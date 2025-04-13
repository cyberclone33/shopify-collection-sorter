import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Get URL parameters
    const url = new URL(request.url);
    const maxProducts = parseInt(url.searchParams.get('max') || '4', 10);
    const sortBy = url.searchParams.get('sort') || 'newest';
    const shop = url.searchParams.get('shop');
    
    console.log(`API request for discounted products - shop: ${shop}, maxProducts: ${maxProducts}, sortBy: ${sortBy}`);
    
    // Validate shop parameter
    if (!shop) {
      return json({ 
        status: "error", 
        message: "Missing shop parameter" 
      }, { status: 400 });
    }
    
    // Query parameters for findMany
    let orderBy: any = { appliedAt: 'desc' }; // Default to newest
    
    // Apply sorting options
    if (sortBy === 'highest_discount') {
      orderBy = { savingsPercentage: 'desc' };
    } else if (sortBy === 'lowest_price') {
      orderBy = { discountedPrice: 'asc' };
    }
    
    // Fetch discounted products
    console.log(`Querying DailyDiscountLog for shop: ${shop}`);
    const discountedProducts = await prisma.dailyDiscountLog.findMany({
      where: {
        shop: shop
      },
      orderBy: orderBy,
      take: maxProducts
    });
    
    console.log(`Found ${discountedProducts.length} discounted products for shop ${shop}`);
    
    // Format product data for the frontend
    const formattedProducts = discountedProducts.map(product => ({
      id: product.id,
      productId: product.productId,
      productTitle: product.productTitle,
      variantId: product.variantId,
      variantTitle: product.variantTitle || null,
      originalPrice: product.originalPrice,
      discountedPrice: product.discountedPrice,
      compareAtPrice: product.compareAtPrice,
      discountPercentage: product.discountPercentage,
      savingsAmount: product.savingsAmount,
      savingsPercentage: product.savingsPercentage,
      currencyCode: product.currencyCode,
      imageUrl: product.imageUrl,
      appliedAt: product.appliedAt,
      inventoryQuantity: product.inventoryQuantity
    }));
    
    // Return the product data
    return json({
      status: "success",
      products: formattedProducts
    });
    
  } catch (error) {
    console.error("Error fetching discounted products:", error);
    return json({ 
      status: "error", 
      message: error instanceof Error ? error.message : "An unknown error occurred"
    }, { status: 500 });
  }
};
