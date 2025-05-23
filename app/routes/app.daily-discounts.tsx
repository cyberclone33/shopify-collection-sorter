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
  Modal,
  ProgressBar,
  Spinner
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { useState, useEffect } from "react";
import prisma from "../db.server";
import { getRandomProducts } from '../utils/productFetcher';
import { shuffleArray } from '../utils/productCache';

// Loading indicator component to show progress when fetching random products
function LoadingOverlay({ progress, isLoading, error }: { progress: number, isLoading: boolean, error: string | null }) {
  if (!isLoading && !error) return null;
  
  return (
    <div style={{ 
      padding: '20px', 
      marginBottom: '20px', 
      backgroundColor: 'var(--p-surface)',
      borderRadius: 'var(--p-border-radius-2)',
      border: `1px solid ${error ? 'var(--p-border-critical)' : 'var(--p-border-subdued)'}` 
    }}>
      {isLoading ? (
        <BlockStack gap="400">
          <Box paddingBlockEnd="300">
            <InlineStack gap="400" align="center">
              <Spinner size="small" accessibilityLabel="Loading random products" />
              <Text as="p" variant="bodyMd">
                Loading products for discount analysis... {progress}%
              </Text>
            </InlineStack>
          </Box>
          <ProgressBar
            progress={progress}
            size="small"
            color={error ? "critical" : "highlight"}
          />
          <Text as="p" variant="bodySm" tone="subdued">
            This may take a moment as we scan your entire inventory to find the best discount candidates.
          </Text>
        </BlockStack>
      ) : null}
      
      {error ? (
        <Banner
          title="Error loading random products"
          tone="critical"
        >
          <p>{error}</p>
          <Box paddingBlockStart="300">
            <Button onClick={() => window.location.reload()}>
              Retry
            </Button>
          </Box>
        </Banner>
      ) : null}
    </div>
  );
}

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

