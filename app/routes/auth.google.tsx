import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { getGoogleAuthUrl } from "../utils/google-auth.server";
import crypto from "crypto";

// Constants for Shopify store domain
const SHOPIFY_STORE_DOMAIN = "alphapetstw.myshopify.com";

/**
 * This route initiates the Google OAuth flow
 * It redirects the user to the Google authorization page
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  
  // Get shop from query parameter
  const shop = url.searchParams.get("shop") || SHOPIFY_STORE_DOMAIN;
  
  // Generate a random state for CSRF protection
  const state = crypto.randomBytes(16).toString("hex");
  
  try {
    // Generate the Google OAuth URL
    const authUrl = getGoogleAuthUrl(shop, state);
    
    console.log(`Redirecting to Google OAuth: ${authUrl}`);
    
    // Redirect to Google OAuth
    return redirect(authUrl);
  } catch (error) {
    console.error("Error initiating Google OAuth:", error);
    return redirect(`https://${shop}/account/login?error=oauth_init_failed`);
  }
}
