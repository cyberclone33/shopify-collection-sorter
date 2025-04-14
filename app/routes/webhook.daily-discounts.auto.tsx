import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { 
  getEligibleProducts, 
  getPreviousAutoDiscounts,
  revertPreviousDiscounts,
  generateRandomDiscount,
  applyDiscount
} from "../utils/autoDiscount.server";
import { authenticateWebhook } from "../utils/webhook-auth.server";
import prisma from "../db.server";

/**
 * Checks if a shop session has been invalidated and cleans up any associated data
 * @param shop - Shop domain
 */
async function cleanupInvalidatedShop(shop: string) {
  try {
    console.log(`[Auto-Discount] Cleaning up invalidated shop: ${shop}`);
    
    // Check if this is a 410 Gone error (app uninstalled)
    // We could mark the shop as inactive or delete its sessions
    
    // For now, just log that we would clean up this shop
    console.log(`[Auto-Discount] Shop ${shop} appears to have uninstalled the app. Cleanup would happen here.`);
    
    // Optionally, you could delete or mark sessions as invalid:
    // await prisma.session.updateMany({
    //   where: { shop },
    //   data: { invalid: true }
    // });
    
    return true;
  } catch (error) {
    console.error(`[Auto-Discount] Error cleaning up shop ${shop}:`, error);
    return false;
  }
}

/**
 * Webhook endpoint for triggering automated daily discounts
 * This can be called by n8n at 12:00 AM daily to rotate discounts
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    // Validate the webhook request
    const isAuthenticated = await authenticateWebhook(request);
    if (!isAuthenticated) {
      return json({ 
        status: "error", 
        message: "Unauthorized" 
      }, { status: 401 });
    }
    
    // Get all active shops from the database
    // Only get shops that have valid sessions (not expired)
    const shops = await prisma.session.findMany({
      where: {
        // Only include sessions that haven't expired or have no expiry
        OR: [
          { expires: { gt: new Date() } },
          { expires: null }
        ]
      },
      select: {
        shop: true,
        accessToken: true,
        expires: true
      },
      distinct: ['shop']
    });
    
    if (!shops || shops.length === 0) {
      console.log('[Auto-Discount] No active shops found with valid sessions');
      return json({
        status: "error",
        message: "No shops found with valid sessions"
      });
    }
    
    console.log(`[Auto-Discount] Found ${shops.length} active shops to process`);
    // Log some info about each shop's session
    shops.forEach(shop => {
      console.log(`[Auto-Discount] Shop: ${shop.shop}, Token: ${shop.accessToken ? 'Valid' : 'Missing'}, Expires: ${shop.expires || 'No expiry'}`);
    });
    
    const results = {
      total: shops.length,
      processed: 0,
      successful: 0,
      failed: 0,
      details: [] as any[]
    };
    
    // Process each shop
    for (const { shop } of shops) {
      try {
        console.log(`[Auto-Discount] Processing shop: ${shop}`);
        results.processed++;
        
        // Get the admin API context for this shop
        console.log(`[Auto-Discount] Getting admin API context for shop: ${shop}`);
        
        // Get the admin session
        let authResponse;
        try {
          authResponse = await authenticate.admin(request, shop);
          if (!authResponse || !authResponse.admin) {
            throw new Error(`Failed to get admin API context for shop: ${shop}`);
          }
        } catch (authError) {
          console.error(`[Auto-Discount] Authentication error for shop ${shop}:`, authError);
          
          // Check if it's a 410 Gone error (shop uninstalled or token revoked)
          const isGoneError = 
            authError.toString().includes("410") || 
            (authError.response && authError.response.status === 410);
          
          if (isGoneError) {
            // Try to clean up the invalidated shop
            await cleanupInvalidatedShop(shop);
            throw new Error(`Shop ${shop} appears to have uninstalled the app or revoked access (410 Gone)`);
          } else {
            throw new Error(`Authentication failed for shop ${shop}: ${authError.message || 'Unknown error'}`);
          }
        }
        
        const { admin } = authResponse;
        console.log(`[Auto-Discount] Successfully got admin API context for shop: ${shop}`);
        
        // Step 1: Find and revert previous auto-discounts
        try {
          console.log(`[Auto-Discount] Finding previous auto-discounts for shop: ${shop}`);
          const previousDiscounts = await getPreviousAutoDiscounts(shop);
          console.log(`[Auto-Discount] Found ${previousDiscounts.length} previous auto-discounts for shop: ${shop}`);
          
          console.log(`[Auto-Discount] Reverting previous discounts for shop: ${shop}`);
          const revertResults = await revertPreviousDiscounts(admin, shop, previousDiscounts);
          console.log(`[Auto-Discount] Revert results:`, JSON.stringify(revertResults));
        } catch (revertError) {
          console.error(`[Auto-Discount] Error reverting discounts:`, revertError);
        }
        
        // Step 2: Get eligible products
        console.log(`[Auto-Discount] Getting eligible products for shop: ${shop}`);
        let eligibleProductsResult;
        try {
          eligibleProductsResult = await getEligibleProducts(admin, shop, 6); // Get 6 products
        } catch (productsError) {
          console.error(`[Auto-Discount] Error getting eligible products:`, productsError);
          throw new Error(`Failed to get eligible products: ${productsError.message || 'Unknown error'}`);
        }
        
        console.log(`[Auto-Discount] Eligible products result:`, JSON.stringify(eligibleProductsResult));
        
        if (eligibleProductsResult.status === "error" || eligibleProductsResult.products.length === 0) {
          results.failed++;
          results.details.push({
            shop,
            status: "error",
            message: eligibleProductsResult.message || "No eligible products found",
            revertResults
          });
          continue;
        }
        
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
          const result = await applyDiscount(admin, shop, product, discount);
          
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
          shop,
          status: "success",
          revertResults,
          discountResults
        });
        

        
      } catch (shopError) {
        results.failed++;
        results.details.push({
          shop,
          status: "error",
          message: shopError instanceof Error ? shopError.message : "Unknown error processing shop",
          details: JSON.stringify(shopError)
        });
      }
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

// Handle unauthorized GET requests
export async function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}
