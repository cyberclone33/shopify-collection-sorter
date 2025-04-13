import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Extract shop from the request - support both admin and public access
    let shop;
    
    // Check if this is coming from app proxy (storefront)
    try {
      // First try to authenticate as a public request
      const appProxyResult = await authenticate.public.appProxy(request);
      shop = appProxyResult.shop;
      console.log("Authenticated as app proxy request from shop:", shop);
    } catch (appProxyError) {
      // If app proxy auth fails, try admin auth
      try {
        const { session } = await authenticate.admin(request);
        shop = session.shop;
        console.log("Authenticated as admin request from shop:", shop);
      } catch (adminAuthError) {
        // If both fail, extract shop from URL parameters
        const url = new URL(request.url);
        shop = url.searchParams.get('shop');
        console.log("Using shop from URL parameter:", shop);
        
        if (!shop) {
          throw new Error("Authentication failed and no shop parameter provided");
        }
      }
    }
    
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
    console.log(`Fetching discounted products for shop: ${shop}, max: ${maxProducts}, sortBy: ${sortBy}`);
    
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
