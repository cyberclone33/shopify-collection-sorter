import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { 
  getEligibleProducts, 
  getPreviousAutoDiscounts,
  revertPreviousDiscounts,
  generateRandomDiscount,
  applyDiscount
} from "../utils/autoDiscount.server";
import { authenticateWebhook } from "../utils/webhook-auth.server";
import prisma from "../db.server";
import { Shopify } from "@shopify/shopify-api";

// Create a mock admin API context using the direct token
function createDirectAdminApiContext(shop: string) {
  const adminApiToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  
  if (!adminApiToken) {
    throw new Error("SHOPIFY_ADMIN_API_TOKEN environment variable is not defined");
  }
  
  // Create a direct admin API context
  return {
    graphql: async (query: string, options?: { variables?: any }) => {
      // If shop is provided as a parameter, use it; otherwise use the environment variable
      const shopifyDomain = shop;
      const url = `https://${shopifyDomain}/admin/api/2025-01/graphql.json`;
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': adminApiToken
          },
          body: JSON.stringify({
            query,
            variables: options?.variables
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`);
        }
        
        // Return an object with a json method to match the Shopify admin API context interface
        return {
          json: async () => {
            return await response.json();
          }
        };
      } catch (error) {
        console.error("Error in direct GraphQL call:", error);
        throw error;
      }
    },
    rest: {
      resources: {}
    }
  };
}

/**
 * Webhook endpoint for triggering automated daily discounts
 * This can be called by a cron job every 5 minutes to rotate discounts
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    // Validate the webhook request using the updated authenticateWebhook function
    const isAuthenticated = await authenticateWebhook(request);
    if (!isAuthenticated) {
      return json({ 
        status: "error", 
        message: "Unauthorized" 
      }, { status: 401 });
    }
    
    // Get the shop domain from request origin or environment variable
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop") || process.env.SHOPIFY_SHOP_DOMAIN || "alphapetstw.myshopify.com";
    
    console.log(`[Auto-Discount] Starting automatic discount run for shop domain: ${shopDomain}`);
    console.log(`[Auto-Discount] Request URL: ${request.url}`);
    console.log(`[Auto-Discount] Request method: ${request.method}`);
    console.log(`[Auto-Discount] Using admin token: ${process.env.SHOPIFY_ADMIN_API_TOKEN ? "Yes (masked)" : "Not found"}`);
    
    // Set up admin API context using direct token approach
    console.log(`[Auto-Discount] Processing shop: ${shopDomain}`);
    
    const results = {
      total: 1, // We're only processing one shop with direct token
      processed: 0,
      successful: 0,
      failed: 0,
      details: [] as any[]
    };
    
    try {
      results.processed++;
      
      // Create direct admin API context
      const adminApiContext = createDirectAdminApiContext(shopDomain);
      console.log(`[Auto-Discount] Created direct API context for shop: ${shopDomain}`);
      
      // Step 1: Find and revert previous auto-discounts
      try {
        console.log(`[Auto-Discount] Finding previous auto-discounts for shop: ${shopDomain}`);
        const previousDiscounts = await getPreviousAutoDiscounts(shopDomain);
        console.log(`[Auto-Discount] Found ${previousDiscounts.length} previous auto-discounts for shop: ${shopDomain}`);
        
        console.log(`[Auto-Discount] Reverting previous discounts for shop: ${shopDomain}`);
        const revertResults = await revertPreviousDiscounts(adminApiContext, shopDomain, previousDiscounts);
        console.log(`[Auto-Discount] Revert results:`, JSON.stringify(revertResults));
      } catch (revertError) {
        console.error(`[Auto-Discount] Error reverting discounts:`, revertError);
      }
      
      // Step 2: Get eligible products
      console.log(`[Auto-Discount] Getting eligible products for shop: ${shopDomain}`);
      let eligibleProductsResult;
      try {
        eligibleProductsResult = await getEligibleProducts(adminApiContext, shopDomain, 6); // Get 6 products
      } catch (productsError) {
        console.error(`[Auto-Discount] Error getting eligible products:`, productsError);
        throw new Error(`Failed to get eligible products: ${productsError.message || 'Unknown error'}`);
      }
      
      if (eligibleProductsResult.status === "error" || eligibleProductsResult.products.length === 0) {
        results.failed++;
        results.details.push({
          shop: shopDomain,
          status: "error",
          message: eligibleProductsResult.message || "No eligible products found"
        });
      } else {
        // Step 3: Apply discounts to new products
        const discountResults = {
          successful: 0,
          failed: 0,
          products: [] as any[]
        };
        
        for (const product of eligibleProductsResult.products) {
          // Generate a random discount for this product
          const discount = generateRandomDiscount(product);
          
          // Apply the discount
          const result = await applyDiscount(adminApiContext, shopDomain, product, discount);
          
          if (result.status === "success") {
            discountResults.successful++;
          } else {
            discountResults.failed++;
          }
          
          discountResults.products.push({
            product: product.title,
            discount: `${discount.discountPercentage}% (${discount.discountedPrice})`,
            status: result.status,
            message: result.message
          });
        }
        
        // Add to results
        if (discountResults.failed === 0 && discountResults.successful > 0) {
          results.successful++;
        } else {
          results.failed++;
        }
        
        results.details.push({
          shop: shopDomain,
          status: "success",
          discountResults
        });
      }
    } catch (error) {
      results.failed++;
      results.details.push({
        shop: shopDomain,
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error processing shop",
        details: JSON.stringify(error)
      });
    }
    
    // Log the run of the auto-discount process
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Automated daily discounts completed:`, {
      total: results.total,
      successful: results.successful,
      failed: results.failed
    });
    
    return json({
      status: "success",
      message: `Processed ${results.processed} shops: ${results.successful} successful, ${results.failed} failed`,
      results
    });
    
  } catch (error) {
    console.error("Error in daily discounts automation:", error);
    return json({
      status: "error",
      message: error instanceof Error ? error.message : "An unknown error occurred during automated discounting",
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}

// Handle GET requests - for testing without authentication
export async function loader({ request }: ActionFunctionArgs) {
  // Check if this is a testing/debug request with authentication
  const url = new URL(request.url);
  const isTest = url.searchParams.get("test") === "true";
  const apiToken = url.searchParams.get("apiToken");
  
  if (isTest && apiToken === process.env.SHOPIFY_ADMIN_API_TOKEN) {
    // Create a POST request to the same endpoint for testing
    const response = await fetch(request.url.replace('?test=true', ''), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Admin-API-Token': apiToken || ''
      }
    });
    
    return json(await response.json());
  }
  
  return json({ error: "Method not allowed" }, { status: 405 });
}
