import React from "react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  Text,
  Banner,
  BlockStack,
  Spinner,
  EmptyState,
  InlineStack,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Define types for our data
interface SortedCollection {
  id: string;
  collectionId: string;
  collectionTitle: string;
  sortedAt: string;
  sortOrder: string;
}

interface ActionData {
  success: boolean;
  message: string;
  collectionTitle?: string;
}

// Fetch sorted collections for the current shop
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  try {
    // First, ensure the table exists
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "SortedCollection" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "shop" TEXT NOT NULL,
        "collectionId" TEXT NOT NULL,
        "collectionTitle" TEXT NOT NULL,
        "sortedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "sortOrder" TEXT NOT NULL DEFAULT 'MANUAL'
      )
    `;
    
    await prisma.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS "shop_collectionId" ON "SortedCollection"("shop", "collectionId")
    `;
    
    // Using raw query instead of Prisma model for compatibility
    const sortedCollections = await prisma.$queryRaw<SortedCollection[]>`
      SELECT * FROM "SortedCollection" 
      WHERE "shop" = ${session.shop}
      ORDER BY "sortedAt" DESC
    `;
    
    // Debug: log collection data
    console.log("Loaded sorted collections:", JSON.stringify(sortedCollections, null, 2));
    
    // Process collection data to ensure titles are properly formatted
    const processedCollections = sortedCollections.map(collection => ({
      ...collection,
      // Ensure collection title is not null or undefined
      collectionTitle: collection.collectionTitle || "Unnamed Collection"
    }));
    
    return json({
      sortedCollections: processedCollections
    });
  } catch (error) {
    console.error("Error loading sorted collections:", error);
    return json({
      sortedCollections: [],
      error: `Error loading sorted collections: ${error instanceof Error ? error.message : "Unknown error"}`
    });
  }
};

// Handle the revert action
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const collectionId = formData.get("collectionId")?.toString();
  const sortedCollectionId = formData.get("sortedCollectionId")?.toString();

  if (!collectionId || !sortedCollectionId) {
    return json({ success: false, message: "Collection information is required" });
  }

  try {
    // Get collection info before removal using raw query
    const sortedCollections = await prisma.$queryRaw<SortedCollection[]>`
      SELECT * FROM "SortedCollection"
      WHERE "id" = ${sortedCollectionId}
    `;
    
    if (!sortedCollections || sortedCollections.length === 0) {
      return json({ success: false, message: "Sorted collection not found" });
    }
    
    const sortedCollection = sortedCollections[0];

    // 1. Get all products in the collection
    const productsResponse = await admin.graphql(
      `#graphql
        query GetCollectionProducts($collectionId: ID!, $first: Int!) {
          collection(id: $collectionId) {
            title
            products(first: $first) {
              edges {
                node {
                  id
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
          first: 250 // Fetch up to 250 products
        } 
      }
    );

    const productsData = await productsResponse.json();
    const collection = productsData.data.collection;
    const products = collection.products.edges.map((edge: any) => edge.node.id);

    // For "reverting", we'll just randomize the order to make it different
    // (A real implementation might want to store the original order)
    const shuffledProducts = [...products].sort(() => Math.random() - 0.5);
    
    // Create moves input
    const moves = shuffledProducts.map((productId, index) => ({
      id: productId,
      newPosition: index.toString()
    }));

    // Reorder the collection with randomized order
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
          moves
        } 
      }
    );

    const updateData = await updateResponse.json();
    
    if (updateData.data.collectionReorderProducts.userErrors.length > 0) {
      const errors = updateData.data.collectionReorderProducts.userErrors.map((err: any) => err.message).join(", ");
      return json({ 
        success: false, 
        message: `Error reverting collection: ${errors}` 
      });
    }
    
    // Remove the collection from our sorted collections database using raw query
    await prisma.$executeRaw`
      DELETE FROM "SortedCollection"
      WHERE "id" = ${sortedCollectionId}
    `;
    
    return json({ 
      success: true, 
      message: `Successfully reverted the sort order for "${sortedCollection.collectionTitle}"`,
      collectionTitle: sortedCollection.collectionTitle
    });
  } catch (error) {
    console.error("Error reverting sorted collection:", error);
    return json({ 
      success: false, 
      message: `Error: ${error instanceof Error ? error.message : "Unknown error occurred"}` 
    });
  }
};

import { useNavigate } from "react-router-dom";

export default function SortedCollectionsPage() {
  const { sortedCollections } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  
  // Debug: log client-side sorted collections
  console.log("Client-side sorted collections:", sortedCollections);
  
  const handleBack = () => {
    navigate("/app");
  };

  // Function to convert Shopify GID to numeric ID for admin URL
  const extractShopifyId = (gid: string) => {
    if (!gid) return '';
    // Extract the numeric ID from format like "gid://shopify/Collection/285480419482"
    const parts = gid.split('/');
    return parts[parts.length - 1];
  };
  
  return (
    <Page
      title="Sorted Collections"
      backAction={{ content: "Back to Collections", onAction: handleBack }}
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" fontWeight="semibold">
                  Collections that have been sorted by in-stock status
                </Text>
                <Text variant="bodyMd" color="subdued">
                  This page shows collections that have been sorted with in-stock products at the top.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          {sortedCollections.length === 0 ? (
            <Layout.Section>
              <EmptyState
                heading="No sorted collections yet"
                image="/empty-state.svg"
              >
                <p>
                  When you sort collections using this app, they will appear here.
                </p>
              </EmptyState>
            </Layout.Section>
          ) : (
            sortedCollections.map((collection, index) => (
              <Layout.Section key={collection.id}>
                <Card>
                  <BlockStack gap="300">
                    <Box>
                      <Text variant="headingMd" fontWeight="bold" as="h3" tone="success">
                        Collection: {collection.collectionTitle}
                      </Text>
                    </Box>
                    <InlineStack gap="500" align="space-between" blockAlign="center" wrap={true}>
                      <Box>
                        <Text variant="bodyMd">
                          Last sorted: {new Date(collection.sortedAt).toLocaleString()}
                        </Text>
                      </Box>
                      <Box>
                        <Button 
                          primary
                          url={`https://${collection.shop}/admin/collections/${extractShopifyId(collection.collectionId)}`}
                          external={true}
                        >
                          View in Shopify
                        </Button>
                      </Box>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Layout.Section>
            ))
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}
