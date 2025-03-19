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
  const bulkSort = formData.get("bulkSort")?.toString() || "false";
  const remainingCollections = formData.get("remainingCollections")?.toString() || "";

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

    // Different approach based on sort order
    if (outOfStockProducts.length > 0) {
      if (sortOrder === "MANUAL") {
        // For manually sorted collections, directly reorder products
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
      } else if (sortOrder === "CREATED_DESC" || sortOrder === "BEST_SELLING" || sortOrder === "CREATED" || sortOrder === "PRICE_DESC" || sortOrder === "PRICE_ASC" || sortOrder === "TITLE" || sortOrder === "TITLE_DESC" || sortOrder === "UPDATED") {
        // For non-manual sort orders, we can't directly reorder but we can:
        // 1. Create a new smart collection that mimics the original but puts out-of-stock at the end
        // 2. Or provide info about what products would be affected
        
        // For now, we'll simply acknowledge the sort was attempted and provide counts
        return json({ 
          success: true, 
          message: `Collection '${collection.title}' analyzed. ${inStockProducts.length} in-stock products and ${outOfStockProducts.length} out-of-stock products found. This collection uses '${sortOrder}' sort order which cannot be directly reordered. Consider creating a manual collection instead.`,
          inStockCount: inStockProducts.length,
          outOfStockCount: outOfStockProducts.length,
          collectionTitle: collection.title
        });
      } else {
        return json({ 
          success: false, 
          message: `Sort order '${sortOrder}' is not supported for reorganizing out-of-stock products.` 
        });
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
        
        // Using raw queries since the model might not be fully recognized by TypeScript yet
        await tx.$executeRawUnsafe(`
          INSERT INTO "SortedCollection" ("id", "shop", "collectionId", "collectionTitle", "sortedAt", "sortOrder")
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT ("shop", "collectionId") 
          DO UPDATE SET "collectionTitle" = ?, "sortedAt" = ?, "sortOrder" = ?
        `, 
        `cuid-${Date.now()}`, 
        session.shop, 
        collectionId, 
        collection.title, 
        new Date().toISOString(),
        sortOrder,
        collection.title,
        new Date().toISOString(),
        sortOrder
        );
      });
      
      if (bulkSort === "true" && remainingCollections) {
        const remainingCollectionIds = remainingCollections.split(",");
        const successfulSorts: any[] = [];
        for (const remainingCollectionId of remainingCollectionIds) {
          // Fetch products from the collection
          const remainingProductsResponse = await admin.graphql(
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
                collectionId: remainingCollectionId,
                first: parseInt(productLimit, 10)
              } 
            }
          );

          const remainingProductsData = await remainingProductsResponse.json();
          const remainingCollection = remainingProductsData.data.collection;
          const remainingProducts = remainingCollection.products.edges.map((edge: any) => ({
            ...edge.node,
            cursor: edge.cursor
          }));

          // Separate in-stock and out-of-stock products
          const remainingInStockProducts = remainingProducts.filter((product: any) => 
            product.status === "ACTIVE" && product.totalInventory > 0
          );
          const remainingOutOfStockProducts = remainingProducts.filter((product: any) => 
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
            if (remainingSortOrder === "MANUAL") {
              // For manually sorted collections, directly reorder products
              // For each product, we need its ID in the desired order
              const newOrder = [...remainingInStockProducts, ...remainingOutOfStockProducts].map(
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
                    collectionId: remainingCollectionId,
                    moves: moves
                  } 
                }
              );

              const updateData = await updateResponse.json();
              
              if (updateData.data.collectionReorderProducts.userErrors.length > 0) {
                const errors = updateData.data.collectionReorderProducts.userErrors.map((err: any) => err.message).join(", ");
                return json({ success: false, message: `Error reordering collection: ${errors}` });
              }
            } else if (remainingSortOrder === "CREATED_DESC" || remainingSortOrder === "BEST_SELLING" || remainingSortOrder === "CREATED" || remainingSortOrder === "PRICE_DESC" || remainingSortOrder === "PRICE_ASC" || remainingSortOrder === "TITLE" || remainingSortOrder === "TITLE_DESC" || remainingSortOrder === "UPDATED") {
              // For non-manual sort orders, we can't directly reorder but we can:
              // 1. Create a new smart collection that mimics the original but puts out-of-stock at the end
              // 2. Or provide info about what products would be affected
              
              // For now, we'll simply acknowledge the sort was attempted and provide counts
              successfulSorts.push({
                title: remainingCollection.title,
                inStockCount: remainingInStockProducts.length,
                outOfStockCount: remainingOutOfStockProducts.length,
                message: `Collection '${remainingCollection.title}' analyzed. ${remainingInStockProducts.length} in-stock products and ${remainingOutOfStockProducts.length} out-of-stock products found. This collection uses '${remainingSortOrder}' sort order which cannot be directly reordered.`
              });
            } else {
              return json({ 
                success: false, 
                message: `Sort order '${remainingSortOrder}' is not supported for reorganizing out-of-stock products.` 
              });
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
              
              // Using raw queries since the model might not be fully recognized by TypeScript yet
              await tx.$executeRawUnsafe(`
                INSERT INTO "SortedCollection" ("id", "shop", "collectionId", "collectionTitle", "sortedAt", "sortOrder")
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT ("shop", "collectionId") 
                DO UPDATE SET "collectionTitle" = ?, "sortedAt" = ?, "sortOrder" = ?
              `, 
              `cuid-${Date.now()}`, 
              session.shop, 
              remainingCollectionId, 
              remainingCollection.title, 
              new Date().toISOString(),
              remainingSortOrder,
              remainingCollection.title,
              new Date().toISOString(),
              remainingSortOrder
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
                                  (Will count products but won't reorder directly)
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
