import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { sortCollection } from "../utils/collection-sorter";

const prisma = new PrismaClient();

// This secure token should be set as an environment variable
const AUTO_RESORT_SECRET = process.env.AUTO_RESORT_SECRET || "change-me-in-env-vars";

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
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    // Validate the request has the correct secret token
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    
    if (token !== AUTO_RESORT_SECRET) {
      console.error(`Unauthorized auto-resort attempt with token: ${token}`);
      return json({ error: "Unauthorized" }, { status: 401 });
    }
    
    console.log(`[${new Date().toISOString()}] Starting automatic collection re-sort`);
    
    // Get all sorted collections from the database
    const sortedCollections = await prisma.$queryRawUnsafe<SortedCollection[]>(
      `SELECT * FROM "SortedCollection" ORDER BY "sortedAt" ASC`
    );
    
    const results = {
      totalCollections: sortedCollections.length,
      successful: 0,
      failed: 0,
      details: [] as SortResult[]
    };
    
    // Process each collection
    for (const collection of sortedCollections) {
      const { shop, collectionId, collectionTitle } = collection;
      
      try {
        console.log(`Re-sorting collection ${collectionTitle} (${collectionId}) for shop ${shop}`);
        
        // Get session for this shop
        const session = await prisma.session.findFirst({
          where: { shop }
        });
        
        if (!session) {
          console.log(`No session found for shop ${shop}, skipping collection`);
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
        sessionHeaders.append('X-Shopify-Shop', shop);
        
        // Create a mock request with the session context attached
        const mockRequest = new Request('https://admin.shopify.com', {
          headers: sessionHeaders
        });
        
        // Use the mock request to authenticate and get admin API
        const { admin } = await authenticate.admin(mockRequest);
        
        // Re-sort the collection
        const sortResult = await sortCollection(admin, session, collectionId, 250);
        
        console.log(`Successfully re-sorted collection ${collectionTitle}`);
        results.successful++;
        results.details.push({
          collection: collectionTitle,
          success: true,
          inStockCount: sortResult.inStockCount,
          outOfStockCount: sortResult.outOfStockCount
        });
      } catch (error) {
        console.error(`Error re-sorting collection ${collectionId} for shop ${shop}:`, error);
        results.failed++;
        results.details.push({
          collection: collectionTitle || collectionId,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    console.log(`[${new Date().toISOString()}] Completed automatic collection re-sort`);
    return json(results);
  } catch (error) {
    console.error('Error during automatic re-sort:', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

// Provide a simple status endpoint for GET requests to check if the service is available
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  
  if (token !== AUTO_RESORT_SECRET) {
    return json({ status: "Endpoint available, token required for operations." });
  }
  
  try {
    // Count sorted collections
    const countResult = await prisma.$queryRawUnsafe<[{count: number}]>(
      `SELECT COUNT(*) as count FROM "SortedCollection"`
    );
    
    return json({
      status: "Service online",
      collectionCount: countResult[0]?.count || 0,
      nextScheduledRun: "Daily at 3:00 AM UTC (configured via external scheduler)"
    });
  } catch (error) {
    return json({ 
      status: "Service online, database error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
