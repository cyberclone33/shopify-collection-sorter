import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getRandomProducts } from '../utils/productFetcher';

/**
 * API endpoint to load random products asynchronously
 * This allows the main page to load faster and then fetch the product data in the background
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const countParam = url.searchParams.get("count");
  const count = countParam ? parseInt(countParam, 10) : 6;
  const forceRefresh = url.searchParams.get("refresh") === "true";
  
  try {
    // Get random products using our optimized utility
    const { products, stats, cacheStatus } = await getRandomProducts(
      count,
      admin,
      session.shop,
      forceRefresh
    );
    
    if (products.length === 0) {
      return json({
        status: "error",
        message: "No products found meeting minimum requirements (image and positive inventory).",
        products: []
      });
    }
    
    // The first product is our primary random product (for backward compatibility)
    const randomProduct = products[0];
    
    // For detailed debugging, log the selected products
    console.log(`API: Using ${products.length} random products for response`);
    
    return json({
      status: "success",
      products,
      randomProduct,
      productStats: stats,
      totalProductsScanned: stats.total,
      cacheStatus
    });
    
  } catch (error) {
    console.error("API Error fetching random products:", error);
    return json({
      status: "error",
      message: error instanceof Error ? error.message : "An unknown error occurred",
      products: []
    }, { status: 500 });
  }
}