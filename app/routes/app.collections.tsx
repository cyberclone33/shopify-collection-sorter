import { useState } from "react";
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
  DataTable,
  Spinner,
  EmptyState,
  Link,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

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

  // Fetch all collections
  const collectionsResponse = await admin.graphql(
    `#graphql
      query GetCollections {
        collections(first: 50) {
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
    `
  );

  const collectionsData = await collectionsResponse.json();
  
  return json({
    collections: collectionsData.data.collections.edges.map((edge: any) => edge.node)
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const collectionId = formData.get("collectionId")?.toString();

  if (!collectionId) {
    return json({ success: false, message: "Collection ID is required" });
  }

  try {
    // 1. Fetch products from the collection
    const productsResponse = await admin.graphql(
      `#graphql
        query GetCollectionProducts($collectionId: ID!) {
          collection(id: $collectionId) {
            title
            products(first: 250) {
              edges {
                node {
                  id
                  title
                  handle
                  totalInventory
                  availableForSale
                }
                cursor
              }
            }
          }
        }
      `,
      { variables: { collectionId } }
    );

    const productsData = await productsResponse.json();
    const collection = productsData.data.collection;
    const products = collection.products.edges.map((edge: any) => ({
      ...edge.node,
      cursor: edge.cursor
    }));

    // 2. Separate in-stock and out-of-stock products
    const inStockProducts = products.filter((product: any) => product.availableForSale);
    const outOfStockProducts = products.filter((product: any) => !product.availableForSale);

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

      // Update the collection's sort order
      const updateResponse = await admin.graphql(
        `#graphql
          mutation CollectionReorder($collectionId: ID!, $productIds: [ID!]!) {
            collectionReorder(id: $collectionId, products: $productIds) {
              collection {
                id
                title
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
            productIds: newOrder
          } 
        }
      );

      const updateData = await updateResponse.json();
      
      if (updateData.data.collectionReorder.userErrors.length > 0) {
        const errors = updateData.data.collectionReorder.userErrors.map((err: any) => err.message).join(", ");
        return json({ success: false, message: `Error reordering collection: ${errors}` });
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

  // Handle sort button click
  const handleSortClick = (collectionId: string) => {
    setSelectedCollectionId(collectionId);
    submit(
      { collectionId },
      { method: "POST" }
    );
  };

  // Create table rows from collections data
  const rows = collections.map((collection: Collection) => [
    collection.title,
    collection.productsCount.count.toString(),
    collection.sortOrder,
    <span key={`sort-button-${collection.id}`}>
      <Button
        disabled={isLoading}
        onClick={() => handleSortClick(collection.id)}
        size="slim"
        variant="primary"
      >
        {isLoading && selectedCollectionId === collection.id ? <Spinner size="small" /> : "Sort"}
      </Button>
    </span>
  ] as [string, string, string, JSX.Element]);

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
            <Card padding="0">
              {collections.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "numeric", "text", "text"]}
                  headings={["Collection", "Products", "Sort Order", "Actions"]}
                  rows={rows}
                />
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
