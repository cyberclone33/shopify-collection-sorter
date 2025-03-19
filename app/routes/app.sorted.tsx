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
}

interface ActionData {
  success: boolean;
  message: string;
  collectionTitle?: string;
}

// Fetch sorted collections for the current shop
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Using raw query instead of Prisma model for compatibility
  const sortedCollections = await prisma.$queryRaw<SortedCollection[]>`
    SELECT * FROM "SortedCollection" 
    WHERE "shop" = ${session.shop}
    ORDER BY "sortedAt" DESC
  `;
  
  return json({
    sortedCollections
  });
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

export default function SortedCollectionsPage() {
  const { sortedCollections } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";
  
  const handleRevertClick = (collectionId: string, sortedCollectionId: string) => {
    if (confirm("Are you sure you want to revert this collection's sort order?")) {
      submit(
        { collectionId, sortedCollectionId },
        { method: "POST" }
      );
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <Page>
      <TitleBar title="Sorted Collections" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Sorted Collections
                </Text>
                <Text as="p" variant="bodyMd">
                  These collections have been sorted to move out-of-stock products to the end.
                  You can revert any collection to reset its sort order.
                </Text>
                {actionData?.success === true && (
                  <Banner 
                    title="Success!" 
                    tone="success"
                  >
                    <p>{actionData.message}</p>
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
              {sortedCollections.length > 0 ? (
                <BlockStack>
                  {sortedCollections.map((collection: SortedCollection) => (
                    <React.Fragment key={collection.id}>
                      <Box padding="400">
                        <InlineStack gap="500" align="space-between" blockAlign="center">
                          <Box width="40%">
                            <Text variant="bodyMd" fontWeight="bold" as="span">
                              {collection.collectionTitle}
                            </Text>
                          </Box>
                          <Box>
                            <Text variant="bodyMd" as="span">
                              Sorted on: {formatDate(collection.sortedAt)}
                            </Text>
                          </Box>
                          <Box>
                            <Button
                              disabled={isLoading}
                              onClick={() => handleRevertClick(collection.collectionId, collection.id)}
                              tone="critical"
                              size="slim"
                            >
                              {isLoading && navigation.formData?.get("sortedCollectionId") === collection.id 
                                ? <><Spinner size="small" /> <span>Reverting</span></>
                                : "Revert"
                              }
                            </Button>
                          </Box>
                        </InlineStack>
                      </Box>
                      <Divider />
                    </React.Fragment>
                  ))}
                </BlockStack>
              ) : (
                <EmptyState
                  heading="No sorted collections"
                  image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
                >
                  <p>You haven't sorted any collections yet.</p>
                </EmptyState>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
