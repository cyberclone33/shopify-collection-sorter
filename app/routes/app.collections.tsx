import React, { useState, useCallback } from "react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  Text,
  Banner,
  List,
  BlockStack,
  Spinner,
  EmptyState,
  Link,
  TextField,
  Select,
  InlineStack,
  Box,
  Pagination,
  Badge,
  Checkbox
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Define types for our data
interface Collection {
  id: string;
  title: string;
  productsCount: {
    count: number;
  };
  sortOrder: string;
}

interface ActionData {
  success: boolean;
  message: string;
  inStockCount?: number;
  outOfStockCount?: number;
  collectionTitle?: string;
  successfulSorts?: Array<{
    title: string;
    inStockCount: number;
    outOfStockCount: number;
    message: string;
  }>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  // Shopify has a hard limit of 250 items per query
  const maxCollectionsPerPage = 250;
  const maxCollections = 400;

  // First query to get the first 250 collections
  const collectionsResponse = await admin.graphql(
    `#graphql
      query GetCollections($first: Int!, $after: String) {
        collections(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              productsCount {
                count
              }
              sortOrder
            }
            cursor
          }
        }
      }
    `,
    {
      variables: {
        first: maxCollectionsPerPage,
      },
    }
  );

  const collectionsData = await collectionsResponse.json();
  let collections = collectionsData.data.collections.edges.map((edge: any) => edge.node);
  
  // If there are more collections and we haven't reached our limit, fetch the next page
  if (
    collectionsData.data.collections.pageInfo.hasNextPage && 
    collections.length < maxCollections
  ) {
    const remainingToFetch = Math.min(maxCollectionsPerPage, maxCollections - collections.length);
    const cursor = collectionsData.data.collections.pageInfo.endCursor;
    
    try {
      const nextPageResponse = await admin.graphql(
        `#graphql
          query GetCollections($first: Int!, $after: String) {
            collections(first: $first, after: $after) {
              edges {
                node {
                  id
                  title
                  productsCount {
                    count
                  }
                  sortOrder
                }
              }
            }
          }
        `,
        {
          variables: {
            first: remainingToFetch,
            after: cursor
          },
        }
      );

      const nextPageData = await nextPageResponse.json();
      const nextPageCollections = nextPageData.data.collections.edges.map((edge: any) => edge.node);
      
      // Combine results
      collections = [...collections, ...nextPageCollections];
    } catch (error) {
      console.error("Error fetching additional collections:", error);
    }
  }
  
