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
    
    // Get all shops from the database
    const shops = await prisma.session.findMany({
      select: {
        shop: true
      },
      distinct: ['shop']
    });
    
    if (!shops || shops.length === 0) {
      return json({
        status: "error",
        message: "No shops found"
      });
    }
    
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
        try {
          const { admin } = await authenticate.admin(request, shop);
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
        
        } catch (adminError) {
          console.error(`[Auto-Discount] Error with admin API for shop ${shop}:`, adminError);
          throw adminError;
        }
        
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
