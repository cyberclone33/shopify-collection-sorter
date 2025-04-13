import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Extract shop from the request
    const { admin, session } = await authenticate.public.appProxy(request);
    const shop = session.shop;
    
    // Get URL parameters
    const url = new URL(request.url);
    const maxProducts = parseInt(url.searchParams.get('max') || '4', 10);
    const sortBy = url.searchParams.get('sort') || 'newest';
    
    // Validate shop
    if (!shop) {
      return json({ 
        status: "error", 
        message: "Shop not authenticated" 
      }, { status: 401 });
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
    const discountedProducts = await prisma.dailyDiscountLog.findMany({
      where: {
        shop: shop
      },
      orderBy: orderBy,
      take: maxProducts
    });
    
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
      appliedAt: product.appliedAt
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
