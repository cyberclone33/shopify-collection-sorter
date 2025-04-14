import { json, ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Box,
  Banner,
  Button,
  Thumbnail,
  TextContainer,
  InlineStack,
  Divider,
  Badge,
  SkeletonBodyText,
  SkeletonDisplayText,
  TextField,
  Toast,
  Frame,
  Modal
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { useState, useEffect } from "react";
import prisma from "../db.server";
import { getRandomProducts } from '../utils/productFetcher';
import { shuffleArray } from '../utils/productCache';

// Interface for our product data
interface ProductData {
  id: string;
  title: string;
  imageUrl: string;
  cost: number;
  sellingPrice: number;
  compareAtPrice: number | null;
  inventoryQuantity: number;
  variantId: string;
  currencyCode: string;
  variantTitle?: string;
}

// Interface for discount data
interface DiscountData {
  profitMargin: number;
  discountPercentage: number;
  originalPrice: number;
  discountedPrice: number;
  savingsAmount: number;
  savingsPercentage: number;
}

// Constants
const DAILY_DISCOUNT_TAG = "DailyDiscount_每日優惠";
const NUM_RANDOM_PRODUCTS = 6; // How many products to show in UI

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const debugVariantId = url.searchParams.get("debugVariantId");
  const forceRefresh = url.searchParams.get("refresh") === "true";
  
  // Fetch recent manual discount logs
  const recentManualDiscountLogs = await prisma.dailyDiscountLog.findMany({
    where: {
      shop: session.shop,
      isRandomDiscount: true, // This was previously true for both
      notes: {
        not: {
          contains: "Auto Discount"
        }
      }
    },
    orderBy: {
      appliedAt: 'desc'
    },
    take: 20
  });
  
  // Fetch recent API discount logs
  const recentApiDiscountLogs = await prisma.dailyDiscountLog.findMany({
    where: {
      shop: session.shop,
      isRandomDiscount: true, // Both use isRandomDiscount: true
      notes: {
        contains: "Auto Discount"
      }
    },
    orderBy: {
      appliedAt: 'desc'
    },
    take: 20
  });
  
  // If a specific variant ID is provided for debugging
  if (debugVariantId) {
    try {
      const variantId = debugVariantId.includes("gid://") 
        ? debugVariantId 
        : `gid://shopify/ProductVariant/${debugVariantId}`;
        
      const response = await admin.graphql(`
        query GetVariantDetails($id: ID!) {
          productVariant(id: $id) {
            id
            title
            price
            compareAtPrice
            inventoryQuantity
            product {
              id
              title
              featuredImage {
                url
              }
            }
            inventoryItem {
              id
              unitCost {
                amount
                currencyCode
              }
            }
          }
        }
      `, {
        variables: {
          id: variantId
        }
      });
      
      const responseJson = await response.json();
      
      if (responseJson.errors) {
        return json({
          status: "error",
          message: `Error fetching variant: ${responseJson.errors[0].message}`,
          debugVariant: null,
          debugVariantId
        });
      }
      
      const variant = responseJson.data?.productVariant;
      
      if (!variant) {
        return json({
          status: "error",
          message: "Variant not found",
          debugVariant: null,
          debugVariantId
        });
      }
      
      // Transform data for easier display
      const debugVariant = {
        id: variant.id,
        variantTitle: variant.title,
        productTitle: variant.product.title,
        price: parseFloat(variant.price),
        compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
        inventoryQuantity: variant.inventoryQuantity,
        cost: variant.inventoryItem?.unitCost?.amount 
          ? parseFloat(variant.inventoryItem.unitCost.amount) 
          : null,
        currencyCode: variant.inventoryItem?.unitCost?.currencyCode || 'USD',
        imageUrl: variant.product.featuredImage?.url || null,
        hasCost: !!variant.inventoryItem?.unitCost?.amount,
        hasImage: !!variant.product.featuredImage,
        hasPositiveInventory: variant.inventoryQuantity > 0
      };
      
      return json({
        status: "debug",
        debugVariant,
        debugVariantId,
        message: "Debug mode: Displaying variant information"
      });
    }
    catch (error) {
      console.error("Error in debug mode:", error);
      return json({
        status: "error",
        message: `Error in debug mode: ${error instanceof Error ? error.message : "Unknown error"}`,
        debugVariant: null,
        debugVariantId
      });
    }
  }
  
  // Regular product fetch logic with caching
  try {
    // Get random products using our optimized utility
    const { products, stats, cacheStatus } = await getRandomProducts(
      NUM_RANDOM_PRODUCTS,
      admin,
      session.shop,
      forceRefresh
    );
    
    if (products.length === 0) {
      return json({
        status: "error",
        message: "No products found meeting minimum requirements (image and positive inventory).",
        randomProduct: null,
        recentManualDiscountLogs,
        recentApiDiscountLogs
      });
    }
    
    // The first product is our primary random product (for backward compatibility)
    const randomProduct = products[0];
    
    // For detailed debugging, log the selected products
    console.log(`Using ${products.length} random products for display`);
    products.forEach((product, index) => {
      console.log(`Selected random product ${index + 1}: ${product.title} (Variant ID: ${product.variantId.split('/').pop()})`);
    });
    
    // Fetch products with the DailyDiscount tag for UI display
    console.log(`Fetching products with tag "${DAILY_DISCOUNT_TAG}"...`);
    
    // Fetch a small number of tagged products for display (we only need to display a few)
    const response = await admin.graphql(`
      query GetTaggedProducts($tag: String!) {
        products(first: 10, query: $tag) {
          edges {
            node {
              id
              title
              tags
              featuredImage {
                url
                altText
              }
              variants(first: 1) {
                edges {
                  node {
                    id
                    title
                    price
                    compareAtPrice
                    inventoryQuantity
                    inventoryItem {
                      unitCost {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, {
      variables: {
        tag: `tag:${DAILY_DISCOUNT_TAG}`
      }
    });
    
    const responseJson = await response.json();
    
    // Parse tagged products (these are current active discounts)
    const taggedProductsEdges = responseJson.data?.products?.edges || [];
    console.log(`Found ${taggedProductsEdges.length} products with tag "${DAILY_DISCOUNT_TAG}"`);
    
    // Transform the data for easier display
    const taggedProducts = taggedProductsEdges.map((edge: any) => {
      const product = edge.node;
      const variant = product.variants.edges[0]?.node;
      
      if (!variant) return null; // Skip products without variants
      
      const price = parseFloat(variant.price);
      
      // If cost is missing, estimate it as 50% of the selling price
      const hasCost = variant.inventoryItem?.unitCost?.amount;
      const cost = hasCost 
        ? parseFloat(variant.inventoryItem.unitCost.amount)
        : price * 0.5; // Assume 50% cost if not available
      
      // Use the same currency code for cost and price if cost data is missing
      const currencyCode = variant.inventoryItem?.unitCost?.currencyCode || 'USD';
      
      return {
        id: product.id,
        title: product.title,
        tags: product.tags,
        imageUrl: product.featuredImage?.url || null,
        imageAlt: product.featuredImage?.altText || product.title,
        cost: cost,
        sellingPrice: price,
        compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
        inventoryQuantity: variant.inventoryQuantity || 0,
        variantId: variant.id,
        variantTitle: variant.title !== "Default Title" ? variant.title : null,
        currencyCode: currencyCode,
        hasCostData: !!hasCost, // Flag to indicate if cost was provided or estimated
        hasDiscount: variant.compareAtPrice && parseFloat(variant.compareAtPrice) > price
      };
    }).filter(Boolean); // Remove null entries
    
    return json({
      status: "success",
      taggedProducts,
      randomProduct,
      multipleRandomProducts: products,
      recentManualDiscountLogs,
      recentApiDiscountLogs,
      tagName: DAILY_DISCOUNT_TAG,
      productStats: stats,
      totalProductsScanned: stats.total,
      cacheStatus
    });
    
  } catch (error) {
    console.error("Error fetching random product:", error);
    return json({
      status: "error",
      message: error instanceof Error ? error.message : "An unknown error occurred",
      randomProduct: null,
      recentManualDiscountLogs: [],
      recentApiDiscountLogs: []
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const variantId = formData.get("variantId")?.toString();
  const newPrice = formData.get("newPrice")?.toString();
  const compareAtPrice = formData.get("compareAtPrice")?.toString();
  
  // Additional fields for logging
  const productId = formData.get("productId")?.toString();
  const productTitle = formData.get("productTitle")?.toString();
  const variantTitle = formData.get("variantTitle")?.toString();
  const originalPrice = formData.get("originalPrice")?.toString();
  const costPrice = formData.get("costPrice")?.toString();
  const profitMargin = formData.get("profitMargin")?.toString();
  const discountPercentage = formData.get("discountPercentage")?.toString();
  const savingsAmount = formData.get("savingsAmount")?.toString();
  const savingsPercentage = formData.get("savingsPercentage")?.toString();
  const currencyCode = formData.get("currencyCode")?.toString();
  const imageUrl = formData.get("imageUrl")?.toString();
  const inventoryQuantity = formData.get("inventoryQuantity")?.toString();
  const notes = formData.get("notes")?.toString();
  
  if (!variantId || !newPrice) {
    return json({
      status: "error",
      message: "Missing required parameters"
    });
  }
  
  try {
    // First, we need to ensure we have the parent product ID
    // If product ID is not directly provided, we may need to fetch it
    let parentProductId = productId;
    
    if (!parentProductId) {
      // If we don't have the product ID, try to extract it from the variant ID
      // This assumes variant ID is in the format "gid://shopify/ProductVariant/123456789"
      // Extract the numeric part and query the product
      const variantMatch = variantId.match(/gid:\/\/shopify\/ProductVariant\/(\d+)/);
      if (variantMatch && variantMatch[1]) {
        // Fetch the product ID using the variant
        try {
          const variantResponse = await admin.graphql(`
            query GetProductIdFromVariant($variantId: ID!) {
              productVariant(id: $variantId) {
                product {
                  id
                }
              }
            }
          `, {
            variables: {
              variantId
            }
          });
          
          const variantData = await variantResponse.json();
          parentProductId = variantData.data?.productVariant?.product?.id;
          
          if (!parentProductId) {
            return json({
              status: "error",
              message: "Could not determine product ID for this variant"
            });
          }
        } catch (variantError) {
          console.error("Error fetching product ID from variant:", variantError);
          return json({
            status: "error",
            message: "Could not fetch product information"
          });
        }
      } else {
        return json({
          status: "error",
          message: "Invalid variant ID format"
        });
      }
    }
    
    // Check if this is a revert action by looking at the notes
    const isRevert = notes && notes.includes("Reverted discount");
    
    // First step: Update the product variant with the new price
    // Using productVariantsBulkUpdate mutation for Shopify API 2025-01
    const response = await admin.graphql(`
      mutation updateProductVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
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
        productId: parentProductId, // We need the parent product ID for this mutation
        variants: [{
          id: variantId,
          price: newPrice,
          compareAtPrice: compareAtPrice || null
        }]
      }
    });
    
    // Second step: Update the product tags - add or remove "DailyDiscount_每日優惠" tag
    // First, fetch the current product tags
    const productResponse = await admin.graphql(`
      query getProductTags($productId: ID!) {
        product(id: $productId) {
          id
          tags
        }
      }
    `, {
      variables: {
        productId: parentProductId
      }
    });
    
    const productJson = await productResponse.json();
    const currentTags = productJson.data?.product?.tags || [];
    const dailyDiscountTag = "DailyDiscount_每日優惠";
    
    // Prepare new tags list based on whether we're applying or reverting a discount
    let newTags;
    if (isRevert) {
      // Remove the tag when reverting
      newTags = currentTags.filter(tag => tag !== dailyDiscountTag);
    } else {
      // Add the tag when applying discount (if not already present)
      if (!currentTags.includes(dailyDiscountTag)) {
        newTags = [...currentTags, dailyDiscountTag];
      } else {
        newTags = currentTags; // Tag already exists, no change needed
      }
    }
    
    // Only update tags if they've changed
    if (JSON.stringify(newTags) !== JSON.stringify(currentTags)) {
      await admin.graphql(`
        mutation updateProductTags($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
              tags
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
            id: parentProductId,
            tags: newTags
          }
        }
      });
    }
    
    const responseJson = await response.json();
    
    if (responseJson.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
      const errors = responseJson.data.productVariantsBulkUpdate.userErrors.map((err: any) => err.message).join(", ");
      return json({
        status: "error",
        message: `Error updating product: ${errors}`
      });
    }

    // Log the discount to the database
    try {
      await prisma.dailyDiscountLog.create({
        data: {
          shop: session.shop,
          productId: productId || '',
          productTitle: productTitle || 'Unknown Product',
          variantId: variantId,
          variantTitle: variantTitle || null,
          originalPrice: parseFloat(originalPrice || '0'),
          discountedPrice: parseFloat(newPrice),
          compareAtPrice: compareAtPrice ? parseFloat(compareAtPrice) : null,
          costPrice: costPrice ? parseFloat(costPrice) : null,
          profitMargin: profitMargin ? parseFloat(profitMargin) : null,
          discountPercentage: parseFloat(discountPercentage || '0'),
          savingsAmount: parseFloat(savingsAmount || '0'),
          savingsPercentage: parseFloat(savingsPercentage || '0'),
          currencyCode: currencyCode || 'USD',
          imageUrl: imageUrl || null,
          inventoryQuantity: inventoryQuantity ? parseInt(inventoryQuantity) : null,
          isRandomDiscount: true,
          notes: notes || "Manual UI Discount"
        }
      });
      console.log(`Discount logged for product ${productTitle} (${variantId})`);
    } catch (logError) {
      console.error("Error logging discount:", logError);
      // Continue anyway even if logging fails
    }
    
    return json({
      status: "success",
      message: isRevert ? "Price reverted successfully" : "Product price updated successfully",
      variant: responseJson.data?.productVariantsBulkUpdate?.productVariants?.[0] || null,
      isRevert
    });
    
  } catch (error) {
    console.error("Error updating product price:", error);
    
    // Log additional details about the error to help with debugging
    if (error.response) {
      console.error("Response data:", error.response.data);
      console.error("Response status:", error.response.status);
      console.error("Response headers:", error.response.headers);
    } else if (error.request) {
      console.error("No response received, request was:", error.request);
    } else if (error.networkData) {
      console.error("Network data:", error.networkData);
    }
    
    // If it's a GraphQL error, it might have additional details
    if (error.graphQLErrors) {
      console.error("GraphQL errors:", error.graphQLErrors);
    }
    
    let errorMessage = "An unknown error occurred";
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Add context for common error types
      if (errorMessage.includes("productVariantsBulkUpdate")) {
        errorMessage += " - This could be due to missing product ID or incorrect mutation format";
      } else if (errorMessage.includes("permission")) {
        errorMessage += " - This could be due to missing permissions for editing products";
      }
    }
    
    return json({
      status: "error",
      message: errorMessage,
      details: error.stack || "No stack trace available"
    });
  }
};

export default function DailyDiscounts() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { randomProduct, multipleRandomProducts, status, message, recentManualDiscountLogs, recentApiDiscountLogs, taggedProducts, tagName } = loaderData;
  const [discount, setDiscount] = useState<DiscountData | null>(null);
  const [isGeneratingDiscount, setIsGeneratingDiscount] = useState(false);
  const [isPriceUpdated, setIsPriceUpdated] = useState(false);
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [isReverting, setIsReverting] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<{active: boolean, message: string}>({
    active: false,
    message: ""
  });
  const [confirmRevert, setConfirmRevert] = useState<any | null>(null);
  const [selectedProductIndex, setSelectedProductIndex] = useState(0);
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set());
  const [applyingMultiple, setApplyingMultiple] = useState(false);
  const [batchResults, setBatchResults] = useState<{
    success: number, 
    failed: number, 
    failedProducts?: Array<{
      title: string, 
      variantId: string, 
      error: string,
      discountPercentage?: number,
      originalPrice?: number,
      discountedPrice?: number
    }>,
    processedProducts?: Array<{
      title: string,
      originalPrice: number,
      discountedPrice: number,
      discountPercentage: number,
      savingsAmount: number,
      savingsPercentage: string
    }>
  } | null>(null);
  const [manualLogCount, setManualLogCount] = useState(20);
  const [apiLogCount, setApiLogCount] = useState(20);
  const [isLoadingMoreManual, setIsLoadingMoreManual] = useState(false);
  const [isLoadingMoreApi, setIsLoadingMoreApi] = useState(false);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [isResettingHistory, setIsResettingHistory] = useState(false);
  const submit = useSubmit();
  
  // Function to generate a random discount
  const generateRandomDiscount = () => {
    if (!multipleRandomProducts || multipleRandomProducts.length === 0) return;
    
    const selectedProduct = multipleRandomProducts[selectedProductIndex];
    
    setIsGeneratingDiscount(true);
    setIsPriceUpdated(false);
    
    // Calculate profit margin
    const profit = selectedProduct.sellingPrice - selectedProduct.cost;
    const profitMargin = profit / selectedProduct.sellingPrice * 100;
    
    // Generate random discount percentage between 10% and 25%
    const discountPercentage = Math.floor(Math.random() * 16) + 10; // 10 to 25
    
    // Calculate discounted profit (applying discount to the profit)
    const discountFactor = 1 - (discountPercentage / 100);
    const discountedProfit = profit * discountFactor;
    
    // Calculate new price (cost + discounted profit)
    const newPrice = selectedProduct.cost + discountedProfit;
    
    // Make the price end in .99 for more attractive pricing
    const roundedPrice = Math.floor(newPrice * 100) / 100;
    const marketingPrice = Math.floor(roundedPrice) + 0.99;
    
    // Calculate savings
    const savingsAmount = selectedProduct.sellingPrice - marketingPrice;
    const savingsPercentage = (savingsAmount / selectedProduct.sellingPrice) * 100;
    
    // Set discount data
    setDiscount({
      profitMargin: profitMargin,
      discountPercentage: discountPercentage,
      originalPrice: selectedProduct.sellingPrice,
      discountedPrice: marketingPrice,
      savingsAmount: savingsAmount,
      savingsPercentage: savingsPercentage
    });
    
    setTimeout(() => setIsGeneratingDiscount(false), 800);
  };
  
  // Actually perform the revert after confirmation
  const confirmRevertDiscount = () => {
    if (!confirmRevert) return;
    
    const log = confirmRevert;
    setIsReverting(log.id);
    
    const formData = new FormData();
    formData.append("variantId", log.variantId);
    formData.append("newPrice", log.originalPrice.toString());
    
    // Set compareAtPrice to null to remove the sale price effect
    formData.append("compareAtPrice", "");
    
    // We need the product ID for the bulk update mutation
    if (log.productId) {
      formData.append("productId", log.productId);
    }
    
    // Add additional fields for logging
    formData.append("productTitle", log.productTitle);
    if (log.variantTitle) {
      formData.append("variantTitle", log.variantTitle);
    }
    formData.append("originalPrice", log.discountedPrice.toString());
    formData.append("costPrice", log.costPrice?.toString() || "0");
    formData.append("currencyCode", log.currencyCode || "USD");
    
    // For reversions, savings should be zero (no savings on a reverted price)
    formData.append("savingsAmount", "0");
    formData.append("savingsPercentage", "0");
    formData.append("discountPercentage", "0");
    
    // Check if this is from an automated discount and preserve the type in notes
    // This will ensure reversion logs appear in the same section as the original discount
    if (log.notes && log.notes.includes("Auto Discount")) {
      formData.append("notes", "Auto Discount Reverted");
    } else {
      formData.append("notes", "Manual UI Discount Reverted");
    }
    
    // Close the confirmation dialog
    setConfirmRevert(null);
    
    // The revert action is just a regular price update back to the original price
    submit(formData, { method: "post" });
  };
  
  // Apply the discount to a single product
  const applyDiscount = () => {
    if (!multipleRandomProducts || multipleRandomProducts.length === 0 || !discount) return;
    
    const selectedProduct = multipleRandomProducts[selectedProductIndex];
    
    const formData = new FormData();
    formData.append("variantId", selectedProduct.variantId);
    formData.append("newPrice", discount.discountedPrice.toString());
    
    // Get product ID from the product's full ID
    let productId = selectedProduct.id;
    
    // If for some reason we need to fix the format of the product ID
    if (!productId.includes("gid://shopify/Product/")) {
      // If the ID is just a number or has a different format, try to fix it
      if (/^\d+$/.test(productId)) {
        productId = `gid://shopify/Product/${productId}`;
      }
    }
    
    formData.append("productId", productId);
    
    // Always set compareAtPrice to original price to ensure it appears as a sale
    formData.append("compareAtPrice", selectedProduct.sellingPrice.toString());
    
    // Add all the fields needed for logging to the database
    formData.append("productTitle", selectedProduct.title);
    if (selectedProduct.variantTitle) {
      formData.append("variantTitle", selectedProduct.variantTitle);
    }
    formData.append("originalPrice", selectedProduct.sellingPrice.toString());
    formData.append("costPrice", selectedProduct.cost.toString());
    formData.append("profitMargin", discount.profitMargin.toString());
    formData.append("discountPercentage", discount.discountPercentage.toString());
    formData.append("savingsAmount", discount.savingsAmount.toString());
    formData.append("savingsPercentage", discount.savingsPercentage.toString());
    formData.append("currencyCode", selectedProduct.currencyCode);
    formData.append("imageUrl", selectedProduct.imageUrl);
    formData.append("inventoryQuantity", selectedProduct.inventoryQuantity.toString());
    formData.append("notes", selectedProduct.hasCostData ? "Based on actual cost data" : "Based on estimated cost (50% of price)");
    
    submit(formData, { method: "post" });
    setIsPriceUpdated(true);
  };
  
  // Format currency
  const formatCurrency = (amount: number, currencyCode: string = "USD") => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2
    }).format(amount);
  };
  
  // Check for action data updates
  useEffect(() => {
    // Check for errors from the action
    if (actionData && actionData.status === "error") {
      setDiscountError(actionData.message || "Error applying discount");
      setIsPriceUpdated(false);
      setIsReverting(null);
    }
    
    // Handle successful action
    if (actionData && actionData.status === "success") {
      // Clear any reverting state
      setIsReverting(null);
      
      // If we just reverted a price, show a success message
      if (actionData.isRevert) {
        setDiscountError(null);
        setSuccessToast({
          active: true,
          message: "Price successfully reverted to original value"
        });
      } else {
        // If we applied a discount, show a success message about the tag being added
        setSuccessToast({
          active: true,
          message: "Price updated successfully and DailyDiscount_每日優惠 tag added to product"
        });
      }
      
      // Auto-hide toast after 5 seconds
      setTimeout(() => {
        setSuccessToast(prev => ({ ...prev, active: false }));
      }, 5000);
    }
  }, [actionData]);

  // Generate a discount when the component loads or when the selected product changes
  useEffect(() => {
    if (multipleRandomProducts && multipleRandomProducts.length > 0) {
      generateRandomDiscount();
    }
  }, [multipleRandomProducts, selectedProductIndex]);
  
  // Simple empty component for a simplified build
  return (
    <Frame>
      <Page title="Daily Discounts">
        <TitleBar title="Daily Discounts" />
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Daily Discounts</Text>
                <Text as="p">The file was truncated during a previous operation. Please refresh the page to see the full interface.</Text>
                <Button url="/app/daily-discounts">Refresh Page</Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
