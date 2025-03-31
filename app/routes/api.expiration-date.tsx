import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Get the shop from the query parameters
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const variantId = url.searchParams.get("variantId");
  
  if (!shop || !variantId) {
    return json({ 
      success: false, 
      message: "Missing required parameters: shop and variantId" 
    }, { status: 400 });
  }
  
  try {
    // Find shelf life items that match this variant ID
    const shelfLifeItems = await prisma.shelfLifeItem.findMany({
      where: {
        shop,
        shopifyVariantId: variantId,
      },
      orderBy: {
        expirationDate: 'asc', // Get earliest expiring items first
      },
    });
    
    if (shelfLifeItems.length === 0) {
      return json({ 
        success: false, 
        message: "No expiration data found for this product" 
      });
    }
    
    // Return the expiration data
    return json({
      success: true,
      expirationData: shelfLifeItems.map(item => ({
        batchId: item.batchId,
        expirationDate: item.expirationDate,
        quantity: item.quantity,
        location: item.location
      }))
    });
  } catch (error) {
    console.error("Error fetching expiration data:", error);
    return json({ 
      success: false, 
      message: `Error fetching expiration data: ${error instanceof Error ? error.message : String(error)}` 
    }, { status: 500 });
  }
}
