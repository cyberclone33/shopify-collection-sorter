import { type AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";

/**
 * Fetches eligible products with inventory, cost, and price data
 * @param admin - Shopify admin API context
 * @param shop - Shop identifier
 * @param count - Number of products to fetch (default: 6)
 * @returns Array of eligible products for discounting
 */
export async function getEligibleProducts(
  admin: AdminApiContext,
  shop: string,
  count: number = 6
) {
  try {
    console.log(`[getEligibleProducts] Fetching products for shop: ${shop}`);
    // Fetch products with inventory, cost, and price data
    // We're getting up to 50 products to have a good pool for random selection
    console.log(`[getEligibleProducts] Executing GraphQL query for shop: ${shop}`);
    let response;
    try {
      response = await admin.graphql(`
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
      `);
    } catch (graphqlError) {
      console.error(`[getEligibleProducts] GraphQL error:`, graphqlError);
      throw new Error(`GraphQL query failed: ${graphqlError.message || 'Unknown GraphQL error'}`);
    }

    console.log(`[getEligibleProducts] Got GraphQL response for shop: ${shop}`);
    const responseJson = await response.json();
    console.log(`[getEligibleProducts] Response structure:`, JSON.stringify(responseJson).substring(0, 200) + '...');
    
    // First, check if we received any products at all
    if (!responseJson.data?.products?.edges || responseJson.data.products.edges.length === 0) {
      return {
        status: "error",
        message: "No products found in the store",
        products: []
      };
    }

    // Filter products to include those with images and variants
    // Make cost optional - we'll estimate it if not available
    const productsWithData = responseJson.data.products.edges
      .filter((edge: any) => {
        const product = edge.node;
        const variant = product.variants.edges[0]?.node;
        
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
      return {
        status: "error",
        message: "No products found meeting minimum requirements (image and positive inventory)",
        products: []
      };
    }
    
    // Shuffle the array to randomize product selection
    const shuffledProducts = shuffleArray(productsWithData);
    
    // Take the requested number of products
    const selectedProducts = shuffledProducts.slice(0, count);
    
    return {
      status: "success",
      products: selectedProducts
    };
    
  } catch (error) {
    console.error("Error fetching eligible products:", error);
    return {
      status: "error",
      message: error instanceof Error ? error.message : "An unknown error occurred",
      products: []
    };
  }
}

/**
 * Fetch all products that were previously auto-discounted
 * @param shop - Shop identifier
 * @returns Array of previously discounted product variant IDs
 */
export async function getPreviousAutoDiscounts(shop: string) {
  try {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const previousDiscounts = await prisma.dailyDiscountLog.findMany({
      where: {
        shop,
        isRandomDiscount: true,
        appliedAt: {
          gte: oneDayAgo
        },
        notes: {
          contains: "Auto Discount"
        }
      },
      orderBy: {
        appliedAt: 'desc'
      }
    });
    
    return previousDiscounts;
  } catch (error) {
    console.error("Error fetching previous auto discounts:", error);
    return [];
  }
}

/**
 * Revert prices for previously discounted products
 * @param admin - Shopify admin API context
 * @param shop - Shop identifier
 * @param previousDiscounts - Array of previous discount logs
 * @returns Results of reversion operations
 */
export async function revertPreviousDiscounts(
  admin: AdminApiContext,
  shop: string,
  previousDiscounts: any[]
) {
  const results = {
    successful: 0,
    failed: 0,
    errors: [] as string[]
  };
  
  for (const discount of previousDiscounts) {
    try {
      // Get the product ID from the variant ID
      // This assumes variant ID is in the format "gid://shopify/ProductVariant/123456789"
      const variantMatch = discount.variantId.match(/gid:\/\/shopify\/ProductVariant\/(\d+)/);
      if (!variantMatch || !variantMatch[1]) {
        results.failed++;
        results.errors.push(`Invalid variant ID format: ${discount.variantId}`);
        continue;
      }
      
      // Get the product ID using the variant
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
          variantId: discount.variantId
        }
      });
      
      const variantData = await variantResponse.json();
      const productId = variantData.data?.productVariant?.product?.id;
      
      if (!productId) {
        results.failed++;
        results.errors.push(`Could not determine product ID for variant: ${discount.variantId}`);
        continue;
      }
      
      // Update the product variant to revert the price
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
          productId,
          variants: [{
            id: discount.variantId,
            price: discount.originalPrice.toString(),
            compareAtPrice: null // Remove compare at price
          }]
        }
      });
      
      const responseJson = await response.json();
      
      if (responseJson.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
        results.failed++;
        const errors = responseJson.data.productVariantsBulkUpdate.userErrors.map((err: any) => err.message).join(", ");
        results.errors.push(`Error reverting discount for ${discount.productTitle}: ${errors}`);
        continue;
      }
      
      // Log the reversion
      await prisma.dailyDiscountLog.create({
        data: {
          shop,
          productId: discount.productId,
          productTitle: discount.productTitle,
          variantId: discount.variantId,
          variantTitle: discount.variantTitle || null,
          originalPrice: discount.discountedPrice,
          discountedPrice: discount.originalPrice,
          compareAtPrice: null,
          costPrice: discount.costPrice,
          profitMargin: discount.profitMargin,
          discountPercentage: discount.discountPercentage,
          savingsAmount: -discount.savingsAmount, // Negative to show it's a reversion
          savingsPercentage: -discount.savingsPercentage,
          currencyCode: discount.currencyCode || 'USD',
          imageUrl: discount.imageUrl,
          inventoryQuantity: discount.inventoryQuantity,
          isRandomDiscount: true,
          notes: "Auto Discount Reverted"
        }
      });
      
      results.successful++;
    } catch (error) {
      results.failed++;
      results.errors.push(`Error reverting discount for ${discount.productTitle}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  
  return results;
}

/**
 * Generate a random discount for a product
 * @param product - Product data
 * @returns Discount data
 */
export function generateRandomDiscount(product: any) {
  // Calculate profit margin
  const profit = product.sellingPrice - product.cost;
  const profitMargin = profit / product.sellingPrice * 100;
  
  // Generate random discount percentage between 10% and 25%
  const discountPercentage = Math.floor(Math.random() * 16) + 10; // 10 to 25
  
  // Calculate discounted profit (applying discount to the profit)
  const discountFactor = 1 - (discountPercentage / 100);
  const discountedProfit = profit * discountFactor;
  
  // Calculate new price (cost + discounted profit)
  const newPrice = product.cost + discountedProfit;
  const roundedPrice = Math.ceil(newPrice * 100) / 100; // Round up to nearest cent
  
  // Calculate savings
  const savingsAmount = product.sellingPrice - roundedPrice;
  const savingsPercentage = (savingsAmount / product.sellingPrice) * 100;
  
  return {
    profitMargin,
    discountPercentage,
    originalPrice: product.sellingPrice,
    discountedPrice: roundedPrice,
    savingsAmount,
    savingsPercentage
  };
}

/**
 * Apply a discount to a product
 * @param admin - Shopify admin API context
 * @param shop - Shop identifier
 * @param product - Product data
 * @param discount - Discount data
 * @returns Result of the operation
 */
export async function applyDiscount(
  admin: AdminApiContext,
  shop: string,
  product: any,
  discount: any
) {
  try {
    // Extract and format product ID
    let productId = product.id;
    if (!productId.includes("gid://shopify/Product/")) {
      if (/^\d+$/.test(productId)) {
        productId = `gid://shopify/Product/${productId}`;
      }
    }
    
    // Apply the discount
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
        productId,
        variants: [{
          id: product.variantId,
          price: discount.discountedPrice.toString(),
          compareAtPrice: product.sellingPrice.toString() // Set original price as compare at price
        }]
      }
    });
    
    const responseJson = await response.json();
    
    if (responseJson.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
      const errors = responseJson.data.productVariantsBulkUpdate.userErrors.map((err: any) => err.message).join(", ");
      return {
        status: "error",
        message: `Error updating product: ${errors}`
      };
    }
    
    // Log the discount
    await prisma.dailyDiscountLog.create({
      data: {
        shop,
        productId: productId,
        productTitle: product.title,
        variantId: product.variantId,
        variantTitle: product.variantTitle || null,
        originalPrice: product.sellingPrice,
        discountedPrice: discount.discountedPrice,
        compareAtPrice: product.sellingPrice,
        costPrice: product.cost,
        profitMargin: discount.profitMargin,
        discountPercentage: discount.discountPercentage,
        savingsAmount: discount.savingsAmount,
        savingsPercentage: discount.savingsPercentage,
        currencyCode: product.currencyCode,
        imageUrl: product.imageUrl,
        inventoryQuantity: product.inventoryQuantity,
        isRandomDiscount: true,
        notes: "Auto Discount Applied"
      }
    });
    
    // Optionally add a tag to the product
    try {
      await admin.graphql(`
        mutation addTagsToProduct($id: ID!, $tags: [String!]!) {
          productUpdate(input: {id: $id, tags: $tags}) {
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
          id: productId,
          tags: ["DailyDiscount_每日優惠"] // Adding a tag for easy filtering
        }
      });
    } catch (tagError) {
      console.error("Error adding tag to product:", tagError);
      // Continue anyway even if tagging fails
    }
    
    return {
      status: "success",
      message: "Discount applied successfully",
      product: responseJson.data?.productVariantsBulkUpdate?.productVariants?.[0] || null
    };
    
  } catch (error) {
    console.error("Error applying discount:", error);
    return {
      status: "error",
      message: error instanceof Error ? error.message : "An unknown error occurred",
      details: error.stack || "No stack trace available"
    };
  }
}

/**
 * Utility function to shuffle an array (Fisher-Yates algorithm)
 */
function shuffleArray(array: any[]) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}
