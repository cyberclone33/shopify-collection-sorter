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
 * Parse CSV data into ShelfLifeData objects
 */
export async function parseCSV(csvContent: string): Promise<ShelfLifeData[]> {
  try {
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    return records.map((record: any) => ({
      productId: record.productId || record.product_id || record.sku || "",
      batchId: record.batchId || record.batch_id || "",
      expirationDate: new Date(record.expirationDate || record.expiration_date || record.date),
      quantity: parseInt(record.quantity, 10) || 0,
      location: record.location || "default",
    }));
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
    const validData = parsedData.filter(item => {
      if (!item.productId) {
        errors.push(`Missing product ID for batch ${item.batchId}`);
        return false;
      }
      if (!item.batchId) {
        errors.push(`Missing batch ID for product ${item.productId}`);
        return false;
      }
      if (isNaN(item.expirationDate.getTime())) {
        errors.push(`Invalid expiration date for product ${item.productId}, batch ${item.batchId}`);
        return false;
      }
      if (item.quantity < 0) {
        errors.push(`Invalid quantity for product ${item.productId}, batch ${item.batchId}`);
        return false;
      }
      return true;
    });
    
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
