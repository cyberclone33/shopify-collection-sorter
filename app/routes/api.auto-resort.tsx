import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { sortCollection } from "../utils/collection-sorter";
import fs from 'fs';
import path from 'path';

// Initialize Prisma client
const prisma = new PrismaClient();

// This secure token should be set as an environment variable
const AUTO_RESORT_SECRET = process.env.AUTO_RESORT_SECRET || "1adeb562b9fcb7ae80555aa49de318be";

interface SortedCollection {
  id: string;
  shop: string;
  collectionId: string;
  collectionTitle: string;
  sortedAt?: Date;
  sortOrder?: string;
}

interface SortResult {
  collection: string;
  success: boolean;
  error?: string;
  inStockCount?: number;
  outOfStockCount?: number;
}

/**
 * API endpoint to trigger automatic collection re-sorting
 * Can be called by an external scheduler service like cron-job.org
 * or from within the app by an authenticated admin user
 */
export async function action({ request }: ActionFunctionArgs) {
  let isAuthenticated = false;
  let authenticatedShop = '';
  
  // Add debug info about the environment
  console.log('DEBUG: Current directory:', process.cwd());
  console.log('DEBUG: DATABASE_URL env var:', process.env.DATABASE_URL);
  console.log('DEBUG: Listing files in data directory:');
  try {
    // Use absolute path to /data instead of relative path
    const dataDir = '/data';
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);
      console.log('Files in data dir:', files);
    } else {
      console.log('Data directory does not exist');
      
      // Try to create the data directory if it doesn't exist
      try {
        console.log('Attempting to create data directory');
        fs.mkdirSync(dataDir, { recursive: true });
        console.log('Data directory created successfully');
        
        // Create prisma subdirectory
        const prismaDir = path.join(dataDir, 'prisma');
        fs.mkdirSync(prismaDir, { recursive: true });
        console.log('Prisma directory created successfully');
      } catch (mkdirError) {
        console.error('Error creating data directory:', mkdirError);
      }
    }
  } catch (fsError) {
    console.error('Error listing data directory:', fsError);
  }
  
  // Check if this is a token-based request (from external scheduler)
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  
  if (token === AUTO_RESORT_SECRET) {
    isAuthenticated = true;
    console.log(`[${new Date().toISOString()}] Starting automatic collection re-sort via token`);
  } else {
    // If not token-based, verify it's from an authenticated admin user
    try {
      // This will throw if not authenticated
      const { admin, session } = await authenticate.admin(request);
      if (admin && session) {
        isAuthenticated = true;
        authenticatedShop = session.shop;
        console.log(`[${new Date().toISOString()}] Starting automatic collection re-sort via admin user for shop: ${authenticatedShop}`);
      }
    } catch (authError) {
      console.error('Authentication error:', authError);
      return json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  
  if (!isAuthenticated) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  
  // Get all sorted collections from the database using raw SQL as fallback
  let sortedCollections: SortedCollection[] = [];
  try {
    // Try using Prisma's type-safe API first
    sortedCollections = await prisma.sortedCollection.findMany({
      orderBy: {
        sortedAt: 'asc'
      }
    });
  } catch (dbError) {
    console.error('Error using Prisma type-safe API, falling back to raw query:', dbError);
    
    // Check if the error is "no such table" and try to create it
    if (dbError instanceof Error && dbError.message.includes('no such table')) {
      console.log('Attempting to create missing SortedCollection table...');
      try {
        // Explicit verbose debugging
        console.log('DEBUG: Prisma client configuration:', {
          provider: 'SQLite',
          databaseUrl: process.env.DATABASE_URL || 'not set'
        });
        
        // Create the SortedCollection table if it doesn't exist
        console.log('DEBUG: Executing raw SQL to create table');
        await prisma.$executeRaw`
          CREATE TABLE IF NOT EXISTS SortedCollection (
            id TEXT PRIMARY KEY,
            shop TEXT NOT NULL,
            collectionId TEXT NOT NULL,
            collectionTitle TEXT NOT NULL,
            sortedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            sortOrder TEXT NOT NULL DEFAULT 'MANUAL',
            UNIQUE(shop, collectionId)
          )
        `;
        console.log('SortedCollection table created successfully');
        
        // Since we just created an empty table, return an empty array
        sortedCollections = [];
      } catch (createError) {
        console.error('Failed to create SortedCollection table:', createError);
        // More detailed error info
        if (createError instanceof Error) {
          console.error('Error details:', {
            name: createError.name,
            message: createError.message,
            stack: createError.stack
          });
        }
        return json({ error: "Database error", details: String(createError) }, { status: 500 });
      }
    } else {
      // For other database errors, try the raw query anyway
      try {
        sortedCollections = await prisma.$queryRaw`SELECT * FROM SortedCollection ORDER BY sortedAt ASC`;
      } catch (rawQueryError) {
        console.error('Raw query also failed:', rawQueryError);
        return json({ error: "Database query error", details: String(rawQueryError) }, { status: 500 });
      }
    }
  }
  
  // If authenticated as a specific shop, only process collections for that shop
  const collectionsToProcess = authenticatedShop 
    ? sortedCollections.filter(c => c.shop === authenticatedShop)
    : sortedCollections;
  
  const results = {
    totalCollections: collectionsToProcess.length,
    successful: 0,
    failed: 0,
    details: [] as Array<{
      collection: string;
      success: boolean;
      error?: string;
      inStockCount?: number;
      outOfStockCount?: number;
    }>
  };
  
  console.log(`Found ${collectionsToProcess.length} collections to process`);
  
  // Process each collection
  for (const collection of collectionsToProcess) {
    const { shop: collectionShop, collectionId, collectionTitle } = collection;
    
    // Get session for this shop
    const dbSession = await prisma.session.findFirst({
      where: { shop: collectionShop }
    });
    
    if (!dbSession) {
      console.log(`No session found for shop ${collectionShop}, skipping collection`);
      results.failed++;
      results.details.push({
        collection: collectionTitle,
        success: false,
        error: "No session found for shop"
      });
      continue;
    }
    
    // Create admin API client for this shop using the session data directly
    console.log('Creating admin API client with session data');
    
    try {
      // Get the authenticated admin client
      const { admin } = await authenticate.admin(request);
      
      // Re-sort the collection using the admin client and session
      const sortResult = await sortCollection(admin, dbSession, collectionId, 250);
      
      console.log(`Successfully re-sorted collection ${collectionTitle}`);
      results.successful++;
      results.details.push({
        collection: collectionTitle,
        success: true,
        inStockCount: sortResult.inStockCount,
        outOfStockCount: sortResult.outOfStockCount
      });
    } catch (error) {
      console.error(`Error re-sorting collection ${collectionId} for shop ${collectionShop}:`, error);
      results.failed++;
      results.details.push({
        collection: collectionTitle || collectionId,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  console.log(`Auto-resort complete. Results: ${results.successful} successful, ${results.failed} failed`);
  
  return json(results);
}

/**
 * Provide a simple status endpoint for GET requests to check if the service is available
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  
  if (token !== AUTO_RESORT_SECRET) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  
  return json({
    status: "ok",
    message: "Auto-resort service is running",
    timestamp: new Date().toISOString()
  });
}