  return json({
    collections
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const collectionId = formData.get("collectionId")?.toString();
  const productLimit = formData.get("productLimit")?.toString() || "250";
  const bulkSort = formData.get("bulkSort")?.toString() || "false";
  const remainingCollections = formData.get("remainingCollections")?.toString() || "";

  if (!collectionId) {
    return json({ success: false, message: "Collection ID is required" });
  }

  try {
    // 1. Fetch products from the collection
    const maxProductsPerPage = 250; // Shopify's limit per API call
    const maxTotalProducts = parseInt(productLimit, 10);
    let allProducts: any[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;
    let collectionTitle = "";
    
    // Fetch products with pagination
    while (hasNextPage && allProducts.length < maxTotalProducts) {
      const remainingLimit = Math.min(maxProductsPerPage, maxTotalProducts - allProducts.length);
      
      // Skip additional queries if we don't need more products
      if (remainingLimit <= 0) break;
      
      const productsResponse: Response = await admin.graphql(
        `#graphql
          query GetCollectionProducts($collectionId: ID!, $first: Int!, $after: String) {
            collection(id: $collectionId) {
              title
              products(first: $first, after: $after) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                edges {
                  node {
                    id
                    title
                    handle
                    totalInventory
                    status
                  }
                  cursor
                }
              }
            }
          }
        `,
        { 
          variables: { 
            collectionId,
            first: remainingLimit,
            after: cursor
          } 
        }
      );

      const productsData: any = await productsResponse.json();
      
      // Check for GraphQL errors
      if (productsData.errors) {
        const errorMessage = productsData.errors.map((err: any) => err.message).join(", ");
        return json({ success: false, message: `Error fetching products: ${errorMessage}` });
      }
      
      const collection: any = productsData.data.collection;
      if (!collection) {
        return json({ success: false, message: "Collection not found" });
      }
      
      const pageInfo: any = collection.products.pageInfo;
      const products = collection.products.edges.map((edge: any) => ({
        ...edge.node,
        cursor: edge.cursor
      }));
      
      allProducts = [...allProducts, ...products];
      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;
      
      // Save the collection title from the first response
      if (collectionTitle === "") {
        collectionTitle = collection.title;
        console.log(`Captured collection title: "${collectionTitle}"`);
      }
      
      // If we've reached our product limit, stop fetching
      if (allProducts.length >= maxTotalProducts) {
        hasNextPage = false;
      }
    }

    // Use the collection title from the queries
    console.log(`Using collection title for sorting: "${collectionTitle}"`);
    
    // 2. Separate in-stock and out-of-stock products
    const inStockProducts = allProducts.filter((product: any) => 
      product.status === "ACTIVE" && product.totalInventory > 0
    );
    const outOfStockProducts = allProducts.filter((product: any) => 
      product.status !== "ACTIVE" || product.totalInventory <= 0
    );

    // 3. Get collection's manual sort order if it's manually sorted
    const collectionResponse = await admin.graphql(
      `#graphql
        query GetCollectionSortOrder($collectionId: ID!) {
          collection(id: $collectionId) {
            sortOrder
          }
        }
      `,
      { variables: { collectionId } }
    );

    const collectionData = await collectionResponse.json();
    const sortOrder = collectionData.data.collection.sortOrder;

    // Different approach based on sort order
    if (outOfStockProducts.length > 0) {
      // For non-MANUAL collections, we must first update the sort order to MANUAL
      if (sortOrder !== "MANUAL") {
        console.log(`Collection ${collectionTitle} has sort order ${sortOrder}. Updating to MANUAL first...`);
        // Update collection to MANUAL sort order first
        const updateSortOrderResponse = await admin.graphql(
          `#graphql
            mutation UpdateCollectionSortOrder($collectionId: ID!) {
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
            }
          `,
          { 
            variables: { 
              collectionId
            } 
          }
        );

        const updateSortOrderData = await updateSortOrderResponse.json();
        console.log('Sort order update response:', JSON.stringify(updateSortOrderData, null, 2));
        
        if (updateSortOrderData.data?.collectionUpdate?.userErrors?.length > 0) {
          const errors = updateSortOrderData.data.collectionUpdate.userErrors.map((err: any) => err.message).join(", ");
          return json({ success: false, message: `Error updating collection sort order: ${errors}` });
        }
        
        // If there are GraphQL-level errors
        if ('errors' in updateSortOrderData && Array.isArray(updateSortOrderData.errors)) {
          const errors = updateSortOrderData.errors.map((err: any) => err.message).join(", ");
          return json({ success: false, message: `GraphQL error in sort order update: ${errors}` });
        }

        // Small delay to ensure sort order update is processed
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('Collection sort order updated to MANUAL');
      }
      
      // For all collections, we can reorder products
      // Note: For non-manual collections, this will change their sort order to MANUAL
      
      // For each product, we need its ID in the desired order
      const newOrder = [...inStockProducts, ...outOfStockProducts].map(
        (product: any) => product.id
      );

      // Check if the collection has too many products for a single API call
      if (newOrder.length > 250) {
        console.log(`Collection ${collectionTitle} has ${newOrder.length} products, which exceeds Shopify's limit. Using a batched approach.`);
        
        // Process in batches of 250 products max
        let success = true;
        const batchSize = 250;
        
        // First, only reorder the first 250 products
        // This places all in-stock products at the start, and as many out-of-stock products as will fit
        const firstBatchMoves = newOrder.slice(0, batchSize).map((productId, index) => ({
          id: productId,
          newPosition: index.toString()
        }));
        
        try {
          const firstBatchResponse = await admin.graphql(
            `#graphql
              mutation CollectionReorder($collectionId: ID!, $moves: [MoveInput!]!) {
                collectionReorderProducts(id: $collectionId, moves: $moves) {
                  job {
                    id
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }
            `,
            { 
              variables: { 
                collectionId,
                moves: firstBatchMoves
              } 
            }
          );

          const firstBatchData = await firstBatchResponse.json();
          
          if (firstBatchData.data?.collectionReorderProducts?.userErrors?.length > 0) {
            const errors = firstBatchData.data.collectionReorderProducts.userErrors.map((err: any) => err.message).join(", ");
            console.error(`Error in first batch reordering: ${errors}`);
            success = false;
          }
          
          if ('errors' in firstBatchData && Array.isArray(firstBatchData.errors)) {
            const errors = firstBatchData.errors.map((err: any) => err.message).join(", ");
            console.error(`GraphQL error in first batch: ${errors}`);
            success = false;
          }
          
          // Small delay to let Shopify process the first batch
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // If there are more products, handle them in a second batch
          if (success && newOrder.length > batchSize) {
            // For the second batch, we're now placing the remaining out-of-stock products at the end
            const secondBatchMoves = newOrder.slice(batchSize).map((productId, index) => ({
              id: productId,
              newPosition: (batchSize + index).toString()
            }));
            
            const secondBatchResponse = await admin.graphql(
              `#graphql
                mutation CollectionReorder($collectionId: ID!, $moves: [MoveInput!]!) {
                  collectionReorderProducts(id: $collectionId, moves: $moves) {
                    job {
                      id
                    }
                    userErrors {
                      field
                      message
                    }
                  }
                }
              `,
              { 
                variables: { 
                  collectionId,
                  moves: secondBatchMoves
                } 
              }
            );
            
            const secondBatchData = await secondBatchResponse.json();
            
            if (secondBatchData.data?.collectionReorderProducts?.userErrors?.length > 0) {
              const errors = secondBatchData.data.collectionReorderProducts.userErrors.map((err: any) => err.message).join(", ");
              console.error(`Error in second batch reordering: ${errors}`);
              success = false;
            }
            
            if ('errors' in secondBatchData && Array.isArray(secondBatchData.errors)) {
              const errors = secondBatchData.errors.map((err: any) => err.message).join(", ");
              console.error(`GraphQL error in second batch: ${errors}`);
              success = false;
            }
          }
          
          if (!success) {
            return json({ success: false, message: `Error reordering collection: Some batches failed. The collection may only be partially sorted.` });
          }
          
        } catch (error) {
          console.error("Error in batched reordering:", error);
          return json({ success: false, message: `Error reordering collection: ${error instanceof Error ? error.message : String(error)}` });
        }
      } else {
        // For collections with fewer than 250 products, use the original approach
        // Create proper "moves" input format for the reordering mutation
        const moves = newOrder.map((productId, index) => ({
          id: productId,
          newPosition: index.toString() // Convert to string to satisfy UnsignedInt64 type requirement
        }));

        // Update the collection's sort order
        const updateResponse = await admin.graphql(
          `#graphql
            mutation CollectionReorder($collectionId: ID!, $moves: [MoveInput!]!) {
              collectionReorderProducts(id: $collectionId, moves: $moves) {
                job {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          { 
            variables: { 
              collectionId,
              moves: moves
            } 
          }
        );

        const updateData = await updateResponse.json();
        
        // Log the entire GraphQL response for debugging
        console.log('Collection reorder response:', JSON.stringify(updateData, null, 2));
        
        if (updateData.data?.collectionReorderProducts?.userErrors?.length > 0) {
          const errors = updateData.data.collectionReorderProducts.userErrors.map((err: any) => err.message).join(", ");
          return json({ success: false, message: `Error reordering collection: ${errors}` });
        }
        
        // If there are GraphQL-level errors
        if ('errors' in updateData && Array.isArray(updateData.errors)) {
          const errors = updateData.errors.map((err: any) => err.message).join(", ");
          return json({ success: false, message: `GraphQL error: ${errors}` });
        }
      }
      
      // Prepare the success message based on whether the sort order was changed
      let message = `Collection '${collectionTitle}' has been sorted with ${inStockProducts.length} in-stock products listed first, followed by ${outOfStockProducts.length} out-of-stock products.`;
      
      // If the collection wasn't manually sorted before, add a note about the sort order change
      if (sortOrder !== "MANUAL") {
        message += ` Note: The collection's sort order has been changed from ${sortOrder} to MANUAL.`;
      }
      
      // Save the sorted collection to the database
      await prisma.$transaction(async (tx) => {
        // First, ensure the table exists
        await tx.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "SortedCollection" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "shop" TEXT NOT NULL,
            "collectionId" TEXT NOT NULL,
            "collectionTitle" TEXT NOT NULL,
            "sortedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "sortOrder" TEXT NOT NULL
          )
        `);
        
        await tx.$executeRawUnsafe(`
          CREATE UNIQUE INDEX IF NOT EXISTS "shop_collectionId" ON "SortedCollection"("shop", "collectionId")
        `);
        
        // Using properly formatted UUID instead of custom ID format
        const uuid = `cuid-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        
        // Log the collection title being saved
        console.log(`Saving collection to database with title: "${collectionTitle}"`);
        
        // Using raw queries since the model might not be fully recognized by TypeScript yet
        await tx.$executeRawUnsafe(`
          INSERT INTO "SortedCollection" ("id", "shop", "collectionId", "collectionTitle", "sortedAt", "sortOrder")
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT ("shop", "collectionId") 
          DO UPDATE SET "collectionTitle" = ?, "sortedAt" = ?, "sortOrder" = ?
        `, 
        uuid, 
        session.shop, 
        collectionId, 
        collectionTitle, 
        new Date().toISOString(),
        "MANUAL",
        collectionTitle, // This ensures the title is updated properly
        new Date().toISOString(),
        "MANUAL"
        );
      });
      
      if (bulkSort === "true" && remainingCollections) {
        const remainingCollectionIds = remainingCollections.split(",");
        const successfulSorts: any[] = [];
        for (const remainingCollectionId of remainingCollectionIds) {
          // Fetch products from the collection
          const maxProductsPerPage = 250; // Shopify's limit per API call
          let remainingInStockProducts: any[] = [];
          let remainingOutOfStockProducts: any[] = [];
          let allRemainingProducts: any[] = [];
          let hasNextPage = true;
          let cursor: string | null = null;
          let remainingCollectionTitle = "";
          
          // Fetch products with pagination
          while (hasNextPage && allRemainingProducts.length < parseInt(productLimit, 10)) {
            const remainingLimit = Math.min(maxProductsPerPage, parseInt(productLimit, 10) - allRemainingProducts.length);
            
            // Skip additional queries if we don't need more products
            if (remainingLimit <= 0) break;
            
            const remainingProductsResponse: Response = await admin.graphql(
              `#graphql
                query GetCollectionProducts($collectionId: ID!, $first: Int!, $after: String) {
                  collection(id: $collectionId) {
                    title
                    products(first: $first, after: $after) {
                      pageInfo {
                        hasNextPage
                        endCursor
                      }
                      edges {
                        node {
                          id
                          title
                          handle
                          totalInventory
                          status
                        }
                        cursor
                      }
                    }
                  }
                }
              `,
              { 
                variables: { 
                  collectionId: remainingCollectionId,
                  first: remainingLimit,
                  after: cursor
                } 
              }
            );

            const remainingProductsData: any = await remainingProductsResponse.json();
            
            // Check for GraphQL errors
            if (remainingProductsData.errors) {
              console.error("Error in bulk sorting collection:", JSON.stringify(remainingProductsData.errors, null, 2));
              continue; // Skip this collection if there's an error
            }
            
            const remainingCollection: any = remainingProductsData.data.collection;
            if (!remainingCollection) {
              console.error("Collection not found:", remainingCollectionId);
              continue; // Skip if collection not found
            }
            
            const pageInfo: any = remainingCollection.products.pageInfo;
            const fetchedProducts = remainingCollection.products.edges.map((edge: any) => ({
              ...edge.node,
              cursor: edge.cursor
            }));
            
            allRemainingProducts = [...allRemainingProducts, ...fetchedProducts];
            hasNextPage = pageInfo.hasNextPage;
            cursor = pageInfo.endCursor;
            
            // Save the collection title on first iteration
            if (allRemainingProducts.length === 0) {
              remainingCollectionTitle = remainingCollection.title;
            }
            
            // If we've reached our product limit, stop fetching
            if (allRemainingProducts.length >= parseInt(productLimit, 10)) {
              hasNextPage = false;
            }
          }

          // Use the collection title from the queries
          const remainingCollection = {
            title: remainingCollectionTitle
          };

          // Separate in-stock and out-of-stock products
          remainingInStockProducts = allRemainingProducts.filter((product: any) => 
            product.status === "ACTIVE" && product.totalInventory > 0
          );
          
          remainingOutOfStockProducts = allRemainingProducts.filter((product: any) => 
            product.status !== "ACTIVE" || product.totalInventory <= 0
          );
          
          // Get collection's manual sort order if it's manually sorted
          const remainingCollectionResponse = await admin.graphql(
            `#graphql
              query GetCollectionSortOrder($collectionId: ID!) {
                collection(id: $collectionId) {
                  sortOrder
                }
              }
            `,
            { variables: { collectionId: remainingCollectionId } }
          );

          const remainingCollectionData = await remainingCollectionResponse.json();
          const remainingSortOrder = remainingCollectionData.data.collection.sortOrder;

          // Different approach based on sort order
          if (remainingOutOfStockProducts.length > 0) {
            // For non-MANUAL collections, we must first update the sort order to MANUAL
            if (remainingSortOrder !== "MANUAL") {
              console.log(`Collection ${remainingCollection.title} has sort order ${remainingSortOrder}. Updating to MANUAL first...`);
              // Update collection to MANUAL sort order first
              const updateSortOrderResponse = await admin.graphql(
                `#graphql
                  mutation UpdateCollectionSortOrder($collectionId: ID!) {
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
                  }
                `,
                { 
                  variables: { 
                    collectionId: remainingCollectionId
                  } 
                }
              );

              const updateSortOrderData = await updateSortOrderResponse.json();
              console.log('Sort order update response:', JSON.stringify(updateSortOrderData, null, 2));
              
              if (updateSortOrderData.data?.collectionUpdate?.userErrors?.length > 0) {
                const errors = updateSortOrderData.data.collectionUpdate.userErrors.map((err: any) => err.message).join(", ");
                return json({ success: false, message: `Error updating collection sort order: ${errors}` });
              }
              
              // If there are GraphQL-level errors
              if ('errors' in updateSortOrderData && Array.isArray(updateSortOrderData.errors)) {
                const errors = updateSortOrderData.errors.map((err: any) => err.message).join(", ");
                return json({ success: false, message: `GraphQL error in sort order update: ${errors}` });
              }

              // Small delay to ensure sort order update is processed
              await new Promise(resolve => setTimeout(resolve, 1000));
              console.log('Collection sort order updated to MANUAL');
            }
            
            // Now the collection is MANUAL, we can proceed with reordering
            // For each product, we need its ID in the desired order
            const newOrder = [...remainingInStockProducts, ...remainingOutOfStockProducts].map(
              (product: any) => product.id
            );

            // Check if the collection has too many products for a single API call
            if (newOrder.length > 250) {
              console.log(`Collection ${remainingCollection.title} has ${newOrder.length} products, which exceeds Shopify's limit. Using a batched approach.`);
              
              // Process in batches of 250 products max
              let success = true;
              const batchSize = 250;
              
              // First, only reorder the first 250 products
              // This places all in-stock products at the start, and as many out-of-stock products as will fit
              const firstBatchMoves = newOrder.slice(0, batchSize).map((productId, index) => ({
                id: productId,
                newPosition: index.toString()
              }));
              
              try {
                const firstBatchResponse = await admin.graphql(
                  `#graphql
                    mutation CollectionReorder($collectionId: ID!, $moves: [MoveInput!]!) {
                      collectionReorderProducts(id: $collectionId, moves: $moves) {
                        job {
                          id
                        }
                        userErrors {
                          field
                          message
                        }
                      }
                    }
                  `,
                  { 
                    variables: { 
                      collectionId: remainingCollectionId,
                      moves: firstBatchMoves
                    } 
                  }
                );

                const firstBatchData = await firstBatchResponse.json();
                
                if (firstBatchData.data?.collectionReorderProducts?.userErrors?.length > 0) {
                  const errors = firstBatchData.data.collectionReorderProducts.userErrors.map((err: any) => err.message).join(", ");
                  console.error(`Error in first batch reordering: ${errors}`);
                  success = false;
                }
                
                if ('errors' in firstBatchData && Array.isArray(firstBatchData.errors)) {
                  const errors = firstBatchData.errors.map((err: any) => err.message).join(", ");
                  console.error(`GraphQL error in first batch: ${errors}`);
                  success = false;
                }
                
                // Small delay to let Shopify process the first batch
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // If there are more products, handle them in a second batch
                if (success && newOrder.length > batchSize) {
                  // For the second batch, we're now placing the remaining out-of-stock products at the end
                  const secondBatchMoves = newOrder.slice(batchSize).map((productId, index) => ({
                    id: productId,
                    newPosition: (batchSize + index).toString()
                  }));
                  
                  const secondBatchResponse = await admin.graphql(
                    `#graphql
                      mutation CollectionReorder($collectionId: ID!, $moves: [MoveInput!]!) {
                        collectionReorderProducts(id: $collectionId, moves: $moves) {
                          job {
                            id
                          }
                          userErrors {
                            field
                            message
                          }
                        }
                      }
                    `,
                    { 
                      variables: { 
                        collectionId: remainingCollectionId,
                        moves: secondBatchMoves
                      } 
                    }
                  );
                  
                  const secondBatchData = await secondBatchResponse.json();
                  
                  if (secondBatchData.data?.collectionReorderProducts?.userErrors?.length > 0) {
                    const errors = secondBatchData.data.collectionReorderProducts.userErrors.map((err: any) => err.message).join(", ");
                    console.error(`Error in second batch reordering: ${errors}`);
                    success = false;
                  }
                  
                  if ('errors' in secondBatchData && Array.isArray(secondBatchData.errors)) {
                    const errors = secondBatchData.errors.map((err: any) => err.message).join(", ");
                    console.error(`GraphQL error in second batch: ${errors}`);
                    success = false;
                  }
                }
                
                if (!success) {
                  return json({ success: false, message: `Error reordering collection: Some batches failed. The collection may only be partially sorted.` });
                }
                
              } catch (error) {
                console.error("Error in batched reordering:", error);
                return json({ success: false, message: `Error reordering collection: ${error instanceof Error ? error.message : String(error)}` });
              }
            } else {
              // For collections with fewer than 250 products, use the original approach
              // Create proper "moves" input format for the reordering mutation
              const moves = newOrder.map((productId, index) => ({
                id: productId,
                newPosition: index.toString() // Convert to string to satisfy UnsignedInt64 type requirement
              }));

              // Update the collection's sort order
              const updateResponse = await admin.graphql(
                `#graphql
                  mutation CollectionReorder($collectionId: ID!, $moves: [MoveInput!]!) {
                    collectionReorderProducts(id: $collectionId, moves: $moves) {
                      job {
                        id
                      }
                      userErrors {
                        field
                        message
                      }
                    }
                  }
                `,
                { 
                  variables: { 
                    collectionId: remainingCollectionId,
                    moves: moves
                  } 
                }
              );

              const updateData = await updateResponse.json();
              
              // Log the entire GraphQL response for debugging
              console.log('Collection reorder response:', JSON.stringify(updateData, null, 2));
              
              if (updateData.data?.collectionReorderProducts?.userErrors?.length > 0) {
                const errors = updateData.data.collectionReorderProducts.userErrors.map((err: any) => err.message).join(", ");
                return json({ success: false, message: `Error reordering collection: ${errors}` });
              }
              
              // If there are GraphQL-level errors
              if ('errors' in updateData && Array.isArray(updateData.errors)) {
                const errors = updateData.errors.map((err: any) => err.message).join(", ");
                return json({ success: false, message: `GraphQL error: ${errors}` });
              }
            }
            
            // Prepare success message
            let successMessage = `${remainingCollection.title}: ${remainingInStockProducts.length} in-stock products, ${remainingOutOfStockProducts.length} out-of-stock products`;
            
            // If the collection wasn't manually sorted before, add a note about the sort order change
            if (remainingSortOrder !== "MANUAL") {
              successMessage += ` (sort order changed from ${remainingSortOrder} to MANUAL)`;
            }
            
            successfulSorts.push({
              title: remainingCollection.title,
              inStockCount: remainingInStockProducts.length,
              outOfStockCount: remainingOutOfStockProducts.length,
              message: successMessage
            });
            
            // Save the sorted collection to the database
            await prisma.$transaction(async (tx) => {
              // First, ensure the table exists
              await tx.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "SortedCollection" (
                  "id" TEXT NOT NULL PRIMARY KEY,
                  "shop" TEXT NOT NULL,
                  "collectionId" TEXT NOT NULL,
                  "collectionTitle" TEXT NOT NULL,
                  "sortedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  "sortOrder" TEXT NOT NULL DEFAULT 'MANUAL'
                )
              `);
              
              await tx.$executeRawUnsafe(`
                CREATE UNIQUE INDEX IF NOT EXISTS "shop_collectionId" ON "SortedCollection"("shop", "collectionId")
              `);
              
              // Using properly formatted UUID instead of custom ID format
              const uuid = `cuid-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
              
              // Using raw queries since the model might not be fully recognized by TypeScript yet
              await tx.$executeRawUnsafe(`
                INSERT INTO "SortedCollection" ("id", "shop", "collectionId", "collectionTitle", "sortedAt", "sortOrder")
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT ("shop", "collectionId") 
                DO UPDATE SET "collectionTitle" = ?, "sortedAt" = ?, "sortOrder" = ?
              `, 
              uuid, 
              session.shop, 
              remainingCollectionId, 
              remainingCollection.title, 
              new Date().toISOString(),
              "MANUAL",
              remainingCollection.title, // Ensure title is always updated correctly
              new Date().toISOString(),
              "MANUAL"
              );
            });
          }
        }
        return json({ 
          success: true, 
          message: `Bulk sorting completed. ${successfulSorts.length} collections were sorted.`,
          successfulSorts
        });
      }

      return json({ 
        success: true, 
        message: message,
        inStockCount: inStockProducts.length,
        outOfStockCount: outOfStockProducts.length,
        collectionTitle: collectionTitle
      });
    } else {
      return json({ 
        success: true, 
        message: `No out-of-stock products found in "${collectionTitle}"`,
        inStockCount: inStockProducts.length,
        outOfStockCount: 0,
        collectionTitle: collectionTitle
      });
    }
  } catch (error) {
    console.error("Error reordering collection:", error);
    return json({ 
      success: false, 
      message: `Error: ${error instanceof Error ? error.message : "Unknown error occurred"}` 
    });
  }
};

export default function CollectionsPage() {
  const { collections } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";
  
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [productLimit, setProductLimit] = useState("400");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  
  // Add state for tracking selected collections
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [isBulkSorting, setIsBulkSorting] = useState(false);

  // Filter collections based on search query
  const filteredCollections = collections.filter((collection: Collection) => 
    collection.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Paginate filtered collections
  const totalPages = Math.ceil(filteredCollections.length / itemsPerPage);
  const paginatedCollections = filteredCollections.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Handle search input change
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setCurrentPage(1); // Reset to first page on new search
  }, []);

  // Handle product limit change
  const handleProductLimitChange = useCallback((value: string) => {
    setProductLimit(value);
  }, []);

  // Handle sort button click
  const handleSortClick = (collectionId: string) => {
    setSelectedCollectionId(collectionId);
    submit(
      { collectionId, productLimit },
      { method: "POST" }
    );
  };
  
  // Handle toggling collection selection
  const handleCollectionSelect = useCallback((collectionId: string, checked: boolean) => {
    setSelectedCollections(prev => {
      if (checked) {
        return [...prev, collectionId];
      } else {
        return prev.filter(id => id !== collectionId);
      }
    });
  }, []);
  
  // Handle bulk sort button click
  const handleBulkSort = useCallback(() => {
    if (selectedCollections.length === 0) return;
    
    setIsBulkSorting(true);
    
    // Process the first collection right away
    const firstCollection = selectedCollections[0];
    const remainingCollections = selectedCollections.slice(1).join(',');
    
    submit(
      { 
        collectionId: firstCollection, 
        productLimit,
        bulkSort: "true",
        remainingCollections
      },
      { method: "POST" }
    );
  }, [submit, selectedCollections, productLimit]);
  
  // Handle select/deselect all collections on current page
  const handleSelectAllPage = useCallback((checked: boolean) => {
    if (checked) {
      // Add all collections from current page that aren't already selected
      const pageCollectionIds = paginatedCollections.map((collection: Collection) => collection.id);
      setSelectedCollections(prev => {
        const newSelections = [...prev];
        pageCollectionIds.forEach((id: string) => {
          if (!newSelections.includes(id)) {
            newSelections.push(id);
          }
        });
        return newSelections;
      });
    } else {
      // Remove all collections from current page
      const pageCollectionIds = paginatedCollections.map((collection: Collection) => collection.id);
      setSelectedCollections(prev => prev.filter((id: string) => !pageCollectionIds.includes(id)));
    }
  }, [paginatedCollections]);

  return (
    <Page>
      <TitleBar title="Collection Sorter" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Collection Sorter
                </Text>
                <Text as="p" variant="bodyMd">
                  This tool helps you move out-of-stock products to the end of your collections,
                  keeping your in-stock items more visible to customers.
                </Text>
                {actionData?.success === true && (
                  <Banner 
                    title={`Success!`} 
                    tone="success"
                  >
                    <p>{actionData.message}</p>
                    {actionData.inStockCount !== undefined && (
                      <List>
                        <List.Item>In-stock products: {actionData.inStockCount}</List.Item>
                        <List.Item>Out-of-stock products: {actionData.outOfStockCount}</List.Item>
                      </List>
                    )}
                    {actionData.successfulSorts && (
                      <List>
                        {actionData.successfulSorts.map((sort: any) => (
                          <List.Item key={sort.title}>
                            <Text variant="bodyMd" as="span">{sort.title}</Text>
                            <List>
                              <List.Item>In-stock products: {sort.inStockCount}</List.Item>
                              <List.Item>Out-of-stock products: {sort.outOfStockCount}</List.Item>
                            </List>
                            <Text variant="bodyMd" as="span">{sort.message}</Text>
                          </List.Item>
                        ))}
                      </List>
                    )}
                  </Banner>
                )}
                {actionData?.success === false && (
                  <Banner 
                    title="There was an error" 
                    tone="critical"
                  >
                    <p>{actionData.message}</p>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="300" align="space-between">
                  <Box width="66%">
                    <TextField
                      label="Search collections"
                      value={searchQuery}
                      onChange={handleSearchChange}
                      autoComplete="off"
                      placeholder="Enter collection name"
                      clearButton
                      onClearButtonClick={() => handleSearchChange("")}
                    />
                  </Box>
                  <Box width="33%">
                    <Select
                      label="Products per collection"
                      options={[
                        { label: '50 products', value: '50' },
                        { label: '100 products', value: '100' },
                        { label: '250 products', value: '250' },
                        { label: '400 products', value: '400' },
                      ]}
                      onChange={handleProductLimitChange}
                      value={productLimit}
                    />
                  </Box>
                </InlineStack>
                
                <Text as="p" variant="bodyMd">
                  Showing {paginatedCollections.length} of {filteredCollections.length} collections
                </Text>
                
                {/* Add bulk actions section */}
                {paginatedCollections.length > 0 && (
                  <InlineStack align="space-between" blockAlign="center">
                    <Checkbox
                      label="Select all on this page"
                      checked={paginatedCollections.length > 0 && paginatedCollections.every(
                        (collection: Collection) => selectedCollections.includes(collection.id)
                      )}
                      onChange={handleSelectAllPage}
                      disabled={isLoading || isBulkSorting}
                    />
                    <Button
                      disabled={selectedCollections.length === 0 || isLoading || isBulkSorting}
                      onClick={handleBulkSort}
                      variant="primary"
                    >
                      {`${isBulkSorting ? "Sorting" : "Sort"} ${selectedCollections.length} ${isBulkSorting ? "collections..." : "selected collections"}`}
                    </Button>
                  </InlineStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              {collections.length > 0 ? (
                <>
                  {paginatedCollections.map((collection: Collection) => {
                    const { id, title, productsCount, sortOrder } = collection;
                    const isCurrentCollection = selectedCollectionId === id && isLoading;
                    const isSorting = isCurrentCollection || (isBulkSorting && selectedCollections.includes(id));
                    
                    return (
                      <Box key={id} padding="400" borderBlockEndWidth="025">
                        <InlineStack gap="500" align="space-between" blockAlign="center">
                          <Box>
                            <Checkbox
                              label=""
                              checked={selectedCollections.includes(id)}
                              onChange={(checked) => handleCollectionSelect(id, checked)}
                              disabled={isLoading || isBulkSorting}
                            />
                          </Box>
                          <Box width="25%">
                            <Text variant="bodyMd" fontWeight="bold" as="span">
                              {title}
                            </Text>
                          </Box>
                          <Box>
                            <Text variant="bodyMd" as="span">{productsCount.count} products</Text>
                          </Box>
                          <Box>
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" variant="bodyMd">
                                Sort Order: {sortOrder}
                              </Text>
                              {sortOrder !== "MANUAL" && (
                                <Text as="span" variant="bodySm" tone="subdued">
                                  (Will be changed to MANUAL when sorted)
                                </Text>
                              )}
                            </InlineStack>
                          </Box>
                          <Box>
                            <Button
                              disabled={isLoading || isBulkSorting}
                              onClick={() => handleSortClick(id)}
                              size="slim"
                              variant="primary"
                            >
                              {isSorting ? "Sorting..." : "Sort"}
                            </Button>
                          </Box>
                        </InlineStack>
                      </Box>
                    );
                  })}
                  {totalPages > 1 && (
                    <Box padding="400">
                      <Pagination
                        hasPrevious={currentPage > 1}
                        onPrevious={() => setCurrentPage(currentPage => Math.max(1, currentPage - 1))}
                        hasNext={currentPage < totalPages}
                        onNext={() => setCurrentPage(currentPage => Math.min(totalPages, currentPage + 1))}
                      />
                    </Box>
                  )}
                </>
              ) : (
                <EmptyState
                  heading="No collections found"
                  image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
                >
                  <p>You need to create a collection before you can use this tool.</p>
                  <div style={{ marginTop: "1rem" }}>
                    <Link url="shopify://admin/collections" external>
                      Create a collection
                    </Link>
                  </div>
                </EmptyState>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
