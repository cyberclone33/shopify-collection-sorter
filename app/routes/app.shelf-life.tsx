import { useState, useCallback, useEffect, useRef } from "react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useSubmit, useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DropZone,
  BlockStack,
  Thumbnail,
  Text,
  Banner,
  Button,
  PageActions,
  InlineStack,
  Box,
  DataTable,
  EmptyState,
  Spinner,
  Tabs,
  ButtonGroup,
  Toast,
  Frame,
  Modal,
  List,
  Popover,
  ActionList,
  Loading,
  Icon,
  ContextualSaveBar,
  Tooltip
} from "@shopify/polaris";
import { NoteIcon, RefreshIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { processCSVFile, getAllShelfLifeItems, syncWithShopify } from "../utils/shelf-life.server";
import prisma from "../db.server";
import iconv from "iconv-lite";

// Define the ShelfLifeItem interface
interface ShelfLifeItem {
  id: string;
  shop: string;
  productId: string;
  batchId: string;
  expirationDate: Date | string;
  quantity: number;
  batchQuantity?: number | null;
  location: string | null;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  shopifyProductTitle: string | null;
  shopifyVariantTitle: string | null;
  variantPrice: number | null;
  variantCost: number | null;
  currencyCode: string | null;
  syncStatus: string | null;
  syncMessage: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

// Define the ShelfLifeItemPriceChange interface
interface ShelfLifeItemPriceChange {
  id: string;
  shop: string;
  shelfLifeItemId: string;
  shopifyVariantId: string;
  originalPrice: number;
  originalCompareAtPrice: number | null;
  newPrice: number;
  newCompareAtPrice: number;
  currencyCode: string | null;
  appliedAt: Date | string;
  appliedByUserId: string | null;
  appliedByUserName: string | null;
  status: string;
  notes: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  
  // Fetch all shelf life items
  const shelfLifeItems: ShelfLifeItem[] = await getAllShelfLifeItems(shop);
  
  // Fetch all price changes for this shop
  let priceChanges: ShelfLifeItemPriceChange[] = [];
  try {
    // Use raw SQL since we had Prisma compatibility issues
    const rawPriceChanges = await prisma.$queryRawUnsafe(`
      SELECT * FROM "ShelfLifeItemPriceChange"
      WHERE "shop" = ?
      ORDER BY "appliedAt" DESC
    `, shop);
    
    priceChanges = Array.isArray(rawPriceChanges) ? rawPriceChanges : [];
    
    // Map variant IDs to price change records for quick lookup
    const priceChangesByVariantId = new Map<string, ShelfLifeItemPriceChange[]>();
    
    priceChanges.forEach(change => {
      if (!priceChangesByVariantId.has(change.shopifyVariantId)) {
        priceChangesByVariantId.set(change.shopifyVariantId, []);
      }
      priceChangesByVariantId.get(change.shopifyVariantId)?.push(change);
    });
    
    // Attach most recent price change to each shelf life item
    for (const item of shelfLifeItems) {
      if (item.shopifyVariantId) {
        const itemPriceChanges = priceChangesByVariantId.get(item.shopifyVariantId) || [];
        // Sort by appliedAt in descending order (most recent first)
        itemPriceChanges.sort((a, b) => 
          new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime()
        );
        
        // Attach the most recent price change if available
        if (itemPriceChanges.length > 0) {
          (item as any).latestPriceChange = itemPriceChanges[0];
        }
      }
    }
  } catch (error) {
    console.error("Error fetching price changes:", error);
  }
  
  return json({
    shelfLifeItems,
    priceChanges
  });
};

interface ActionData {
  status: string;
  message: string;
  filename?: string;
  size?: number;
  savedCount?: number;
  errors?: string[];
  syncResult?: {
    success: boolean;
    matchedCount: number;
    message: string;
    unmatchedItems?: Array<{
      productId: string;
      reason: string;
    }>;
  };
  deletedCount?: number;
  discountResult?: {
    success: boolean;
    itemsDiscounted: number;
    totalItems: number;
    message: string;
    errors?: Array<{
      productId: string;
      reason: string;
    }>;
  };
  revertDiscountResult?: {
    success: boolean;
    itemsReverted: number;
    totalItems: number;
    message: string;
    errors?: Array<{
      productId: string;
      reason: string;
    }>;
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  
  const formData = await request.formData();
  const action = formData.get("action");
  
  if (action === "sync") {
    try {
      const syncResult = await syncWithShopify(shop, admin);
      
      return json<ActionData>({
        status: syncResult.success ? "success" : "error",
        message: syncResult.message,
        syncResult
      });
    } catch (error) {
      console.error("Error syncing with Shopify:", error);
      return json<ActionData>({
        status: "error",
        message: `Error syncing with Shopify: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  
  // Handle updating sale price (and setting current price as compare-at price)
  if (action === "updateCompareAtPrice") {
    try {
      const variantId = formData.get("variantId");
      const compareAtPrice = formData.get("compareAtPrice");
      
      if (!variantId) {
        return json<ActionData>({ 
          status: "error", 
          message: "Variant ID is required for updating sale price" 
        });
      }
      
      if (!compareAtPrice) {
        return json<ActionData>({ 
          status: "error", 
          message: "Price is required" 
        });
      }
      
      // Parse sale price as float
      const compareAtPriceFloat = parseFloat(compareAtPrice.toString());
      
      if (isNaN(compareAtPriceFloat)) {
        return json<ActionData>({ 
          status: "error", 
          message: "Price must be a valid number" 
        });
      }
      
      console.log(`Using GraphQL productVariantsBulkUpdate to update variant ${variantId} price to ${compareAtPriceFloat}`);
      
      try {
        // First, we need to look up the product ID and current price from the database
        // Get all shelf life items from the database for this shop
        const shelfLifeItemsFromDb = await prisma.shelfLifeItem.findMany({
          where: { shop: session.shop }
        });
        
        console.log(`Found ${shelfLifeItemsFromDb.length} shelf life items in database`);
        
        // Find the item with matching variant ID
        const item = shelfLifeItemsFromDb.find(item => item.shopifyVariantId === variantId);
        const productId = item?.shopifyProductId;
        const currentPrice = item?.variantPrice;
        
        if (!productId) {
          console.error(`Cannot find product ID for variant ${variantId}`);
          return json<ActionData>({
            status: "error",
            message: "Cannot find product ID for this variant"
          });
        }
        
        if (!currentPrice) {
          console.error(`Cannot find current price for variant ${variantId}`);
          return json<ActionData>({
            status: "error",
            message: "Cannot find current price for this variant"
          });
        }
        
        console.log(`Found corresponding product ID: ${productId} for variant: ${variantId}`);
        console.log(`Current price: ${currentPrice}, updating to: ${compareAtPriceFloat}`);
        
        // Determine the price values to use for the update
        const newPriceValue = compareAtPriceFloat.toFixed(2);
        
        // Determine what to do with the Compare At price
        let compareAtPriceValue = null;
        if (formData.get("newCompareAtPrice")) {
          // Use the explicitly provided Compare At price
          compareAtPriceValue = parseFloat(formData.get("newCompareAtPrice")!.toString()).toFixed(2);
        } else {
          // Check if there's an existing Compare At price in the latest price change
          const priceChangesFromDb = await prisma.$queryRawUnsafe(`
            SELECT * FROM "ShelfLifeItemPriceChange"
            WHERE "shopifyVariantId" = ?
            ORDER BY "appliedAt" DESC
            LIMIT 1
          `, variantId);
          
          if (Array.isArray(priceChangesFromDb) && priceChangesFromDb.length > 0 && 
              priceChangesFromDb[0].newCompareAtPrice) {
            compareAtPriceValue = priceChangesFromDb[0].newCompareAtPrice.toFixed(2);
          }
        }
        
        // Build the variant input based on what values we have
        const variantInput: any = {
          id: variantId,
          price: newPriceValue
        };
        
        // Only include compareAtPrice if we have a value for it
        if (compareAtPriceValue !== null) {
          variantInput.compareAtPrice = compareAtPriceValue;
        }
        
        // Use the productVariantsBulkUpdate with the correct productId parameter
        const response = await admin.graphql(
          `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              productVariants {
                id
                title
                price
                compareAtPrice
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              productId: productId,
              variants: [variantInput]
            }
          }
        );
        
        const responseJson = await response.json();
        
        if (responseJson.errors) {
          console.error("GraphQL errors:", responseJson.errors);
          return json<ActionData>({
            status: "error",
            message: `Error updating compare at price: ${responseJson.errors[0]?.message || "Unknown GraphQL error"}`
          });
        }
        
        const result = responseJson.data?.productVariantsBulkUpdate;
        
        if (result?.userErrors?.length > 0) {
          console.error("GraphQL user errors:", result.userErrors);
          return json<ActionData>({
            status: "error",
            message: `Error updating compare at price: ${result.userErrors[0].message}`
          });
        }
        
        // Record the price change
        try {
          // Generate a unique ID for the price change record
          const priceChangeId = `cuid-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
          
          console.log("Attempting to insert price change record with:", {
            priceChangeId,
            shop: session.shop,
            itemId: item.id,
            variantId,
            currentPrice,
            newPrice: compareAtPriceFloat,
            currencyCode: item.currencyCode || "USD"
          });
          
          // Get the current compareAtPrice value from the database or previous price changes
          let currentCompareAtPrice = null;
          const priceChangesFromDb = await prisma.$queryRawUnsafe(`
            SELECT * FROM "ShelfLifeItemPriceChange"
            WHERE "shopifyVariantId" = ?
            ORDER BY "appliedAt" DESC
            LIMIT 1
          `, variantId);
          
          if (Array.isArray(priceChangesFromDb) && priceChangesFromDb.length > 0) {
            currentCompareAtPrice = priceChangesFromDb[0].newCompareAtPrice;
          }
          
          // Determine what to use for the new Compare At price
          const newCompareAtPrice = formData.get("newCompareAtPrice")
            ? parseFloat(formData.get("newCompareAtPrice")!.toString())
            : currentCompareAtPrice !== null ? currentCompareAtPrice : currentPrice;
          
          // Use Prisma's create method instead of raw SQL for more reliable insertion
          try {
            // Try to use Prisma's built-in methods first (much more reliable)
            await prisma.$executeRaw`
              INSERT INTO "ShelfLifeItemPriceChange" (
                "id", 
                "shop", 
                "shelfLifeItemId", 
                "shopifyVariantId", 
                "originalPrice", 
                "originalCompareAtPrice", 
                "newPrice", 
                "newCompareAtPrice", 
                "currencyCode", 
                "appliedAt", 
                "status"
              ) VALUES (
                ${priceChangeId},
                ${session.shop},
                ${item.id},
                ${variantId},
                ${currentPrice},
                ${currentCompareAtPrice},
                ${compareAtPriceFloat},
                ${newCompareAtPrice},
                ${item.currencyCode || "USD"},
                ${new Date().toISOString()},
                'APPLIED'
              )
            `;
            
            console.log(`Successfully recorded price change with ID: ${priceChangeId}`);
          } catch (prismaError) {
            console.error("Failed with Prisma insertion, trying raw SQL as fallback:", prismaError);
            
            // Fallback to the previous method with the same values
            await prisma.$executeRawUnsafe(`
              INSERT INTO "ShelfLifeItemPriceChange" (
                "id", 
                "shop", 
                "shelfLifeItemId", 
                "shopifyVariantId", 
                "originalPrice", 
                "originalCompareAtPrice", 
                "newPrice", 
                "newCompareAtPrice", 
                "currencyCode", 
                "appliedAt", 
                "status"
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, 
              priceChangeId,
              session.shop,
              item.id,
              variantId,
              currentPrice,
              currentCompareAtPrice,
              compareAtPriceFloat,
              newCompareAtPrice,
              item.currencyCode || "USD",
              new Date().toISOString(),
              "APPLIED"
            );
            
            console.log(`Recorded price change with ID (fallback method): ${priceChangeId}`);
          }
        } catch (dbError) {
          console.error("Failed to record price change (outer catch):", dbError);
          console.error("Error details:", JSON.stringify(dbError, null, 2));
          // Continue anyway as the Shopify update was successful
        }
        
        console.log("Successfully updated variant sale price with GraphQL");
        return json<ActionData>({
          status: "success",
          message: `Price updated successfully to ${compareAtPriceFloat}`
        });
      } catch (error) {
        console.error("GraphQL exception:", error);
        return json<ActionData>({
          status: "error",
          message: `Error updating compare at price: ${error instanceof Error ? error.message : String(error)}`
        });
      }
      
    } catch (error) {
      console.error("Error updating compare at price:", error);
      return json<ActionData>({
        status: "error",
        message: `Error updating compare at price: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  
  // Handle item deletion
  if (action === "delete") {
    try {
      const id = formData.get("id");
      
      if (!id) {
        return json<ActionData>({ 
          status: "error", 
          message: "Item ID is required for deletion" 
        });
      }
      
      await prisma.shelfLifeItem.delete({
        where: { id: id.toString() }
      });
      
      return json<ActionData>({
        status: "success",
        message: "Item deleted successfully"
      });
    } catch (error) {
      console.error("Error deleting item:", error);
      return json<ActionData>({
        status: "error",
        message: `Error deleting item: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  
  // Handle bulk deletion
  if (action === "bulkDelete") {
    try {
      const idsString = formData.get("ids");
      
      if (!idsString) {
        return json<ActionData>({ 
          status: "error", 
          message: "Item IDs are required for bulk deletion" 
        });
      }
      
      const ids = idsString.toString().split(",");
      
      await prisma.shelfLifeItem.deleteMany({
        where: {
          id: {
            in: ids
          },
          shop // Ensure we only delete items for this shop
        }
      });
      
      return json<ActionData>({
        status: "success",
        message: `${ids.length} items deleted successfully`
      });
    } catch (error) {
      console.error("Error deleting items:", error);
      return json<ActionData>({
        status: "error",
        message: `Error deleting items: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  
  // Handle delete all items
  if (action === "deleteAll") {
    try {
      // In the short term, just get all item IDs and delete them individually
      // This will use Prisma's onDelete behavior correctly
      const items = await prisma.shelfLifeItem.findMany({
        where: { shop },
        select: { id: true }
      });
      
      console.log(`Found ${items.length} items to delete`);
      
      // Delete items one by one (this is slower but more reliable)
      let deletedCount = 0;
      for (const item of items) {
        await prisma.shelfLifeItem.delete({
          where: { id: item.id }
        });
        deletedCount++;
      }
      
      console.log(`Deleted ${deletedCount} items individually`);
      
      return json<ActionData>({
        status: "success",
        message: `${deletedCount} items deleted successfully (price change history preserved)`
      });
    } catch (error) {
      console.error("Error deleting all items:", error);
      return json<ActionData>({
        status: "error",
        message: `Error deleting all items: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  
  // Handle automatic discounts based on expiration date
  if (action === "applyAutomaticDiscounts") {
    try {
      console.log("Applying automatic discounts based on expiration date");
      
      // Get all shelf life items that are synced with Shopify
      const items = await prisma.shelfLifeItem.findMany({
        where: { 
          shop,
          syncStatus: "MATCHED",
          shopifyVariantId: { not: null },
          shopifyProductId: { not: null },
          variantPrice: { not: null },
          variantCost: { not: null }
        }
      });
      
      console.log(`Found ${items.length} valid items for potential discounting`);
      
      // Track successful and failed updates
      let discountedItems = 0;
      const errors: Array<{ productId: string; reason: string }> = [];
      
      // Process each item
      for (const item of items) {
        try {
          if (!item.shopifyProductId || !item.shopifyVariantId || 
              item.variantPrice === null || item.variantCost === null) {
            errors.push({
              productId: item.productId,
              reason: "Missing required data (product ID, variant ID, price, or cost)"
            });
            continue;
          }
          
          // Calculate days until expiration
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          const expirationDate = new Date(item.expirationDate);
          expirationDate.setHours(0, 0, 0, 0);
          
          const diffTime = expirationDate.getTime() - today.getTime();
          const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          console.log(`Item ${item.productId} has ${daysLeft} days until expiration`);
          
          // Skip items that aren't expiring soon
          if (daysLeft > 180) {
            continue;
          }
          
          // Calculate margin and discount percentage
          const margin = item.variantPrice - item.variantCost;
          let marginPercentToKeep = 0.8; // Default: keep 80% (180+ days)
          let discountReason = "180_DAYS_LEFT";
          
          if (daysLeft <= 30) {
            marginPercentToKeep = 0.1; // Keep 10% (30 days or less)
            discountReason = "30_DAYS_LEFT";
          } else if (daysLeft <= 60) {
            marginPercentToKeep = 0.35; // Keep 35% (60 days or less)
            discountReason = "60_DAYS_LEFT";
          } else if (daysLeft <= 90) {
            marginPercentToKeep = 0.6; // Keep 60% (90 days or less)
            discountReason = "90_DAYS_LEFT";
          } else if (daysLeft <= 180) {
            marginPercentToKeep = 0.8; // Keep 80% (180 days or less)
            discountReason = "180_DAYS_LEFT";
          }
          
          // Calculate new price
          const newPrice = item.variantCost + (margin * marginPercentToKeep);
          const roundedNewPrice = Math.ceil(newPrice); // Round up to whole number
          
          console.log(`
            Item: ${item.productId}
            Original Price: ${item.variantPrice}
            Cost: ${item.variantCost}
            Margin: ${margin}
            Days Left: ${daysLeft}
            Keep: ${marginPercentToKeep * 100}%
            New Price: ${roundedNewPrice}
          `);
          
          // Skip if the discounted price is the same as current price
          if (roundedNewPrice === item.variantPrice) {
            console.log(`Skipping item ${item.productId} as new price equals current price`);
            continue;
          }
          
          // Update price in Shopify
          const variantInput = {
            id: item.shopifyVariantId,
            price: roundedNewPrice.toFixed(2),
            compareAtPrice: item.variantPrice.toFixed(2) // Set original price as compareAt
          };
          
          // Use the productVariantsBulkUpdate with the correct productId parameter
          const response = await admin.graphql(
            `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                productVariants {
                  id
                  title
                  price
                  compareAtPrice
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
              variables: {
                productId: item.shopifyProductId,
                variants: [variantInput]
              }
            }
          );
          
          const responseJson = await response.json();
          
          if (responseJson.errors || responseJson.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
            const errorMessage = responseJson.errors?.[0]?.message || 
                               responseJson.data?.productVariantsBulkUpdate?.userErrors?.[0]?.message || 
                               "Unknown GraphQL error";
                               
            errors.push({
              productId: item.productId,
              reason: `GraphQL error: ${errorMessage}`
            });
            continue;
          }
          
          // Record the price change in the database
          const priceChangeId = `cuid-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
          
          await prisma.$executeRaw`
            INSERT INTO "ShelfLifeItemPriceChange" (
              "id", 
              "shop", 
              "shelfLifeItemId", 
              "shopifyVariantId", 
              "originalPrice", 
              "originalCompareAtPrice", 
              "newPrice", 
              "newCompareAtPrice", 
              "currencyCode", 
              "appliedAt", 
              "status",
              "notes"
            ) VALUES (
              ${priceChangeId},
              ${shop},
              ${item.id},
              ${item.shopifyVariantId},
              ${item.variantPrice},
              ${null},
              ${roundedNewPrice},
              ${item.variantPrice},
              ${item.currencyCode || "TWD"},
              ${new Date().toISOString()},
              'APPLIED',
              ${`Automatic discount: ${discountReason}, ${Math.round((1 - marginPercentToKeep) * 100)}% margin discount`}
            )
          `;
          
          discountedItems++;
          
        } catch (itemError) {
          console.error(`Error processing item ${item.productId}:`, itemError);
          errors.push({
            productId: item.productId,
            reason: itemError instanceof Error ? itemError.message : String(itemError)
          });
        }
      }
      
      const message = discountedItems > 0 
        ? `Successfully applied automatic discounts to ${discountedItems} items based on expiration date.` 
        : "No items were discounted. Items may not meet discount criteria or already have discounts applied.";
      
      return json<ActionData>({
        status: errors.length > 0 ? "warning" : "success",
        message,
        discountResult: {
          success: true,
          itemsDiscounted: discountedItems,
          totalItems: items.length,
          message,
          errors: errors.length > 0 ? errors : undefined
        }
      });
      
    } catch (error) {
      console.error("Error applying automatic discounts:", error);
      return json<ActionData>({
        status: "error",
        message: `Error applying automatic discounts: ${error instanceof Error ? error.message : String(error)}`,
        discountResult: {
          success: false,
          itemsDiscounted: 0,
          totalItems: 0,
          message: `Error applying automatic discounts: ${error instanceof Error ? error.message : String(error)}`
        }
      });
    }
  }
  
  // Handle reverting automatic discounts
  if (action === "revertAutomaticDiscounts") {
    try {
      console.log("Reverting automatic discounts");
      
      // Get all price changes that were applied as automatic discounts
      const priceChanges = await prisma.$queryRaw`
        SELECT pc.*, si.shopifyProductId, si.productId
        FROM "ShelfLifeItemPriceChange" pc
        JOIN "ShelfLifeItem" si ON pc."shelfLifeItemId" = si.id
        WHERE pc.shop = ${shop}
        AND pc.notes LIKE '%Automatic discount%'
        AND pc.status = 'APPLIED'
        ORDER BY pc."appliedAt" DESC
      `;
      
      // Get unique variant IDs (most recent first to prioritize newer discounts)
      const variantMap = new Map();
      
      if (Array.isArray(priceChanges)) {
        priceChanges.forEach(change => {
          // Only add variant if not already in map (so we only get the most recent)
          if (!variantMap.has(change.shopifyVariantId)) {
            variantMap.set(change.shopifyVariantId, change);
          }
        });
      }
      
      console.log(`Found ${variantMap.size} automatically discounted variants to revert`);
      
      // Track successful and failed updates
      let revertedItems = 0;
      const errors: Array<{ productId: string; reason: string }> = [];
      
      // Process each variant
      for (const [variantId, change] of variantMap.entries()) {
        try {
          if (!change.shopifyProductId) {
            errors.push({
              productId: change.productId || variantId,
              reason: "Missing Shopify product ID"
            });
            continue;
          }
          
          console.log(`
            Reverting discount for:
            Product ID: ${change.productId}
            Variant ID: ${variantId}
            Current Price: ${change.newPrice}
            Original Price: ${change.originalPrice}
          `);
          
          // Revert price to original (pre-discount) price
          const variantInput = {
            id: variantId,
            price: change.originalPrice.toFixed(2),
            compareAtPrice: null // Remove Compare At price
          };
          
          // Use the productVariantsBulkUpdate with the correct productId parameter
          const response = await admin.graphql(
            `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                productVariants {
                  id
                  title
                  price
                  compareAtPrice
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
              variables: {
                productId: change.shopifyProductId,
                variants: [variantInput]
              }
            }
          );
          
          const responseJson = await response.json();
          
          if (responseJson.errors || responseJson.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
            const errorMessage = responseJson.errors?.[0]?.message || 
                               responseJson.data?.productVariantsBulkUpdate?.userErrors?.[0]?.message || 
                               "Unknown GraphQL error";
                               
            errors.push({
              productId: change.productId || variantId,
              reason: `GraphQL error: ${errorMessage}`
            });
            continue;
          }
          
          // Record the price reversion in the database
          const priceChangeId = `cuid-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
          
          await prisma.$executeRaw`
            INSERT INTO "ShelfLifeItemPriceChange" (
              "id", 
              "shop", 
              "shelfLifeItemId", 
              "shopifyVariantId", 
              "originalPrice", 
              "originalCompareAtPrice", 
              "newPrice", 
              "newCompareAtPrice", 
              "currencyCode", 
              "appliedAt", 
              "status",
              "notes"
            ) VALUES (
              ${priceChangeId},
              ${shop},
              ${change.shelfLifeItemId},
              ${variantId},
              ${change.newPrice},
              ${change.newCompareAtPrice},
              ${change.originalPrice},
              ${null},
              ${change.currencyCode || "TWD"},
              ${new Date().toISOString()},
              'APPLIED',
              ${'Reverted automatic discount'}
            )
          `;
          
          // Update status of all previous discounts for this variant to show they've been reverted
          await prisma.$executeRaw`
            UPDATE "ShelfLifeItemPriceChange"
            SET status = 'REVERTED'
            WHERE shop = ${shop}
            AND shopifyVariantId = ${variantId}
            AND notes LIKE '%Automatic discount%'
            AND id != ${priceChangeId}
          `;
          
          revertedItems++;
          
        } catch (itemError) {
          console.error(`Error reverting discount for ${change.productId || variantId}:`, itemError);
          errors.push({
            productId: change.productId || variantId,
            reason: itemError instanceof Error ? itemError.message : String(itemError)
          });
        }
      }
      
      const message = revertedItems > 0 
        ? `Successfully reverted automatic discounts for ${revertedItems} items.` 
        : "No automatic discounts were found to revert.";
      
      return json<ActionData>({
        status: errors.length > 0 ? "warning" : "success",
        message,
        revertDiscountResult: {
          success: true,
          itemsReverted: revertedItems,
          totalItems: variantMap.size,
          message,
          errors: errors.length > 0 ? errors : undefined
        }
      });
      
    } catch (error) {
      console.error("Error reverting automatic discounts:", error);
      return json<ActionData>({
        status: "error",
        message: `Error reverting automatic discounts: ${error instanceof Error ? error.message : String(error)}`,
        revertDiscountResult: {
          success: false,
          itemsReverted: 0,
          totalItems: 0,
          message: `Error reverting automatic discounts: ${error instanceof Error ? error.message : String(error)}`
        }
      });
    }
  }
  
  // Handle CSV upload
  const file = formData.get("file");
  
  if (!file || !(file instanceof File)) {
    return json<ActionData>({ status: "error", message: "No file uploaded" });
  }
  
  try {
    // Read the file content as ArrayBuffer to handle different encodings
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Try to convert from Big5 to UTF-8 using iconv-lite
    // This will handle Traditional Chinese characters properly
    let fileContent;
    try {
      fileContent = iconv.decode(buffer, 'big5');
    } catch (encodingError) {
      console.warn("Failed to decode as Big5, falling back to UTF-8:", encodingError);
      fileContent = iconv.decode(buffer, 'utf8');
    }
    
    // Process the CSV file
    const result = await processCSVFile(fileContent, shop);
    
    if (result.errors.length > 0) {
      return json<ActionData>({
        status: "warning",
        message: `File processed with ${result.errors.length} errors`,
        filename: file.name,
        size: file.size,
        savedCount: result.savedCount,
        errors: result.errors
      });
    }
    
    return json<ActionData>({
      status: "success",
      message: `File processed successfully. ${result.savedCount} items saved.`,
      filename: file.name,
      size: file.size,
      savedCount: result.savedCount
    });
  } catch (error) {
    console.error("Error processing file:", error);
    return json<ActionData>({
      status: "error",
      message: `Error processing file: ${error instanceof Error ? error.message : String(error)}`
    });
  }
};

export default function ShelfLifeManagement() {
  const [file, setFile] = useState<File | null>(null);
  const [rejectedFiles, setRejectedFiles] = useState<File[]>([]);
  const [selectedTab, setSelectedTab] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [toastActive, setToastActive] = useState(false);
  const [toastContent, setToastContent] = useState({ message: "", tone: "success" });
  const [syncResultModalActive, setSyncResultModalActive] = useState(false);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDeleteModalActive, setConfirmDeleteModalActive] = useState(false);
  const [confirmDeleteAllModalActive, setConfirmDeleteAllModalActive] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [actionsPopoverActive, setActionsPopoverActive] = useState(false);
  const [compareAtPrices, setCompareAtPrices] = useState<Record<string, string>>({});
  const [newCompareAtPrices, setNewCompareAtPrices] = useState<Record<string, string>>({});
  const [updatingVariantId, setUpdatingVariantId] = useState<string | null>(null);
  const [updatedVariants, setUpdatedVariants] = useState<Record<string, { 
    timestamp: number, 
    newPrice: string, 
    newCompareAtPrice: string | null 
  }>>({});
  const [selectedPriceHistory, setSelectedPriceHistory] = useState<{ itemId: string, variantId: string } | null>(null);
  const [priceHistoryModalActive, setPriceHistoryModalActive] = useState(false);
  const [hideZeroQuantity, setHideZeroQuantity] = useState(false);
  const [isApplyingDiscounts, setIsApplyingDiscounts] = useState(false);
  const [isRevertingDiscounts, setIsRevertingDiscounts] = useState(false);
  const [autoDiscountModalActive, setAutoDiscountModalActive] = useState(false);
  const [revertDiscountModalActive, setRevertDiscountModalActive] = useState(false);
  const [discountResults, setDiscountResults] = useState<{ 
    success: boolean, 
    message: string, 
    itemsDiscounted: number,
    totalItems: number
  } | null>(null);
  const [revertDiscountResults, setRevertDiscountResults] = useState<{ 
    success: boolean, 
    message: string, 
    itemsReverted: number,
    totalItems: number
  } | null>(null);
  
  const actionData = useActionData<ActionData>();
  const { shelfLifeItems } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const deleteFormRef = useRef<HTMLFormElement>(null);

  // Handle toast and modal when action data changes
  useEffect(() => {
    if (actionData) {
      setToastActive(true);
      setToastContent({
        message: actionData.message,
        tone: actionData.status === "success" ? "success" : "critical"
      });
      
      // Handle sync results
      if (actionData.syncResult) {
        // Set progress to 100% before stopping
        setSyncProgress(100);
        
        // Delay the completion to show 100% progress
        setTimeout(() => {
          setIsSyncing(false);
          
          // If there are unmatched items, show the modal
          if (actionData.syncResult.unmatchedItems && actionData.syncResult.unmatchedItems.length > 0) {
            setSyncResultModalActive(true);
          }
          
          // Clear the updated variants tracker since we've synced
          setUpdatedVariants({});
        }, 500);
      }
      
      // Handle discount results
      if (actionData.discountResult) {
        setIsApplyingDiscounts(false);
        setDiscountResults(actionData.discountResult);
      }
      
      // Handle revert discount results
      if (actionData.revertDiscountResult) {
        setIsRevertingDiscounts(false);
        setRevertDiscountResults(actionData.revertDiscountResult);
      }
      
      // Handle file upload completion
      if (actionData.filename) {
        setIsUploading(false);
        
        // If CSV upload was successful, switch to inventory tab
        if (actionData.status === "success") {
          setTimeout(() => setSelectedTab(1), 1500);
        }
      }
      
      // Reset states if action succeeded
      if (actionData.status === "success") {
        if (isDeleting) {
          setIsDeleting(false);
          setSelectedItems([]);
          setItemToDelete(null);
        }
        
        if (updatingVariantId) {
          // Store the updated price for visual tracking
          const priceValue = compareAtPrices[updatingVariantId] || '';
          const compareAtValue = newCompareAtPrices[updatingVariantId] || '';
          
          // Update the variants with both price and compareAt values
          setUpdatedVariants(prev => ({
            ...prev,
            [updatingVariantId]: {
              timestamp: Date.now(),
              newPrice: priceValue,
              newCompareAtPrice: compareAtValue || null
            }
          }));
          
          // Immediately find and update the item in the shelfLifeItems array
          const updatedItem = shelfLifeItems.find(item => item.shopifyVariantId === updatingVariantId);
          if (updatedItem) {
            // Always ensure we have a valid variantPrice, even if it's the current one
            const newPrice = priceValue && !isNaN(parseFloat(priceValue)) 
              ? parseFloat(priceValue) 
              : updatedItem.variantPrice;
            
            // Always update the variant price to ensure it's not null
            if (newPrice !== null && !isNaN(Number(newPrice))) {
              updatedItem.variantPrice = newPrice;
            }
            
            // Check if the item has latestPriceChange and update it
            if ((updatedItem as any).latestPriceChange) {
              // Update the existing latestPriceChange
              if (priceValue && !isNaN(parseFloat(priceValue))) {
                (updatedItem as any).latestPriceChange.newPrice = parseFloat(priceValue);
              }
              
              if (compareAtValue && !isNaN(parseFloat(compareAtValue))) {
                (updatedItem as any).latestPriceChange.newCompareAtPrice = parseFloat(compareAtValue);
              }
            } else {
              // If no latestPriceChange exists, create one to show the history
              const originalPrice = updatedItem.variantPrice || 0;
              (updatedItem as any).latestPriceChange = {
                originalPrice: originalPrice,
                newPrice: priceValue && !isNaN(parseFloat(priceValue)) 
                  ? parseFloat(priceValue) 
                  : originalPrice,
                newCompareAtPrice: compareAtValue && !isNaN(parseFloat(compareAtValue))
                  ? parseFloat(compareAtValue) 
                  : originalPrice,
                appliedAt: new Date().toISOString(),
                currencyCode: updatedItem.currencyCode
              };
            }
          }
          
          setUpdatingVariantId(null);
        }
      }
    }
  }, [actionData, isDeleting, updatingVariantId]);

  const handleDropZoneDrop = useCallback(
    (_dropFiles: File[], acceptedFiles: File[], rejectedFiles: File[]) => {
      setFile(acceptedFiles[0]);
      setRejectedFiles(rejectedFiles);
    },
    []
  );

  const handleSubmit = () => {
    if (!file) return;
    
    setIsUploading(true);
    
    const formData = new FormData();
    formData.append("file", file);
    
    submit(formData, { method: "post", encType: "multipart/form-data" });
    
    // This simulates the success state after upload
    const timer = setTimeout(() => {
      if (actionData?.status !== "error") {
        setSelectedTab(1); // Switch to the All Inventory tab
      }
      setIsUploading(false);
    }, 3000);
    
    return () => clearTimeout(timer);
  };
  
  const handleSync = () => {
    setIsSyncing(true);
    setSyncProgress(0);
    
    // Define sync progress stages that match the server-side logs
    const stages = [
      { message: "Initializing sync...", progress: 5 },
      { message: "Finding unique product IDs...", progress: 10 },
      { message: "Found product IDs to check against Shopify", progress: 15 }
    ];
    
    // Add API call stages based on the logs showing 14-15 API calls
    const apiCalls = 14;
    for (let i = 1; i <= apiCalls; i++) {
      const productsPerCall = i === apiCalls ? 25 : 100; // Last call usually has fewer products
      const percentComplete = 15 + Math.min(75, Math.round((i / apiCalls) * 70));
      stages.push({
        message: `API call ${i}: Processed ${productsPerCall} products`,
        progress: percentComplete
      });
    }
    
    // Final stage for updating metafields
    stages.push({ message: "Updating metafields for variants", progress: 90 });
    stages.push({ message: "Finalizing sync...", progress: 95 });
    
    let currentStage = 0;
    
    // Update progress based on stages to match the server logs
    const progressInterval = setInterval(() => {
      if (currentStage < stages.length) {
        const stage = stages[currentStage];
        setSyncProgress(stage.progress);
        setSyncStatus(stage.message);
        
        // Add log message to console to match server behavior
        console.log(`Sync progress: ${stage.message} (${stage.progress}%)`);
        
        currentStage++;
      } else {
        clearInterval(progressInterval);
      }
    }, 700); // Slightly slower to match real-world API calls
    
    const formData = new FormData();
    formData.append("action", "sync");
    
    submit(formData, { method: "post" });
    
    return () => {
      clearInterval(progressInterval);
    };
  };
  
  // Handle deleting a single item
  const handleDeleteItem = (id: string) => {
    setItemToDelete(id);
    setConfirmDeleteModalActive(true);
  };
  
  // Handle confirming the deletion of a single item
  const confirmDeleteItem = () => {
    if (!itemToDelete) return;
    
    setIsDeleting(true);
    setConfirmDeleteModalActive(false);
    
    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("id", itemToDelete);
    
    submit(formData, { method: "post" });
  };
  
  // Handle updating sale price
  const handleUpdateCompareAtPrice = (variantId: string, value: string) => {
    // Validate the input value is a number
    const isValidNumber = value === '' || !isNaN(parseFloat(value));
    if (!isValidNumber) {
      // If invalid input, don't update the state
      return;
    }
    
    // Update the input value
    setCompareAtPrices(prev => ({
      ...prev,
      [variantId]: value
    }));
    
    // Instantly update the display in the table row
    if (value && !isNaN(parseFloat(value))) {
      setUpdatedVariants(prev => {
        const existing = prev[variantId] || { 
          timestamp: Date.now(), 
          newPrice: '', 
          newCompareAtPrice: prev[variantId]?.newCompareAtPrice || null 
        };
        
        return {
          ...prev,
          [variantId]: {
            ...existing,
            timestamp: Date.now(),
            newPrice: value
          }
        };
      });
    }
  };
  
  // Handle updating new Compare At price
  const handleUpdateNewCompareAtPrice = (variantId: string, value: string) => {
    // Validate the input value is a number
    const isValidNumber = value === '' || !isNaN(parseFloat(value));
    if (!isValidNumber) {
      // If invalid input, don't update the state
      return;
    }
    
    // Update the input value
    setNewCompareAtPrices(prev => ({
      ...prev,
      [variantId]: value
    }));
    
    // Instantly update the display in the table row
    if (value && !isNaN(parseFloat(value))) {
      setUpdatedVariants(prev => {
        const existing = prev[variantId] || { 
          timestamp: Date.now(), 
          newPrice: prev[variantId]?.newPrice || '', 
          newCompareAtPrice: null 
        };
        
        return {
          ...prev,
          [variantId]: {
            ...existing,
            timestamp: Date.now(),
            newCompareAtPrice: value
          }
        };
      });
    }
  };
  
  // Handle submitting price updates
  const submitCompareAtPrice = (variantId: string, compareAtPrice: string | undefined, compareAtPriceOnly: boolean = false) => {
    if (!variantId) return;
    
    const item = shelfLifeItems.find(item => item.shopifyVariantId === variantId);
    if (!item) return;
    
    let newSalePrice = compareAtPrice;
    
    // If only updating Compare At price, keep the existing price as is
    if (compareAtPriceOnly) {
      // Use the current price from the item
      const currentPrice = item.variantPrice;
      if (!currentPrice && currentPrice !== 0) return;
      
      newSalePrice = currentPrice.toString();
    } else if (!newSalePrice) {
      return;
    }
    
    setUpdatingVariantId(variantId);
    
    const formData = new FormData();
    formData.append("action", "updateCompareAtPrice");
    formData.append("variantId", variantId);
    formData.append("compareAtPrice", newSalePrice);
    
    // For the Compare At price:
    // If we have a new Compare At price specified, use that
    // Otherwise, if we're only updating the regular price, keep the existing Compare At price
    let newCompareAtPrice = newCompareAtPrices[variantId];
    
    // If there's no explicit Compare At price in the input field, check if we should keep the existing one
    if (!newCompareAtPrice && compareAtPriceOnly && (item as any).latestPriceChange?.newCompareAtPrice) {
      // Use the existing Compare At price
      newCompareAtPrice = (item as any).latestPriceChange.newCompareAtPrice.toString();
    }
    
    if (newCompareAtPrice) {
      formData.append("newCompareAtPrice", newCompareAtPrice);
    }
    
    submit(formData, { method: "post" });
    
    // Clear the inputs after submission
    setCompareAtPrices(prev => {
      const newState = { ...prev };
      delete newState[variantId];
      return newState;
    });
    
    setNewCompareAtPrices(prev => {
      const newState = { ...prev };
      delete newState[variantId];
      return newState;
    });
  };
  
  // Handle deleting selected items
  const handleDeleteSelected = () => {
    if (selectedItems.length === 0) return;
    
    setConfirmDeleteModalActive(true);
  };
  
  // Handle confirming the deletion of selected items
  const confirmDeleteSelected = () => {
    if (selectedItems.length === 0) return;
    
    setIsDeleting(true);
    setConfirmDeleteModalActive(false);
    
    const formData = new FormData();
    formData.append("action", "bulkDelete");
    formData.append("ids", selectedItems.join(","));
    
    submit(formData, { method: "post" });
  };
  
  // Handle deleting all items
  const handleDeleteAll = () => {
    if (shelfLifeItems.length === 0) return;
    
    setConfirmDeleteAllModalActive(true);
  };
  
  // Handle confirming the deletion of all items
  const confirmDeleteAll = () => {
    setIsDeleting(true);
    setConfirmDeleteAllModalActive(false);
    
    const formData = new FormData();
    formData.append("action", "deleteAll");
    
    submit(formData, { method: "post" });
  };
  
  // Handle applying automatic discounts
  const handleApplyAutomaticDiscounts = () => {
    setIsApplyingDiscounts(true);
    setAutoDiscountModalActive(false);
    
    const formData = new FormData();
    formData.append("action", "applyAutomaticDiscounts");
    
    submit(formData, { method: "post" });
  };
  
  // Handle reverting automatic discounts
  const handleRevertAutomaticDiscounts = () => {
    setIsRevertingDiscounts(true);
    setRevertDiscountModalActive(false);
    
    const formData = new FormData();
    formData.append("action", "revertAutomaticDiscounts");
    
    submit(formData, { method: "post" });
  };
  
  // Handle toggling item selection for bulk actions
  const handleSelectItem = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedItems(prev => [...prev, id]);
    } else {
      setSelectedItems(prev => prev.filter(itemId => itemId !== id));
    }
  };
  
  // Handle selecting all items
  const handleSelectAll = (checked: boolean) => {
    const currentItems = getFilteredItems(shelfLifeItems, getCurrentTabId());
    
    if (checked) {
      // Add current filtered items to selection
      const newSelectedItems = [...selectedItems];
      currentItems.forEach(item => {
        if (!selectedItems.includes(item.id)) {
          newSelectedItems.push(item.id);
        }
      });
      setSelectedItems(newSelectedItems);
    } else {
      // Remove current filtered items from selection
      const currentItemIds = currentItems.map(item => item.id);
      setSelectedItems(selectedItems.filter(id => !currentItemIds.includes(id)));
    }
  };
  
  // Toggle actions popover
  const toggleActionsPopover = useCallback(() => 
    setActionsPopoverActive(active => !active), []);
    
  // Refresh the UI every minute to update the "X min ago" text
  useEffect(() => {
    const timer = setInterval(() => {
      if (Object.keys(updatedVariants).length > 0) {
        // Force a re-render by making a clone of the state
        setUpdatedVariants({...updatedVariants});
      }
    }, 60000); // Every minute
    
    return () => clearInterval(timer);
  }, [updatedVariants]);

  const validImageTypes = ["text/csv"];
  
  const fileUpload = !file && (
    <DropZone.FileUpload actionHint="Accepts .csv files" />
  );
  
  const uploadedFile = file && (
    <InlineStack gap="400">
      <Thumbnail
        size="small"
        alt={file.name}
        source={NoteIcon}
      />
      <div>
        <Text variant="bodyMd" fontWeight="bold" as="p">
          {file.name}
        </Text>
        <Text variant="bodySm" as="p">
          {file.size} bytes
        </Text>
      </div>
    </InlineStack>
  );

  const errorMessage = rejectedFiles.length > 0 && (
    <Banner
      title="The following files couldn't be uploaded:"
      tone="critical"
    >
      <ul>
        {rejectedFiles.map((file, index) => (
          <li key={index}>
            {file.name} is not supported. File type must be .csv
          </li>
        ))}
      </ul>
    </Banner>
  );

  const successMessage = actionData?.status === "success" && !actionData?.syncResult && (
    <Banner title="Success" tone="success">
      <BlockStack gap="200">
        <Text as="p">{actionData.message}</Text>
        {actionData.filename && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ 
              width: '16px', 
              height: '16px', 
              borderRadius: '50%', 
              backgroundColor: '#008060', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center' 
            }}>
              <span style={{ color: 'white', fontSize: '12px', fontWeight: 'bold' }}>✓</span>
            </div>
            <Text as="p" fontWeight="medium">
              {actionData.filename} processed successfully. 
              {actionData.savedCount && ` ${actionData.savedCount} items saved.`}
            </Text>
          </div>
        )}
        {!selectedTab && (
          <div style={{ marginTop: '8px' }}>
            <Button onClick={() => setSelectedTab(1)}>View Inventory</Button>
          </div>
        )}
      </BlockStack>
    </Banner>
  );

  const warningMessage = actionData?.status === "warning" && (
    <Banner title="Warning" tone="warning">
      <BlockStack gap="200">
        <Text as="p">{actionData.message}</Text>
        {actionData.errors && actionData.errors.length > 0 && (
          <BlockStack gap="100">
            <Text as="p">Errors:</Text>
            <ul>
              {actionData.errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </BlockStack>
        )}
      </BlockStack>
    </Banner>
  );

  const errorUploadMessage = actionData?.status === "error" && !actionData?.syncResult && (
    <Banner title="Error" tone="critical">
      {actionData.message}
    </Banner>
  );

  // Format date for display
  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString();
  };
  
  // Format currency for display
  const formatCurrency = (amount: number | null, currencyCode: string | null) => {
    // Extra check to handle undefined or non-numeric values
    if (amount === null || amount === undefined || isNaN(Number(amount))) {
      return 'N/A';
    }
    
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount);
    } catch (error) {
      // Fall back to basic formatting if currency code is invalid
      return `${currencyCode || '$'}${Number(amount).toFixed(2)}`;
    }
  };

  // Calculate days until expiration based on batch ID
  const getDaysUntilExpiration = (batchId: string) => {
    if (!batchId || batchId.length !== 8) return null;
    
    try {
      const year = parseInt(batchId.substring(0, 4));
      const month = parseInt(batchId.substring(4, 6)) - 1; // JS months are 0-indexed
      const day = parseInt(batchId.substring(6, 8));
      
      const expirationDate = new Date(year, month, day);
      const today = new Date();
      
      // Reset time part to compare just the dates
      today.setHours(0, 0, 0, 0);
      expirationDate.setHours(0, 0, 0, 0);
      
      const diffTime = expirationDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      return diffDays;
    } catch (error) {
      return null;
    }
  };
  
  // Filter items based on their sync status and expiration status
  const getFilteredItems = (items: ShelfLifeItem[], tabId: string) => {
    let filteredItems = items;
    
    // Apply the zero quantity filter if enabled
    if (hideZeroQuantity) {
      filteredItems = filteredItems.filter(item => {
        // Only filter out items that have been synced and have quantity of 0
        if (item.syncStatus === "MATCHED" && item.quantity === 0) {
          return false;
        }
        return true;
      });
    }
    
    if (tabId === 'view') {
      return filteredItems; // Return all items for the "All Inventory" tab (with zero quantity filter applied if enabled)
    }
    
    // Special case for "Not Synced" tab
    if (tabId === 'not-synced') {
      return filteredItems.filter(item => !item.syncStatus || item.syncStatus === "UNMATCHED");
    }
    
    // For expiration-based categories, only include items that ARE synced (have sync status of MATCHED)
    return filteredItems.filter(item => {
      // First ensure that item is synced before including it in any expiration-based tabs
      if (!item.syncStatus || item.syncStatus !== "MATCHED") {
        return false; // Don't include not synced items in expiration tabs
      }
      
      const daysUntilExpiration = getDaysUntilExpiration(item.batchId);
      
      if (daysUntilExpiration === null) {
        return false; // Filter out items with invalid expiration dates for category tabs
      }
      
      switch (tabId) {
        case 'expired':
          return daysUntilExpiration < 0;
        case 'expiring-soon':
          return daysUntilExpiration >= 0 && daysUntilExpiration <= 30;
        case 'expiring-60':
          return daysUntilExpiration > 30 && daysUntilExpiration <= 60;
        case 'expiring-90':
          return daysUntilExpiration > 60 && daysUntilExpiration <= 90;
        case 'expiring-180':
          return daysUntilExpiration > 90 && daysUntilExpiration <= 180;
        case 'good':
          return daysUntilExpiration > 180;
        default:
          return true;
      }
    });
  };
  
  // Get expiration status text and color
  const getExpirationStatus = (batchId: string) => {
    const daysUntilExpiration = getDaysUntilExpiration(batchId);
    
    if (daysUntilExpiration === null) {
      return <Text as="span" tone="subdued">Unknown</Text>;
    } else if (daysUntilExpiration < 0) {
      return <Text as="span" tone="critical">Expired ({Math.abs(daysUntilExpiration)} days ago)</Text>;
    } else if (daysUntilExpiration <= 30) {
      return <Text as="span" tone="critical">Expiring soon ({daysUntilExpiration} days)</Text>;
    } else if (daysUntilExpiration <= 60) {
      return <Text as="span" tone="caution">60 days ({daysUntilExpiration} days left)</Text>;
    } else if (daysUntilExpiration <= 90) {
      return <Text as="span" tone="info">90 days ({daysUntilExpiration} days left)</Text>;
    } else if (daysUntilExpiration <= 180) {
      return <Text as="span" tone="success">180 days ({daysUntilExpiration} days left)</Text>;
    } else {
      return <Text as="span" tone="success">Good ({daysUntilExpiration} days left)</Text>;
    }
  };

  // Get sync status text and color
  const getSyncStatusText = (item: ShelfLifeItem) => {
    if (item.syncStatus === "MATCHED") {
      return <Text as="span" tone="success">Matched</Text>;
    } else if (item.syncStatus === "UNMATCHED") {
      return <Text as="span" tone="critical">Not Matched</Text>;
    } else {
      return <Text as="span" tone="warning">Pending Sync</Text>;
    }
  };

  // Get filtered items based on the selected tab
  const getFilteredRows = (tabId: string) => {
    // For upload tab, return empty rows
    if (tabId === 'upload') {
      return [];
    }
    
    // Get filtered items for the selected tab
    const filteredItems = getFilteredItems(shelfLifeItems, tabId);
    
    // Map filtered items to rows for the data table
    return filteredItems.map((item: ShelfLifeItem) => {
      const daysUntilExpiration = getDaysUntilExpiration(item.batchId);
      const isExpired = daysUntilExpiration !== null && daysUntilExpiration < 0;
      const isExpiringSoon = daysUntilExpiration !== null && daysUntilExpiration >= 0 && daysUntilExpiration <= 30;
      
      // Determine row styling based on expiration status
      const textTone = isExpired ? "critical" : isExpiringSoon ? "caution" : undefined;
      const fontWeight = isExpired || isExpiringSoon ? "bold" : "regular";
      
      return [
        <input 
          type="checkbox" 
          checked={selectedItems.includes(item.id)} 
          onChange={(e) => handleSelectItem(item.id, e.target.checked)}
          disabled={isDeleting}
        />,
        <Text as="span" tone={textTone} fontWeight={fontWeight}>{item.productId}</Text>,
        <Text as="span" tone={textTone} fontWeight={fontWeight}>{item.batchId}</Text>,
        getExpirationStatus(item.batchId),
        <Text as="span" tone={textTone} fontWeight={fontWeight}>{item.quantity.toString()}</Text>,
        <Text as="span" tone={textTone} fontWeight={fontWeight}>
          {item.batchQuantity !== undefined && item.batchQuantity !== null ? item.batchQuantity.toString() : "N/A"}
        </Text>,
        <Text as="span" tone={textTone} fontWeight={fontWeight}>{item.location || "N/A"}</Text>,
        <Text as="span" tone={textTone} fontWeight={fontWeight}>{item.shopifyProductTitle || "Not synced"}</Text>,
        <InlineStack gap="100" align="center">
          {updatedVariants[item.shopifyVariantId || ''] && updatedVariants[item.shopifyVariantId || ''].newPrice ? (
            <Text as="span" tone="success" fontWeight="bold">
              {formatCurrency(
                parseFloat(updatedVariants[item.shopifyVariantId || ''].newPrice), 
                item.currencyCode
              )}
              {' '}
              <span style={{ fontSize: '0.7em', opacity: 0.7 }}>
                {Math.floor((Date.now() - updatedVariants[item.shopifyVariantId || ''].timestamp) / 60000)} min ago
              </span>
            </Text>
          ) : ((item as any).latestPriceChange && (item as any).latestPriceChange.newPrice) ? (
            <InlineStack gap="100" align="center">
              <Text as="span" tone="success" fontWeight={fontWeight}>
                {formatCurrency((item as any).latestPriceChange.newPrice, item.currencyCode)}
              </Text>
              {/* Show discount badge if notes contains "Automatic discount" */}
              {(item as any).latestPriceChange.notes?.includes("Automatic discount") && (
                <span style={{ 
                  backgroundColor: '#d1f0e0', 
                  color: '#006633', 
                  padding: '2px 6px', 
                  borderRadius: '4px', 
                  fontSize: '0.7em',
                  fontWeight: 'bold' 
                }}>
                  AUTO DISCOUNT
                </span>
              )}
            </InlineStack>
          ) : (
            <Text as="span" tone={textTone} fontWeight={fontWeight}>
              {item.variantPrice !== null 
                ? formatCurrency(item.variantPrice, item.currencyCode) 
                : (item as any).latestPriceChange 
                  ? formatCurrency((item as any).latestPriceChange.newPrice || (item as any).latestPriceChange.originalPrice, item.currencyCode)
                  : "N/A"}
            </Text>
          )}
          {(item as any).latestPriceChange && (
            <Tooltip content={`Original price: ${formatCurrency((item as any).latestPriceChange.originalPrice, (item as any).latestPriceChange.currencyCode)}
Changed to: ${formatCurrency((item as any).latestPriceChange.newPrice, (item as any).latestPriceChange.currencyCode)}
Date: ${new Date((item as any).latestPriceChange.appliedAt).toLocaleString()}`}>
              <Button 
                variant="plain" 
                size="micro" 
                onClick={() => handlePriceHistoryClick(item.id, item.shopifyVariantId || '')}
              >
                <span 
                  style={{ 
                    fontSize: '0.85em', 
                    backgroundColor: '#f2f7f2', 
                    padding: '2px 6px', 
                    borderRadius: '4px',
                    color: '#2c6e2c',
                    whiteSpace: 'nowrap',
                  }}
                >
                  History
                </span>
              </Button>
            </Tooltip>
          )}
        </InlineStack>,
        <InlineStack gap="100" align="center">
          {updatedVariants[item.shopifyVariantId || ''] && updatedVariants[item.shopifyVariantId || ''].newCompareAtPrice ? (
            <Text as="span" tone="success" fontWeight="bold">
              {formatCurrency(
                updatedVariants[item.shopifyVariantId || ''].newCompareAtPrice === '' || updatedVariants[item.shopifyVariantId || ''].newCompareAtPrice === null
                  ? item.variantPrice
                  : parseFloat(updatedVariants[item.shopifyVariantId || ''].newCompareAtPrice),
                item.currencyCode
              )}
              {' '}
              <span style={{ fontSize: '0.7em', opacity: 0.7 }}>
                {Math.floor((Date.now() - updatedVariants[item.shopifyVariantId || ''].timestamp) / 60000)} min ago
              </span>
            </Text>
          ) : (
            <InlineStack gap="100" align="center">
              <Text as="span" tone={textTone} fontWeight={fontWeight}>
                {(item as any).latestPriceChange && (item as any).latestPriceChange.newCompareAtPrice 
                  ? formatCurrency((item as any).latestPriceChange.newCompareAtPrice, item.currencyCode)
                  : item.variantPrice 
                    ? formatCurrency(item.variantPrice, item.currencyCode)
                    : "N/A"}
              </Text>
              
              {/* Display discount percentage if this is an auto-discounted item */}
              {(item as any).latestPriceChange?.notes?.includes("Automatic discount") && 
               (item as any).latestPriceChange?.originalPrice && 
               (item as any).latestPriceChange?.newPrice && (
                <span style={{ 
                  backgroundColor: '#f2f2f2', 
                  padding: '2px 6px', 
                  borderRadius: '4px', 
                  fontSize: '0.7em' 
                }}>
                  {Math.round(
                    ((item as any).latestPriceChange.originalPrice - (item as any).latestPriceChange.newPrice) / 
                    (item as any).latestPriceChange.originalPrice * 100
                  )}% OFF
                </span>
              )}
            </InlineStack>
          )}
        </InlineStack>,
        <InlineStack gap="100" align="center">
          <div>
            <input
              type="number"
              style={{ 
                width: '80px', 
                padding: '6px', 
                border: '1px solid #c9cccf', 
                borderRadius: '4px',
                fontSize: '0.8125rem'
              }}
              placeholder="New sale price"
              value={compareAtPrices[item.shopifyVariantId || ''] || ''}
              onChange={(e) => handleUpdateCompareAtPrice(item.shopifyVariantId || '', e.target.value)}
              disabled={!item.shopifyVariantId || updatingVariantId === item.shopifyVariantId}
            />
            <div style={{ marginTop: '4px' }}>
              <input
                type="number"
                style={{ 
                  width: '80px', 
                  padding: '6px', 
                  border: '1px solid #c9cccf', 
                  borderRadius: '4px',
                  fontSize: '0.8125rem'
                }}
                placeholder="New Compare At"
                value={newCompareAtPrices[item.shopifyVariantId || ''] || ''}
                onChange={(e) => handleUpdateNewCompareAtPrice(item.shopifyVariantId || '', e.target.value)}
                disabled={!item.shopifyVariantId || updatingVariantId === item.shopifyVariantId}
              />
            </div>
          </div>
          <Button
            size="micro"
            onClick={() => {
              // If there's a new sale price, submit that
              if (compareAtPrices[item.shopifyVariantId || '']) {
                submitCompareAtPrice(item.shopifyVariantId || '', compareAtPrices[item.shopifyVariantId || '']);
              } 
              // If there's only a Compare At price (no sale price), use the compareAtPriceOnly flag
              else if (newCompareAtPrices[item.shopifyVariantId || '']) {
                submitCompareAtPrice(item.shopifyVariantId || '', undefined, true);
              }
            }}
            disabled={!item.shopifyVariantId || 
              ((!compareAtPrices[item.shopifyVariantId || ''] && !newCompareAtPrices[item.shopifyVariantId || '']) 
              || updatingVariantId === item.shopifyVariantId)}
            loading={updatingVariantId === item.shopifyVariantId}
          >
            Apply
          </Button>
        </InlineStack>,
        <Text as="span" tone={textTone} fontWeight={fontWeight}>{formatCurrency(item.variantCost, item.currencyCode)}</Text>,
        getSyncStatusText(item),
        <Text as="span" tone={textTone}>{item.syncMessage || "Not synced yet"}</Text>,
        <Text as="span" tone={textTone}>{formatDate(item.updatedAt)}</Text>,
        <ButtonGroup>
          <Button 
            onClick={() => handleDeleteItem(item.id)} 
            variant="tertiary" 
            tone="critical"
            disabled={isDeleting}
            accessibilityLabel={`Delete ${item.productId}`}
          >
            Delete
          </Button>
        </ButtonGroup>
      ];
    });
  };
  
  // Get counts of items in each category for tab badges
  const getExpirationCounts = () => {
    const counts = {
      expired: 0,
      expiringSoon: 0,
      expiring60: 0,
      expiring90: 0,
      expiring180: 0,
      good: 0,
      notSynced: 0,
      // Add filtered counts when zero quantity filter is applied
      filteredExpired: 0,
      filteredExpiringSoon: 0,
      filteredExpiring60: 0,
      filteredExpiring90: 0,
      filteredExpiring180: 0,
      filteredGood: 0,
      filteredNotSynced: 0,
      totalFiltered: 0
    };
    
    shelfLifeItems.forEach(item => {
      // Skip items with zero quantity if the filter is applied
      const isZeroQuantity = item.quantity === 0 && item.syncStatus === "MATCHED";
      
      // Count not synced items first
      if (!item.syncStatus || item.syncStatus === "UNMATCHED") {
        counts.notSynced++;
        if (!isZeroQuantity || !hideZeroQuantity) {
          counts.filteredNotSynced++;
        }
        return; // Skip expiration counting for not synced items
      }
      
      // Only count expiration for synced items
      const daysUntilExpiration = getDaysUntilExpiration(item.batchId);
      
      if (daysUntilExpiration === null) return;
      
      if (daysUntilExpiration < 0) {
        counts.expired++;
        if (!isZeroQuantity || !hideZeroQuantity) {
          counts.filteredExpired++;
        }
      } else if (daysUntilExpiration <= 30) {
        counts.expiringSoon++;
        if (!isZeroQuantity || !hideZeroQuantity) {
          counts.filteredExpiringSoon++;
        }
      } else if (daysUntilExpiration <= 60) {
        counts.expiring60++;
        if (!isZeroQuantity || !hideZeroQuantity) {
          counts.filteredExpiring60++;
        }
      } else if (daysUntilExpiration <= 90) {
        counts.expiring90++;
        if (!isZeroQuantity || !hideZeroQuantity) {
          counts.filteredExpiring90++;
        }
      } else if (daysUntilExpiration <= 180) {
        counts.expiring180++;
        if (!isZeroQuantity || !hideZeroQuantity) {
          counts.filteredExpiring180++;
        }
      } else {
        counts.good++;
        if (!isZeroQuantity || !hideZeroQuantity) {
          counts.filteredGood++;
        }
      }
      
      // Count total filtered items
      if (!isZeroQuantity || !hideZeroQuantity) {
        counts.totalFiltered++;
      }
    });
    
    return counts;
  };
  
  // Get expiration counts
  const expirationCounts = getExpirationCounts();
  
  // Define tabs with counts
  const tabs = [
    {
      id: 'upload',
      content: 'Upload CSV',
      panelID: 'upload-panel',
    },
    {
      id: 'view',
      content: hideZeroQuantity 
        ? `All Inventory (${expirationCounts.totalFiltered}/${shelfLifeItems.length})` 
        : `All Inventory (${shelfLifeItems.length})`,
      panelID: 'view-panel',
    },
    {
      id: 'not-synced',
      content: hideZeroQuantity 
        ? `Not Synced (${expirationCounts.filteredNotSynced}/${expirationCounts.notSynced})` 
        : `Not Synced (${expirationCounts.notSynced})`,
      panelID: 'not-synced-panel',
    },
    {
      id: 'expired',
      content: hideZeroQuantity 
        ? `Expired (${expirationCounts.filteredExpired}/${expirationCounts.expired})` 
        : `Expired (${expirationCounts.expired})`,
      panelID: 'expired-panel',
      disabled: hideZeroQuantity ? expirationCounts.filteredExpired === 0 : expirationCounts.expired === 0
    },
    {
      id: 'expiring-soon',
      content: hideZeroQuantity 
        ? `Expiring Soon (${expirationCounts.filteredExpiringSoon}/${expirationCounts.expiringSoon})` 
        : `Expiring Soon (${expirationCounts.expiringSoon})`,
      panelID: 'expiring-soon-panel',
      disabled: hideZeroQuantity ? expirationCounts.filteredExpiringSoon === 0 : expirationCounts.expiringSoon === 0
    },
    {
      id: 'expiring-60',
      content: hideZeroQuantity 
        ? `60 Days (${expirationCounts.filteredExpiring60}/${expirationCounts.expiring60})` 
        : `60 Days (${expirationCounts.expiring60})`,
      panelID: 'expiring-60-panel',
      disabled: hideZeroQuantity ? expirationCounts.filteredExpiring60 === 0 : expirationCounts.expiring60 === 0
    },
    {
      id: 'expiring-90',
      content: hideZeroQuantity 
        ? `90 Days (${expirationCounts.filteredExpiring90}/${expirationCounts.expiring90})` 
        : `90 Days (${expirationCounts.expiring90})`,
      panelID: 'expiring-90-panel',
      disabled: hideZeroQuantity ? expirationCounts.filteredExpiring90 === 0 : expirationCounts.expiring90 === 0
    },
    {
      id: 'expiring-180',
      content: hideZeroQuantity 
        ? `180 Days (${expirationCounts.filteredExpiring180}/${expirationCounts.expiring180})` 
        : `180 Days (${expirationCounts.expiring180})`,
      panelID: 'expiring-180-panel',
      disabled: hideZeroQuantity ? expirationCounts.filteredExpiring180 === 0 : expirationCounts.expiring180 === 0
    },
    {
      id: 'good',
      content: hideZeroQuantity 
        ? `Good Inventory (>180 days) (${expirationCounts.filteredGood}/${expirationCounts.good})` 
        : `Good Inventory (>180 days) (${expirationCounts.good})`,
      panelID: 'good-panel',
      disabled: hideZeroQuantity ? expirationCounts.filteredGood === 0 : expirationCounts.good === 0
    },
  ];
  
  // Get the current filtered rows based on the selected tab ID
  const getCurrentTabId = () => {
    return tabs[selectedTab]?.id || 'view';
  };
  
  const rows = getFilteredRows(getCurrentTabId());

  // Prepare actions popover
  const actionsPopoverButton = (
    <Button
      onClick={toggleActionsPopover}
      variant="tertiary"
      disabled={isDeleting}
    >
      • • • Actions
    </Button>
  );
  
  const handlePopoverActionSelect = (action: string) => {
    setActionsPopoverActive(false);
    
    if (action === 'delete_selected') {
      handleDeleteSelected();
    } else if (action === 'delete_all') {
      handleDeleteAll();
    }
  };

  const toggleActive = useCallback(() => setToastActive((active) => !active), []);
  const handleModalClose = useCallback(() => setSyncResultModalActive(false), []);
  const handleDeleteModalClose = useCallback(() => {
    setConfirmDeleteModalActive(false);
    setItemToDelete(null);
  }, []);
  const handleDeleteAllModalClose = useCallback(() => {
    setConfirmDeleteAllModalActive(false);
  }, []);
  
  const handlePriceHistoryClick = useCallback((itemId: string, variantId: string) => {
    setSelectedPriceHistory({ itemId, variantId });
    setPriceHistoryModalActive(true);
  }, []);
  
  const handlePriceHistoryModalClose = useCallback(() => {
    setPriceHistoryModalActive(false);
    setSelectedPriceHistory(null);
  }, []);

  return (
    <Frame>
      <Page
        title="Shelf Life Management"
        primaryAction={selectedTab === 0 ? {
          content: isUploading ? "Uploading..." : "Upload CSV",
          onAction: handleSubmit,
          disabled: !file || isUploading,
          loading: isUploading
        } : undefined}
        secondaryActions={selectedTab === 1 ? [
          {
            content: isSyncing 
              ? `Syncing... ${syncProgress}%` 
              : expirationCounts.notSynced > 0
                ? `Sync with Shopify (${expirationCounts.notSynced} items need matching)`
                : "Sync with Shopify",
            icon: RefreshIcon,
            onAction: handleSync,
            loading: isSyncing,
            disabled: isSyncing,
            tone: expirationCounts.notSynced > 0 ? "warning" : undefined
          }
        ] : undefined}
      >
        {/* Show progress bar during syncing */}
        {isSyncing && (
          <Box paddingBlockEnd="300">
            <div>
              <div style={{ 
                height: '4px', 
                backgroundColor: '#e4e5e7',
                borderRadius: '2px',
                overflow: 'hidden',
                width: '100%',
                marginBottom: '8px'
              }}>
                <div style={{ 
                  height: '100%', 
                  width: `${syncProgress}%`, 
                  backgroundColor: '#008060',
                  transition: 'width 0.3s ease'
                }}></div>
              </div>
              <div style={{
                fontSize: '0.8125rem',
                color: '#637381',
                margin: '0 0 12px'
              }}>
                {syncStatus || (
                  syncProgress < 15 ? 'Finding products to check...' : 
                  syncProgress < 85 ? `API call ${Math.floor((syncProgress - 15) / 5) + 1}: Processing products...` :
                  syncProgress < 90 ? 'Updating metafields for variants...' : 
                  'Finalizing sync...'
                )}
              </div>
            </div>
          </Box>
        )}
        <BlockStack gap="500">
          {successMessage}
          {warningMessage}
          {errorUploadMessage}
          {errorMessage}
          
          <Tabs
            tabs={tabs}
            selected={selectedTab}
            onSelect={(index) => setSelectedTab(index)}
          />
          
          {selectedTab === 0 ? (
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="500">
                    <Text as="h2" variant="headingMd">Upload shelf life data</Text>
                    <Text as="p">
                      Upload a CSV file containing product shelf life information. The file should include columns for product ID, batch ID, expiration date, and quantity.
                    </Text>
                    <DropZone
                      accept="text/csv"
                      type="file"
                      onDrop={handleDropZoneDrop}
                      allowMultiple={false}
                    >
                      {uploadedFile}
                      {fileUpload}
                    </DropZone>
                    <Box paddingBlockStart="200">
                      <Text as="h3" variant="headingMd">Notes:</Text>
                      <ul>
                        <li>
                          <Text as="p">
                            The CSV file should contain columns for product ID (SKU), batch ID, expiration date, and quantity.
                          </Text>
                        </li>
                        <li>
                          <Text as="p">
                            Leading equals signs (=) in product IDs will be automatically removed.
                          </Text>
                        </li>
                        <li>
                          <Text as="p">
                            The file can be encoded in Big5 (Traditional Chinese) or UTF-8.
                          </Text>
                        </li>
                      </ul>
                    </Box>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          ) : (
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="500">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">Shelf Life Inventory</Text>
                      <ButtonGroup>
                        {selectedItems.length > 0 && (
                          <Button 
                            tone="critical"
                            onClick={handleDeleteSelected} 
                            disabled={isDeleting}
                          >
                            Delete Selected ({selectedItems.length})
                          </Button>
                        )}
                        <Button 
                          icon={RefreshIcon} 
                          onClick={handleSync} 
                          loading={isSyncing}
                          disabled={isSyncing || isDeleting}
                          tone={
                            expirationCounts.notSynced > 0 
                              ? "warning" 
                              : Object.keys(updatedVariants).length > 0 
                                ? "success" 
                                : undefined
                          }
                        >
                          {isSyncing 
                            ? `Syncing... ${syncProgress}%` 
                            : expirationCounts.notSynced > 0
                              ? `Sync with Shopify (${expirationCounts.notSynced} items need matching)`
                              : Object.keys(updatedVariants).length > 0 
                                ? `Sync with Shopify (${Object.keys(updatedVariants).length} updates pending)`
                                : "Sync with Shopify"
                          }
                        </Button>
                        
                        <ButtonGroup>
                          <Button 
                            onClick={() => setAutoDiscountModalActive(true)}
                            disabled={isApplyingDiscounts || isRevertingDiscounts}
                            tone="success"
                          >
                            Apply Automatic Discounts
                          </Button>
                          
                          <Button 
                            onClick={() => setRevertDiscountModalActive(true)}
                            disabled={isApplyingDiscounts || isRevertingDiscounts}
                            tone="caution"
                          >
                            Revert Automatic Discounts
                          </Button>
                        </ButtonGroup>
                        
                        <Popover
                          active={actionsPopoverActive}
                          activator={actionsPopoverButton}
                          onClose={toggleActionsPopover}
                          preferredAlignment="right"
                        >
                          <ActionList
                            actionRole="menuitem"
                            items={[
                              {
                                content: 'Delete Selected',
                                onAction: () => handlePopoverActionSelect('delete_selected'),
                                disabled: selectedItems.length === 0 || isDeleting
                              },
                              {
                                content: 'Delete All Items',
                                onAction: () => handlePopoverActionSelect('delete_all'),
                                disabled: shelfLifeItems.length === 0 || isDeleting
                              }
                            ]}
                          />
                        </Popover>
                      </ButtonGroup>
                    </InlineStack>
                    
                    {/* Filter Controls */}
                    {getCurrentTabId() !== 'upload' && (
                      <Box paddingBlockStart="300" paddingBlockEnd="300">
                        <InlineStack gap="300" align="center">
                          <Button
                            onClick={() => setHideZeroQuantity(!hideZeroQuantity)}
                            variant="tertiary"
                            pressed={hideZeroQuantity}
                          >
                            {hideZeroQuantity ? "Show Zero Quantity Items" : "Hide Zero Quantity Items"}
                          </Button>
                          {hideZeroQuantity && (
                            <Text as="span" tone="info">
                              Filtered out {shelfLifeItems.length - getFilteredItems(shelfLifeItems, getCurrentTabId()).length} items with 0 quantity
                            </Text>
                          )}
                        </InlineStack>
                      </Box>
                    )}
                    
                    {/* Display category-specific banner */}
                    {getCurrentTabId() === 'view' && (
                      <Box paddingBlockEnd="300">
                        <Banner tone="info">
                          <Text as="p">
                            {hideZeroQuantity 
                              ? `Showing ${rows.length} of ${shelfLifeItems.length} items (filtered to hide zero quantity items). ` 
                              : `Showing all ${shelfLifeItems.length} items. `
                            }
                            Use the "Not Synced" tab to view only items that haven't been matched with Shopify products. Expiration tabs only show synced items.
                          </Text>
                        </Banner>
                      </Box>
                    )}
                    {getCurrentTabId() !== 'upload' && getCurrentTabId() !== 'view' && (
                      <Box paddingBlockEnd="300">
                        <Banner tone={
                          getCurrentTabId() === 'expired' ? 'critical' :
                          getCurrentTabId() === 'expiring-soon' ? 'warning' :
                          getCurrentTabId() === 'expiring-60' ? 'info' :
                          getCurrentTabId() === 'expiring-90' ? 'info' :
                          getCurrentTabId() === 'expiring-180' ? 'info' :
                          getCurrentTabId() === 'not-synced' ? 'warning' : 'success'
                        }>
                          <Text as="p">
                            {getCurrentTabId() === 'expired' && (
                              hideZeroQuantity 
                                ? `Showing ${rows.length} of ${expirationCounts.expired} expired items (filtered to hide zero quantity items). These products have passed their expiration date.` 
                                : `Showing ${rows.length} expired items. These products have passed their expiration date.`
                            )}
                            {getCurrentTabId() === 'expiring-soon' && (
                              hideZeroQuantity 
                                ? `Showing ${rows.length} of ${expirationCounts.expiringSoon} items expiring within 30 days (filtered to hide zero quantity items). These products need immediate attention.` 
                                : `Showing ${rows.length} items expiring within 30 days. These products need immediate attention.`
                            )}
                            {getCurrentTabId() === 'expiring-60' && (
                              hideZeroQuantity 
                                ? `Showing ${rows.length} of ${expirationCounts.expiring60} items expiring within 31-60 days (filtered to hide zero quantity items). Consider planning for these items.` 
                                : `Showing ${rows.length} items expiring within 31-60 days. Consider planning for these items.`
                            )}
                            {getCurrentTabId() === 'expiring-90' && (
                              hideZeroQuantity 
                                ? `Showing ${rows.length} of ${expirationCounts.expiring90} items expiring within 61-90 days (filtered to hide zero quantity items).` 
                                : `Showing ${rows.length} items expiring within 61-90 days.`
                            )}
                            {getCurrentTabId() === 'expiring-180' && (
                              hideZeroQuantity 
                                ? `Showing ${rows.length} of ${expirationCounts.expiring180} items expiring within 91-180 days (filtered to hide zero quantity items).` 
                                : `Showing ${rows.length} items expiring within 91-180 days.`
                            )}
                            {getCurrentTabId() === 'good' && (
                              hideZeroQuantity 
                                ? `Showing ${rows.length} of ${expirationCounts.good} items with more than 180 days until expiration (filtered to hide zero quantity items).` 
                                : `Showing ${rows.length} items with more than 180 days until expiration.`
                            )}
                            {getCurrentTabId() === 'not-synced' && (
                              <>
                                {hideZeroQuantity 
                                  ? `Showing ${rows.length} of ${expirationCounts.notSynced} items that have not been successfully matched with Shopify products (filtered to hide zero quantity items).` 
                                  : `Showing ${rows.length} items that have not been successfully matched with Shopify products.`
                                } 
                                Click "Sync with Shopify" to attempt matching these items with your products again.
                                <Box paddingBlockStart="300">
                                  <Text fontWeight="medium" as="p">Common reasons for failed matching:</Text>
                                  <ul>
                                    <li>Product IDs (SKUs) in your CSV don't match SKUs in your Shopify store</li>
                                    <li>Products may have been deleted or archived in Shopify</li>
                                    <li>API limits may have been reached during sync</li>
                                  </ul>
                                </Box>
                              </>
                            )}
                          </Text>
                        </Banner>
                      </Box>
                    )}
                    
                    {/* Hidden form for delete operations */}
                    <form method="post" ref={deleteFormRef} style={{ display: 'none' }}>
                      <input type="hidden" name="action" value="delete" />
                      <input type="hidden" name="id" id="deleteItemId" />
                    </form>
                    
                    {getCurrentTabId() === 'upload' ? (
                      <></>
                    ) : rows.length === 0 ? (
                      <EmptyState
                        heading={shelfLifeItems.length === 0 
                          ? "No shelf life data found" 
                          : `No items found in this category`}
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      >
                        <p>{shelfLifeItems.length === 0 
                          ? "Upload a CSV file to add shelf life data." 
                          : "Try selecting a different category or upload more items."}
                        </p>
                      </EmptyState>
                    ) : (
                      <DataTable
                        columnContentTypes={[
                          'text',
                          'text',
                          'text',
                          'text',
                          'numeric',
                          'numeric',
                          'text',
                          'text',
                          'numeric',
                          'numeric',
                          'numeric',
                          'numeric',
                          'text',
                          'text',
                          'text',
                          'text'
                        ]}
                        headings={[
                          <input 
                            type="checkbox" 
                            checked={rows.length > 0 && 
                              getFilteredItems(shelfLifeItems, getCurrentTabId())
                                .every(item => selectedItems.includes(item.id))} 
                            onChange={(e) => {
                              const currentItems = getFilteredItems(shelfLifeItems, getCurrentTabId());
                              if (e.target.checked) {
                                // Select all visible items in the current tab
                                const newSelectedItems = [...selectedItems];
                                currentItems.forEach(item => {
                                  if (!selectedItems.includes(item.id)) {
                                    newSelectedItems.push(item.id);
                                  }
                                });
                                setSelectedItems(newSelectedItems);
                              } else {
                                // Deselect all visible items in the current tab
                                const currentItemIds = currentItems.map(item => item.id);
                                setSelectedItems(selectedItems.filter(id => !currentItemIds.includes(id)));
                              }
                            }}
                            disabled={isDeleting || rows.length === 0}
                          />,
                          'Product ID',
                          'Batch ID',
                          'Expiration Status',
                          'Quantity',
                          'Batch Quantity (批號存量)',
                          'Location',
                          'Shopify Product',
                          'Price',
                          'Compare At',
                          'Set Sale Price',
                          'Cost',
                          'Sync Status',
                          'Sync Message',
                          'Updated At',
                          'Actions'
                        ]}
                        rows={rows}
                        hoverable
                        verticalAlign="top"
                      />
                    )}
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          )}
        </BlockStack>
      </Page>
      
      {isDeleting && <Loading />}
      
      {toastActive && (
        <Toast
          content={toastContent.message}
          tone={toastContent.tone as any}
          onDismiss={toggleActive}
        />
      )}
      
      {/* Modal to display unmatched items with reasons */}
      <Modal
        open={syncResultModalActive}
        onClose={handleModalClose}
        title="Sync Results"
        primaryAction={{
          content: "Close",
          onAction: handleModalClose,
        }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              {actionData?.syncResult?.message}
            </Text>
            
            {actionData?.syncResult?.unmatchedItems && actionData.syncResult.unmatchedItems.length > 0 && (
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">Products that couldn't be matched:</Text>
                <List type="bullet">
                  {actionData.syncResult.unmatchedItems.map((item, index) => (
                    <List.Item key={index}>
                      <Text as="span" tone="critical">
                        {item.productId}: {item.reason}
                      </Text>
                    </List.Item>
                  ))}
                </List>
                <Text as="p">
                  To fix these issues, make sure the Product IDs in your CSV match the SKUs in your Shopify store.
                </Text>
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
      
      {/* Confirm Delete Modal for single or selected items */}
      <Modal
        open={confirmDeleteModalActive}
        onClose={handleDeleteModalClose}
        title={itemToDelete ? "Delete Item" : "Delete Selected Items"}
        primaryAction={{
          content: "Delete",
          onAction: itemToDelete ? confirmDeleteItem : confirmDeleteSelected,
          destructive: true,
          loading: isDeleting
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleDeleteModalClose,
            disabled: isDeleting
          }
        ]}
      >
        <Modal.Section>
          <Text as="p">
            {itemToDelete 
              ? "Are you sure you want to delete this item? This action cannot be undone."
              : `Are you sure you want to delete ${selectedItems.length} items? This action cannot be undone.`
            }
          </Text>
        </Modal.Section>
      </Modal>
      
      {/* Confirm Delete All Modal */}
      <Modal
        open={confirmDeleteAllModalActive}
        onClose={handleDeleteAllModalClose}
        title="Delete All Items"
        primaryAction={{
          content: "Delete All",
          onAction: confirmDeleteAll,
          destructive: true,
          loading: isDeleting
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleDeleteAllModalClose,
            disabled: isDeleting
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="critical" fontWeight="bold">
              Warning: This action will delete all {shelfLifeItems.length} items in your shelf life inventory.
            </Text>
            <Text as="p">
              This is a permanent action and cannot be undone. Are you sure you want to proceed?
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      
      {/* Price History Modal */}
      <Modal
        open={priceHistoryModalActive}
        onClose={handlePriceHistoryModalClose}
        title="Price Change History"
        primaryAction={{
          content: "Close",
          onAction: handlePriceHistoryModalClose
        }}
      >
        <Modal.Section>
          {selectedPriceHistory && (
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                {shelfLifeItems.find(item => item.id === selectedPriceHistory.itemId)?.shopifyProductTitle || 'Product'}
              </Text>
              
              {(() => {
                const { priceChanges } = useLoaderData<typeof loader>();
                const filteredChanges = priceChanges.filter(
                  change => change.shopifyVariantId === selectedPriceHistory.variantId
                ).sort((a, b) => 
                  new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime()
                );
                
                if (filteredChanges.length === 0) {
                  return (
                    <EmptyState
                      heading="No price change history"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>There are no recorded price changes for this product.</p>
                    </EmptyState>
                  );
                }
                
                return (
                  <DataTable
                    columnContentTypes={['text', 'numeric', 'numeric', 'numeric', 'text', 'text']}
                    headings={['Date', 'Original Price', 'New Price', 'Compare At', 'Status', 'Notes']}
                    rows={filteredChanges.map(change => [
                      new Date(change.appliedAt).toLocaleString(),
                      formatCurrency(change.originalPrice, change.currencyCode),
                      formatCurrency(change.newPrice, change.currencyCode),
                      formatCurrency(change.newCompareAtPrice, change.currencyCode),
                      <Text tone={change.status === 'APPLIED' ? 'success' : 'info'}>{change.status}</Text>,
                      change.notes ? (
                        change.notes.includes("Automatic discount") ? (
                          <Text tone="success" fontWeight="bold">
                            {change.notes}
                          </Text>
                        ) : (
                          <Text>{change.notes}</Text>
                        )
                      ) : null
                    ])}
                  />
                );
              })()}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
      
      {/* Automatic Discount Confirmation Modal */}
      <Modal
        open={autoDiscountModalActive}
        onClose={() => setAutoDiscountModalActive(false)}
        title="Apply Automatic Discounts"
        primaryAction={{
          content: "Apply Discounts",
          onAction: handleApplyAutomaticDiscounts,
          loading: isApplyingDiscounts
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setAutoDiscountModalActive(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              This will apply automatic discounts to products based on their expiration date using the following rules:
            </Text>
            
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text']}
              headings={['Days Left', 'Margin % to Keep', 'Margin % to Discount', 'Calculation']}
              rows={[
                ["180 days", "80%", "20%", "Cost + (Margin × 80%)"],
                ["90 days", "60%", "40%", "Cost + (Margin × 60%)"],
                ["60 days", "35%", "65%", "Cost + (Margin × 35%)"],
                ["30 days", "10%", "90%", "Cost + (Margin × 10%)"]
              ]}
            />
            
            <Text as="p" fontWeight="medium">
              Original prices will be shown as "Compare At" prices in your Shopify store.
            </Text>
            
            <Text as="p" tone="warning">
              This operation will update product prices in your Shopify store. Are you sure you want to continue?
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      
      {/* Discount Results Modal */}
      {discountResults && (
        <Modal
          open={!!discountResults}
          onClose={() => setDiscountResults(null)}
          title="Automatic Discount Results"
          primaryAction={{
            content: "Close",
            onAction: () => setDiscountResults(null)
          }}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner tone={discountResults.success ? "success" : "critical"}>
                <Text as="p">
                  {discountResults.message}
                </Text>
              </Banner>
              
              <BlockStack gap="200">
                <Text as="p" fontWeight="medium">Summary:</Text>
                <Text as="p">• Items processed: {discountResults.totalItems}</Text>
                <Text as="p">• Items discounted: {discountResults.itemsDiscounted}</Text>
                {discountResults.errors && discountResults.errors.length > 0 && (
                  <Text as="p">• Items with errors: {discountResults.errors.length}</Text>
                )}
              </BlockStack>
              
              {discountResults.errors && discountResults.errors.length > 0 && (
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">Items with errors:</Text>
                  <List type="bullet">
                    {discountResults.errors.map((error, index) => (
                      <List.Item key={index}>
                        <Text as="span" tone="critical">
                          {error.productId}: {error.reason}
                        </Text>
                      </List.Item>
                    ))}
                  </List>
                </BlockStack>
              )}
              
              <Text as="p">
                You can view detailed price change history for each product by clicking the "History" button in the product row.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
      
      {/* Revert Discount Confirmation Modal */}
      <Modal
        open={revertDiscountModalActive}
        onClose={() => setRevertDiscountModalActive(false)}
        title="Revert Automatic Discounts"
        primaryAction={{
          content: "Revert Discounts",
          onAction: handleRevertAutomaticDiscounts,
          loading: isRevertingDiscounts,
          destructive: true
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setRevertDiscountModalActive(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              This will revert all automatic discounts applied to products and restore them to their original prices.
            </Text>
            
            <Banner tone="caution">
              <Text as="p">
                This will:
              </Text>
              <ul>
                <li>Restore all products with automatic discounts to their original prices</li>
                <li>Remove the "Compare At" prices set during discounting</li>
                <li>Record the price changes in the price history</li>
              </ul>
            </Banner>
            
            <Text as="p" tone="warning" fontWeight="medium">
              Are you sure you want to revert all automatic discounts?
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      
      {/* Revert Discount Results Modal */}
      {revertDiscountResults && (
        <Modal
          open={!!revertDiscountResults}
          onClose={() => setRevertDiscountResults(null)}
          title="Revert Discount Results"
          primaryAction={{
            content: "Close",
            onAction: () => setRevertDiscountResults(null)
          }}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner tone={revertDiscountResults.success ? "success" : "critical"}>
                <Text as="p">
                  {revertDiscountResults.message}
                </Text>
              </Banner>
              
              <BlockStack gap="200">
                <Text as="p" fontWeight="medium">Summary:</Text>
                <Text as="p">• Items processed: {revertDiscountResults.totalItems}</Text>
                <Text as="p">• Items reverted: {revertDiscountResults.itemsReverted}</Text>
                {revertDiscountResults.errors && revertDiscountResults.errors.length > 0 && (
                  <Text as="p">• Items with errors: {revertDiscountResults.errors.length}</Text>
                )}
              </BlockStack>
              
              {revertDiscountResults.errors && revertDiscountResults.errors.length > 0 && (
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">Items with errors:</Text>
                  <List type="bullet">
                    {revertDiscountResults.errors.map((error, index) => (
                      <List.Item key={index}>
                        <Text as="span" tone="critical">
                          {error.productId}: {error.reason}
                        </Text>
                      </List.Item>
                    ))}
                  </List>
                </BlockStack>
              )}
              
              <Text as="p">
                You can view detailed price change history for each product by clicking the "History" button in the product row.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Frame>
  );
}
