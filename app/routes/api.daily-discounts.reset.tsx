import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * API endpoint to reset all discount logs
 * Truncates the DailyDiscountLog table and recreates it with the schema
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    // Only allow POST requests
    if (request.method !== "POST") {
      return json({
        status: "error",
        message: "Method not allowed"
      }, { status: 405 });
    }
    
    // Authenticate the request as admin
    const { session } = await authenticate.admin(request);
    
    // Get the shop from the session
    const shop = session.shop;
    
    // Parse the request body to check for confirmation and SQL option
    const body = await request.json();
    const { confirm, useSql } = body;
    
    // Require explicit confirmation
    if (!confirm || confirm !== "DELETE_ALL_DISCOUNT_LOGS") {
      return json({
        status: "error",
        message: "Missing or invalid confirmation token"
      }, { status: 400 });
    }
    
    let result;
    
    // Choose method based on the useSql flag
    if (useSql) {
      // Use raw SQL for a complete table reset (requires Prisma to support executeRaw)
      // This is more efficient but riskier as it completely recreates the table
      try {
        // Drop the table
        await prisma.$executeRaw`DROP TABLE IF EXISTS "DailyDiscountLog"`;
        
        // Recreate the table with the schema
        await prisma.$executeRaw`
          CREATE TABLE IF NOT EXISTS "DailyDiscountLog" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "shop" TEXT NOT NULL,
            "productId" TEXT NOT NULL,
            "productTitle" TEXT NOT NULL,
            "variantId" TEXT NOT NULL,
            "variantTitle" TEXT,
            "originalPrice" REAL NOT NULL,
            "discountedPrice" REAL NOT NULL,
            "compareAtPrice" REAL,
            "costPrice" REAL,
            "profitMargin" REAL,
            "discountPercentage" REAL NOT NULL,
            "savingsAmount" REAL NOT NULL,
            "savingsPercentage" REAL NOT NULL,
            "currencyCode" TEXT NOT NULL DEFAULT 'USD',
            "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "appliedByUserId" TEXT,
            "imageUrl" TEXT,
            "inventoryQuantity" INTEGER,
            "isRandomDiscount" BOOLEAN NOT NULL DEFAULT true,
            "notes" TEXT
          )
        `;
        
        // Recreate the indexes
        await prisma.$executeRaw`CREATE INDEX "DailyDiscountLog_shop_idx" ON "DailyDiscountLog"("shop")`;
        await prisma.$executeRaw`CREATE INDEX "DailyDiscountLog_variantId_idx" ON "DailyDiscountLog"("variantId")`;
        await prisma.$executeRaw`CREATE INDEX "DailyDiscountLog_appliedAt_idx" ON "DailyDiscountLog"("appliedAt")`;
        
        result = {
          method: "SQL",
          message: "Successfully dropped and recreated the DailyDiscountLog table"
        };
      } catch (sqlError) {
        console.error("Error executing raw SQL:", sqlError);
        
        // Fall back to the safer method if SQL fails
        const deleteCount = await prisma.dailyDiscountLog.deleteMany({
          where: { shop }
        });
        
        result = {
          method: "Prisma (fallback)",
          message: `SQL execution failed, used Prisma instead. Deleted ${deleteCount.count} discount logs for shop ${shop}`
        };
      }
    } else {
      // Use Prisma's deleteMany for a safer approach
      // This keeps the table structure intact and only deletes rows for the current shop
      const deleteCount = await prisma.dailyDiscountLog.deleteMany({
        where: { shop }
      });
      
      result = {
        method: "Prisma",
        message: `Deleted ${deleteCount.count} discount logs for shop ${shop}`
      };
    }
    
    // Log this significant action
    console.log(`[${new Date().toISOString()}] RESET DISCOUNT LOGS: Shop ${shop}, Method: ${result.method}`);
    
    return json({
      status: "success",
      ...result
    });
    
  } catch (error) {
    console.error("Error resetting discount logs:", error);
    return json({
      status: "error",
      message: error instanceof Error ? error.message : "An unknown error occurred"
    }, { status: 500 });
  }
}
