import { useState, useCallback, useEffect } from "react";
import { json } from "@remix-run/node";
import { useActionData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  Button,
  Text,
  BlockStack,
  Box,
  InlineStack,
  Banner,
  Spinner,
  Divider,
  SkeletonBodyText,
  SkeletonDisplayText,
  Card,
  InlineGrid,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  return json({});
};

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  try {
    if (action === "randomDiscount") {
      // Get a random product
      const response = await admin.graphql(`
        query {
          products(first: 25) {
            edges {
              node {
                id
                title
                variants(first: 1) {
                  edges {
                    node {
                      id
                      price
                      compareAtPrice
                      inventoryQuantity
                      sku
                    }
                  }
                }
              }
            }
          }
        }
      `);

      const responseJson = await response.json();
      const products = responseJson.data.products.edges;
      
      if (products.length === 0) {
        return json({ 
          status: "error", 
          message: "No products found in your store." 
        });
      }

      // Select a random product
      const randomIndex = Math.floor(Math.random() * products.length);
      const selectedProduct = products[randomIndex].node;
      
      // Calculate a random discount (10-40%)
      const discountPercent = Math.floor(Math.random() * 31) + 10;
      const variant = selectedProduct.variants.edges[0].node;
      
      const originalPrice = parseFloat(variant.price);
      const discountedPrice = (originalPrice * (100 - discountPercent) / 100).toFixed(2);
      
      // Update the product with the discounted price
      const updateResponse = await admin.graphql(`
        mutation productVariantUpdate($input: ProductVariantInput!) {
          productVariantUpdate(input: $input) {
            productVariant {
              id
              price
              compareAtPrice
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          input: {
            id: variant.id,
            price: discountedPrice,
            compareAtPrice: variant.compareAtPrice || originalPrice.toString(),
          },
        },
      });

      const updateResult = await updateResponse.json();
      
      if (updateResult.data?.productVariantUpdate?.userErrors?.length > 0) {
        return json({
          status: "error",
          message: "Failed to update product variant: " + 
            updateResult.data.productVariantUpdate.userErrors.map(err => err.message).join(", ")
        });
      }

      return json({
        status: "success",
        product: {
          id: selectedProduct.id,
          title: selectedProduct.title,
          variant: {
            id: variant.id,
            sku: variant.sku,
            originalPrice: originalPrice,
            discountedPrice: discountedPrice,
            compareAtPrice: variant.compareAtPrice || originalPrice.toString(),
            inventoryQuantity: variant.inventoryQuantity,
            discountPercent
          }
        }
      });
    }
    
    return json({ status: "error", message: "Unknown action" });
  } catch (error) {
    return json({
      status: "error",
      message: error.message || "An error occurred"
    });
  }
}

export default function DizzyDiscounts() {
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  
  const [lastDiscount, setLastDiscount] = useState(null);
  const isLoading = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.status === "success" && actionData?.product) {
      setLastDiscount(actionData.product);
    }
  }, [actionData]);

  const handleRandomDiscount = useCallback(() => {
    submit({ action: "randomDiscount" }, { method: "post" });
  }, [submit]);

  return (
    <Page
      title="Dizzy Discounts"
      primaryAction={
        <Button 
          variant="primary" 
          onClick={handleRandomDiscount}
          loading={isLoading}
        >
          Generate Random Discount
        </Button>
      }
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <LegacyCard>
              <LegacyCard.Section>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    About Dizzy Discounts
                  </Text>
                  <Text as="p" variant="bodyMd">
                    This tool helps you generate random discounts on your products.
                    Click the button above to select a random product and apply a discount between 10-40%.
                  </Text>
                </BlockStack>
              </LegacyCard.Section>
            </LegacyCard>
          </Layout.Section>

          <Layout.Section>
            {actionData?.status === "error" && (
              <Banner title="Error" tone="critical">
                <p>{actionData.message}</p>
              </Banner>
            )}

            {isLoading ? (
              <Card>
                <BlockStack gap="400">
                  <SkeletonDisplayText size="small" />
                  <SkeletonBodyText lines={4} />
                </BlockStack>
              </Card>
            ) : lastDiscount ? (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Last Generated Discount
                  </Text>
                  
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingLg" fontWeight="bold">
                      {lastDiscount.title}
                    </Text>
                    
                    <Box paddingBlock="400">
                      <InlineGrid columns="2" gap="400">
                        <Text as="span" variant="bodyMd">SKU:</Text>
                        <Text as="span" variant="bodyMd">{lastDiscount.variant.sku || "N/A"}</Text>
                        
                        <Text as="span" variant="bodyMd">Original Price:</Text>
                        <Text as="span" variant="bodyMd">${lastDiscount.variant.originalPrice}</Text>
                        
                        <Text as="span" variant="bodyMd">Discounted Price:</Text>
                        <Text as="span" variant="bodyMd" fontWeight="bold" color="success">
                          ${lastDiscount.variant.discountedPrice}
                        </Text>
                        
                        <Text as="span" variant="bodyMd">Compare At Price:</Text>
                        <Text as="span" variant="bodyMd">${lastDiscount.variant.compareAtPrice || "N/A"}</Text>
                        
                        <Text as="span" variant="bodyMd">Inventory Quantity:</Text>
                        <Text as="span" variant="bodyMd">{lastDiscount.variant.inventoryQuantity || "N/A"}</Text>
                        
                        <Text as="span" variant="bodyMd">Discount Applied:</Text>
                        <Text as="span" variant="bodyMd" fontWeight="bold">
                          {lastDiscount.variant.discountPercent}%
                        </Text>
                      </InlineGrid>
                    </Box>
                  </BlockStack>
                </BlockStack>
              </Card>
            ) : null}
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
