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
    // Fetch ALL products with inventory, cost, and price data
    // We're getting them in batches of 250 products at a time for maximum selection
    console.log(`[getEligibleProducts] Executing GraphQL queries to fetch ALL products for shop: ${shop}`);
    
    let allProducts: any[] = [];
    let hasNextPage = true;
    let cursor = null;
    const batchSize = 250; // GraphQL pagination size - maximum allowed
    
    // Fetch products in batches using pagination until we have ALL products
    while (hasNextPage) {
      let query;
      let variables: any = { first: batchSize };
      
      // If we have a cursor, use it for pagination
      if (cursor) {
        variables.after = cursor;
        query = `
          query GetProductsWithInventory($first: Int!, $after: String) {
            products(first: $first, after: $after) {
              pageInfo {
                hasNextPage
                endCursor
              }
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
        `;
      } else {
        // First query without cursor
        query = `
          query GetProductsWithInventory($first: Int!) {
            products(first: $first) {
              pageInfo {
                hasNextPage
                endCursor
              }
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
        `;
      }
      
      try {
        console.log(`[getEligibleProducts] Fetching batch ${allProducts.length} to ${allProducts.length + batchSize}`);
        const response = await admin.graphql(query, { variables });
        const responseJson = await response.json();
        
        if (!responseJson.data?.products?.edges) {
          console.error(`[getEligibleProducts] No products in response:`, responseJson);
          break;
        }
        
        // Add the products from this batch
        allProducts = [...allProducts, ...responseJson.data.products.edges];
        
        // Update pagination info
        hasNextPage = responseJson.data.products.pageInfo.hasNextPage;
        cursor = responseJson.data.products.pageInfo.endCursor;
        
        console.log(`[getEligibleProducts] Fetched ${responseJson.data.products.edges.length} products, total: ${allProducts.length}`);
        
        // Break if there are no more pages - we want ALL products
        if (!hasNextPage) {
          console.log(`[getEligibleProducts] No more product pages to fetch`);
          break;
        }
      } catch (graphqlError) {
        console.error(`[getEligibleProducts] GraphQL error:`, graphqlError);
        // If we have some products, continue with what we have
        if (allProducts.length > 0) {
          console.log(`[getEligibleProducts] Continuing with ${allProducts.length} products already fetched`);
          break;
        }
        throw new Error(`GraphQL query failed: ${graphqlError.message || 'Unknown GraphQL error'}`);
      }
    }
    
    console.log(`[getEligibleProducts] Completed fetching ALL products from the store, total products: ${allProducts.length}`);
    
    // Stats for monitoring
    const start = Date.now();
    console.log(`[getEligibleProducts] Beginning product filtering from pool of ${allProducts.length} products...`);
    
    // Check if we received any products at all
    if (allProducts.length === 0) {
      return {
        status: "error",
        message: "No products found in the store",
        products: []
      };
    }

    // Filter products to include those with images and variants
    // Make cost optional - we'll estimate it if not available
    const productsWithData = allProducts
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
    
    // Calculate timing for filtering
    const filterTime = Date.now() - start;
    console.log(`[getEligibleProducts] Found ${productsWithData.length} eligible products after filtering (took ${filterTime}ms)`);
    
    // Calculate some stats for monitoring
    const eligiblePercentage = (productsWithData.length / allProducts.length) * 100;
    console.log(`[getEligibleProducts] ${eligiblePercentage.toFixed(2)}% of products meet eligibility criteria`);
    
    // If we have fewer eligible products than requested, use all of them
    if (productsWithData.length <= count) {
      console.log(`[getEligibleProducts] Using all ${productsWithData.length} eligible products (fewer than requested ${count})`);
      return {
        status: "success",
        products: productsWithData
      };
    }
    
    // Improved random selection from the pool of eligible products
    const selectedProducts = [];
    
    // Create a deep copy to avoid modifying the original array
    let productPool = [...productsWithData];
    
    // Truly random selection without replacement
    for (let i = 0; i < count && productPool.length > 0; i++) {
      // Select a random index
      const randomIndex = Math.floor(Math.random() * productPool.length);
      
      // Add the product at that index to our selected products
      selectedProducts.push(productPool[randomIndex]);
      
      // Remove the selected product from the pool to avoid duplicates
      productPool.splice(randomIndex, 1);
    }
    
    console.log(`[getEligibleProducts] Randomly selected ${selectedProducts.length} products from pool of ${productsWithData.length}`);
    
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
    
    console.log(`[getPreviousAutoDiscounts] Fetching auto discounts for shop: ${shop} since ${oneDayAgo.toISOString()}`);
    
    // Get only applied discounts that haven't been reverted yet using the isReverted field
    const previousDiscounts = await prisma.dailyDiscountLog.findMany({
      where: {
        shop,
        isRandomDiscount: true,
        appliedAt: {
          gte: oneDayAgo
        },
        notes: {
          contains: "Auto Discount Applied"
        },
        // Directly check the isReverted flag
        isReverted: false
      },
      orderBy: {
        appliedAt: 'desc'
      }
    });
    
    console.log(`[getPreviousAutoDiscounts] Found ${previousDiscounts.length} active auto discounts that need reverting`);
    
    // Print the first few discounts for debugging
    if (previousDiscounts.length > 0) {
      const sampleDiscount = previousDiscounts[0];
      console.log(`[getPreviousAutoDiscounts] Sample discount: ${sampleDiscount.productTitle} (${sampleDiscount.variantId}), Original: ${sampleDiscount.originalPrice}, Discounted: ${sampleDiscount.discountedPrice}`);
    }
    
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
    errors: [] as string[],
    revertedItems: [] as string[]
  };
  
  console.log(`[revertPreviousDiscounts] Starting reversion for ${previousDiscounts.length} products`);
  
  if (previousDiscounts.length === 0) {
    console.log(`[revertPreviousDiscounts] No products to revert - skipping`);
    return results;
  }
  
  for (const discount of previousDiscounts) {
    console.log(`[revertPreviousDiscounts] Processing ${discount.productTitle} (${discount.variantId})`);
    
    try {
      // Check if this discount is already marked as reverted
      if (discount.isReverted) {
        console.log(`[revertPreviousDiscounts] Product ${discount.productTitle} already reverted - skipping`);
        continue;
      }
      
      // Get the product ID from the variant ID
      // This assumes variant ID is in the format "gid://shopify/ProductVariant/123456789"
      const variantMatch = discount.variantId.match(/gid:\/\/shopify\/ProductVariant\/(\d+)/);
      if (!variantMatch || !variantMatch[1]) {
        results.failed++;
        results.errors.push(`Invalid variant ID format: ${discount.variantId}`);
        console.error(`[revertPreviousDiscounts] Invalid variant ID format: ${discount.variantId}`);
        continue;
      }
      
      // Get the product ID using the variant
      console.log(`[revertPreviousDiscounts] Fetching product ID for variant: ${discount.variantId}`);
      let productId;
      
      // First try using the stored productId if available
      if (discount.productId && discount.productId.includes("gid://shopify/Product/")) {
        productId = discount.productId;
        console.log(`[revertPreviousDiscounts] Using stored productId: ${productId}`);
      } else {
        // If not available, fetch it from the API
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
              variantId: discount.variantId
            }
          });
          
          const variantData = await variantResponse.json();
          productId = variantData.data?.productVariant?.product?.id;
          
          if (!productId) {
            results.failed++;
            results.errors.push(`Could not determine product ID for variant: ${discount.variantId}`);
            console.error(`[revertPreviousDiscounts] Could not determine product ID for variant: ${discount.variantId}`);
            continue;
          }
          console.log(`[revertPreviousDiscounts] Fetched productId from API: ${productId}`);
        } catch (variantError) {
          results.failed++;
          results.errors.push(`Error fetching product ID: ${variantError.message}`);
          console.error(`[revertPreviousDiscounts] Error fetching product ID:`, variantError);
          continue;
        }
      }
      
      // Update the product variant to revert the price
      console.log(`[revertPreviousDiscounts] Reverting price for ${discount.productTitle} to ${discount.originalPrice}`);
      
      try {
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
          console.error(`[revertPreviousDiscounts] GraphQL error:`, responseJson.data.productVariantsBulkUpdate.userErrors);
          continue;
        }
        
        // Try to remove the discount tag
        try {
          // First get current tags
          const getTagsResponse = await admin.graphql(`
            query getProductTags($id: ID!) {
              product(id: $id) {
                id
                tags
              }
            }
          `, {
            variables: {
              id: productId
            }
          });
          
          const tagsJson = await getTagsResponse.json();
          const currentTags = tagsJson.data?.product?.tags || [];
          
          // Filter out the discount tag
          const updatedTags = currentTags.filter((tag: string) => tag !== "DailyDiscount_每日優惠");
          
          // Only update if the tag was present
          if (currentTags.length !== updatedTags.length) {
            await admin.graphql(`
              mutation updateProductTags($id: ID!, $tags: [String!]!) {
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
                tags: updatedTags
              }
            });
            
            console.log(`[revertPreviousDiscounts] Removed discount tag from ${discount.productTitle}`);
          }
        } catch (tagError) {
          console.error(`[revertPreviousDiscounts] Error updating tags:`, tagError);
          // Continue anyway even if tag removal fails
        }
        
        // Instead of creating a new record, update the existing one to show it's been reverted
        await prisma.dailyDiscountLog.update({
          where: {
            id: discount.id
          },
          data: {
            notes: "Auto Discount Reverted",
            isReverted: true,
            revertedAt: new Date(),
            revertOriginalPrice: discount.discountedPrice,
            revertDiscountedPrice: discount.originalPrice,
            revertCompareAtPrice: null,
            revertNotes: "Price reverted to original value"
          }
        });
        
        results.successful++;
        results.revertedItems.push(discount.productTitle);
        console.log(`[revertPreviousDiscounts] Successfully reverted ${discount.productTitle}`);
      } catch (updateError) {
        results.failed++;
        results.errors.push(`Error updating product: ${updateError.message}`);
        console.error(`[revertPreviousDiscounts] Error updating product:`, updateError);
      }
    } catch (error) {
      results.failed++;
      results.errors.push(`Error reverting discount for ${discount.productTitle}: ${error instanceof Error ? error.message : "Unknown error"}`);
      console.error(`[revertPreviousDiscounts] Error processing discount:`, error);
    }
  }
  
  console.log(`[revertPreviousDiscounts] Reversion complete: ${results.successful} successful, ${results.failed} failed`);
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
 * Enhanced with better randomization
 */
function shuffleArray(array: any[]) {
  // Create a new copy to avoid modifying the original
  const newArray = [...array];
  
  // Use Fisher-Yates algorithm for shuffling
  for (let i = newArray.length - 1; i > 0; i--) {
    // Generate a more unpredictable random index using a combination of methods
    let j = Math.floor(Math.random() * (i + 1));
    
    // Ensure j is within bounds (defensive programming)
    j = Math.max(0, Math.min(j, i));
    
    // Swap elements
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  
  return newArray;
}
