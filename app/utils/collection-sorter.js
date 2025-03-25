// Collection sorting utility functions
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Sort a collection by moving out-of-stock products to the end
 * @param {Object} admin - Shopify Admin API client
 * @param {Object} session - Shopify session
 * @param {String} collectionId - The Shopify collection ID to sort
 * @param {Number} maxProducts - Maximum number of products to process (default: 250)
 * @returns {{ 
 *   success: boolean;
 *   message: string;
 *   inStockCount: number;
 *   outOfStockCount: number;
 * }} - The result of the sorting operation
 */
export async function sortCollection(admin, session, collectionId, maxProducts = 250) {
  console.log(`Sorting collection ${collectionId} with max ${maxProducts} products`);
  
  let allProducts = [];
  let hasNextPage = true;
  let cursor = null;
  let collectionTitle = "";
  
  // Fetch all products in the collection
  while (hasNextPage) {
    const productsResponse = await admin.graphql(
      `query GetCollectionProducts($collectionId: ID!, $first: Int!, $after: String) {
        collection(id: $collectionId) {
          id
          title
          products(first: $first, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              cursor
              node {
                id
                title
                status
                totalInventory
              }
            }
          }
        }
      }`,
      {
        variables: {
          collectionId,
          first: Math.min(maxProducts, 250),
          after: cursor
        }
      }
    );

    const productsData = await productsResponse.json();
    
    // Check for GraphQL errors
    if (productsData.errors) {
      const errorMessage = productsData.errors.map(err => err.message).join(", ");
      throw new Error(`Error fetching products: ${errorMessage}`);
    }
    
    const collection = productsData.data?.collection;
    if (!collection) {
      throw new Error("Collection not found");
    }
    
    const pageInfo = collection.products.pageInfo;
    const products = collection.products.edges.map(edge => ({
      ...edge.node,
      cursor: edge.cursor
    }));
    
    allProducts = [...allProducts, ...products];
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
    
    // Save the collection title from the first response
    if (collectionTitle === "") {
      collectionTitle = collection.title;
    }
    
    // If we've reached our product limit, stop fetching
    if (allProducts.length >= maxProducts) {
      hasNextPage = false;
    }
  }
  
  // Separate in-stock and out-of-stock products
  const inStockProducts = allProducts.filter(product => 
    product.status === "ACTIVE" && product.totalInventory > 0
  );
  const outOfStockProducts = allProducts.filter(product => 
    product.status !== "ACTIVE" || product.totalInventory <= 0
  );
  
  // Get collection's sort order
  const collectionResponse = await admin.graphql(
    `query GetCollectionSortOrder($collectionId: ID!) {
      collection(id: $collectionId) {
        sortOrder
      }
    }`,
    {
      variables: { collectionId }
    }
  );

  const collectionData = await collectionResponse.json();
  const sortOrder = collectionData.data.collection.sortOrder;
  
  // Update sort order to MANUAL if it's not already
  if (sortOrder !== "MANUAL") {
    console.log(`Collection ${collectionTitle} has sort order ${sortOrder}. Updating to MANUAL first...`);
    
    const updateSortOrderResponse = await admin.graphql(
      `mutation UpdateCollectionSortOrder($collectionId: ID!) {
        collectionUpdate(input: {id: $collectionId, sortOrder: MANUAL}) {
          collection {
            id
            sortOrder
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: { collectionId }
      }
    );

    const updateSortOrderData = await updateSortOrderResponse.json();
    
    if (updateSortOrderData.data?.collectionUpdate?.userErrors?.length > 0) {
      const errors = updateSortOrderData.data.collectionUpdate.userErrors.map(err => err.message).join(", ");
      throw new Error(`Error updating collection sort order: ${errors}`);
    }
    
    // Small delay to ensure sort order update is processed
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Reorder products to move out-of-stock items to the end
  const newOrder = [...inStockProducts, ...outOfStockProducts];
  
  if (newOrder.length === 0) {
    console.log(`Collection ${collectionTitle} has no products to sort`);
    return {
      success: true,
      message: `Collection "${collectionTitle}" has no products to sort.`,
      inStockCount: 0,
      outOfStockCount: 0
    };
  }
  
  // Process in batches if needed
  const batchSize = 250;
  const batches = [];
  
  for (let i = 0; i < newOrder.length; i += batchSize) {
    batches.push(newOrder.slice(i, i + batchSize));
  }
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const startPosition = i * batchSize;
    
    // Format moves for the GraphQL mutation
    const moves = batch.map((product, index) => ({
      id: product.id,
      position: startPosition + index + 1
    }));
    
    // Reorder the collection
    const reorderResponse = await admin.graphql(
      `mutation CollectionReorderProducts($collectionId: ID!, $moves: [MoveInput!]!) {
        collectionReorderProducts(id: $collectionId, moves: $moves) {
          job {
            id
          }
          reorderedCollection {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          collectionId,
          moves
        }
      }
    );

    const reorderData = await reorderResponse.json();
    
    if (reorderData.data?.collectionReorderProducts?.userErrors?.length > 0) {
      const errors = reorderData.data.collectionReorderProducts.userErrors.map(err => err.message).join(", ");
      throw new Error(`Error reordering products: ${errors}`);
    }
  }
  
  // Update the SortedCollection entry in the database
  await updateSortedCollectionRecord(session.shop, collectionId, collectionTitle);
  
  return {
    success: true,
    message: `Successfully sorted collection "${collectionTitle}" with ${inStockProducts.length} in-stock and ${outOfStockProducts.length} out-of-stock products.`,
    inStockCount: inStockProducts.length,
    outOfStockCount: outOfStockProducts.length
  };
}

/**
 * Update or create a SortedCollection record in the database
 */
async function updateSortedCollectionRecord(shop, collectionId, collectionTitle) {
  try {
    // Ensure the table exists
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SortedCollection" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "shop" TEXT NOT NULL,
        "collectionId" TEXT NOT NULL,
        "collectionTitle" TEXT NOT NULL,
        "sortedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "sortOrder" TEXT NOT NULL DEFAULT 'MANUAL'
      )
    `);
    
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "shop_collectionId" ON "SortedCollection"("shop", "collectionId")
    `);
    
    // Generate a UUID for the record
    const uuid = uuidv4();
    
    // Update the record
    await prisma.$executeRawUnsafe(`
      INSERT INTO "SortedCollection" ("id", "shop", "collectionId", "collectionTitle", "sortedAt", "sortOrder")
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT ("shop", "collectionId") 
      DO UPDATE SET "collectionTitle" = ?, "sortedAt" = ?, "sortOrder" = ?
    `, 
    uuid, 
    shop, 
    collectionId, 
    collectionTitle, 
    new Date().toISOString(),
    "MANUAL",
    collectionTitle,
    new Date().toISOString(),
    "MANUAL"
    );
    
    console.log(`Updated SortedCollection record for ${collectionTitle}`);
  } catch (error) {
    console.error('Error updating SortedCollection record:', error);
    throw error;
  }
}
