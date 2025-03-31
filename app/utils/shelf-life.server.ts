import { parse } from "csv-parse/sync";
import prisma from "../db.server";

/**
 * Interface for shelf life data from CSV
 */
interface ShelfLifeData {
  productId: string;
  batchId: string;
  expirationDate: Date;
  quantity: number;
  batchQuantity?: number;
  location?: string;
}

/**
 * Interface for ShelfLifeItem from database
 */
interface ShelfLifeItem {
  id: string;
  shop: string;
  productId: string;
  batchId: string;
  expirationDate: Date;
  quantity: number;
  batchQuantity: number | null;
  location: string | null;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  shopifyProductTitle: string | null;
  shopifyVariantTitle: string | null;
  syncStatus: string | null;
  syncMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Clean product ID by removing leading equals sign
 */
function cleanProductId(productId: string): string {
  if (!productId) return "";
  if (productId.startsWith('=')) {
    return productId.substring(1).replace(/"/g, '');
  }
  return productId.replace(/"/g, '');
}

/**
 * Parse CSV data into ShelfLifeData objects
 */
export async function parseCSV(csvContent: string): Promise<ShelfLifeData[]> {
  try {
    // Log the first 200 characters of the CSV to help with debugging
    console.log("CSV content preview:", csvContent.substring(0, 200));
    
    // Handle Big5 encoding by using a more relaxed parsing approach
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,  // More forgiving quote handling
      relax_column_count: true, // Allow varying column counts
      encoding: 'utf8', // We'll handle encoding conversion separately if needed
    });
    
    // Log the first record to help with debugging
    if (records.length > 0) {
      console.log("First record keys:", Object.keys(records[0]));
      console.log("First record values:", Object.values(records[0]));
    }
    
    // Try to identify the product ID column - specifically look for '產品代號' first
    const possibleProductIdColumns = [
      '產品代號', // This is the primary column name in the user's CSV
      'productId', 'product_id', 'sku', 'SKU', 'Product ID', 'ProductID', 
      'product id', 'product', 'Product', 'ID', 'id', 'Item', 'item',
      '商品ID', '商品編號', '產品編號', '產品ID', '商品代碼', '貨號'
    ];
    
    // Try to identify the batch ID column - look for '保存批號' first
    const possibleBatchIdColumns = [
      '保存批號', // This is the primary column name in the user's CSV
      'batchId', 'batch_id', 'batch', 'Batch ID', 'BatchID', 'batch id',
      'Batch', 'lot', 'Lot', 'LotID', 'Lot ID', 'lot id',
      '批次', '批號', '批次編號', '批次ID'
    ];
    
    // Try to identify the expiration date column - look for '有效期限' or '保存期限' first
    const possibleExpirationDateColumns = [
      '有效期限', '保存期限', // These are the primary column names in the user's CSV
      'expirationDate', 'expiration_date', 'date', 'Date', 'Expiration', 
      'expiration', 'Expiry', 'expiry', 'Exp Date', 'exp date',
      '到期日', '效期'
    ];
    
    // Try to identify the quantity column - look for '分倉存量' first
    const possibleQuantityColumns = [
      '分倉存量', // This is the primary column name in the user's CSV
      'quantity', 'Quantity', 'qty', 'Qty', 'QTY', 'Amount', 'amount',
      '數量', '庫存', '庫存數量', '數目'
    ];
    
    // Try to identify the batch quantity column - specifically look for '批號存量'
    const possibleBatchQuantityColumns = [
      '批號存量', // This is the primary column name in the user's CSV
      'batchQuantity', 'batch_quantity', 'batch quantity', 'Batch Quantity',
      '批次數量', '批號數量'
    ];
    
    // Try to identify the location column - look for '倉庫名稱' or '倉庫代號' first
    const possibleLocationColumns = [
      '倉庫名稱', '倉庫代號', // These are the primary column names in the user's CSV
      'location', 'Location', 'loc', 'Loc', 'warehouse', 'Warehouse',
      '位置', '倉庫', '儲位', '庫位'
    ];
    
    // Find the actual column names in the CSV
    let productIdColumn = '';
    let batchIdColumn = '';
    let expirationDateColumn = '';
    let quantityColumn = '';
    let batchQuantityColumn = '';
    let locationColumn = '';
    
    if (records.length > 0) {
      const firstRecord = records[0];
      const csvColumns = Object.keys(firstRecord);
      
      // Find product ID column
      productIdColumn = csvColumns.find(col => 
        possibleProductIdColumns.some(possible => 
          col.toLowerCase() === possible.toLowerCase()
        )
      ) || '';
      
      // Find batch ID column
      batchIdColumn = csvColumns.find(col => 
        possibleBatchIdColumns.some(possible => 
          col.toLowerCase() === possible.toLowerCase()
        )
      ) || '';
      
      // Find expiration date column
      expirationDateColumn = csvColumns.find(col => 
        possibleExpirationDateColumns.some(possible => 
          col.toLowerCase() === possible.toLowerCase()
        )
      ) || '';
      
      // Find quantity column
      quantityColumn = csvColumns.find(col => 
        possibleQuantityColumns.some(possible => 
          col.toLowerCase() === possible.toLowerCase()
        )
      ) || '';
      
      // Find batch quantity column
      batchQuantityColumn = csvColumns.find(col => 
        possibleBatchQuantityColumns.some(possible => 
          col.toLowerCase() === possible.toLowerCase()
        )
      ) || '';
      
      // Find location column
      locationColumn = csvColumns.find(col => 
        possibleLocationColumns.some(possible => 
          col.toLowerCase() === possible.toLowerCase()
        )
      ) || '';
      
      console.log("Identified columns:", {
        productIdColumn,
        batchIdColumn,
        expirationDateColumn,
        quantityColumn,
        batchQuantityColumn,
        locationColumn
      });
    }
    
    return records.map((record: any, index: number) => {
      // Get product ID from identified column or try various fallbacks
      let rawProductId = '';
      if (productIdColumn && record[productIdColumn]) {
        rawProductId = record[productIdColumn];
      } else {
        // Try all possible product ID columns
        for (const col of possibleProductIdColumns) {
          if (record[col]) {
            rawProductId = record[col];
            break;
          }
        }
        
        // If still no product ID, try to use any column that might contain it
        if (!rawProductId) {
          for (const key of Object.keys(record)) {
            const value = record[key];
            if (typeof value === 'string' && 
                (value.includes('SKU') || value.includes('sku') || 
                 value.includes('product') || value.includes('Product'))) {
              rawProductId = value;
              break;
            }
          }
        }
      }
      
      // Special case: If we still don't have a product ID but we have a record with a '產品代號' field
      // This is specifically for the user's CSV format
      if (!rawProductId && record['產品代號']) {
        rawProductId = record['產品代號'];
      }
      
      const productId = cleanProductId(rawProductId);
      
      // Get batch ID from identified column or try various fallbacks
      let batchId = '';
      if (batchIdColumn && record[batchIdColumn]) {
        batchId = record[batchIdColumn];
      } else if (record['保存批號']) {
        // Special case for the user's CSV format
        batchId = record['保存批號'];
      } else {
        // If no batch ID found, generate one based on row index
        batchId = `batch-${index + 1}`;
      }
      
      // Clean the batch ID as well to remove equals signs and quotes
      batchId = cleanProductId(batchId);
      
      // Get expiration date
      let expirationDateStr = '';
      if (expirationDateColumn && record[expirationDateColumn]) {
        expirationDateStr = record[expirationDateColumn];
      } else if (record['有效期限']) {
        // Special case for the user's CSV format
        expirationDateStr = record['有效期限'];
      } else if (record['保存期限']) {
        // Alternative field in the user's CSV
        expirationDateStr = record['保存期限'];
      } else {
        // Try all possible expiration date columns
        for (const col of possibleExpirationDateColumns) {
          if (record[col]) {
            expirationDateStr = record[col];
            break;
          }
        }
      }
      
      // Parse the expiration date - handle various formats
      let expirationDate = new Date();
      try {
        if (expirationDateStr) {
          // Try to handle various date formats
          if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(expirationDateStr)) {
            // Format: YYYY/MM/DD
            expirationDate = new Date(expirationDateStr);
          } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(expirationDateStr)) {
            // Format: MM/DD/YYYY
            const parts = expirationDateStr.split('/');
            expirationDate = new Date(`${parts[2]}-${parts[0]}-${parts[1]}`);
          } else if (/^\d{4}$/.test(expirationDateStr)) {
            // Format: YYYY - assume January 1st
            expirationDate = new Date(`${expirationDateStr}-01-01`);
          } else if (/^\d{3}$/.test(expirationDateStr)) {
            // Format: YYY - assume it's 2YYY and January 1st
            expirationDate = new Date(`2${expirationDateStr}-01-01`);
          } else {
            // Try standard date parsing
            expirationDate = new Date(expirationDateStr);
          }
          
          // If the date is invalid, try alternative parsing
          if (isNaN(expirationDate.getTime())) {
            // Check if it's a format like "20270924" (YYYYMMDD)
            if (/^\d{8}$/.test(expirationDateStr)) {
              const year = expirationDateStr.substring(0, 4);
              const month = expirationDateStr.substring(4, 6);
              const day = expirationDateStr.substring(6, 8);
              expirationDate = new Date(`${year}-${month}-${day}`);
            }
          }
        } else {
          // Default to 30 days from now if no date found
          expirationDate = new Date();
          expirationDate.setDate(expirationDate.getDate() + 30);
        }
      } catch (e) {
        console.error(`Error parsing date '${expirationDateStr}' for row ${index + 1}:`, e);
        // Default to 30 days from now on error
        expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 30);
      }
      
      // Get quantity
      let quantityStr = '';
      if (quantityColumn && record[quantityColumn]) {
        quantityStr = record[quantityColumn];
      } else if (record['分倉存量']) {
        // Special case for the user's CSV format
        quantityStr = record['分倉存量'];
      } else {
        // Try all possible quantity columns
        for (const col of possibleQuantityColumns) {
          if (record[col]) {
            quantityStr = record[col];
            break;
          }
        }
      }
      
      // Parse the quantity
      let quantity = 0;
      try {
        quantity = parseInt(quantityStr, 10) || 0;
      } catch (e) {
        console.error(`Error parsing quantity '${quantityStr}' for row ${index + 1}:`, e);
      }
      
      // Get batch quantity
      let batchQuantityStr = '';
      if (batchQuantityColumn && record[batchQuantityColumn]) {
        batchQuantityStr = record[batchQuantityColumn];
      } else if (record['批號存量']) {
        // Special case for the user's CSV format
        batchQuantityStr = record['批號存量'];
      } else {
        // Try all possible batch quantity columns
        for (const col of possibleBatchQuantityColumns) {
          if (record[col]) {
            batchQuantityStr = record[col];
            break;
          }
        }
      }
      
      // Parse the batch quantity
      let batchQuantity = 0;
      try {
        batchQuantity = parseInt(batchQuantityStr, 10) || 0;
      } catch (e) {
        console.error(`Error parsing batch quantity '${batchQuantityStr}' for row ${index + 1}:`, e);
      }
      
      // Get location
      let location = 'default';
      if (locationColumn && record[locationColumn]) {
        location = record[locationColumn];
      } else if (record['倉庫名稱']) {
        // Special case for the user's CSV format
        location = record['倉庫名稱'];
      } else if (record['倉庫代號']) {
        // Alternative field in the user's CSV
        location = record['倉庫代號'];
      } else {
        // Try all possible location columns
        for (const col of possibleLocationColumns) {
          if (record[col]) {
            location = record[col];
            break;
          }
        }
      }
      
      // Log the row data for debugging
      if (index < 5 || !productId) {
        console.log(`Row ${index + 1} data:`, { 
          rawProductId, 
          productId, 
          batchId, 
          expirationDateStr, 
          expirationDate, 
          quantityStr, 
          quantity, 
          batchQuantityStr, 
          batchQuantity, 
          location,
          record // Log the full record for debugging
        });
      }
      
      return {
        productId,
        batchId,
        expirationDate,
        quantity,
        batchQuantity,
        location,
      };
    });
  } catch (error) {
    console.error("Error parsing CSV:", error);
    throw new Error(`Failed to parse CSV: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Save shelf life data to the database
 */
export async function saveShelfLifeData(data: ShelfLifeData[], shop: string): Promise<number> {
  try {
    let savedCount = 0;
    
    for (const item of data) {
      await prisma.shelfLifeItem.upsert({
        where: {
          productId_batchId: {
            productId: item.productId,
            batchId: item.batchId,
          },
        },
        update: {
          shop,
          expirationDate: item.expirationDate,
          quantity: item.quantity,
          batchQuantity: item.batchQuantity,
          location: item.location,
        },
        create: {
          shop,
          productId: item.productId,
          batchId: item.batchId,
          expirationDate: item.expirationDate,
          quantity: item.quantity,
          batchQuantity: item.batchQuantity,
          location: item.location || "default",
        },
      });
      savedCount++;
    }
    
    return savedCount;
  } catch (error) {
    console.error("Error saving shelf life data:", error);
    throw new Error(`Failed to save shelf life data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get all shelf life items
 */
export async function getAllShelfLifeItems(shop: string): Promise<ShelfLifeItem[]> {
  try {
    return await prisma.shelfLifeItem.findMany({
      where: {
        shop,
      },
      orderBy: {
        expirationDate: 'asc',
      },
    }) as ShelfLifeItem[];
  } catch (error) {
    console.error("Error fetching shelf life items:", error);
    throw new Error(`Failed to fetch shelf life items: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get expiring shelf life items
 */
export async function getExpiringItems(shop: string, daysThreshold: number = 30) {
  try {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);
    
    return await prisma.shelfLifeItem.findMany({
      where: {
        shop,
        expirationDate: {
          lte: thresholdDate,
        },
        quantity: {
          gt: 0,
        },
      },
      orderBy: {
        expirationDate: 'asc',
      },
    });
  } catch (error) {
    console.error("Error fetching expiring items:", error);
    throw new Error(`Failed to fetch expiring items: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Process CSV file content
 */
export async function processCSVFile(fileContent: string, shop: string): Promise<{ savedCount: number; errors: string[] }> {
  try {
    const parsedData = await parseCSV(fileContent);
    const errors: string[] = [];
    
    // Validate data
    const validData = parsedData.filter((item, index) => {
      if (!item.productId) {
        const errorMsg = `Missing product ID for batch ${item.batchId} at row ${index + 1}`;
        console.error(errorMsg);
        errors.push(errorMsg);
        return false;
      }
      if (!item.batchId) {
        const errorMsg = `Missing batch ID for product ${item.productId} at row ${index + 1}`;
        console.error(errorMsg);
        errors.push(errorMsg);
        return false;
      }
      if (isNaN(item.expirationDate.getTime())) {
        const errorMsg = `Invalid expiration date for product ${item.productId}, batch ${item.batchId} at row ${index + 1}`;
        console.error(errorMsg);
        errors.push(errorMsg);
        return false;
      }
      if (item.quantity < 0) {
        const errorMsg = `Invalid quantity for product ${item.productId}, batch ${item.batchId} at row ${index + 1}`;
        console.error(errorMsg);
        errors.push(errorMsg);
        return false;
      }
      return true;
    });
    
    console.log(`Parsed ${parsedData.length} items, ${validData.length} valid items`);
    
    // Save valid data
    const savedCount = await saveShelfLifeData(validData, shop);
    
    return {
      savedCount,
      errors,
    };
  } catch (error) {
    console.error("Error processing CSV file:", error);
    throw new Error(`Failed to process CSV file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Sync shelf life items with Shopify products
 * This function matches shelf life product IDs with Shopify variant SKUs
 */
export async function syncWithShopify(shop: string, admin: any): Promise<{ 
  success: boolean; 
  matchedCount: number; 
  message: string;
  unmatchedItems?: Array<{
    productId: string;
    reason: string;
  }>;
}> {
  try {
    // Get all shelf life items
    const shelfLifeItems = await getAllShelfLifeItems(shop);
    
    // Create a map of SKU to variant details
    const skuToVariantMap = new Map();
    let hasNextPage = true;
    let cursor: string | null = null;
    let productsProcessed = 0;
    let apiCallCount = 0;
    const MAX_API_CALLS = 25; // Increased from 10 to 25
    
    // Extract unique product IDs from shelf life items to optimize fetching
    const uniqueProductIds = new Set<string>();
    shelfLifeItems.forEach(item => {
      if (item.productId) {
        uniqueProductIds.add(item.productId);
      }
    });
    
    console.log(`Found ${uniqueProductIds.size} unique product IDs to check against Shopify`);
    
    // Fetch products in batches to respect API limits
    while (hasNextPage && apiCallCount < MAX_API_CALLS) {
      apiCallCount++;
      
      // Build the query with pagination
      const afterParam: string = cursor ? `, after: "${cursor}"` : '';
      const response: any = await admin.graphql(`
        query {
          products(first: 100${afterParam}) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                variants(first: 100) {
                  edges {
                    node {
                      id
                      sku
                      inventoryQuantity
                      title
                    }
                  }
                }
              }
            }
          }
        }
      `);
      
      const responseJson: any = await response.json();
      
      // Check for errors
      if (responseJson.errors) {
        console.error("GraphQL errors:", responseJson.errors);
        return {
          success: false,
          matchedCount: 0,
          message: `Error fetching products: ${responseJson.errors[0].message}`
        };
      }
      
      const productData: any = responseJson.data.products;
      const productEdges = productData.edges;
      
      // Update pagination info
      hasNextPage = productData.pageInfo.hasNextPage;
      cursor = productData.pageInfo.endCursor;
      productsProcessed += productEdges.length;
      
      // Process this batch of products
      let newMatchesInBatch = 0;
      productEdges.forEach((productEdge: any) => {
        const product = productEdge.node;
        const variantEdges = product.variants.edges;
        
        variantEdges.forEach((variantEdge: any) => {
          const variant = variantEdge.node;
          if (variant.sku && uniqueProductIds.has(variant.sku)) {
            skuToVariantMap.set(variant.sku, {
              variantId: variant.id,
              productId: product.id,
              productTitle: product.title,
              variantTitle: variant.title,
              inventoryQuantity: variant.inventoryQuantity
            });
            newMatchesInBatch++;
          }
        });
      });
      
      console.log(`API call ${apiCallCount}: Processed ${productEdges.length} products, found ${newMatchesInBatch} new matches`);
      
      // If we've found matches for all unique product IDs, we can stop
      if (skuToVariantMap.size >= uniqueProductIds.size) {
        console.log(`Found matches for all ${uniqueProductIds.size} unique product IDs. Stopping API calls.`);
        break;
      }
      
      // If no new matches were found in this batch, and we've processed a significant number of products,
      // we might want to consider stopping to save API calls
      if (newMatchesInBatch === 0 && productsProcessed > 300) {
        const matchPercentage = (skuToVariantMap.size / uniqueProductIds.size) * 100;
        // If we've already matched more than 80% of products and no new matches in this batch, stop
        if (matchPercentage > 80) {
          console.log(`No new matches found in this batch and already matched ${matchPercentage.toFixed(1)}% of products. Stopping API calls to save quota.`);
          break;
        }
      }
      
      // Add a small delay between API calls to avoid rate limiting
      if (hasNextPage) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // If we stopped because of the API call limit, log a warning
    if (hasNextPage) {
      console.warn(`Stopped product fetching after ${apiCallCount} API calls. Not all products may have been processed.`);
    }
    
    // Match shelf life items with Shopify variants
    let matchedCount = 0;
    const unmatchedItems = [];
    
    // Group shelf life items by variant ID for metafield updates
    const variantExpirationMap = new Map();
    
    for (const item of shelfLifeItems) {
      const variantDetails = skuToVariantMap.get(item.productId);
      
      if (variantDetails) {
        // Update the shelf life item with Shopify variant details
        await prisma.shelfLifeItem.update({
          where: {
            id: item.id
          },
          data: {
            shopifyVariantId: variantDetails.variantId,
            shopifyProductId: variantDetails.productId,
            shopifyProductTitle: variantDetails.productTitle,
            shopifyVariantTitle: variantDetails.variantTitle,
            syncStatus: "MATCHED",
            syncMessage: "Successfully matched with Shopify variant"
          }
        });
        
        // Add this item to the variant expiration map
        if (!variantExpirationMap.has(variantDetails.variantId)) {
          variantExpirationMap.set(variantDetails.variantId, []);
        }
        
        // Add this batch to the variant's expiration data
        variantExpirationMap.get(variantDetails.variantId).push({
          batchId: item.batchId,
          quantity: item.quantity,
          batchQuantity: item.batchQuantity !== null && item.batchQuantity !== undefined ? item.batchQuantity : item.quantity,
          location: item.location || ""
        });
        
        matchedCount++;
      } else {
        // Record the reason why this item wasn't matched
        const reason = "No matching SKU found in Shopify";
        
        // Update the item with the sync status
        await prisma.shelfLifeItem.update({
          where: {
            id: item.id
          },
          data: {
            syncStatus: "UNMATCHED",
            syncMessage: reason
          }
        });
        
        unmatchedItems.push({
          productId: item.productId,
          reason
        });
      }
    }
    
    // Update metafields for each variant with expiration data
    console.log(`Updating metafields for ${variantExpirationMap.size} variants`);
    let metafieldUpdateCount = 0;
    
    for (const [variantId, expirationData] of variantExpirationMap.entries()) {
      try {
        // Update the variant's metafield with expiration data using metafieldsSet mutation
        const response = await admin.graphql(`
          mutation {
            metafieldsSet(metafields: [
              {
                ownerId: "${variantId}",
                namespace: "alpha_dog",
                key: "expiration_data",
                type: "json",
                value: "${JSON.stringify(expirationData).replace(/"/g, '\\"')}"
              }
            ]) {
              metafields {
                id
                namespace
                key
              }
              userErrors {
                field
                message
              }
            }
          }
        `);
        
        const responseJson = await response.json(); // Parse the JSON properly
        
        if (responseJson.errors) {
          console.error('GraphQL errors:', responseJson.errors);
          throw new Error(`GraphQL error: ${responseJson.errors[0].message}`);
        }
        
        const result = responseJson.data.metafieldsSet;
        
        if (result.userErrors && result.userErrors.length > 0) {
          console.error(`Error updating metafield for variant ${variantId}:`, result.userErrors);
        } else {
          metafieldUpdateCount++;
        }
        
        // Add a small delay between API calls to avoid rate limiting
        if (metafieldUpdateCount % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`Error updating metafield for variant ${variantId}:`, error);
      }
    }
    
    const apiLimitMessage = hasNextPage ? 
      ` Note: API call limit reached after processing ${productsProcessed} products. Some products may not have been checked.` : '';
    
    return {
      success: true,
      matchedCount,
      unmatchedItems,
      message: `Successfully matched ${matchedCount} out of ${shelfLifeItems.length} shelf life items with Shopify products. Updated metafields for ${variantExpirationMap.size} variants.${apiLimitMessage}`
    };
  } catch (error) {
    console.error("Error syncing with Shopify:", error);
    return {
      success: false,
      matchedCount: 0,
      message: `Failed to sync with Shopify: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
