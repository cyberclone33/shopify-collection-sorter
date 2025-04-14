import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import productCache from "../utils/productCache";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Require authentication to prevent unauthorized cache clearing
    const { admin, session } = await authenticate.admin(request);
    
    // Clear the product cache
    productCache.clear();
    
    // Return success message
    return json({
      status: "success",
      message: "Product cache cleared successfully",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error clearing cache:", error);
    return json({
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
};
