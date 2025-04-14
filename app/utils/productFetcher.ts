// productFetcher.ts - Utility for efficient product fetching with pagination

import productCache, { Product, ProductStats, shuffleArray } from './productCache';

/**
 * Fetches all eligible products from Shopify with efficient pagination
 * @param admin Shopify Admin API client from authenticate.admin
 * @param tagFilter Optional tag filter string (e.g., "NOT tag:SomeTag")
 * @returns Object containing products array and statistics
 */
export async function fetchAllEligibleProducts(admin: any, shopId: string, tagFilter?: string | null): Promise<{
  products: Product[];
  stats: ProductStats;
}> {
  console.log("Fetching all eligible products (with pagination)...");
  
  // Check if we have valid cached data for this shop
  if (productCache.isValid(shopId)) {
    const cachedProducts = productCache.getProducts();
    const cachedStats = productCache.getProductStats();
    
    if (cachedProducts && cachedStats) {
      const cacheStatus = productCache.getStatus();
      console.log(`Using cached data (${cachedProducts.length} products), ${Math.round(cacheStatus.cacheExpiry / 60)} minutes until expiry`);
      return { products: cachedProducts, stats: cachedStats };
    }
  }
  
  // If we get here, we need to fetch new data
  let allProducts: Product[] = [];
  let hasNextPage = true;
  let cursor = null;
  let pageCount = 0;
  
  // Product statistics for reporting/debugging
  const productStats: ProductStats = {
    total: 0,
    withImage: 0,
    withVariant: 0,
    withInventory: 0,
    withCost: 0,
    eligible: 0
  };
  
  // Build the query filter string based on the tag
  const queryFilter = tagFilter ? 
    `query: "${tagFilter}"` : 
    '';
  
  // Use pagination to fetch all products (100 at a time for maximum efficiency)
  while (hasNextPage) {
    pageCount++;
    const paginationQuery = cursor ? 
      `after: "${cursor}", first: 100, ${queryFilter}` :
      `first: 100, ${queryFilter}`;
    
    const query = `
      query GetProductsWithInventory {
        products(${paginationQuery}) {
          edges {
            cursor
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
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;
    
    try {
      const response = await admin.graphql(query);
      const pageData = await response.json();
      
      if (pageData.errors) {
        console.error("GraphQL errors:", pageData.errors);
        throw new Error(pageData.errors[0]?.message || "Error fetching products");
      }
      
      const pageEdges = pageData.data?.products?.edges || [];
      const pageInfo = pageData.data?.products?.pageInfo;
      
      // Process products from this page
      pageEdges.forEach(edge => {
        const product = edge.node;
        const variant = product.variants.edges[0]?.node;
        
        // Count for statistics
        productStats.total++;
        if (product.featuredImage) productStats.withImage++;
        if (variant) productStats.withVariant++;
        if (variant && variant.inventoryQuantity > 0) productStats.withInventory++;
        if (variant && variant.inventoryItem?.unitCost?.amount) productStats.withCost++;
        
        // Only add eligible products
        if (product.featuredImage && 
            variant && 
            variant.inventoryQuantity > 0) {
          productStats.eligible++;
          
          const price = parseFloat(variant.price);
          
          // If cost is missing, estimate it as 50% of the selling price
          const hasCost = variant.inventoryItem?.unitCost?.amount;
          const cost = hasCost 
            ? parseFloat(variant.inventoryItem.unitCost.amount)
            : price * 0.5; // Assume 50% cost if not available
          
          // Use the same currency code for cost and price if cost data is missing
          const currencyCode = variant.inventoryItem?.unitCost?.currencyCode || 'USD';
          
          allProducts.push({
            id: product.id,
            title: product.title,
            imageUrl: product.featuredImage.url,
            imageAlt: product.featuredImage.altText || product.title,
            cost: cost,
            sellingPrice: price,
            compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
            inventoryQuantity: variant.inventoryQuantity,
            variantId: variant.id,
            variantTitle: variant.title !== "Default Title" ? variant.title : null,
            currencyCode: currencyCode,
            hasCostData: !!hasCost // Flag to indicate if cost was provided or estimated
          });
        }
      });
      
      // Log progress to show activity during long fetches
      if (pageCount % 5 === 0 || pageCount === 1) {
        console.log(`Fetched ${allProducts.length} eligible products from ${productStats.total} total (page ${pageCount})`);
      }
      
      // Check if there are more pages
      hasNextPage = pageInfo?.hasNextPage || false;
      
      // Update cursor for next page if needed
      if (hasNextPage) {
        cursor = pageInfo.endCursor;
      }
    } catch (error) {
      console.error(`Error fetching products (page ${pageCount}):`, error);
      hasNextPage = false; // Stop pagination on error
      
      // If we failed on the first page, rethrow to signal complete failure
      if (pageCount === 1) {
        throw error;
      }
      
      // Otherwise, we'll just use what we have so far
      console.warn(`Stopping pagination early due to error. Using ${allProducts.length} products fetched so far.`);
    }
  }
  
  console.log(`Completed product fetch. Found ${allProducts.length} eligible products from ${productStats.total} total.`);
  console.log("Product statistics:", productStats);
  
  // Store in cache before returning
  const randomSelections = shuffleArray(allProducts).slice(0, 20); // Pre-compute top 20 random products
  productCache.store(allProducts, productStats, randomSelections, shopId);
  
  return { products: allProducts, stats: productStats };
}

/**
 * Get a number of randomly selected products for display
 * @param count Number of random products to select
 * @param admin Shopify Admin API client
 * @param shopId Current shop ID
 * @param forceRefresh Whether to force a cache refresh
 * @returns Array of randomly selected products
 */
export async function getRandomProducts(
  count: number,
  admin: any,
  shopId: string,
  forceRefresh: boolean = false
): Promise<{
  products: Product[];
  stats: ProductStats;
  cacheStatus: { isCached: boolean; cacheAge: number; cacheExpiry: number; productsCount: number; };
}> {
  // Check if we have cached random selections
  if (!forceRefresh && productCache.isValid(shopId)) {
    const randomSelections = productCache.getRandomSelections();
    const stats = productCache.getProductStats();
    
    if (randomSelections?.length && stats) {
      // Use cached random selections
      return {
        products: randomSelections.slice(0, count),
        stats,
        cacheStatus: productCache.getStatus()
      };
    }
  }
  
  // Fetch fresh data if cache is invalid or we need to refresh
  const { products, stats } = await fetchAllEligibleProducts(admin, shopId);
  
  // Get random products from the fetched data
  const shuffled = shuffleArray(products);
  const selectedProducts = shuffled.slice(0, count);
  
  return { 
    products: selectedProducts,
    stats,
    cacheStatus: productCache.getStatus()
  };
}

export default {
  fetchAllEligibleProducts,
  getRandomProducts
};
