import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * This endpoint provides authentication information for client-side API calls
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Authentication - this will redirect to login if not authenticated
    const { admin, session } = await authenticate.admin(request);
    
    // Return authentication info that can be used for API calls
    return json({
      status: "success",
      shop: session.shop,
      accessToken: session.accessToken,
      expiresAt: session.expires?.toISOString() || null
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    console.error("Authentication error:", error);
    // Return error but don't expose sensitive information
    return json({
      status: "error",
      message: "Authentication required"
    }, { 
      status: 401,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  }
};
