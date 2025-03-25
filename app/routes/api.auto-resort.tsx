import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { sortCollection } from "../utils/collection-sorter";

const prisma = new PrismaClient();

// This secure token should be set as an environment variable
const AUTO_RESORT_SECRET = process.env.AUTO_RESORT_SECRET || "1adeb562b9fcb7ae80555aa49de318be";

interface SortedCollection {
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
  try {
    let isAuthenticated = false;
    let authenticatedShop = '';
    
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
    
    // Get all sorted collections from the database
    const sortedCollections = await prisma.sortedCollection.findMany({
      orderBy: {
        sortedAt: 'asc'
      }
    });
    
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
    
    // Process each collection
    for (const collection of collectionsToProcess) {
      const { shop: collectionShop, collectionId, collectionTitle } = collection;
      
      try {
        console.log(`Re-sorting collection ${collectionTitle} (${collectionId}) for shop ${collectionShop}`);
        
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
        
        // Create admin API client for this shop
        const sessionHeaders = new Headers();
        sessionHeaders.append('X-Shopify-Shop', collectionShop);
        
        // Create a mock request with the session context attached
        const mockRequest = new Request('https://admin.shopify.com', {
          headers: sessionHeaders
        });
        
        // Use the mock request to authenticate and get admin API
        const { admin } = await authenticate.admin(mockRequest);
        
        // Re-sort the collection
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
  } catch (error) {
    console.error("Error in auto-resort:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
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
