import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getRandomProducts } from '../utils/productFetcher';

/**
 * API endpoint to load random products asynchronously
 * This allows the main page to load faster and then fetch the product data in the background
 * 
 * NOTE: This approach has been replaced with a server action in app.daily-discounts.tsx
 * for better authentication handling, but we're keeping this as a fallback.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    // Try multiple authentication methods
    let admin, session;
    
    try {
      // First try regular admin authentication
      const authResult = await authenticate.admin(request);
      admin = authResult.admin;
      session = authResult.session;
    } catch (authError) {
      // Fall back to URL parameters if admin auth fails
      const url = new URL(request.url);
      const shop = url.searchParams.get("shop");
      const token = url.searchParams.get("token");
      
      if (!shop || !token) {
        return json({
          status: "error",
          message: "Authentication failed. Please provide shop and token parameters.",
          products: []
        }, { status: 401 });
      }
      
      // Create a mock session and admin context
      session = { shop, accessToken: token };
      
      // Create an admin API context with the token
      admin = {
        graphql: async (query: string, options?: { variables?: any }) => {
          const shopifyDomain = shop;
          const url = `https://${shopifyDomain}/admin/api/2025-01/graphql.json`;
          
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': token
              },
              body: JSON.stringify({
                query,
                variables: options?.variables
              })
            });
            
            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`);
            }
            
            // Return an object with a json method to match the Shopify admin API context interface
            return {
              json: async () => {
                return await response.json();
              }
            };
          } catch (error) {
            console.error("Error in direct GraphQL call:", error);
            throw error;
          }
        }
      };
    }
    
    // Now proceed with fetching products using whatever authentication method worked
    const url = new URL(request.url);
    const countParam = url.searchParams.get("count");
    const count = countParam ? parseInt(countParam, 10) : 6;
    const forceRefresh = url.searchParams.get("refresh") === "true";
    
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

/**
 * Support loading products via POST request as well
 * This can handle form submissions more reliably
 */
export async function action({ request }: ActionFunctionArgs) {
  // Delegate to the loader function
  return loader({ request });
}