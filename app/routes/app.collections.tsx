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
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  // Default to 250 collections to ensure we get all of them for most stores
  const first = 250;

  // Fetch all collections
  const collectionsResponse = await admin.graphql(
    `#graphql
      query GetCollections($first: Int!) {
        collections(first: $first) {
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
        first,
      },
    }
  );

  const collectionsData = await collectionsResponse.json();
  
  return json({
    collections: collectionsData.data.collections.edges.map((edge: any) => edge.node)
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const collectionId = formData.get("collectionId")?.toString();
  const productLimit = formData.get("productLimit")?.toString() || "250";

  if (!collectionId) {
    return json({ success: false, message: "Collection ID is required" });
  }

  try {
    // 1. Fetch products from the collection
    const productsResponse = await admin.graphql(
      `#graphql
        query GetCollectionProducts($collectionId: ID!, $first: Int!) {
          collection(id: $collectionId) {
            title
            products(first: $first) {
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
          first: parseInt(productLimit, 10)
        } 
      }
    );

    const productsData = await productsResponse.json();
    const collection = productsData.data.collection;
    const products = collection.products.edges.map((edge: any) => ({
      ...edge.node,
      cursor: edge.cursor
    }));

    // 2. Separate in-stock and out-of-stock products
    const inStockProducts = products.filter((product: any) => 
      product.status === "ACTIVE" && product.totalInventory > 0
    );
    const outOfStockProducts = products.filter((product: any) => 
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

    // Only proceed with manual sorting
    if (sortOrder !== "MANUAL") {
      return json({ 
        success: false, 
        message: "Cannot sort this collection. Only manually sorted collections can be reordered." 
      });
    }

    // 4. Reorder the collection with in-stock products first, then out-of-stock
    if (outOfStockProducts.length > 0) {
      // For each product, we need its ID in the desired order
      const newOrder = [...inStockProducts, ...outOfStockProducts].map(
        (product: any) => product.id
      );

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
      
      if (updateData.data.collectionReorderProducts.userErrors.length > 0) {
        const errors = updateData.data.collectionReorderProducts.userErrors.map((err: any) => err.message).join(", ");
        return json({ success: false, message: `Error reordering collection: ${errors}` });
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
            "sortedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        
        await tx.$executeRawUnsafe(`
          CREATE UNIQUE INDEX IF NOT EXISTS "shop_collectionId" ON "SortedCollection"("shop", "collectionId")
        `);
        
        // Using raw queries since the model might not be fully recognized by TypeScript yet
        await tx.$executeRawUnsafe(`
          INSERT INTO "SortedCollection" ("id", "shop", "collectionId", "collectionTitle", "sortedAt")
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT ("shop", "collectionId") 
          DO UPDATE SET "collectionTitle" = ?, "sortedAt" = ?
        `, 
        `cuid-${Date.now()}`, 
        session.shop, 
        collectionId, 
        collection.title, 
        new Date().toISOString(),
        collection.title,
        new Date().toISOString()
        );
      });
      
      return json({ 
        success: true, 
        message: `Successfully moved ${outOfStockProducts.length} out-of-stock products to the end of "${collection.title}"`,
        inStockCount: inStockProducts.length,
        outOfStockCount: outOfStockProducts.length,
        collectionTitle: collection.title
      });
    } else {
      return json({ 
        success: true, 
        message: `No out-of-stock products found in "${collection.title}"`,
        inStockCount: inStockProducts.length,
        outOfStockCount: 0,
        collectionTitle: collection.title
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
  const [productLimit, setProductLimit] = useState("250");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

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
                      ]}
                      onChange={handleProductLimitChange}
                      value={productLimit}
                    />
                  </Box>
                </InlineStack>
                
                <Text as="p" variant="bodyMd">
                  Showing {paginatedCollections.length} of {filteredCollections.length} collections
                </Text>
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
                    
                    return (
                      <Box key={id} padding="400" borderBlockEndWidth="025">
                        <InlineStack gap="500" align="space-between" blockAlign="center">
                          <Box width="30%">
                            <Text variant="bodyMd" fontWeight="bold" as="span">
                              {title}
                            </Text>
                          </Box>
                          <Box>
                            <Text variant="bodyMd" as="span">{productsCount.count} products</Text>
                          </Box>
                          <Box>
                            <Text variant="bodyMd" as="span">Sort: {sortOrder}</Text>
                          </Box>
                          <Box>
                            <Button
                              disabled={isLoading}
                              onClick={() => handleSortClick(id)}
                              size="slim"
                              variant="primary"
                            >
                              {isCurrentCollection ? <><Spinner size="small" /> <span>Sorting</span></> : "Sort"}
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
