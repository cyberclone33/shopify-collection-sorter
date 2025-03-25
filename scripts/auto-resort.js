// Automatic re-sorting script for collection sorter
import { PrismaClient } from '@prisma/client';
import { shopify } from '../app/shopify.server.js';
import { sortCollection } from '../app/utils/collection-sorter.js';

const prisma = new PrismaClient();

export async function autoResortCollections() {
  console.log(`[${new Date().toISOString()}] Starting automatic collection re-sort`);
  
  try {
    // Get all sorted collections from the database
    const sortedCollections = await prisma.$queryRawUnsafe(
      `SELECT * FROM "SortedCollection" ORDER BY "sortedAt" ASC`
    );
    
    console.log(`Found ${sortedCollections.length} collections to re-sort`);
    
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
          continue;
        }
        
        // Create admin API client for this shop
        const adminApi = new shopify.api.clients.Graphql({
          session
        });
        
        // Re-sort the collection
        await sortCollection(adminApi, session, collectionId, 250);
        
        console.log(`Successfully re-sorted collection ${collectionTitle}`);
      } catch (error) {
        console.error(`Error re-sorting collection ${collectionId} for shop ${shop}:`, error);
      }
    }
    
    console.log(`[${new Date().toISOString()}] Completed automatic collection re-sort`);
  } catch (error) {
    console.error('Error during automatic re-sort:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// If this script is run directly (not imported)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  autoResortCollections()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error during auto-resort:', error);
      process.exit(1);
    });
}