import { getRandomProducts } from '../utils/productFetcher';

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
  
  // CHANGE #1: Restructured the loader to load quickly, deferring heavy product fetching to client-side
  try {
    // Fetch products with the DailyDiscount tag for UI display
    // This is a lightweight query that runs quickly
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
    
    // CHANGE #2: Return early with minimal data rather than waiting for getRandomProducts
    // This allows the page to load quickly
    return json({
      status: "success",
      initialDataLoaded: true,  // Flag to indicate page can render immediately
      randomProductsLoading: true,  // Signal to client that random products need to be loaded
      taggedProducts,
      randomProduct: null,  // Will be loaded client-side
      multipleRandomProducts: [],  // Will be loaded client-side
      recentManualDiscountLogs,
      recentApiDiscountLogs,
      tagName: DAILY_DISCOUNT_TAG,
      // CHANGE #3: Pass session data needed for client-side API calls
      adminSessionData: {
        shop: session.shop,
        accessToken: session.accessToken,
        expires: session.expires
      },
      forceRefresh  // Pass through to client-side for API calls
    });
    
  } catch (error) {
    console.error("Error fetching initial data:", error);
    return json({
      status: "error",
      message: error instanceof Error ? error.message : "An unknown error occurred",
      randomProduct: null,
      multipleRandomProducts: [],
      recentManualDiscountLogs,
      recentApiDiscountLogs,
      // CHANGE #4: Still signal that random products need to be loaded
      randomProductsLoading: true
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  // Check if this is a request to fetch random products
  const action = formData.get("action")?.toString();
  
  if (action === "fetchRandomProducts") {
    try {
      // Parse count parameter with default value
      const countParam = formData.get("count")?.toString();
      const count = countParam ? parseInt(countParam, 10) : 6;
      const forceRefresh = formData.get("forceRefresh") === "true";
      
      console.log(`Fetching ${count} random products via server action for shop: ${session.shop}`);
      
      // Use the existing utility to get random products
      // This maintains the authenticated admin context
      const { products, stats, cacheStatus } = await getRandomProducts(
        count,
        admin,
        session.shop,
        forceRefresh
      );
      
      if (products.length === 0) {
        return json({
          fetchStatus: "error",
          message: "No products found meeting minimum requirements (image and positive inventory).",
          products: [],
          stats: null
        });
      }
      
      // The first product is our primary random product (for backward compatibility)
      const randomProduct = products[0];
      
      console.log(`Server action: Found ${products.length} random products`);
      
      // Return the products and stats
      return json({
        fetchStatus: "success",
        products,
        randomProduct,
        stats,
        totalProductsScanned: stats.total,
        cacheStatus
      });
    } catch (error) {
      console.error("Error fetching random products in server action:", error);
      return json({
        fetchStatus: "error",
        message: error instanceof Error ? error.message : "An unknown error occurred",
        products: []
      });
    }
  }
  
  // Original price update action
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
    const isRevert = notes && notes.includes("Reverted");
    
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
      // Check if this is a revert
      const isRevert = formData.get("isRevert") === "true";
      const originalLogId = formData.get("originalLogId")?.toString();
      const revertedAt = formData.get("revertedAt")?.toString();
      
      if (isRevert && originalLogId) {
        // For reverts, update the existing log entry instead of creating a new one
        await prisma.dailyDiscountLog.update({
          where: {
            id: originalLogId
          },
          data: {
            isReverted: true,
            revertedAt: revertedAt ? new Date(revertedAt) : new Date(),
            revertOriginalPrice: parseFloat(originalPrice || '0'),
            revertDiscountedPrice: parseFloat(newPrice),
            revertCompareAtPrice: compareAtPrice ? parseFloat(compareAtPrice) : null,
            revertNotes: notes || "Reverted to original price"
          }
        });
        console.log(`Updated discount log for reverted product ${productTitle} (${variantId})`);
      } else {
        // For new discounts, create a new log entry as before
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
            isReverted: false,
            notes: notes || "Manual UI Discount"
          }
        });
        console.log(`Discount logged for product ${productTitle} (${variantId})`);
      }} catch (logError) {
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
  
  // Extract variables from loader data, including new randomProductsLoading flag
  const { 
    status, 
    message, 
    recentManualDiscountLogs, 
    recentApiDiscountLogs, 
    taggedProducts, 
    tagName,
    randomProductsLoading = false,
    adminSessionData,
    forceRefresh = false
  } = loaderData;
  
  // State for storing product data that will be loaded client-side
  const [randomProduct, setRandomProduct] = useState(loaderData.randomProduct || null);
  const [multipleRandomProducts, setMultipleRandomProducts] = useState(loaderData.multipleRandomProducts || []);
  const [loadingRandomProducts, setLoadingRandomProducts] = useState(randomProductsLoading);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [productStats, setProductStats] = useState(loaderData.productStats || { total: 0, eligible: 0 });
  
  // Regular state variables from original component
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
  // Track reverted items in state instead of creating new database entries
  const [revertedItems, setRevertedItems] = useState<Set<string>>(new Set());
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
  
  // Effect for client-side loading of random products using server action
  useEffect(() => {
    if (loadingRandomProducts) {
      // Function to fetch random products via a server action
      const fetchRandomProducts = async () => {
        try {
          setLoadingProgress(10); // Start loading indicator
          
          // Create form data for the server action
          const formData = new FormData();
          formData.append('action', 'fetchRandomProducts');
          formData.append('count', NUM_RANDOM_PRODUCTS.toString());
          if (forceRefresh) {
            formData.append('forceRefresh', 'true');
          }
          
          setLoadingProgress(30); // Update progress
          
          // Submit the form to the server action
          // This preserves the authentication context
          submit(formData, { 
            method: 'post',
            replace: false // Don't replace current entry in history
          });
          
          setLoadingProgress(50); // Update progress
          
          // The actual data processing happens in the actionData effect below
          // This is a more reliable pattern with Remix as it guarantees we catch the updates
          
        } catch (error) {
          console.error('Error submitting product fetch request:', error);
          setLoadingError(error instanceof Error ? error.message : 'Unknown error submitting request');
          setLoadingRandomProducts(false);
        }
      };
      
      // Start the fetch operation
      fetchRandomProducts();
    }
  }, [loadingRandomProducts, forceRefresh, submit]);
  
  // Separate effect to handle action data updates
  useEffect(() => {
    // Process action data when it becomes available
    if (actionData && 'fetchStatus' in actionData && loadingRandomProducts) {
      setLoadingProgress(80); // Almost done
      
      if (actionData.fetchStatus === 'success' && actionData.products && actionData.products.length > 0) {
        // Update state with the fetched products
        setMultipleRandomProducts(actionData.products);
        setRandomProduct(actionData.products[0]); // Set first product as primary
        if (actionData.stats) {
          setProductStats(actionData.stats);
        }
        setLoadingError(null);
      } else {
        setLoadingError(actionData.message || 'No products returned from the server');
      }
      
      setLoadingProgress(100); // Complete
      
      // Small delay before removing loading indicator to ensure progress animation completes
      setTimeout(() => {
        setLoadingRandomProducts(false);
      }, 500);
    }
  }, [actionData, loadingRandomProducts]);
  
  // Store authentication info in localStorage when the component loads
  useEffect(() => {
    // If we have session data from the loader, store it for API calls
    if (adminSessionData?.shop && adminSessionData?.accessToken) {
      const { shop, accessToken, expires } = adminSessionData;
      
      try {
        // Store in localStorage for use by API calls
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('shopify:shop', shop);
          
          // Only store token if it's available and not expired
          if (accessToken && (!expires || new Date(expires) > new Date())) {
            localStorage.setItem('shopify:token', accessToken);
            localStorage.setItem('shopify:token_expires', expires?.toString() || '');
          }
        }
      } catch (e) {
        console.error("Error storing authentication data:", e);
      }
    }
    
    // Check if we need to refresh authentication
    const checkAuth = async () => {
      try {
        // Check if token exists but might be expired
        const storedExpires = localStorage.getItem('shopify:token_expires');
        if (storedExpires) {
          const expiryDate = new Date(storedExpires);
          const now = new Date();
          
          // If token expires soon (within 5 minutes) or has expired, refresh it
          if (expiryDate <= new Date(now.getTime() + 5 * 60 * 1000)) {
            const response = await fetch('/api/auth-check');
            if (response.ok) {
              const data = await response.json();
              if (data.status === "success") {
                localStorage.setItem('shopify:shop', data.shop);
                localStorage.setItem('shopify:token', data.accessToken);
                localStorage.setItem('shopify:token_expires', data.expiresAt || '');
              }
            }
          }
        } else {
          // No token stored, try to get one
          const response = await fetch('/api/auth-check');
          if (response.ok) {
            const data = await response.json();
            if (data.status === "success") {
              localStorage.setItem('shopify:shop', data.shop);
              localStorage.setItem('shopify:token', data.accessToken);
              localStorage.setItem('shopify:token_expires', data.expiresAt || '');
            }
          }
        }
      } catch (e) {
        console.error("Error checking authentication:", e);
      }
    };
    
    checkAuth();
  }, [adminSessionData]);
  
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
  
  // Helper function to calculate a discount for a specific product
  // In batch mode, each product gets a completely randomized discount percentage
  const calculateDiscountForProduct = (product, baseDiscountPercentage, isRandomized = false) => {
    // Calculate product-specific profit margin
    const profit = product.sellingPrice - product.cost;
    const profitMargin = profit / product.sellingPrice * 100;
    
    // For batch operations, use a completely random discount percentage for each product
    // This makes each product have a unique discount that's more interesting for customers
    let actualDiscountPercentage;
    if (isRandomized) {
      // Generate a fresh random discount between 10-25%
      actualDiscountPercentage = Math.floor(Math.random() * 16) + 10; // 10 to 25
      console.log(`Generated random discount for ${product.title}: ${actualDiscountPercentage}%`);
    } else {
      actualDiscountPercentage = baseDiscountPercentage;
    }
    
    // Calculate discounted profit (applying discount to the profit)
    const discountFactor = 1 - (actualDiscountPercentage / 100);
    const discountedProfit = profit * discountFactor;
    
    // Calculate new price (cost + discounted profit)
    const newPrice = product.cost + discountedProfit;
    
    // Make the price end in .99 for more attractive pricing
    const roundedPrice = Math.floor(newPrice * 100) / 100;
    const marketingPrice = Math.floor(roundedPrice) + 0.99;
    
    // Calculate savings
    const savingsAmount = product.sellingPrice - marketingPrice;
    const savingsPercentage = (savingsAmount / product.sellingPrice) * 100;
    
    return {
      profitMargin,
      discountPercentage: actualDiscountPercentage,
      originalPrice: product.sellingPrice,
      discountedPrice: marketingPrice,
      savingsAmount,
      savingsPercentage
    };
  };

  // Helper function to prepare form data for a product
  const prepareProductFormData = (productIndex: number) => {
    if (!multipleRandomProducts) return null;
    
    const product = multipleRandomProducts[productIndex];
    if (!product) return null;
    
    // For batch operations, calculate a product-specific discount with randomized percentage
    // For single operations, use the global discount
    const productDiscount = applyingMultiple
      ? calculateDiscountForProduct(product, Math.floor(Math.random() * 16) + 10, true) // random 10-25% discount
      : discount;
      
    if (!productDiscount) return null;
    
    const formData = new FormData();
    formData.append("variantId", product.variantId);
    formData.append("newPrice", productDiscount.discountedPrice.toString());
    
    // Get product ID from the product's full ID
    let productId = product.id;
    
    // If for some reason we need to fix the format of the product ID
    if (!productId.includes("gid://shopify/Product/")) {
      // If the ID is just a number or has a different format, try to fix it
      if (/^\d+$/.test(productId)) {
        productId = `gid://shopify/Product/${productId}`;
      }
    }
    
    formData.append("productId", productId);
    
    // Always set compareAtPrice to original price to ensure it appears as a sale
    formData.append("compareAtPrice", product.sellingPrice.toString());
    
    // Add all the fields needed for logging to the database
    formData.append("productTitle", product.title);
    if (product.variantTitle) {
      formData.append("variantTitle", product.variantTitle);
    }
    formData.append("originalPrice", product.sellingPrice.toString());
    formData.append("costPrice", product.cost.toString());
    formData.append("profitMargin", productDiscount.profitMargin.toString());
    formData.append("discountPercentage", productDiscount.discountPercentage.toString());
    formData.append("savingsAmount", productDiscount.savingsAmount.toString());
    formData.append("savingsPercentage", productDiscount.savingsPercentage.toString());
    formData.append("currencyCode", product.currencyCode);
    formData.append("imageUrl", product.imageUrl);
    formData.append("inventoryQuantity", product.inventoryQuantity.toString());
    formData.append("notes", product.hasCostData ? "Based on actual cost data" : "Based on estimated cost (50% of price)");
    
    return formData;
  };
  
  // Apply the discount to the selected product
  const applyDiscount = () => {
    if (!multipleRandomProducts || multipleRandomProducts.length === 0 || !discount) return;
    
    const formData = prepareProductFormData(selectedProductIndex);
    if (!formData) return;
    
    submit(formData, { method: "post" });
    setIsPriceUpdated(true);
    
    // Log the form data being sent
    console.log("Submitting discount for single product:", {
      variantId: multipleRandomProducts[selectedProductIndex].variantId,
      productId: multipleRandomProducts[selectedProductIndex].id,
      newPrice: discount.discountedPrice.toString()
    });
  };
  
  // Apply discounts to multiple selected products using existing data
  // No need to refetch products since we already have all data in memory
  const applyMultipleDiscounts = async () => {
    if (!multipleRandomProducts || !discount || selectedProducts.size === 0) return;
    
    setApplyingMultiple(true);
    setIsBatchOperation(true);
    setBatchResults(null);
    
    let successCount = 0;
    let failedCount = 0;
    let failedProducts = [];
    let processedProducts = [];
    
    // Use the products we already have in memory - no need to refetch anything
    const selectedIndices = Array.from(selectedProducts).sort();
    console.log(`Processing ${selectedIndices.length} products for batch discount (using existing data)`);
    
    // Process products one at a time with a moderate delay to avoid API rate limits
    const DELAY_BETWEEN_REQUESTS = 1500; // 1.5 second delay between requests

    for (let i = 0; i < selectedIndices.length; i++) {
      const index = selectedIndices[i];
      const product = multipleRandomProducts[index];
      
      // Create a unique random discount for this product
      const randomDiscountPercent = Math.floor(Math.random() * 16) + 10; // random 10-25%
      
      // All calculations use the data we already have
      const profit = product.sellingPrice - product.cost;
      const profitMargin = profit / product.sellingPrice * 100;
      
      // Calculate the discounted profit
      const discountFactor = 1 - (randomDiscountPercent / 100);
      const discountedProfit = profit * discountFactor;
      
      // Calculate price with .99 ending for better marketing
      const newPrice = product.cost + discountedProfit;
      const roundedPrice = Math.floor(newPrice * 100) / 100;
      const discountedPrice = Math.floor(roundedPrice) + 0.99;
      
      // Calculate customer savings
      const savingsAmount = product.sellingPrice - discountedPrice;
      const savingsPercentage = (savingsAmount / product.sellingPrice) * 100;
      
      // Log the details for transparency
      console.log(`[${i+1}/${selectedIndices.length}] ${product.title}`);
      console.log(`  ${formatCurrency(product.sellingPrice, product.currencyCode)} → ${formatCurrency(discountedPrice, product.currencyCode)}`);
      console.log(`  Discount: ${randomDiscountPercent}% of profit (${profitMargin.toFixed(1)}% margin)`);
      console.log(`  Customer saves: ${formatCurrency(savingsAmount, product.currencyCode)} (${savingsPercentage.toFixed(1)}%)`);
      
      // Create minimal data needed for price update - we don't need to send everything
      const formData = new FormData();
      
      // Essential fields for price update
      formData.append("variantId", product.variantId);
      formData.append("newPrice", discountedPrice.toString());
      formData.append("productId", product.id);
      formData.append("compareAtPrice", product.sellingPrice.toString());
      formData.append("productTitle", product.title);
      
      if (product.variantTitle) {
        formData.append("variantTitle", product.variantTitle);
      }
      
      // Fields for logging/tracking
      formData.append("originalPrice", product.sellingPrice.toString());
      formData.append("costPrice", product.cost.toString());
      formData.append("profitMargin", profitMargin.toString());
      formData.append("discountPercentage", randomDiscountPercent.toString());
      formData.append("savingsAmount", savingsAmount.toString());
      formData.append("savingsPercentage", savingsPercentage.toString());
      formData.append("currencyCode", product.currencyCode);
      formData.append("imageUrl", product.imageUrl);
      formData.append("inventoryQuantity", product.inventoryQuantity.toString());
      formData.append("notes", `Randomized ${randomDiscountPercent}% profit discount (${product.hasCostData ? "actual cost" : "estimated cost"})`);
      
      try {
        // Use direct fetch instead of submit() to avoid page refreshes
        const response = await fetch('/app/daily-discounts', {
          method: 'POST',
          body: formData
        });
        
        if (response.ok) {
          // Track successful price update
          successCount++;
          
          // Save product details for result display
          processedProducts.push({
            title: product.title,
            originalPrice: product.sellingPrice,
            discountedPrice: discountedPrice,
            discountPercentage: randomDiscountPercent,
            savingsAmount: savingsAmount,
            savingsPercentage: savingsPercentage.toFixed(1),
            currencyCode: product.currencyCode
          });
          console.log(`✓ Successfully applied discount to ${product.title}`);
          
          // For better UI feedback, we could also update the local state here
          // This would show the discount in the UI without a page refresh
        } else {
          // Handle server-side errors
          failedCount++;
          let errorText = await response.text();
          let errorMessage = "Server returned an error response";
          
          try {
            // Try to parse error as JSON
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.message || errorMessage;
          } catch (e) {
            // If not JSON, use text snippet
            errorMessage = errorText.length > 100 ? 
              `${errorText.substring(0, 100)}...` : errorText;
          }
          
          failedProducts.push({
            title: product.title,
            variantId: product.variantId,
            error: errorMessage,
            discountPercentage: randomDiscountPercent,
            originalPrice: product.sellingPrice,
            discountedPrice: discountedPrice,
            currencyCode: product.currencyCode
          });
          console.error(`✗ Failed to apply discount to ${product.title}: ${errorMessage}`);
        }
        
        // Wait between requests to prevent hitting rate limits
        // Only if not the last item
        if (i < selectedIndices.length - 1) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
        }
      } catch (error) {
        // Handle client-side errors (network issues, etc.)
        failedCount++;
        failedProducts.push({
          title: product.title,
          variantId: product.variantId,
          error: error instanceof Error ? error.message : "Unknown error",
          discountPercentage: randomDiscountPercent,
          originalPrice: product.sellingPrice,
          discountedPrice: discountedPrice,
          currencyCode: product.currencyCode
        });
        console.error(`✗ Error applying discount to ${product.title}:`, error);
        
        // Add a small delay after an error to allow potential network recovery
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Log completion statistics
    console.log(`✅ Batch discount application completed: ${successCount} succeeded, ${failedCount} failed`);
    
    // Store results for display in the modal - no need to reload the page
    setBatchResults({
      success: successCount,
      failed: failedCount,
      failedProducts: failedProducts,
      processedProducts: processedProducts
    });
    
    setApplyingMultiple(false);
    setIsBatchOperation(false);
    
    // Show appropriate toast notification based on results
    if (successCount > 0) {
      setSuccessToast({
        active: true,
        message: `Successfully applied ${successCount} unique discounts${failedCount > 0 ? ` (${failedCount} failed)` : ''}`
      });
      
      // Auto-hide toast after 5 seconds
      setTimeout(() => {
        setSuccessToast(prev => ({ ...prev, active: false }));
      }, 5000);
    } else if (failedCount > 0) {
      // Show error toast if all failed
      setSuccessToast({
        active: true,
        message: `Failed to apply discounts to ${failedCount} products. See details for more information.`
      });
      
      setTimeout(() => {
        setSuccessToast(prev => ({ ...prev, active: false }));
      }, 5000);
    }
    
    // Instead of reloading the page (which would trigger another product fetch),
    // we just show the batch results modal with the updated information
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
  // Make sure the selected product index is valid
  useEffect(() => {
    if (multipleRandomProducts && selectedProductIndex >= multipleRandomProducts.length) {
      setSelectedProductIndex(0);
    }
  }, [multipleRandomProducts]);

  // Track if we're in the middle of a batch operation to avoid redundant reloads
  const [isBatchOperation, setIsBatchOperation] = useState(false);

  useEffect(() => {
    // Check for errors from the action (for single product operations)
    if (actionData && actionData.status === "error") {
      setDiscountError(actionData.message || "Error applying discount");
      setIsPriceUpdated(false);
      setIsReverting(null);
    }
    
    // Handle successful action (for single product operations)
    if (actionData && actionData.status === "success") {
      // Clear any reverting state
      setIsReverting(null);
      setDiscountError(null);
      
      // If we just reverted a price, show a success message
      if (actionData.isRevert) {
        setSuccessToast({
          active: true,
          message: "Price successfully reverted to original value and DailyDiscount tag removed"
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
      
      // No automatic page refresh - let the user decide when to refresh
      // This prevents unnecessary product fetching and API calls
      // If the user wants to see updated discount history, they can
      // manually refresh using the button in the success message
    }
  }, [actionData]);

  // Generate a discount when the component loads or when the selected product changes
  useEffect(() => {
    if (multipleRandomProducts && multipleRandomProducts.length > 0) {
      generateRandomDiscount();
    }
  }, [multipleRandomProducts, selectedProductIndex]);
  
  // Show confirmation dialog for reverting a discount
  const handleRevertDiscount = (log: any) => {
    if (!log.variantId || !log.originalPrice) {
      setDiscountError("Cannot revert: Missing variant ID or original price");
      return;
    }
    
    // Check if this item is already reverted
    if (log.isReverted || revertedItems.has(log.id)) {
      setDiscountError("This item has already been reverted.");
      return;
    }
    
    // Set the log in state to show confirmation dialog
    setConfirmRevert(log);
  };
  
  // Actually perform the revert after confirmation
  const confirmRevertDiscount = () => {
  if (!confirmRevert) return;
  
  const log = confirmRevert;
  setIsReverting(log.id);
  
  // Add to reverted items set
  setRevertedItems(prev => new Set([...prev, log.id]));
  
  // Save to localStorage
  try {
    const storedItems = localStorage.getItem('revertedItems');
    const revertedArr = storedItems ? JSON.parse(storedItems) : [];
    revertedArr.push(log.id);
    localStorage.setItem('revertedItems', JSON.stringify([...new Set(revertedArr)]));
  } catch (e) {
    console.error("Error saving reverted item:", e);
  }
  
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
  
  // Add original log ID for updating instead of creating new log
  formData.append("originalLogId", log.id);
  formData.append("isRevert", "true");
  
  // Check if this is from an automated discount and preserve the type in notes
  // This will ensure reversion logs appear in the same section as the original discount
  if (log.notes && log.notes.includes("Auto Discount")) {
    formData.append("notes", "Auto Discount Reverted");
  } else {
    formData.append("notes", "Manual UI Discount Reverted");
  }
  
  // Add revert timestamp
  formData.append("revertedAt", new Date().toISOString());
  
  // Close the confirmation dialog
  setConfirmRevert(null);
  
  // The revert action is just a regular price update back to the original price
  submit(formData, { method: "post" });
};
  
  // Get a new random product
  const getNewRandomProduct = () => {
    // Reload the page to get a new random product
    window.location.reload();
  };
  
  // Check if in debug mode
  const isDebugMode = status === "debug" && !!loaderData.debugVariant;
  const debugVariant = loaderData.debugVariant;
  const debugVariantId = loaderData.debugVariantId;
  
  return (
    <Frame>
      <Page
        title="Daily Discounts"
        primaryAction={isDebugMode ? {
          content: "Back to Daily Discounts",
          url: "/app/daily-discounts"
        } : undefined}
      >
      <TitleBar title="Daily Discounts" />
      
      {isDebugMode ? (
        // Debug mode UI
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Product Variant Debug Info
                </Text>
                
                <Banner tone="info">
                  <p>Showing debug information for variant ID: {debugVariantId}</p>
                </Banner>
                
                {debugVariant && (
                  <BlockStack gap="400">
                    <InlineStack gap="400" blockAlign="center">
                      {debugVariant.imageUrl && (
                        <Box>
                          <Thumbnail
                            source={debugVariant.imageUrl}
                            alt={debugVariant.productTitle}
                            size="large"
                          />
                        </Box>
                      )}
                      
                      <Box>
                        <BlockStack gap="200">
                          <Text variant="headingLg" as="h3">{debugVariant.productTitle}</Text>
                          <Text variant="bodyMd" as="p">{debugVariant.variantTitle}</Text>
                        </BlockStack>
                      </Box>
                    </InlineStack>
                    
                    <Divider />
                    
                    <InlineStack gap="400" wrap={false}>
                      <Box style={{ flex: 1 }}>
                        <BlockStack gap="200">
                          <Text variant="headingMd" as="h4">Pricing Information</Text>
                          <Text variant="bodyMd" as="p">Price: {formatCurrency(debugVariant.price, debugVariant.currencyCode)}</Text>
                          <Text variant="bodyMd" as="p">Compare At: {debugVariant.compareAtPrice ? formatCurrency(debugVariant.compareAtPrice, debugVariant.currencyCode) : "Not set"}</Text>
                          <Text variant="bodyMd" as="p">
                            Cost: {debugVariant.cost ? formatCurrency(debugVariant.cost, debugVariant.currencyCode) : "Not set"} 
                            {!debugVariant.hasCost && <Badge tone="warning">Missing</Badge>}
                          </Text>
                          <Text variant="bodyMd" as="p">Inventory: {debugVariant.inventoryQuantity}</Text>
                        </BlockStack>
                      </Box>
                      
                      <Box style={{ flex: 1 }}>
                        <BlockStack gap="200">
                          <Text variant="headingMd" as="h4">Requirement Status</Text>
                          <InlineStack gap="200" blockAlign="center">
                            <Text variant="bodyMd" as="span">Has Image:</Text>
                            {debugVariant.hasImage ? 
                              <Badge tone="success">Yes</Badge> : 
                              <Badge tone="critical">No (Required)</Badge>
                            }
                          </InlineStack>
                          
                          <InlineStack gap="200" blockAlign="center">
                            <Text variant="bodyMd" as="span">Has Cost Data:</Text>
                            {debugVariant.hasCost ? 
                              <Badge tone="success">Yes</Badge> : 
                              <Badge tone="warning">No (Will estimate)</Badge>
                            }
                          </InlineStack>
                          
                          <InlineStack gap="200" blockAlign="center">
                            <Text variant="bodyMd" as="span">Has Inventory &gt; 0:</Text>
                            {debugVariant.hasPositiveInventory ? 
                              <Badge tone="success">Yes</Badge> : 
                              <Badge tone="critical">No (Required)</Badge>
                            }
                          </InlineStack>
                          
                          <InlineStack gap="200" blockAlign="center">
                            <Text variant="bodyMd" as="span">Overall:</Text>
                            {(debugVariant.hasImage && debugVariant.hasPositiveInventory) ? 
                              <Badge tone="success">Eligible for Daily Discount</Badge> : 
                              <Badge tone="critical">Not eligible</Badge>
                            }
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    </InlineStack>
                    
                    <Box paddingBlock="300">
                      <Divider />
                    </Box>
                    
                    <Text variant="bodyMd" as="p">
                      This product variant {(debugVariant.hasImage && debugVariant.hasPositiveInventory) ? 
                        <strong>is eligible</strong> : 
                        <strong>is not eligible</strong>
                      } to be selected for Daily Discounts.
                    </Text>
                    
                    {!debugVariant.hasImage && (
                      <Text variant="bodyMd" as="p">
                        <strong>Missing requirement:</strong> This product needs a featured image. Edit the product and add an image.
                      </Text>
                    )}
                    
                    {!debugVariant.hasPositiveInventory && (
                      <Text variant="bodyMd" as="p">
                        <strong>Missing requirement:</strong> This product needs positive inventory. Currently it has {debugVariant.inventoryQuantity}.
                      </Text>
                    )}
                    
                    {!debugVariant.hasCost && (
                      <Text variant="bodyMd" as="p">
                        <strong>Optional improvement:</strong> This product doesn't have cost data. Cost will be estimated as 50% of the selling price.
                        For more accurate discounts, add cost data in Inventory → Edit inventory → Unit cost.
                      </Text>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Check Another Variant
                </Text>
                
                <form method="get" action="/app/daily-discounts">
                  <InlineStack gap="300">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Variant ID"
                        name="debugVariantId"
                        placeholder="Enter variant ID (numbers only)"
                        helpText="Enter just the numeric ID, not the full gid://shopify/ProductVariant/ prefix"
                        autoComplete="off"
                        defaultValue=""
                      />
                    </div>
                    <div style={{ paddingTop: "1.9rem" }}>
                      <Button submit>Check Variant</Button>
                    </div>
                  </InlineStack>
                </form>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      ) : (
        // Regular UI
        <Layout>
        <Layout.Section oneHalf>
          
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Random Product Discounter
              </Text>
              
              <Text as="p">
                This tool helps you create daily discounts by randomly selecting products from your inventory
                and generating profit-based discounts. Perfect for flash sales and daily deals!
              </Text>
              
              {status === "error" && (
                <Banner tone="critical">
                  <p>{message || "Error loading product data"}</p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        
          
          
          <Card>
            <BlockStack gap="600">
              <Text as="h2" variant="headingMd" alignment="center">
                Random Products for Discount
              </Text>
              
              {/* Add loading overlay that displays while products are being fetched */}
              <LoadingOverlay 
                progress={loadingProgress} 
                isLoading={loadingRandomProducts} 
                error={loadingError} 
              />
              
              {/* Show empty state when no products are loaded but loading has finished */}
              {!loadingRandomProducts && (!multipleRandomProducts || multipleRandomProducts.length === 0) && !loadingError && (
                <Banner tone="warning">
                  <p>No eligible products found for discounting. Products need to have images, positive inventory, and cost data available.</p>
                  <Box paddingBlockStart="300">
                    <Button onClick={() => {
                      // Reset loading state
                      setLoadingRandomProducts(true);
                      setLoadingProgress(0);
                      setLoadingError(null);
                      
                      // Submit the form to fetch products
                      const formData = new FormData();
                      formData.append('action', 'fetchRandomProducts');
                      formData.append('count', NUM_RANDOM_PRODUCTS.toString());
                      formData.append('forceRefresh', 'true'); // Force refresh on retry
                      
                      submit(formData, { 
                        method: 'post',
                        replace: false
                      });
                    }}>
                      Try Again
                    </Button>
                  </Box>
                </Banner>
              )}
              
              {productStats?.total > 0 && multipleRandomProducts.length > 0 && (
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text variant="bodyMd">
                      Randomly selected from {productStats.total} products in your store
                      ({productStats?.eligible || 0} eligible with images and inventory)
                    </Text>
                    
                    {productStats && (
                      <Text variant="bodySm" tone="subdued">
                        Products not eligible: {productStats.total - (productStats.eligible || 0)} 
                        ({productStats.total - (productStats.withImage || 0)} missing images, 
                        {productStats.total - (productStats.withInventory || 0)} out of stock)
                      </Text>
                    )}
                    
                    {/* No need to show cache status during loading */ false && (
                      <InlineStack gap="200" align="start" blockAlign="center">
                        <Badge tone="success" progress="complete">
                          {loaderData.cacheStatus.isCached ? 'Data Cached' : 'Fresh Data'}
                        </Badge>
                        <Text variant="bodySm" tone="subdued">
                          {loaderData.cacheStatus.isCached 
                            ? `Cache expires in ${Math.floor(loaderData.cacheStatus.cacheExpiry / 60)} min` 
                            : 'Using fresh data'}
                        </Text>
                        <Button 
                          size="micro" 
                          url="/app/daily-discounts?refresh=true" 
                          accessibilityLabel="Refresh product data"
                        >
                          Refresh
                        </Button>
                      </InlineStack>
                    )}
                  </BlockStack>
                </Banner>
              )}
              
              {multipleRandomProducts && multipleRandomProducts.length > 0 && (
                <Box padding="400">
                  <BlockStack gap="400">
                    <InlineStack gap="200" align="space-between" blockAlign="center">
                      <Text variant="headingSm">Select products for discount:</Text>
                      
                      <Button 
                        disabled={selectedProducts.size === 0 || isGeneratingDiscount || isPriceUpdated}
                        onClick={() => {
                          if (selectedProducts.size > 0) {
                            setSelectedProducts(new Set());
                          } else {
                            // Select all products
                            const allIndices = new Set(multipleRandomProducts.map((_, i) => i));
                            setSelectedProducts(allIndices);
                          }
                        }}
                        size="slim"
                      >
                        {selectedProducts.size > 0 ? "Deselect All" : "Select All"}
                      </Button>
                    </InlineStack>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                      {multipleRandomProducts.map((product, index) => (
                        <div 
                          key={product.id} 
                          style={{ 
                            padding: '8px',
                            border: selectedProductIndex === index ? '2px solid #2C6ECB' : '1px solid #ddd',
                            borderRadius: '8px',
                            backgroundColor: selectedProductIndex === index ? '#F4F6F8' : 'white',
                            position: 'relative'
                          }}
                        >
                          <div 
                            style={{ 
                              position: 'absolute',
                              top: '8px',
                              right: '8px',
                              zIndex: 10
                            }}
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent triggering the parent's onClick
                              
                              // Toggle this product's selection
                              const newSelection = new Set(selectedProducts);
                              if (newSelection.has(index)) {
                                newSelection.delete(index);
                              } else {
                                newSelection.add(index);
                              }
                              setSelectedProducts(newSelection);
                            }}
                          >
                            <div style={{ 
                              width: '24px', 
                              height: '24px', 
                              border: '2px solid #637381',
                              borderRadius: '4px',
                              backgroundColor: selectedProducts.has(index) ? '#2C6ECB' : 'white',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer'
                            }}>
                              {selectedProducts.has(index) && (
                                <span style={{ color: 'white' }}>✓</span>
                              )}
                            </div>
                          </div>
                          
                          <div onClick={() => setSelectedProductIndex(index)} style={{ cursor: 'pointer' }}>
                            <BlockStack gap="200" alignment="center">
                              <Thumbnail
                                source={product.imageUrl}
                                alt={product.title}
                                size="medium"
                              />
                              <Text variant="bodySm" fontWeight={selectedProductIndex === index ? "bold" : "regular"}>
                                {product.title.length > 20 ? product.title.substring(0, 20) + '...' : product.title}
                              </Text>
                              <Text variant="bodySm" tone="subdued">
                                {formatCurrency(product.sellingPrice, product.currencyCode)}
                              </Text>
                            </BlockStack>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {selectedProducts.size > 1 && (
                      <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                        <BlockStack gap="300">
                          <InlineStack gap="400" align="space-between" blockAlign="center">
                            <Text variant="bodyMd">
                              <strong>{selectedProducts.size}</strong> products selected for batch discount
                            </Text>
                            
                            <Button 
                              onClick={() => applyMultipleDiscounts()}
                              primary
                              loading={applyingMultiple}
                              disabled={isPriceUpdated || isGeneratingDiscount || !discount}
                            >
                              Apply Unique Discounts to All Selected
                            </Button>
                          </InlineStack>
                          
                          {applyingMultiple && (
                            <Banner tone="info">
                              <BlockStack gap="200">
                                <Text variant="bodyMd">
                                  Applying unique randomized discounts to {selectedProducts.size} products...
                                </Text>
                                <Text variant="bodySm">
                                  Each product receives its own random discount percentage between 10-25% of profit.
                                  This may take a few moments to complete.
                                </Text>
                              </BlockStack>
                            </Banner>
                          )}
                        </BlockStack>
                      </Box>
                    )}
                  </BlockStack>
                </Box>
              )}
              
              {!multipleRandomProducts || multipleRandomProducts.length === 0 ? (
                <BlockStack gap="400">
                  <Box padding="400" style={{ textAlign: "center" }}>
                    <SkeletonDisplayText size="large" />
                    <Box paddingBlock="400">
                      <div style={{ margin: "0 auto", width: "200px", height: "200px", background: "#f6f6f7" }}></div>
                    </Box>
                    <SkeletonBodyText lines={3} />
                  </Box>
                </BlockStack>
              ) : (
                <BlockStack gap="400">
                  <TextContainer spacing="tight">
                    <Text as="h3" variant="headingLg" alignment="center">
                      {multipleRandomProducts[selectedProductIndex].title}
                    </Text>
                    {multipleRandomProducts[selectedProductIndex].variantTitle && (
                      <Text as="p" variant="bodyMd" alignment="center">
                        Variant: {multipleRandomProducts[selectedProductIndex].variantTitle}
                      </Text>
                    )}
                    <Text as="p" variant="bodySm" alignment="center" tone="subdued">
                      Variant ID: {multipleRandomProducts[selectedProductIndex].variantId.split("/").pop()}
                    </Text>
                  </TextContainer>
                  
                  <Box padding="400" style={{ textAlign: "center" }}>
                    <div style={{ margin: "0 auto", maxWidth: "300px" }}>
                      <Thumbnail
                        source={multipleRandomProducts[selectedProductIndex].imageUrl}
                        alt={multipleRandomProducts[selectedProductIndex].title}
                        size="large"
                      />
                    </div>
                  </Box>
                  
                  <BlockStack gap="300">
                    <InlineStack gap="600" align="center" blockAlign="center" wrap={false}>
                      <Box style={{ flex: 1 }}>
                        <BlockStack gap="100">
                          <Text variant="bodyMd" as="span">
                            Cost {!multipleRandomProducts[selectedProductIndex].hasCostData && <span style={{ color: '#bf0711', fontSize: '0.8em' }}>(Estimated)</span>}
                          </Text>
                          <Text variant="headingMd" as="span" fontWeight="bold">
                            {formatCurrency(multipleRandomProducts[selectedProductIndex].cost, multipleRandomProducts[selectedProductIndex].currencyCode)}
                          </Text>
                        </BlockStack>
                      </Box>
                      
                      <Box style={{ flex: 1 }}>
                        <BlockStack gap="100">
                          <Text variant="bodyMd" as="span">Selling Price</Text>
                          <Text variant="headingMd" as="span" fontWeight="bold">
                            {formatCurrency(multipleRandomProducts[selectedProductIndex].sellingPrice, multipleRandomProducts[selectedProductIndex].currencyCode)}
                          </Text>
                        </BlockStack>
                      </Box>
                      
                      <Box style={{ flex: 1 }}>
                        <BlockStack gap="100">
                          <Text variant="bodyMd" as="span">Compare At</Text>
                          <Text variant="headingMd" as="span" fontWeight="bold">
                            {multipleRandomProducts[selectedProductIndex].compareAtPrice 
                              ? formatCurrency(multipleRandomProducts[selectedProductIndex].compareAtPrice, multipleRandomProducts[selectedProductIndex].currencyCode) 
                              : "-"
                            }
                          </Text>
                        </BlockStack>
                      </Box>
                      
                      <Box style={{ flex: 1 }}>
                        <BlockStack gap="100">
                          <Text variant="bodyMd" as="span">Inventory</Text>
                          <Text variant="headingMd" as="span" fontWeight="bold">
                            {multipleRandomProducts[selectedProductIndex].inventoryQuantity}
                          </Text>
                        </BlockStack>
                      </Box>
                    </InlineStack>
                    
                    <Box paddingBlock="300">
                      <Divider />
                    </Box>
                    
                    <Box padding="300" style={{ backgroundColor: "#f9fafb", borderRadius: "8px" }}>
                      <BlockStack gap="400">
                        <InlineStack align="space-between">
                          <Text variant="headingMd" as="h3">
                            <InlineStack gap="200" align="center" blockAlign="center">
                              <span style={{ marginRight: '8px', fontWeight: 'bold' }}>🏷️</span>
                              <span>Discount Generator</span>
                            </InlineStack>
                          </Text>
                          
                          <Button 
                            onClick={generateRandomDiscount} 
                            loading={isGeneratingDiscount}
                            size="slim"
                          >
                            Regenerate
                          </Button>
                        </InlineStack>
                        
                        {discount && (
                          <BlockStack gap="300">
                            <InlineStack wrap={false} gap="300" align="space-between">
                              <BlockStack gap="100">
                                <Text variant="bodyMd" as="span">Profit Margin</Text>
                                <Text variant="headingMd" as="span">
                                  {discount.profitMargin.toFixed(1)}%
                                </Text>
                              </BlockStack>
                              
                              <BlockStack gap="100">
                                <Text variant="bodyMd" as="span">Discount</Text>
                                <Text variant="headingMd" as="span" tone="success">
                                  {discount.discountPercentage}% of profit
                                </Text>
                              </BlockStack>
                              
                              <BlockStack gap="100">
                                <Text variant="bodyMd" as="span">Discounted Price</Text>
                                <Text variant="headingMd" as="span" fontWeight="bold">
                                  {formatCurrency(discount.discountedPrice, randomProduct.currencyCode)}
                                </Text>
                              </BlockStack>
                              
                              <BlockStack gap="100">
                                <Text variant="bodyMd" as="span">Customer Saves</Text>
                                <Text variant="headingMd" as="span" tone="success">
                                  {formatCurrency(discount.savingsAmount, randomProduct.currencyCode)} ({discount.savingsPercentage.toFixed(1)}%)
                                </Text>
                              </BlockStack>
                            </InlineStack>
                            
                            <BlockStack gap="300">
                              {/* Error message */}
                              {discountError && (
                                <Banner tone="critical" onDismiss={() => setDiscountError(null)}>
                                  <p>{discountError}</p>
                                </Banner>
                              )}
                              
                              <InlineStack gap="300" align="end">
                                <Button 
                                  onClick={getNewRandomProduct}
                                  tone="critical"
                                >
                                  New Product Selection
                                </Button>
                                
                                {isPriceUpdated ? (
                                  <InlineStack gap="300">
                                    <Button 
                                      onClick={() => window.location.reload()} 
                                      tone="success"
                                    >
                                      <InlineStack gap="200" blockAlign="center">
                                        <span style={{ marginRight: '4px' }}>✓</span>
                                        <span>Refresh Page</span>
                                      </InlineStack>
                                    </Button>
                                  </InlineStack>
                                ) : (
                                  <Button 
                                    onClick={applyDiscount} 
                                    variant="primary"
                                  >
                                    Apply Discount
                                  </Button>
                                )}
                              </InlineStack>
                            </BlockStack>
                          </BlockStack>
                        )}
                      </BlockStack>
                    </Box>
                  </BlockStack>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        
        </Layout.Section>
        
        <Layout.Section oneHalf>
          
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Recent Discount History
                </Text>
                
                <Button 
                  tone="critical" 
                  variant="plain"
                  onClick={() => {
                    // Show confirmation modal
                    setConfirmClearHistory(true);
                  }}
                >
                  Delete All History
                </Button>
              </InlineStack>
              
              <Layout>
                {/* Manual Discounts Column */}
                <Layout.Section oneHalf>
                  <Text variant="headingMd" as="h3">Manual UI Discounts</Text>
                  
                  {(!recentManualDiscountLogs || recentManualDiscountLogs.length === 0) ? (
                    <Banner tone="info">
                      <p>No manual discount logs found. Apply discounts to products to see them here.</p>
                    </Banner>
                  ) : (
                    <BlockStack gap="400">
                      {recentManualDiscountLogs.map((log) => (
                        <Box key={log.id} padding="300" background={log.notes && log.notes.includes("Reverted") || revertedItems.has(log.id) ? "bg-surface-secondary" : "bg-subdued"} borderRadius="200">
                          <BlockStack gap="200">
                            <InlineStack gap="300" align="start" blockAlign="center">
                              {log.imageUrl && (
                                <Box>
                                  <Thumbnail
                                    source={log.imageUrl}
                                    alt={log.productTitle}
                                    size="small"
                                  />
                                </Box>
                              )}
                              <BlockStack gap="100">
                                <InlineStack gap="200" align="space-between">
                                  <InlineStack gap="200" align="start" blockAlign="center">
                                    <Text variant="headingSm" as="h3">{log.productTitle}</Text>
                                    {(log.notes && log.notes.includes("Reverted") || revertedItems.has(log.id)) && (
                                      <Badge tone="info">Reverted</Badge>
                                    )}
                                  </InlineStack>
                                  <Text variant="bodySm" as="span">
                                    {new Date(log.appliedAt).toLocaleDateString()} {new Date(log.appliedAt).toLocaleTimeString()}
                                  </Text>
                                </InlineStack>
                                {log.variantTitle && (
                                  <Text variant="bodySm" as="p">
                                    Variant: {log.variantTitle}
                                  </Text>
                                )}
                                <Text variant="bodySm" as="p" tone="subdued">
                                  Variant ID: {log.variantId.split("/").pop()}
                                </Text>
                              </BlockStack>
                            </InlineStack>
                            
                            <InlineStack gap="200" wrap={true}>
                              <Text variant="bodySm" as="span">
                                Original: {formatCurrency(log.originalPrice, log.currencyCode)}
                              </Text>
                              <Text variant="bodySm" as="span">
                                Discounted: {formatCurrency(log.discountedPrice, log.currencyCode)}
                              </Text>
                              {(log.notes && log.notes.includes("Reverted") || revertedItems.has(log.id)) ? (
                                <Text variant="bodySm" as="span">
                                  Savings: {formatCurrency(0, log.currencyCode)} (0.0%)
                                </Text>
                              ) : (
                                <Text variant="bodySm" as="span" tone="success">
                                  Savings: {formatCurrency(log.savingsAmount, log.currencyCode)} ({log.savingsPercentage.toFixed(1)}%)
                                </Text>
                              )}
                            </InlineStack>
                            
                            <InlineStack align="end">
                              <Button
                                size="micro"
                                tone="critical"
                                onClick={() => handleRevertDiscount(log)}
                                disabled={isReverting === log.id || revertedItems.has(log.id) || log.isReverted}
                              >
                                {isReverting === log.id ? "Reverting..." : (log.isReverted || revertedItems.has(log.id)) ? "Reverted" : "Revert to Original Price"}
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </Box>
                      ))}
                      
                      {recentManualDiscountLogs.length === manualLogCount && (
                        <Box padding="300" textAlign="center">
                          <Button 
                            onClick={async () => {
                              setIsLoadingMoreManual(true);
                              
                              try {
                                // Fetch more manual logs
                                const response = await fetch(`/api/daily-discounts/logs?type=manual&skip=${manualLogCount}&take=20`);
                                const data = await response.json();
                                
                                if (data.status === "success" && data.logs && data.logs.length > 0) {
                                  // Add the new logs to the existing ones
                                  const newLogs = [...recentManualDiscountLogs, ...data.logs];
                                  // Replace recentManualDiscountLogs in loaderData
                                  loaderData.recentManualDiscountLogs = newLogs;
                                  setManualLogCount(prev => prev + data.logs.length);
                                }
                              } catch (error) {
                                console.error("Error loading more logs:", error);
                                // Show error toast
                                setSuccessToast({
                                  active: true,
                                  message: "Failed to load more logs. Please try again."
                                });
                                setTimeout(() => {
                                  setSuccessToast(prev => ({ ...prev, active: false }));
                                }, 3000);
                              } finally {
                                setIsLoadingMoreManual(false);
                              }
                            }}
                            loading={isLoadingMoreManual}
                            size="slim"
                          >
                            Load More History
                          </Button>
                        </Box>
                      )}
                    </BlockStack>
                  )}
                </Layout.Section>
                
                {/* API Discounts Column */}
                <Layout.Section oneHalf>
                  <Text variant="headingMd" as="h3">Automated Webhook Discounts</Text>
                  
                  {(!recentApiDiscountLogs || recentApiDiscountLogs.length === 0) ? (
                    <Banner tone="info">
                      <p>No automated webhook discount logs found. Products discounted via the automatic webhook will appear here.</p>
                    </Banner>
                  ) : (
                    <BlockStack gap="400">
                      {recentApiDiscountLogs.map((log) => (
                        <Box key={log.id} padding="300" background={log.notes && log.notes.includes("Reverted") || revertedItems.has(log.id) ? "bg-surface-secondary" : "bg-subdued"} borderRadius="200">
                          <BlockStack gap="200">
                            <InlineStack gap="300" align="start" blockAlign="center">
                              {log.imageUrl && (
                                <Box>
                                  <Thumbnail
                                    source={log.imageUrl}
                                    alt={log.productTitle}
                                    size="small"
                                  />
                                </Box>
                              )}
                              <BlockStack gap="100">
                                <InlineStack gap="200" align="space-between">
                                  <InlineStack gap="200" align="start" blockAlign="center">
                                    <Text variant="headingSm" as="h3">{log.productTitle}</Text>
                                    {(log.notes && log.notes.includes("Reverted") || revertedItems.has(log.id)) && (
                                      <Badge tone="info">Reverted</Badge>
                                    )}
                                  </InlineStack>
                                  <Text variant="bodySm" as="span">
                                    {new Date(log.appliedAt).toLocaleDateString()} {new Date(log.appliedAt).toLocaleTimeString()}
                                  </Text>
                                </InlineStack>
                                {log.variantTitle && (
                                  <Text variant="bodySm" as="p">
                                    Variant: {log.variantTitle}
                                  </Text>
                                )}
                                <Text variant="bodySm" as="p" tone="subdued">
                                  Variant ID: {log.variantId.split("/").pop()}
                                </Text>
                                {log.notes && (
                                  <Text variant="bodySm" as="p" tone="subdued">
                                    Notes: {log.notes}
                                  </Text>
                                )}
                              </BlockStack>
                            </InlineStack>
                            
                            <InlineStack gap="200" wrap={true}>
                              <Text variant="bodySm" as="span">
                                Original: {formatCurrency(log.originalPrice, log.currencyCode)}
                              </Text>
                              <Text variant="bodySm" as="span">
                                Discounted: {formatCurrency(log.discountedPrice, log.currencyCode)}
                              </Text>
                              {(log.notes && log.notes.includes("Reverted") || revertedItems.has(log.id)) ? (
                                <Text variant="bodySm" as="span">
                                  Savings: {formatCurrency(0, log.currencyCode)} (0.0%)
                                </Text>
                              ) : (
                                <Text variant="bodySm" as="span" tone="success">
                                  Savings: {formatCurrency(log.savingsAmount, log.currencyCode)} ({log.savingsPercentage.toFixed(1)}%)
                                </Text>
                              )}
                            </InlineStack>
                            
                            <InlineStack align="end">
                              <Button
                                size="micro"
                                tone="critical"
                                onClick={() => handleRevertDiscount(log)}
                                disabled={isReverting === log.id || revertedItems.has(log.id) || log.isReverted}
                              >
                                {isReverting === log.id ? "Reverting..." : (log.isReverted || revertedItems.has(log.id)) ? "Reverted" : "Revert to Original Price"}
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </Box>
                      ))}
                      
                      {recentApiDiscountLogs.length === apiLogCount && (
                        <Box padding="300" textAlign="center">
                          <Button 
                            onClick={async () => {
                              setIsLoadingMoreApi(true);
                              
                              try {
                                // Fetch more API logs
                                const response = await fetch(`/api/daily-discounts/logs?type=api&skip=${apiLogCount}&take=20`);
                                const data = await response.json();
                                
                                if (data.status === "success" && data.logs && data.logs.length > 0) {
                                  // Add the new logs to the existing ones
                                  const newLogs = [...recentApiDiscountLogs, ...data.logs];
                                  // Replace recentApiDiscountLogs in loaderData
                                  loaderData.recentApiDiscountLogs = newLogs;
                                  setApiLogCount(prev => prev + data.logs.length);
                                }
                              } catch (error) {
                                console.error("Error loading more logs:", error);
                                // Show error toast
                                setSuccessToast({
                                  active: true,
                                  message: "Failed to load more logs. Please try again."
                                });
                                setTimeout(() => {
                                  setSuccessToast(prev => ({ ...prev, active: false }));
                                }, 3000);
                              } finally {
                                setIsLoadingMoreApi(false);
                              }
                            }}
                            loading={isLoadingMoreApi}
                            size="slim"
                          >
                            Load More History
                          </Button>
                        </Box>
                      )}
                    </BlockStack>
                  )}
                </Layout.Section>
              </Layout>
            </BlockStack>
          </Card>
        
          
          
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                About Daily Discounts
              </Text>
              
              <Text as="p">
                This tool automatically selects a random product from your entire inventory and generates a discount
                based on the product's profit margin. The discounts range from 10% to 25% of the product's profit,
                ensuring you maintain profitability while offering attractive discounts to your customers.
              </Text>
              
              <Text as="p">
                <strong>Two discount methods are available:</strong>
              </Text>
              
              <BlockStack gap="300">
                <InlineStack gap="400" align="start" blockAlign="start">
                  <div style={{ width: '24px', textAlign: 'center', marginTop: '2px' }}>1.</div>
                  <div>
                    <Text as="p" fontWeight="bold">Manual UI Discounts</Text>
                    <Text as="p">Select and apply discounts manually through this interface. Perfect for curating specific featured products or testing the discount tool.</Text>
                  </div>
                </InlineStack>
                
                <InlineStack gap="400" align="start" blockAlign="start">
                  <div style={{ width: '24px', textAlign: 'center', marginTop: '2px' }}>2.</div>
                  <div>
                    <Text as="p" fontWeight="bold">Automated Webhook Discounts</Text>
                    <Text as="p">Let the system automatically select and discount products on a regular schedule. This creates rotating flash sales without any manual intervention.</Text>
                  </div>
                </InlineStack>
              </BlockStack>
              
              <Text as="p">
                When applying discounts to multiple products at once, each product receives its own unique random
                discount percentage (between 10-25%). This creates varied and more interesting savings amounts for your
                customers, with all prices ending in .99 for maximum appeal.
              </Text>
              
              <Text as="p">
                The randomization process scans through all products in your store (not just the first batch)
                and uses a thorough shuffling algorithm to ensure truly random selection. Only products with
                images and positive inventory are eligible for selection.
              </Text>
              
              <Banner tone="info">
                <p>
                  The tool will set the original price as the "Compare at price" (if not already set)
                  and apply the discounted price as the regular price, making the discount visible to customers.
                </p>
              </Banner>
              
              <Banner tone="success">
                <BlockStack gap="200">
                  <Text variant="headingSm">Performance Optimized</Text>
                  <Text variant="bodyMd">
                    This tool now uses an intelligent caching system that stores product data for 30 minutes,
                    dramatically reducing load times and API usage. You'll notice the app is much faster and more
                    responsive when selecting and applying discounts.
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    If you need to see the latest product data, just click the "Refresh" button in the product selection area.
                  </Text>
                </BlockStack>
              </Banner>
              
              <Banner tone="warning">
                <p>
                  <strong>Note:</strong> For best results, set cost information for your products in Shopify 
                  (Inventory → Edit inventory → Unit cost). If cost data is missing, the tool will estimate it as 
                  50% of the selling price.
                </p>
              </Banner>
            </BlockStack>
          </Card>
        
        </Layout.Section>
      </Layout>
      )}
      </Page>
      
      {/* Success toast notification */}
      {successToast.active && (
        <Toast 
          content={successToast.message} 
          onDismiss={() => setSuccessToast(prev => ({ ...prev, active: false }))}
          duration={4000}
          tone="success"
        />
      )}
      
      {/* Batch results modal */}
      {batchResults && (
        <Modal
          open={!!batchResults}
          onClose={() => setBatchResults(null)}
          title="Batch Discount Results (Varied Profit Discounts)"
          primaryAction={{
            content: "OK",
            onAction: () => setBatchResults(null)
          }}
          size="large"
        >
          <Modal.Section>
            <BlockStack gap="400">
              <BlockStack gap="300">
                <Text variant="bodyLg">
                  {batchResults.success > 0 ? (
                    <span style={{ color: 'var(--p-text-success)' }}>✓ Successfully applied discounts to {batchResults.success} products</span>
                  ) : null}
                </Text>
                
                <Text variant="bodyMd">
                  Completely randomized discount rates (between 10-25% of profit) were applied to each product,
                  with prices calculated individually based on each product's cost, profit margin, and a unique
                  discount percentage. All prices end in .99 for more attractive pricing.
                </Text>
                
                <Text variant="bodySm" tone="subdued">
                  All calculations were performed using your existing product data without making redundant API calls or
                  reloading the page - ensuring maximum efficiency and speed while minimizing server load.
                </Text>
              </BlockStack>
              
              <BlockStack gap="400">
                {batchResults.success > 0 && (
                  <Box background="bg-surface-success" padding="400" borderRadius="200">
                    <BlockStack gap="400">
                      <Text variant="headingSm">Successfully updated products:</Text>
                      <Text variant="bodySm">
                        Each product received a unique randomized discount between 10-25% of their profit margin.
                        This creates an engaging variety of savings for your customers while ensuring all products
                        remain profitable.
                      </Text>
                      
                      {batchResults.processedProducts && batchResults.processedProducts.length > 0 && (
                        <BlockStack gap="300">
                          {batchResults.processedProducts.map((product, index) => (
                            <Box key={index} padding="300" background="bg-surface" borderRadius="200">
                              <BlockStack gap="200">
                                <Text variant="bodyMd" fontWeight="bold">{product.title}</Text>
                                <InlineStack wrap={true} gap="200">
                                  <Text variant="bodySm">
                                    Original: {formatCurrency(product.originalPrice, product.currencyCode)}
                                  </Text>
                                  <Text variant="bodySm" tone="success">
                                    Discounted: {formatCurrency(product.discountedPrice, product.currencyCode)}
                                  </Text>
                                  <Text variant="bodySm" tone="success">
                                    Savings: {formatCurrency(product.savingsAmount, product.currencyCode)} ({product.savingsPercentage}%)
                                  </Text>
                                  <Text variant="bodySm">
                                    Discount: {product.discountPercentage}% of profit
                                  </Text>
                                </InlineStack>
                              </BlockStack>
                            </Box>
                          ))}
                        </BlockStack>
                      )}
                    </BlockStack>
                  </Box>
                )}
                
                {batchResults.failed > 0 && (
                  <Text variant="bodyLg" tone="critical">
                    ✗ Failed to apply discounts to {batchResults.failed} products
                  </Text>
                )}
                
                {batchResults.failedProducts && batchResults.failedProducts.length > 0 && (
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="300">
                      <Text variant="headingSm">Error details:</Text>
                      {batchResults.failedProducts.map((product, index) => (
                        <Box key={index} padding="300" background="bg-surface" borderRadius="200">
                          <BlockStack gap="200">
                            <Text variant="bodyMd" fontWeight="bold">{product.title}</Text>
                            <Text variant="bodySm">Variant ID: {product.variantId.split('/').pop()}</Text>
                            {product.discountPercentage && (
                              <Text variant="bodySm">
                                Discount: {product.discountPercentage}% of profit 
                                ({product.originalPrice && product.discountedPrice ? 
                                  `${formatCurrency(product.originalPrice, product.currencyCode)} → ${formatCurrency(product.discountedPrice, product.currencyCode)}` : 
                                  ''})
                              </Text>
                            )}
                            <Text variant="bodyMd" tone="critical">Error: {product.error}</Text>
                            {product.responsePreview && (
                              <Text variant="bodySm" tone="subdued">
                                Response preview: {product.responsePreview}...
                              </Text>
                            )}
                          </BlockStack>
                        </Box>
                      ))}
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
              
              <Box paddingBlock="400">
                <Divider />
              </Box>
              
              <BlockStack gap="200">
                <Text variant="bodyMd">
                  Click the button below to refresh the page and view your updated discount history.
                </Text>
                <Text variant="bodySm" tone="subdued">
                  Note: For best results when applying discounts to multiple products, select smaller batches of 3-5 products at a time.
                </Text>
              </BlockStack>
              
              <Box paddingBlock="300">
                <Button 
                  onClick={() => window.location.reload()} 
                  primary
                >
                  Refresh Page to See Updates
                </Button>
              </Box>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
      
      {/* Revert confirmation modal */}
      <Modal
        open={confirmRevert !== null}
        onClose={() => setConfirmRevert(null)}
        title="Revert Price"
        primaryAction={{
          content: "Yes, revert price",
          onAction: confirmRevertDiscount,
          destructive: true
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setConfirmRevert(null)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              Are you sure you want to revert the price of "{confirmRevert?.productTitle}" back to its original price of {confirmRevert?.originalPrice ? formatCurrency(confirmRevert.originalPrice, confirmRevert.currencyCode) : "original price"}?
            </Text>
            <Text as="p">
              This will remove the discount and update the product price in your store immediately.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      
      {/* Clear History confirmation modal */}
      <Modal
        open={confirmClearHistory}
        onClose={() => setConfirmClearHistory(false)}
        title="Delete All Discount History"
        primaryAction={{
          content: "Yes, Delete All History",
          onAction: async () => {
            setIsResettingHistory(true);
            
            try {
              // Send request to the API endpoint to reset history
              const response = await fetch('/api/daily-discounts/reset', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                  confirm: "DELETE_ALL_DISCOUNT_LOGS",
                  useSql: false // Use the safer Prisma method by default
                })
              });
              
              const data = await response.json();
              
              if (data.status === "success") {
                // Show success toast
                setSuccessToast({
                  active: true,
                  message: `Successfully deleted all discount history. ${data.message}`
                });
                
                // Update the local state to reflect the empty history
                loaderData.recentManualDiscountLogs = [];
                loaderData.recentApiDiscountLogs = [];
                
                // Reset the log counters
                setManualLogCount(20);
                setApiLogCount(20);
              } else {
                throw new Error(data.message || "Failed to delete history");
              }
            } catch (error) {
              console.error("Error clearing history:", error);
              
              // Show error toast
              setSuccessToast({
                active: true,
                message: `Failed to delete history: ${error instanceof Error ? error.message : "Unknown error"}`
              });
            } finally {
              setIsResettingHistory(false);
              setConfirmClearHistory(false);
              
              // Auto-hide toast after 5 seconds
              setTimeout(() => {
                setSuccessToast(prev => ({ ...prev, active: false }));
              }, 5000);
            }
          },
          destructive: true,
          loading: isResettingHistory
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setConfirmClearHistory(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="critical" fontWeight="bold">
              Warning: This action cannot be undone.
            </Text>
            <Text as="p">
              You are about to delete all discount history records for your store. This includes both manual and automated discounts.
            </Text>
            <Text as="p">
              This action will not affect the current prices of your products, but will erase all logs of previous discount operations.
            </Text>
            <Text as="p">
              Are you sure you want to proceed?
            </Text>
            
            <Box paddingBlock="400">
              <Divider />
            </Box>
            
            <details>
              <summary>
                <Text as="span" tone="subdued">Advanced Options</Text>
              </summary>
              <Box paddingBlock="300">
                <BlockStack gap="300">
                  <Text as="p" tone="warning">
                    For developer use only. These options can affect database integrity.
                  </Text>
                  
                  <Button 
                    tone="critical" 
                    onClick={async () => {
                      if (window.confirm("WARNING: This will completely drop and recreate the discount logs table. Are you absolutely sure?")) {
                        setIsResettingHistory(true);
                        
                        try {
                          // Send request with SQL flag
                          const response = await fetch('/api/daily-discounts/reset', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ 
                              confirm: "DELETE_ALL_DISCOUNT_LOGS",
                              useSql: true // Use SQL method
                            })
                          });
                          
                          const data = await response.json();
                          
                          if (data.status === "success") {
                            // Show success toast
                            setSuccessToast({
                              active: true,
                              message: `SQL Reset successful: ${data.message}`
                            });
                            
                            // Update the local state to reflect the empty history
                            loaderData.recentManualDiscountLogs = [];
                            loaderData.recentApiDiscountLogs = [];
                            
                            // Reset the log counters
                            setManualLogCount(20);
                            setApiLogCount(20);
                            
                            // Close the modal
                            setConfirmClearHistory(false);
                          } else {
                            throw new Error(data.message || "SQL reset failed");
                          }
                        } catch (error) {
                          console.error("Error performing SQL reset:", error);
                          
                          // Show error toast
                          setSuccessToast({
                            active: true,
                            message: `SQL Reset failed: ${error instanceof Error ? error.message : "Unknown error"}`
                          });
                        } finally {
                          setIsResettingHistory(false);
                          
                          // Auto-hide toast after 5 seconds
                          setTimeout(() => {
                            setSuccessToast(prev => ({ ...prev, active: false }));
                          }, 5000);
                        }
                      }
                    }}
                  >
                    Complete SQL Reset (Drop Table)
                  </Button>
                </BlockStack>
              </Box>
            </details>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Frame>
  );
}