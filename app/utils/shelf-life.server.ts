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
  location?: string;
}

/**
 * Clean product ID by removing leading equals sign
 */
function cleanProductId(productId: string): string {
  if (!productId) return "";
  if (productId.startsWith('=')) {
    return productId.substring(1);
  }
  return productId;
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
    
    // Try to identify the product ID column
    const possibleProductIdColumns = [
      'productId', 'product_id', 'sku', 'SKU', 'Product ID', 'ProductID', 
      'product id', 'product', 'Product', 'ID', 'id', 'Item', 'item',
      '商品ID', '商品編號', '產品編號', '產品ID', '商品代碼', '貨號'
    ];
    
    // Try to identify the batch ID column
    const possibleBatchIdColumns = [
      'batchId', 'batch_id', 'batch', 'Batch ID', 'BatchID', 'batch id',
      'Batch', 'lot', 'Lot', 'LotID', 'Lot ID', 'lot id',
      '批次', '批號', '批次編號', '批次ID'
    ];
    
    // Try to identify the expiration date column
    const possibleExpirationDateColumns = [
      'expirationDate', 'expiration_date', 'date', 'Date', 'Expiration', 
      'expiration', 'Expiry', 'expiry', 'Exp Date', 'exp date',
      '到期日', '有效期', '效期', '保存期限', '有效日期'
    ];
    
    // Try to identify the quantity column
    const possibleQuantityColumns = [
      'quantity', 'Quantity', 'qty', 'Qty', 'QTY', 'Amount', 'amount',
      '數量', '庫存', '庫存數量', '數目'
    ];
    
    // Try to identify the location column
    const possibleLocationColumns = [
      'location', 'Location', 'loc', 'Loc', 'warehouse', 'Warehouse',
      '位置', '倉庫', '儲位', '庫位'
    ];
    
    // Find the actual column names in the CSV
    let productIdColumn = '';
    let batchIdColumn = '';
    let expirationDateColumn = '';
    let quantityColumn = '';
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
      
      const productId = cleanProductId(rawProductId);
      
      // Get batch ID from identified column or try various fallbacks
      let batchId = '';
      if (batchIdColumn && record[batchIdColumn]) {
        batchId = record[batchIdColumn];
      } else {
        // If no batch ID found, generate one based on row index
        batchId = `batch-${index + 1}`;
      }
      
      // Get expiration date
      let expirationDateStr = '';
      if (expirationDateColumn && record[expirationDateColumn]) {
        expirationDateStr = record[expirationDateColumn];
      } else {
        // Try all possible expiration date columns
        for (const col of possibleExpirationDateColumns) {
          if (record[col]) {
            expirationDateStr = record[col];
            break;
          }
        }
      }
      
      // Parse the expiration date
      let expirationDate = new Date();
      try {
        if (expirationDateStr) {
          expirationDate = new Date(expirationDateStr);
        } else {
          // Default to 30 days from now if no date found
          expirationDate = new Date();
          expirationDate.setDate(expirationDate.getDate() + 30);
        }
      } catch (e) {
        console.error(`Error parsing date '${expirationDateStr}' for row ${index + 1}:`, e);
      }
      
      // Get quantity
      let quantityStr = '';
      if (quantityColumn && record[quantityColumn]) {
        quantityStr = record[quantityColumn];
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
      
      // Get location
      let location = 'default';
      if (locationColumn && record[locationColumn]) {
        location = record[locationColumn];
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
          location 
        });
      }
      
      return {
        productId,
        batchId,
        expirationDate,
        quantity,
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
export async function saveShelfLifeData(data: ShelfLifeData[]): Promise<number> {
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
          expirationDate: item.expirationDate,
          quantity: item.quantity,
          location: item.location,
        },
        create: {
          productId: item.productId,
          batchId: item.batchId,
          expirationDate: item.expirationDate,
          quantity: item.quantity,
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
export async function getAllShelfLifeItems() {
  try {
    return await prisma.shelfLifeItem.findMany({
      orderBy: {
        expirationDate: 'asc',
      },
    });
  } catch (error) {
    console.error("Error fetching shelf life items:", error);
    throw new Error(`Failed to fetch shelf life items: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get expiring shelf life items
 */
export async function getExpiringItems(daysThreshold: number = 30) {
  try {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);
    
    return await prisma.shelfLifeItem.findMany({
      where: {
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
export async function processCSVFile(fileContent: string): Promise<{ savedCount: number; errors: string[] }> {
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
    const savedCount = await saveShelfLifeData(validData);
    
    return {
      savedCount,
      errors,
    };
  } catch (error) {
    console.error("Error processing CSV file:", error);
    throw new Error(`Failed to process CSV file: ${error instanceof Error ? error.message : String(error)}`);
  }
}
