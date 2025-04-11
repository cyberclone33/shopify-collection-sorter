import { useState, useCallback, useEffect, useRef } from "react";
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
  Badge,
  Tabs,
  Divider,
  Avatar,
  Thumbnail,
  Grid,
  Frame,
  MediaCard,
  Stack,
  FooterHelp,
  Link,
} from "@shopify/polaris";
import { 
  RefreshIcon, 
  UndoIcon, 
  CheckIcon,
  XIcon,
  DisabledIcon,
  CheckCircleIcon,
  ImageIcon,
  ClockIcon,
  DiscountIcon
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();

// Add activity log type to track both discounted and skipped products
/**
 * @typedef {Object} ActivityLog
 * @property {string} id - Unique ID for this activity record
 * @property {string} productId - The Shopify product ID
 * @property {string} productTitle - The product title
 * @property {string} sku - The variant SKU
 * @property {number} originalPrice - The original price
 * @property {number} discountedPrice - The discounted price (if discounted, same as original if skipped)
 * @property {number} discountPercent - The discount percentage (0 if skipped)
 * @property {boolean} wasDiscounted - Whether the product was discounted or skipped
 * @property {Date} timestamp - When the action was taken
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
  
  // Fetch activity log for this shop
  const activityLog = await prisma.activityLog.findMany({
    where: {
      shop: session.shop
    },
    orderBy: {
      timestamp: 'desc'
    },
    take: 100 // Limit to last 100 activities
  });
  
  return json({ 
    discountedProducts,
    activityLog
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
                featuredImage {
                  url
                }
                variants(first: 1) {
                  edges {
                    node {
                      id
                      price
                      compareAtPrice
                      inventoryQuantity
                      sku
                      image {
                        url
                      }
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
      const variant = selectedProduct.variants.edges[0].node;
      const originalPrice = parseFloat(variant.price);
      const imageUrl = variant.image?.url || selectedProduct.featuredImage?.url || null;
      
      // For "pickAnotherProduct" action, we just return the selected product without applying a discount
      if (action === "pickAnotherProduct") {
        return json({
          status: "success",
          product: {
            id: selectedProduct.id,
            title: selectedProduct.title,
            imageUrl: imageUrl,
            variant: {
              id: variant.id,
              sku: variant.sku,
              originalPrice: originalPrice,
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
      
      // Add to activity log
      await prisma.activityLog.create({
        data: {
          id: uuidv4(),
          shop: session.shop,
          productId: selectedProduct.id,
          productTitle: selectedProduct.title,
          sku: variant.sku || "",
          originalPrice: originalPrice,
          discountedPrice: parseFloat(discountedPrice),
          discountPercent: discountPercent,
          wasDiscounted: true,
          timestamp: new Date()
        }
      });

      return json({
        status: "success",
        product: {
          id: selectedProduct.id,
          title: selectedProduct.title,
          imageUrl: imageUrl,
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
    } else if (action === "skipProduct") {
      // Log the skipped product without applying a discount
      const productId = formData.get("productId");
      const title = formData.get("title");
      const sku = formData.get("sku") || "";
      const originalPrice = parseFloat(formData.get("originalPrice"));
      
      // Add to activity log as skipped
      await prisma.activityLog.create({
        data: {
          id: uuidv4(),
          shop: session.shop,
          productId: productId,
          productTitle: title,
          sku: sku,
          originalPrice: originalPrice,
          discountedPrice: originalPrice,
          discountPercent: 0,
          wasDiscounted: false,
          timestamp: new Date()
        }
      });
      
      // Get next random product
      return await action({
        request: new Request(request.url, {
          method: 'POST',
          headers: request.headers,
          body: new URLSearchParams({
            action: 'pickAnotherProduct'
          })
        })
      });
    } else if (action === "redoDiscount") {
      // Redo the discount for the same product
      const productId = formData.get("productId");
      const variantId = formData.get("variantId");
      const originalPrice = parseFloat(formData.get("originalPrice"));
      const sku = formData.get("sku");
      const inventoryQuantity = formData.get("inventoryQuantity");
      const title = formData.get("title");
      const imageUrl = formData.get("imageUrl");
      
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
      
      // Add to activity log
      await prisma.activityLog.create({
        data: {
          id: uuidv4(),
          shop: session.shop,
          productId: productId,
          productTitle: title,
          sku: sku || "",
          originalPrice: originalPrice,
          discountedPrice: parseFloat(discountedPrice),
          discountPercent: discountPercent,
          wasDiscounted: true,
          timestamp: new Date()
        }
      });

      return json({
        status: "success",
        product: {
          id: productId,
          title: title,
          imageUrl: imageUrl,
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
      
      // Add to activity log
      await prisma.activityLog.create({
        data: {
          id: uuidv4(),
          shop: session.shop,
          productId: discount.productId,
          productTitle: discount.productTitle,
          sku: discount.sku || "",
          originalPrice: discount.originalPrice,
          discountedPrice: discount.originalPrice,
          discountPercent: 0,
          wasDiscounted: false,
          timestamp: new Date(),
          note: "Discount reverted"
        }
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
            
            // Add to activity log
            await prisma.activityLog.create({
              data: {
                id: uuidv4(),
                shop: session.shop,
                productId: discount.productId,
                productTitle: discount.productTitle,
                sku: discount.sku || "",
                originalPrice: discount.originalPrice,
                discountedPrice: discount.originalPrice,
                discountPercent: 0,
                wasDiscounted: false,
                timestamp: new Date(),
                note: "Discount reverted (bulk action)"
              }
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
  const { discountedProducts, activityLog = [] } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  
  const [lastDiscount, setLastDiscount] = useState(null);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [revertResults, setRevertResults] = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const isLoading = navigation.state === "submitting";

  // Stats
  const discountedCount = activityLog.filter(item => item.wasDiscounted).length;
  const skippedCount = activityLog.filter(item => !item.wasDiscounted).length;
  const totalSavings = activityLog
    .filter(item => item.wasDiscounted)
    .reduce((sum, item) => sum + (item.originalPrice - item.discountedPrice), 0);

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
    formData.append("imageUrl", lastDiscount.imageUrl || "");
    
    submit(formData, { method: "post" });
  }, [lastDiscount, submit]);
  
  const handlePickAnotherProduct = useCallback(() => {
    submit({ action: "pickAnotherProduct" }, { method: "post" });
  }, [submit]);
  
  const handleSkipProduct = useCallback(() => {
    if (!lastDiscount) return;
    
    const formData = new FormData();
    formData.append("action", "skipProduct");
    formData.append("productId", lastDiscount.id);
    formData.append("sku", lastDiscount.variant.sku || "");
    formData.append("originalPrice", lastDiscount.variant.originalPrice);
    formData.append("title", lastDiscount.title);
    
    submit(formData, { method: "post" });
  }, [lastDiscount, submit]);
  
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
  const activeDiscountsRows = discountedProducts?.map(product => [
    product.productTitle,
    product.sku || "N/A",
    `$${product.originalPrice.toFixed(2)}`,
    `$${product.discountedPrice.toFixed(2)}`,
    `${product.discountPercent}%`,
    new Date(product.discountedAt).toLocaleString(),
    <Button size="micro" onClick={() => handleRevertDiscount(product.id)}>
      <Icon source={UndoIcon} />
      <span>Revert</span>
    </Button>
  ]) || [];
  
  // Activity log rows
  const activityLogRows = activityLog.map(log => [
    log.productTitle,
    log.sku || "N/A",
    `$${log.originalPrice.toFixed(2)}`,
    log.wasDiscounted ? `$${log.discountedPrice.toFixed(2)}` : "N/A",
    log.wasDiscounted ? `${log.discountPercent}%` : "N/A",
    new Date(log.timestamp).toLocaleString(),
    <Badge status={log.wasDiscounted ? "success" : "attention"}>
      {log.wasDiscounted ? "Discounted" : "Skipped"}
    </Badge>
  ]);
  
  // Tabs for the history view
  const tabs = [
    {
      id: 'active-discounts',
      content: (
        <span>
          Active Discounts <Badge status="success">{discountedProducts?.length || 0}</Badge>
        </span>
      ),
    },
    {
      id: 'activity-log',
      content: (
        <span>
          Activity Log <Badge>{activityLog.length}</Badge>
        </span>
      ),
    },
  ];

  return (
    <Page
      title={
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Icon source={DiscountIcon} color="success" />
          <span style={{ marginLeft: '8px' }}>Dizzy Discounts</span>
        </div>
      }
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
        {/* Stats Summary Card */}
        <Layout>
          <Layout.Section>
            <Card>
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4 }}>
                  <Box padding="400" borderColor="border" borderBlockEndWidth="1">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">Products Discounted</Text>
                      <Text as="p" variant="heading2xl" color="success">{discountedCount}</Text>
                    </BlockStack>
                  </Box>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4 }}>
                  <Box padding="400" borderColor="border" borderBlockEndWidth="1">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">Products Skipped</Text>
                      <Text as="p" variant="heading2xl" color="critical">{skippedCount}</Text>
                    </BlockStack>
                  </Box>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 12, sm: 4, md: 4, lg: 4 }}>
                  <Box padding="400" borderColor="border" borderBlockEndWidth="1">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">Total Savings Generated</Text>
                      <Text as="p" variant="heading2xl" color="success">${totalSavings.toFixed(2)}</Text>
                    </BlockStack>
                  </Box>
                </Grid.Cell>
              </Grid>
            </Card>
          </Layout.Section>
        </Layout>
        
        <Layout>
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

            {/* Product Display Card */}
            {isLoading ? (
              <Card>
                <BlockStack gap="400">
                  <SkeletonDisplayText size="medium" />
                  <Box paddingBlock="400">
                    <Grid>
                      <Grid.Cell columnSpan={{ xs: 12, sm: 4, md: 4, lg: 4 }}>
                        <Box height="200px" background="bg-surface-secondary" />
                      </Grid.Cell>
                      <Grid.Cell columnSpan={{ xs: 12, sm: 8, md: 8, lg: 8 }}>
                        <SkeletonBodyText lines={4} />
                      </Grid.Cell>
                    </Grid>
                  </Box>
                  <SkeletonBodyText lines={1} />
                </BlockStack>
              </Card>
            ) : lastDiscount ? (
              <Card>
                <BlockStack gap="400">
                  <Box padding="400" borderColor="border" borderBlockEndWidth="1">
                    <Text as="h2" variant="headingLg" alignment="center">
                      Product Decision Center
                    </Text>
                  </Box>
                  
                  <Box padding="400">
                    <BlockStack gap="500">
                      <Grid>
                        <Grid.Cell columnSpan={{ xs: 12, sm: 4, md: 4, lg: 4 }}>
                          <Box padding="200" background="bg-surface-secondary" borderRadius="2" shadow="md" borderWidth="1" borderColor="border">
                            {lastDiscount.imageUrl ? (
                              <Thumbnail 
                                source={lastDiscount.imageUrl} 
                                alt={lastDiscount.title}
                                size="large"
                              />
                            ) : (
                              <Box height="200px" alignment="center" background="bg-surface-secondary">
                                <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }}>
                                  <Icon source={ImageIcon} color="base" />
                                </div>
                              </Box>
                            )}
                          </Box>
                        </Grid.Cell>
                        <Grid.Cell columnSpan={{ xs: 12, sm: 8, md: 8, lg: 8 }}>
                          <BlockStack gap="400">
                            <Text as="h3" variant="headingXl" fontWeight="bold">
                              {lastDiscount.title}
                            </Text>
                            
                            <Box paddingBlock="400">
                              <Grid>
                                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6 }}>
                                  <Box padding="200">
                                    <Text as="span" variant="bodyMd" color="subdued">SKU:</Text>
                                    <Text as="p" variant="bodyLg">{lastDiscount.variant.sku || "N/A"}</Text>
                                  </Box>
                                </Grid.Cell>
                                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6 }}>
                                  <Box padding="200">
                                    <Text as="span" variant="bodyMd" color="subdued">Inventory:</Text>
                                    <Text as="p" variant="bodyLg">{lastDiscount.variant.inventoryQuantity || "N/A"}</Text>
                                  </Box>
                                </Grid.Cell>
                                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6 }}>
                                  <Box padding="200">
                                    <Text as="span" variant="bodyMd" color="subdued">Original Price:</Text>
                                    <Text as="p" variant="headingLg">${lastDiscount.variant.originalPrice}</Text>
                                  </Box>
                                </Grid.Cell>
                                
                                {lastDiscount.variant.discountPercent > 0 && (
                                  <>
                                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6 }}>
                                      <Box padding="200">
                                        <Text as="span" variant="bodyMd" color="subdued">Discounted Price:</Text>
                                        <Text as="p" variant="headingLg" color="success">${lastDiscount.variant.discountedPrice}</Text>
                                      </Box>
                                    </Grid.Cell>
                                    <Grid.Cell columnSpan={{ xs: 12, sm: 12, md: 12, lg: 12 }}>
                                      <Box padding="200" background="bg-surface-success" borderRadius="2">
                                        <Text as="p" variant="headingMd" color="success">
                                          Discount Applied: {lastDiscount.variant.discountPercent}% off
                                        </Text>
                                      </Box>
                                    </Grid.Cell>
                                  </>
                                )}
                              </Grid>
                            </Box>
                          </BlockStack>
                        </Grid.Cell>
                      </Grid>
                      
                      <Box paddingBlockStart="400">
                        <Grid>
                          <Grid.Cell columnSpan={{ xs: 12, sm: 12, md: 12, lg: 12 }}>
                            <div style={{ display: "flex", justifyContent: "center", gap: "16px" }}>
                              {actionData?.skipDiscount ? (
                                <>
                                  <Button 
                                    size="large"
                                    variant="primary" 
                                    onClick={handleRandomDiscount} 
                                    disabled={isLoading}
                                    icon={CheckCircleIcon}
                                  >
                                    <span style={{ marginLeft: "8px" }}>Apply Discount</span>
                                  </Button>
                                  <Button 
                                    size="large"
                                    variant="tertiary"
                                    onClick={handleSkipProduct} 
                                    disabled={isLoading}
                                    icon={XIcon}
                                  >
                                    <span style={{ marginLeft: "8px" }}>Skip Product</span>
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button 
                                    size="large"
                                    variant="primary" 
                                    onClick={handleRedoDiscount} 
                                    disabled={isLoading}
                                    icon={RefreshIcon}
                                  >
                                    <span style={{ marginLeft: "8px" }}>New Discount</span>
                                  </Button>
                                  <Button 
                                    size="large"
                                    variant="tertiary"
                                    onClick={handlePickAnotherProduct} 
                                    disabled={isLoading}
                                  >
                                    Next Product
                                  </Button>
                                </>
                              )}
                            </div>
                          </Grid.Cell>
                        </Grid>
                      </Box>
                    </BlockStack>
                  </Box>
                </BlockStack>
              </Card>
            ) : (
              <Card>
                <EmptyState
                  heading="Start generating random discounts"
                  image=""
                  action={{
                    content: "Generate Random Discount",
                    onAction: handleRandomDiscount
                  }}
                >
                  <p>Click the button to select a random product and apply a discount between 10-40%.</p>
                </EmptyState>
              </Card>
            )}
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Tabs
                  tabs={tabs}
                  selected={selectedTab}
                  onSelect={setSelectedTab}
                />
                
                <div style={{ display: selectedTab === 0 ? "block" : "none" }}>
                  {activeDiscountsRows.length > 0 ? (
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
                      rows={activeDiscountsRows}
                    />
                  ) : (
                    <Box padding="400">
                      <EmptyState
                        heading="No active discounts"
                        image=""
                      >
                        <p>Apply discounts to products to see them listed here.</p>
                      </EmptyState>
                    </Box>
                  )}
                </div>
                
                <div style={{ display: selectedTab === 1 ? "block" : "none" }}>
                  {activityLogRows.length > 0 ? (
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
                        'Timestamp',
                        'Action',
                      ]}
                      rows={activityLogRows}
                    />
                  ) : (
                    <Box padding="400">
                      <EmptyState
                        heading="No activity recorded yet"
                        image=""
                      >
                        <p>Activity will be logged as you interact with products.</p>
                      </EmptyState>
                    </Box>
                  )}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      <FooterHelp>
        Need help with discounts? <Link url="https://help.shopify.com/manual/promoting-marketing/create-marketing/discounts">Learn more</Link>
      </FooterHelp>

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
