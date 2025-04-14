import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { 
  getEligibleProducts, 
  getPreviousAutoDiscounts,
  revertPreviousDiscounts,
  generateRandomDiscount,
  applyDiscount
} from "../utils/autoDiscount.server";
import prisma from "../db.server";

/**
 * API for manually triggering or checking automated discounts
 * GET: Check status of auto-discounts for the current shop
 * POST: Manually trigger auto-discounts for the current shop
 */

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  
  try {
    // Get previous auto-discounts for this shop
    const previousDiscounts = await getPreviousAutoDiscounts(shop);
    
    // Get summary of auto-discounts
    const lastDay = new Date();
    lastDay.setDate(lastDay.getDate() - 1);
    
    const countStats = await prisma.dailyDiscountLog.groupBy({
      by: ['notes'],
      where: {
        shop,
        isRandomDiscount: true,
        appliedAt: {
          gte: lastDay
        },
        notes: {
          contains: "Auto Discount"
        }
      },
      _count: {
        id: true
      }
    });
    
    const autoDiscountStats = {
      total: 0,
      applied: 0,
      reverted: 0
    };
    
    countStats.forEach(stat => {
      if (stat.notes.includes("Applied")) {
        autoDiscountStats.applied = stat._count.id;
      }
      if (stat.notes.includes("Reverted")) {
        autoDiscountStats.reverted = stat._count.id;
      }
      autoDiscountStats.total += stat._count.id;
    });
    
    // Get latest 10 auto-discount logs
    const recentLogs = await prisma.dailyDiscountLog.findMany({
      where: {
        shop,
        isRandomDiscount: true,
        notes: {
          contains: "Auto Discount"
        }
      },
      orderBy: {
        appliedAt: 'desc'
      },
      take: 10
    });
    
    return json({
      status: "success",
      stats: autoDiscountStats,
      currentDiscounts: previousDiscounts.filter(d => d.notes.includes("Applied")),
      recentLogs
    });
    
  } catch (error) {
    console.error("Error fetching auto-discount status:", error);
    return json({
      status: "error",
      message: error instanceof Error ? error.message : "An unknown error occurred",
    }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  
  try {
    // Get form data to see if we're doing a manual run
    const formData = await request.formData();
    const action = formData.get("action");
    
    if (action === "run_auto_discounts") {
      // Number of products to discount
      const countString = formData.get("count")?.toString();
      const count = countString ? parseInt(countString, 10) : 6;
      
      // Step 1: Find and revert previous auto-discounts
      const previousDiscounts = await getPreviousAutoDiscounts(shop);
      const revertResults = await revertPreviousDiscounts(admin, shop, previousDiscounts);
      
      // Step 2: Get eligible products
      const eligibleProductsResult = await getEligibleProducts(admin, shop, count);
      
      if (eligibleProductsResult.status === "error" || eligibleProductsResult.products.length === 0) {
        return json({
          status: "error",
          message: eligibleProductsResult.message || "No eligible products found",
          revertResults
        });
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
      
      return json({
        status: "success",
        message: `Applied discounts to ${discountResults.successful} products (${discountResults.failed} failed)`,
        revertResults,
        discountResults
      });
    }
    
    return json({
      status: "error",
      message: "Invalid action"
    }, { status: 400 });
    
  } catch (error) {
    console.error("Error in manual auto-discount run:", error);
    return json({
      status: "error",
      message: error instanceof Error ? error.message : "An unknown error occurred",
    }, { status: 500 });
  }
}
