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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const debugVariantId = url.searchParams.get("debugVariantId");
  
  // Fetch recent discount logs (limited to 5)
  const recentDiscountLogs = await prisma.dailyDiscountLog.findMany({
    where: {
      shop: session.shop
    },
    orderBy: {
      appliedAt: 'desc'
    },
    take: 5
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
  
  // Regular product fetch logic
  try {
    // We'll fetch all products by using pagination
    let allProductEdges = [];
    let hasNextPage = true;
    let cursor = null;
    
    // Function to build the query with the appropriate cursor
    const buildQuery = (cursor) => {
      return `
        query GetProductsWithInventory {
          products(first: 500${cursor ? `, after: "${cursor}"` : ''}) {
            edges {
              node {
                id
                title
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
              cursor
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `;
    };
    
    // Loop to fetch all pages of products
    while (hasNextPage) {
      console.log(`Fetching products${cursor ? ' after cursor: ' + cursor : ''}`);
      
      const response = await admin.graphql(buildQuery(cursor));
      const responseJson = await response.json();
      
      if (responseJson.errors) {
        console.error("GraphQL errors:", responseJson.errors);
        break;
      }
      
      const products = responseJson.data?.products;
      
      if (!products || !products.edges || products.edges.length === 0) {
        break;
      }
      
      // Add the current page of edges to our collection
      allProductEdges = [...allProductEdges, ...products.edges];
      
      // Check if there are more pages
      hasNextPage = products.pageInfo.hasNextPage;
      
      // If there are more pages, get the cursor of the last item
      if (hasNextPage && products.edges.length > 0) {
        cursor = products.edges[products.edges.length - 1].cursor;
      } else {
        break;
      }
      
      // Log progress for large stores
      if (allProductEdges.length % 500 === 0) {
        console.log(`Fetched ${allProductEdges.length} products so far...`);
      }
    }
    
    console.log(`Fetched a total of ${allProductEdges.length} products`);
    
    // Create a response object structure that matches the original format
    const responseJson = {
      data: {
        products: {
          edges: allProductEdges
        }
      }
    };
    
    // First, check if we received any products at all
    if (!responseJson.data?.products?.edges || responseJson.data.products.edges.length === 0) {
      return json({
        status: "error",
        message: "No products found in your store. Please add some products first.",
        randomProduct: null
      });
    }

    // Count products that meet each criterion to provide better diagnostics
    const diagnostics = {
      totalProducts: responseJson.data.products.edges.length,
      withImages: 0,
      withVariants: 0,
      withPositiveInventory: 0,
      withCost: 0
    };

    // Filter products to include those with images and variants
    // Make cost optional - we'll estimate it if not available
    const productsWithData = responseJson.data.products.edges
      .filter((edge: any) => {
        const product = edge.node;
        const variant = product.variants.edges[0]?.node;
        
        // Count for diagnostics
        if (product.featuredImage) diagnostics.withImages++;
        if (variant) diagnostics.withVariants++;
        if (variant && variant.inventoryQuantity > 0) diagnostics.withPositiveInventory++;
        if (variant && variant.inventoryItem?.unitCost?.amount) diagnostics.withCost++;
        
        // Require image, variant, and positive inventory but make cost optional
        return (
          product.featuredImage && 
          variant &&
          variant.inventoryQuantity > 0
        );
      })
      .map((edge: any) => {
        const product = edge.node;
        const variant = product.variants.edges[0].node;
        const price = parseFloat(variant.price);
        
        // If cost is missing, estimate it as 50% of the selling price
        // This is just a fallback for demonstration purposes
        const hasCost = variant.inventoryItem?.unitCost?.amount;
        const cost = hasCost 
          ? parseFloat(variant.inventoryItem.unitCost.amount)
          : price * 0.5; // Assume 50% cost if not available
        
        // Use the same currency code for cost and price if cost data is missing
        const currencyCode = variant.inventoryItem?.unitCost?.currencyCode || 'USD';
        
        return {
          id: product.id,
          title: product.title,
          imageUrl: product.featuredImage.url,
          imageAlt: product.featuredImage.altText || product.title,
          cost: cost,
          sellingPrice: price,
          compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
          inventoryQuantity: variant.inventoryQuantity,
          variantId: variant.id,
          variantTitle: variant.title,
          currencyCode: currencyCode,
          hasCostData: !!hasCost // Flag to indicate if cost was provided or estimated
        };
      });
    
    // Check if we have any valid products
    if (productsWithData.length === 0) {
      // Provide detailed diagnostics about what criteria products failed to meet
      return json({
        status: "error",
        message: `No products found meeting minimum requirements (image and positive inventory).
        
Found ${diagnostics.totalProducts} products:
• ${diagnostics.withImages} have images
• ${diagnostics.withVariants} have variants
• ${diagnostics.withPositiveInventory} have positive inventory
• ${diagnostics.withCost} have cost data

Please ensure some products have images and inventory quantity > 0.`,
        diagnostics,
        randomProduct: null
      });
    }
    
    // Get array of recently discounted product IDs to avoid repeating
    const recentlyDiscountedProductIds = recentDiscountLogs
      .map(log => log.productId)
      .filter(Boolean);
      
    // Filter out recently discounted products if possible
    let eligibleProducts = productsWithData;
    if (recentlyDiscountedProductIds.length > 0 && productsWithData.length > recentlyDiscountedProductIds.length) {
      eligibleProducts = productsWithData.filter(product => 
        !recentlyDiscountedProductIds.includes(product.id)
      );
      
      // If we filtered out all products, fall back to the full list
      if (eligibleProducts.length === 0) {
        eligibleProducts = productsWithData;
        console.log("All available products have been recently discounted. Using full product list.");
      }
    }
    
    // Select a random product from eligible products
    const randomIndex = Math.floor(Math.random() * eligibleProducts.length);
    const randomProduct = eligibleProducts[randomIndex];
    
    return json({
      status: "success",
      randomProduct,
      recentDiscountLogs
    });
    
  } catch (error) {
    console.error("Error fetching random product:", error);
    return json({
      status: "error",
      message: error instanceof Error ? error.message : "An unknown error occurred",
      randomProduct: null
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
    
    // Update the product variant with the new price
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
          notes: notes || null
        }
      });
      console.log(`Discount logged for product ${productTitle} (${variantId})`);
    } catch (logError) {
      console.error("Error logging discount:", logError);
      // Continue anyway even if logging fails
    }
    
    // Check if this was a revert action by looking at the notes
    const isRevert = notes && notes.includes("Reverted discount");
    
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
  const { randomProduct, status, message, recentDiscountLogs } = loaderData;
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
  const submit = useSubmit();
  
  // Function to generate a random discount
  const generateRandomDiscount = () => {
    if (!randomProduct) return;
    
    setIsGeneratingDiscount(true);
    setIsPriceUpdated(false);
    
    // Calculate profit margin
    const profit = randomProduct.sellingPrice - randomProduct.cost;
    const profitMargin = profit / randomProduct.sellingPrice * 100;
    
    // Generate random discount percentage between 10% and 25%
    const discountPercentage = Math.floor(Math.random() * 16) + 10; // 10 to 25
    
    // Calculate discounted profit (applying discount to the profit)
    const discountFactor = 1 - (discountPercentage / 100);
    const discountedProfit = profit * discountFactor;
    
    // Calculate new price (cost + discounted profit)
    const newPrice = randomProduct.cost + discountedProfit;
    const roundedPrice = Math.ceil(newPrice * 100) / 100; // Round up to nearest cent
    
    // Calculate savings
    const savingsAmount = randomProduct.sellingPrice - roundedPrice;
    const savingsPercentage = (savingsAmount / randomProduct.sellingPrice) * 100;
    
    // Set discount data
    setDiscount({
      profitMargin: profitMargin,
      discountPercentage: discountPercentage,
      originalPrice: randomProduct.sellingPrice,
      discountedPrice: roundedPrice,
      savingsAmount: savingsAmount,
      savingsPercentage: savingsPercentage
    });
    
    setTimeout(() => setIsGeneratingDiscount(false), 800);
  };
  
  // Apply the discount to the product
  const applyDiscount = () => {
    if (!randomProduct || !discount) return;
    
    const formData = new FormData();
    formData.append("variantId", randomProduct.variantId);
    formData.append("newPrice", discount.discountedPrice.toString());
    
    // Get product ID from the product's full ID
    // Product ID should be in the format "gid://shopify/Product/123456789"
    let productId = randomProduct.id;
    
    // If for some reason we need to fix the format of the product ID
    if (!productId.includes("gid://shopify/Product/")) {
      // If the ID is just a number or has a different format, try to fix it
      if (/^\d+$/.test(productId)) {
        productId = `gid://shopify/Product/${productId}`;
      }
    }
    
    formData.append("productId", productId);
    
    // Always set compareAtPrice to original price to ensure it appears as a sale
    formData.append("compareAtPrice", randomProduct.sellingPrice.toString());
    
    // Add all the fields needed for logging to the database
    formData.append("productTitle", randomProduct.title);
    if (randomProduct.variantTitle) {
      formData.append("variantTitle", randomProduct.variantTitle);
    }
    formData.append("originalPrice", randomProduct.sellingPrice.toString());
    formData.append("costPrice", randomProduct.cost.toString());
    formData.append("profitMargin", discount.profitMargin.toString());
    formData.append("discountPercentage", discount.discountPercentage.toString());
    formData.append("savingsAmount", discount.savingsAmount.toString());
    formData.append("savingsPercentage", discount.savingsPercentage.toString());
    formData.append("currencyCode", randomProduct.currencyCode);
    formData.append("imageUrl", randomProduct.imageUrl);
    formData.append("inventoryQuantity", randomProduct.inventoryQuantity.toString());
    formData.append("notes", randomProduct.hasCostData ? "Based on actual cost data" : "Based on estimated cost (50% of price)");
    
    submit(formData, { method: "post" });
    setIsPriceUpdated(true);
    
    // Log the form data being sent
    console.log("Submitting discount with data:", {
      variantId: randomProduct.variantId,
      productId: productId,
      newPrice: discount.discountedPrice.toString(),
      compareAtPrice: randomProduct.sellingPrice.toString()
    });
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
        
        // Auto-hide toast after 5 seconds
        setTimeout(() => {
          setSuccessToast(prev => ({ ...prev, active: false }));
        }, 5000);
        
        // Refresh the page after a short delay to update the discount logs
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    }
  }, [actionData]);

  // Generate a discount when the component loads
  useEffect(() => {
    if (randomProduct) {
      generateRandomDiscount();
    }
  }, [randomProduct]);
  
  // Show confirmation dialog for reverting a discount
  const handleRevertDiscount = (log: any) => {
    if (!log.variantId || !log.originalPrice) {
      setDiscountError("Cannot revert: Missing variant ID or original price");
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
    formData.append("notes", "Reverted discount to original price");
    
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
                Today's Featured Product
              </Text>
              
              {!randomProduct ? (
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
                    <Text as="h3" variant="headingLg" alignment="center">{randomProduct.title}</Text>
                    {randomProduct.variantTitle && (
                      <Text as="p" variant="bodyMd" alignment="center">
                        Variant: {randomProduct.variantTitle}
                      </Text>
                    )}
                    <Text as="p" variant="bodySm" alignment="center" tone="subdued">
                      Variant ID: {randomProduct.variantId.split("/").pop()}
                    </Text>
                  </TextContainer>
                  
                  <Box padding="400" style={{ textAlign: "center" }}>
                    <div style={{ margin: "0 auto", maxWidth: "300px" }}>
                      <Thumbnail
                        source={randomProduct.imageUrl}
                        alt={randomProduct.title}
                        size="large"
                      />
                    </div>
                  </Box>
                  
                  <BlockStack gap="300">
                    <InlineStack gap="600" align="center" blockAlign="center" wrap={false}>
                      <Box style={{ flex: 1 }}>
                        <BlockStack gap="100">
                          <Text variant="bodyMd" as="span">
                            Cost {!randomProduct.hasCostData && <span style={{ color: '#bf0711', fontSize: '0.8em' }}>(Estimated)</span>}
                          </Text>
                          <Text variant="headingMd" as="span" fontWeight="bold">
                            {formatCurrency(randomProduct.cost, randomProduct.currencyCode)}
                          </Text>
                        </BlockStack>
                      </Box>
                      
                      <Box style={{ flex: 1 }}>
                        <BlockStack gap="100">
                          <Text variant="bodyMd" as="span">Selling Price</Text>
                          <Text variant="headingMd" as="span" fontWeight="bold">
                            {formatCurrency(randomProduct.sellingPrice, randomProduct.currencyCode)}
                          </Text>
                        </BlockStack>
                      </Box>
                      
                      <Box style={{ flex: 1 }}>
                        <BlockStack gap="100">
                          <Text variant="bodyMd" as="span">Compare At</Text>
                          <Text variant="headingMd" as="span" fontWeight="bold">
                            {randomProduct.compareAtPrice 
                              ? formatCurrency(randomProduct.compareAtPrice, randomProduct.currencyCode) 
                              : "-"
                            }
                          </Text>
                        </BlockStack>
                      </Box>
                      
                      <Box style={{ flex: 1 }}>
                        <BlockStack gap="100">
                          <Text variant="bodyMd" as="span">Inventory</Text>
                          <Text variant="headingMd" as="span" fontWeight="bold">
                            {randomProduct.inventoryQuantity}
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
                                  New Random Product
                                </Button>
                                
                                <Button 
                                  onClick={applyDiscount} 
                                  variant="primary"
                                  disabled={isPriceUpdated}
                                >
                                  {isPriceUpdated ? (
                                    <InlineStack gap="200" blockAlign="center">
                                      <span style={{ color: 'var(--p-color-text-success)', marginRight: '4px' }}>✓</span>
                                      <span>Price Updated!</span>
                                    </InlineStack>
                                  ) : (
                                    "Apply Discount"
                                  )}
                                </Button>
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
              <Text as="h2" variant="headingMd">
                Recent Discount History
              </Text>
              
              {(!recentDiscountLogs || recentDiscountLogs.length === 0) ? (
                <Banner tone="info">
                  <p>No daily discount logs found. Apply discounts to products to see them here.</p>
                </Banner>
              ) : (
                <BlockStack gap="400">
                  {recentDiscountLogs.map((log) => (
                    <Box key={log.id} padding="300" background="bg-subdued" borderRadius="200">
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
                              <Text variant="headingSm" as="h3">{log.productTitle}</Text>
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
                          <Text variant="bodySm" as="span" tone="success">
                            Savings: {formatCurrency(log.savingsAmount, log.currencyCode)} ({log.savingsPercentage.toFixed(1)}%)
                          </Text>
                        </InlineStack>
                        
                        <InlineStack align="end">
                          <Button 
                            size="micro" 
                            tone="critical"
                            onClick={() => handleRevertDiscount(log)}
                            disabled={isReverting === log.id}
                          >
                            {isReverting === log.id ? "Reverting..." : "Revert to Original Price"}
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        
          
          
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                About Daily Discounts
              </Text>
              
              <Text as="p">
                This tool automatically selects a random product from your inventory and generates a discount
                based on the product's profit margin. The discounts range from 10% to 25% of the product's profit,
                ensuring you maintain profitability while offering attractive discounts to your customers.
              </Text>
              
              <Banner tone="info">
                <p>
                  The tool will set the original price as the "Compare at price" (if not already set)
                  and apply the discounted price as the regular price, making the discount visible to customers.
                </p>
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
    </Frame>
  );
}