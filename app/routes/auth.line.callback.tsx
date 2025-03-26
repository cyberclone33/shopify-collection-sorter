import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { 
  getLineAccessToken, 
  getLineProfile, 
  parseIdToken, 
  saveLineUser
} from "../utils/line-auth.server";
import { createOrLinkShopifyCustomer } from "../utils/shopify-customer.server";
import { authenticate } from "../shopify.server";

/**
 * This route handles the callback from LINE OAuth
 * It exchanges the authorization code for an access token,
 * fetches the user's profile, and creates/updates the user in our database
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // Handle errors from LINE
  if (error) {
    console.error(`LINE OAuth error: ${error} - ${errorDescription}`);
    return redirect(`/?error=${error}`);
  }

  // Validate required parameters
  if (!code || !state) {
    console.error("Missing required parameters from LINE callback");
    return redirect("/?error=invalid_request");
  }

  // Extract shop from state parameter (we should encode this in the state)
  // For now, use a default shop
  const shop = "alphapetstw.myshopify.com";
  
  // In production, you should verify the state parameter matches what was sent
  
  try {
    // Exchange code for access token
    const tokenData = await getLineAccessToken(code);
    
    // Get user profile from LINE
    const lineProfile = await getLineProfile(tokenData.access_token);
    
    // Parse ID token to get additional user info (like email)
    const idTokenData = tokenData.id_token ? parseIdToken(tokenData.id_token) : null;
    
    // Save LINE user data to our database
    const lineUser = await saveLineUser(shop, lineProfile, tokenData, idTokenData);
    
    // For now, we'll skip creating a Shopify customer since we don't have the session
    // In a production app, you would need to implement a different approach
    console.log(`Successfully authenticated LINE user: ${lineProfile.displayName}`);
    
    // Redirect to success page or back to the store
    return redirect(`https://${shop}?login=success`);
    
  } catch (error) {
    console.error("Error processing LINE callback:", error);
    return redirect("/?error=server_error");
  }
}
