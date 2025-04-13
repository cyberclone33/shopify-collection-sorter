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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { useState, useEffect } from "react";
import { MobileAcceptIcon, DiscountAutomaticIcon } from "@shopify/polaris-icons";

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
  const { randomProduct, status, message } = useLoaderData<typeof loader>();
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
  
  return (
    <Page>
      <TitleBar title="Daily Discounts" />
      
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
                              <Icon source={DiscountAutomaticIcon} />
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
      </Layout>
    </Page>
  );
}
