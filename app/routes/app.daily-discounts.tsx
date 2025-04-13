import { json, ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
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
  Icon,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { useState, useEffect } from "react";
import { MobileAcceptIcon, DiscountsMajor } from "@shopify/polaris-icons";

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
    // Fetch a random product with inventory, cost, and price data
    // We're getting up to 50 products to have a good pool for random selection
    const response = await admin.graphql(`
      query GetProductsWithInventory {
        products(first: 50) {
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
    `);

    const responseJson = await response.json();
    
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
    
    // Select a random product
    const randomIndex = Math.floor(Math.random() * productsWithData.length);
    const randomProduct = productsWithData[randomIndex];
    
    return json({
      status: "success",
      randomProduct
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
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const variantId = formData.get("variantId")?.toString();
  const newPrice = formData.get("newPrice")?.toString();
  const compareAtPrice = formData.get("compareAtPrice")?.toString();
  
  if (!variantId || !newPrice) {
    return json({
      status: "error",
      message: "Missing required parameters"
    });
  }
  
  try {
    // Update the product variant with the new price
    const response = await admin.graphql(`
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
          id: variantId,
          price: newPrice,
          compareAtPrice: compareAtPrice || null
        }
      }
    });
    
    const responseJson = await response.json();
    
    if (responseJson.data?.productVariantUpdate?.userErrors?.length > 0) {
      const errors = responseJson.data.productVariantUpdate.userErrors.map((err: any) => err.message).join(", ");
      return json({
        status: "error",
        message: `Error updating product: ${errors}`
      });
    }
    
    return json({
      status: "success",
      message: "Product price updated successfully",
      variant: responseJson.data?.productVariantUpdate?.productVariant
    });
    
  } catch (error) {
    console.error("Error updating product price:", error);
    return json({
      status: "error",
      message: error instanceof Error ? error.message : "An unknown error occurred"
    });
  }
};

export default function DailyDiscounts() {
  const loaderData = useLoaderData<typeof loader>();
  const { randomProduct, status, message } = loaderData;
  const [discount, setDiscount] = useState<DiscountData | null>(null);
  const [isGeneratingDiscount, setIsGeneratingDiscount] = useState(false);
  const [isPriceUpdated, setIsPriceUpdated] = useState(false);
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
    
    // If there's no compare-at price yet, use the original price
    if (!randomProduct.compareAtPrice) {
      formData.append("compareAtPrice", randomProduct.sellingPrice.toString());
    }
    
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
  
  // Generate a discount when the component loads
  useEffect(() => {
    if (randomProduct) {
      generateRandomDiscount();
    }
  }, [randomProduct]);
  
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
        <Layout.Section>
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
        </Layout.Section>
        
        <Layout.Section>
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
                              <Icon source={DiscountsMajor} />
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
                                    <Icon source={MobileAcceptIcon} color="success" />
                                    <span>Price Updated!</span>
                                  </InlineStack>
                                ) : (
                                  "Apply Discount"
                                )}
                              </Button>
                            </InlineStack>
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
        
        <Layout.Section>
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
        
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Debug Information
              </Text>
              
              <Text as="p">
                If you're having issues with the Daily Discounts feature, you can use the following GraphQL query in the 
                Shopify Admin API Explorer to check if your product variants have cost data set:
              </Text>
              
              <Box padding="400" style={{ backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
                <pre style={{ whiteSpace: "pre-wrap", overflow: "auto", margin: 0 }}>
{`query {
  productVariant(id: "gid://shopify/ProductVariant/YOUR_VARIANT_ID") {
    id
    title
    price
    compareAtPrice
    inventoryItem {
      id
      cost
    }
  }
}`}
                </pre>
              </Box>
              
              <Text as="p">
                Replace YOUR_VARIANT_ID with the numeric ID of the variant you want to check. You can find this ID in the product URL 
                when editing a product in Shopify.
              </Text>
              
              <Text as="p">
                If the cost value shows as null, you'll need to set the cost for your products in Shopify:
                <br />
                Go to Products → Inventory → click "Edit" next to a product → find "Unit cost" field.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      )}
    </Page>
  );
}
