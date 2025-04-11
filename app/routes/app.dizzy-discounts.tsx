import { useState, useCallback, useEffect } from "react";
import { json } from "@remix-run/node";
import { useActionData, useNavigation, useSubmit, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  Button,
  Text,
  BlockStack,
  Box,
  Banner,
  SkeletonBodyText,
  SkeletonDisplayText,
  Card,
  InlineGrid,
  ButtonGroup,
  DataTable,
  Modal,
  EmptyState,
  Icon,
  Tooltip,
} from "@shopify/polaris";
import { RefreshMinor, UndoMinor } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();

// Define a new model for tracking discounted products
// This would normally be added to the prisma/schema.prisma file
// But for simplicity we'll define the type here
/**
 * @typedef {Object} DiscountedProduct
 * @property {string} id - Unique ID for this discount record
 * @property {string} shop - The Shopify shop domain
 * @property {string} productId - The Shopify product ID
 * @property {string} variantId - The Shopify variant ID
 * @property {string} productTitle - The product title
 * @property {string} sku - The variant SKU
 * @property {number} originalPrice - The original price before discount
 * @property {number} discountedPrice - The price after discount
 * @property {number} discountPercent - The discount percentage applied
 * @property {Date} discountedAt - When the discount was applied
 */

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  
  // Fetch all discounted products for this shop
  const discountedProducts = await prisma.discountedProduct.findMany({
    where: {
      shop: session.shop,
      active: true
    },
    orderBy: {
      discountedAt: 'desc'
    }
  });
  
  return json({ 
    discountedProducts
  });
};

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  try {
    if (action === "randomDiscount" || action === "pickAnotherProduct") {
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
      
      // For "pickAnotherProduct" action, we just return the selected product without applying a discount
      if (action === "pickAnotherProduct") {
        const variant = selectedProduct.variants.edges[0].node;
        
        return json({
          status: "success",
          product: {
            id: selectedProduct.id,
            title: selectedProduct.title,
            variant: {
              id: variant.id,
              sku: variant.sku,
              originalPrice: parseFloat(variant.price),
              discountedPrice: variant.price,
              compareAtPrice: variant.compareAtPrice,
              inventoryQuantity: variant.inventoryQuantity,
              discountPercent: 0
            }
          },
          skipDiscount: true
        });
      }
      
      // For "randomDiscount" action, calculate and apply a discount
      const discountPercent = Math.floor(Math.random() * 31) + 10;
      const variant = selectedProduct.variants.edges[0].node;
      
      const originalPrice = parseFloat(variant.price);
      const discountedPrice = (originalPrice * (100 - discountPercent) / 100).toFixed(2);
      
      // Extract product ID from the GraphQL ID
      const productId = selectedProduct.id;
      const variantId = variant.id;
      
      // Update the product with the discounted price using the correct mutation
      const updateResponse = await admin.graphql(`
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            product {
              id
              title
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          productId: productId,
          variants: [
            {
              id: variantId,
              price: discountedPrice,
              compareAtPrice: variant.compareAtPrice || originalPrice.toString()
            }
          ]
        }
      });

      const updateResult = await updateResponse.json();
      
      if (updateResult.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
        return json({
          status: "error",
          message: "Failed to update product variant: " + 
            updateResult.data.productVariantsBulkUpdate.userErrors.map(err => err.message).join(", ")
        });
      }
      
      // Store the discounted product in our database
      await prisma.discountedProduct.create({
        data: {
          id: uuidv4(),
          shop: session.shop,
          productId: selectedProduct.id,
          variantId: variant.id,
          productTitle: selectedProduct.title,
          sku: variant.sku || "",
          originalPrice: originalPrice,
          discountedPrice: parseFloat(discountedPrice),
          discountPercent: discountPercent,
          discountedAt: new Date(),
          active: true
        }
      });

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
    } else if (action === "redoDiscount") {
      // Redo the discount for the same product
      const productId = formData.get("productId");
      const variantId = formData.get("variantId");
      const originalPrice = parseFloat(formData.get("originalPrice"));
      const sku = formData.get("sku");
      const inventoryQuantity = formData.get("inventoryQuantity");
      const title = formData.get("title");
      
      // Calculate a new random discount (10-40%)
      const discountPercent = Math.floor(Math.random() * 31) + 10;
      const discountedPrice = (originalPrice * (100 - discountPercent) / 100).toFixed(2);
      
      // Update the product with the new discounted price
      const updateResponse = await admin.graphql(`
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            product {
              id
              title
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          productId: productId,
          variants: [
            {
              id: variantId,
              price: discountedPrice,
              compareAtPrice: originalPrice.toString()
            }
          ]
        }
      });

      const updateResult = await updateResponse.json();
      
      if (updateResult.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
        return json({
          status: "error",
          message: "Failed to update product variant: " + 
            updateResult.data.productVariantsBulkUpdate.userErrors.map(err => err.message).join(", ")
        });
      }
      
      // Update or create the discounted product record
      await prisma.discountedProduct.upsert({
        where: {
          shop_variantId: {
            shop: session.shop,
            variantId: variantId
          }
        },
        update: {
          discountedPrice: parseFloat(discountedPrice),
          discountPercent: discountPercent,
          discountedAt: new Date(),
          active: true
        },
        create: {
          id: uuidv4(),
          shop: session.shop,
          productId: productId,
          variantId: variantId,
          productTitle: title,
          sku: sku || "",
          originalPrice: originalPrice,
          discountedPrice: parseFloat(discountedPrice),
          discountPercent: discountPercent,
          discountedAt: new Date(),
          active: true
        }
      });

      return json({
        status: "success",
        product: {
          id: productId,
          title: title,
          variant: {
            id: variantId,
            sku: sku,
            originalPrice: originalPrice,
            discountedPrice: discountedPrice,
            compareAtPrice: originalPrice.toString(),
            inventoryQuantity: inventoryQuantity,
            discountPercent
          }
        }
      });
    } else if (action === "revertDiscount") {
      const discountId = formData.get("discountId");
      
      // Get the discount record
      const discount = await prisma.discountedProduct.findUnique({
        where: { id: discountId }
      });
      
      if (!discount || !discount.active) {
        return json({
          status: "error",
          message: "Discount record not found or already reverted."
        });
      }
      
      // Revert the price back to original
      const updateResponse = await admin.graphql(`
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            product {
              id
              title
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          productId: discount.productId,
          variants: [
            {
              id: discount.variantId,
              price: discount.originalPrice.toString(),
              compareAtPrice: null  // Remove compare-at price
            }
          ]
        }
      });
      
      const updateResult = await updateResponse.json();
      
      if (updateResult.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
        return json({
          status: "error",
          message: "Failed to revert discount: " + 
            updateResult.data.productVariantsBulkUpdate.userErrors.map(err => err.message).join(", ")
        });
      }
      
      // Mark the discount as inactive
      await prisma.discountedProduct.update({
        where: { id: discountId },
        data: { active: false }
      });
      
      return json({
        status: "success",
        message: `Successfully reverted discount for ${discount.productTitle}`
      });
    } else if (action === "revertAllDiscounts") {
      // Get all active discounted products
      const discounts = await prisma.discountedProduct.findMany({
        where: {
          shop: session.shop,
          active: true
        }
      });
      
      if (discounts.length === 0) {
        return json({
          status: "error",
          message: "No active discounts to revert."
        });
      }
      
      // Revert each discount one by one
      const results = [];
      for (const discount of discounts) {
        try {
          // Revert the price back to original
          const updateResponse = await admin.graphql(`
            mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                product {
                  id
                  title
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `, {
            variables: {
              productId: discount.productId,
              variants: [
                {
                  id: discount.variantId,
                  price: discount.originalPrice.toString(),
                  compareAtPrice: null  // Remove compare-at price
                }
              ]
            }
          });
          
          const updateResult = await updateResponse.json();
          
          if (updateResult.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
            results.push({
              product: discount.productTitle,
              success: false,
              error: updateResult.data.productVariantsBulkUpdate.userErrors.map(err => err.message).join(", ")
            });
          } else {
            // Mark the discount as inactive
            await prisma.discountedProduct.update({
              where: { id: discount.id },
              data: { active: false }
            });
            
            results.push({
              product: discount.productTitle,
              success: true
            });
          }
        } catch (error) {
          results.push({
            product: discount.productTitle,
            success: false,
            error: error.message
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      
      return json({
        status: "success",
        message: `Successfully reverted ${successCount} of ${discounts.length} discounts.`,
        results
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
  const { discountedProducts } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  
  const [lastDiscount, setLastDiscount] = useState(null);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [revertResults, setRevertResults] = useState(null);
  const isLoading = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.status === "success") {
      if (actionData.product) {
        setLastDiscount(actionData.product);
      }
      
      if (actionData.results) {
        setRevertResults(actionData.results);
      }
    }
  }, [actionData]);

  const handleRandomDiscount = useCallback(() => {
    submit({ action: "randomDiscount" }, { method: "post" });
  }, [submit]);
  
  const handleRedoDiscount = useCallback(() => {
    if (!lastDiscount) return;
    
    const formData = new FormData();
    formData.append("action", "redoDiscount");
    formData.append("productId", lastDiscount.id);
    formData.append("variantId", lastDiscount.variant.id);
    formData.append("originalPrice", lastDiscount.variant.originalPrice);
    formData.append("sku", lastDiscount.variant.sku || "");
    formData.append("inventoryQuantity", lastDiscount.variant.inventoryQuantity || "0");
    formData.append("title", lastDiscount.title);
    
    submit(formData, { method: "post" });
  }, [lastDiscount, submit]);
  
  const handlePickAnotherProduct = useCallback(() => {
    submit({ action: "pickAnotherProduct" }, { method: "post" });
  }, [submit]);
  
  const handleRevertDiscount = useCallback((discountId) => {
    const formData = new FormData();
    formData.append("action", "revertDiscount");
    formData.append("discountId", discountId);
    
    submit(formData, { method: "post" });
  }, [submit]);
  
  const handleRevertAllDiscounts = useCallback(() => {
    setShowRevertModal(true);
  }, []);
  
  const handleConfirmRevertAll = useCallback(() => {
    setShowRevertModal(false);
    
    const formData = new FormData();
    formData.append("action", "revertAllDiscounts");
    
    submit(formData, { method: "post" });
  }, [submit]);
  
  // Prepare the discount history table rows
  const rows = discountedProducts?.map(product => [
    product.productTitle,
    product.sku || "N/A",
    `$${product.originalPrice.toFixed(2)}`,
    `$${product.discountedPrice.toFixed(2)}`,
    `${product.discountPercent}%`,
    new Date(product.discountedAt).toLocaleString(),
    <Button size="micro" onClick={() => handleRevertDiscount(product.id)}>
      <Icon source={UndoMinor} />
      <span>Revert</span>
    </Button>
  ]) || [];

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
      secondaryActions={[
        {
          content: 'Revert All Discounts',
          onAction: handleRevertAllDiscounts,
          disabled: !discountedProducts?.length || isLoading
        }
      ]}
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
            
            {actionData?.status === "success" && actionData.message && !actionData.product && (
              <Banner title="Success" tone="success">
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
                    {actionData?.skipDiscount ? "Selected Product" : "Last Generated Discount"}
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
                        
                        {lastDiscount.variant.discountPercent > 0 && (
                          <>
                            <Text as="span" variant="bodyMd">Discounted Price:</Text>
                            <Text as="span" variant="bodyMd" fontWeight="bold" color="success">
                              ${lastDiscount.variant.discountedPrice}
                            </Text>
                            
                            <Text as="span" variant="bodyMd">Compare At Price:</Text>
                            <Text as="span" variant="bodyMd">${lastDiscount.variant.compareAtPrice || "N/A"}</Text>
                            
                            <Text as="span" variant="bodyMd">Discount Applied:</Text>
                            <Text as="span" variant="bodyMd" fontWeight="bold">
                              {lastDiscount.variant.discountPercent}%
                            </Text>
                          </>
                        )}
                        
                        <Text as="span" variant="bodyMd">Inventory Quantity:</Text>
                        <Text as="span" variant="bodyMd">{lastDiscount.variant.inventoryQuantity || "N/A"}</Text>
                      </InlineGrid>
                    </Box>
                    
                    <BlockStack gap="200">
                      <ButtonGroup>
                        {actionData?.skipDiscount ? (
                          <Button 
                            variant="primary" 
                            onClick={handleRandomDiscount} 
                            disabled={isLoading}
                          >
                            Apply Random Discount
                          </Button>
                        ) : (
                          <Button 
                            onClick={handleRedoDiscount} 
                            disabled={isLoading}
                          >
                            Generate New Discount
                          </Button>
                        )}
                        
                        <Button 
                          onClick={handlePickAnotherProduct} 
                          disabled={isLoading}
                        >
                          Pick Another Product
                        </Button>
                      </ButtonGroup>
                    </BlockStack>
                  </BlockStack>
                </BlockStack>
              </Card>
            ) : null}
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Discount History
                </Text>
                
                {rows.length > 0 ? (
                  <DataTable
                    columnContentTypes={[
                      'text',
                      'text',
                      'text',
                      'text',
                      'text',
                      'text',
                      'text',
                    ]}
                    headings={[
                      'Product',
                      'SKU',
                      'Original Price',
                      'Discounted Price',
                      'Discount',
                      'Applied At',
                      'Actions',
                    ]}
                    rows={rows}
                  />
                ) : (
                  <EmptyState
                    heading="No discounts applied yet"
                    image=""
                  >
                    <p>Use the 'Generate Random Discount' button to start applying discounts to products.</p>
                  </EmptyState>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      <Modal
        open={showRevertModal}
        onClose={() => setShowRevertModal(false)}
        title="Revert All Discounts"
        primaryAction={{
          content: 'Revert All',
          onAction: handleConfirmRevertAll,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowRevertModal(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to revert all applied discounts? This will restore the original prices for all products.
          </Text>
        </Modal.Section>
      </Modal>

      {revertResults && (
        <Modal
          open={!!revertResults}
          onClose={() => setRevertResults(null)}
          title="Revert Results"
          primaryAction={{
            content: 'OK',
            onAction: () => setRevertResults(null),
          }}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {revertResults.map((result, index) => (
                <Banner 
                  key={index} 
                  title={result.product}
                  tone={result.success ? "success" : "critical"}
                >
                  {result.success ? "Successfully reverted" : `Error: ${result.error}`}
                </Banner>
              ))}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
