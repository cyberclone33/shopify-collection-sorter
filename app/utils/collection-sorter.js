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
      newPosition: (startPosition + index).toString()
    }));
    
    // Reorder the collection
    const reorderResponse = await admin.graphql(
      `mutation CollectionReorderProducts($collectionId: ID!, $moves: [MoveInput!]!) {
        collectionReorderProducts(id: $collectionId, moves: $moves) {
          job {
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
  
  // Log the success and return the result
  console.log(`Successfully re-sorted collection ${collectionTitle}`);
  
  // Store the sorting result in the database
  try {
    await prisma.sortedCollection.upsert({
      where: {
        shopDomain_collectionId: {
          shopDomain: session.shop,
          collectionId
        }
      },
      update: {
        lastSortedAt: new Date()
      },
      create: {
        id: uuidv4(),
        shopDomain: session.shop,
        collectionId,
        collectionTitle,
        lastSortedAt: new Date()
      }
    });
  } catch (error) {
    console.error(`Error updating database record: ${error.message}`);
  }
  
  return {
    success: true,
    message: `Successfully re-sorted collection ${collectionTitle}`,
    inStockCount: inStockProducts.length,
    outOfStockCount: outOfStockProducts.length
  };
}
