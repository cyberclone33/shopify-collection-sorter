import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { 
  getLineAccessToken, 
  getLineProfile, 
  parseIdToken, 
  saveLineUser
} from "../utils/line-auth.server";
import { createOrLinkShopifyCustomer } from "../utils/shopify-customer.server";

// Admin API access token - in production, store this in environment variables
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN || "";

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
    
    console.log(`Successfully authenticated LINE user: ${lineProfile.displayName}`);
    
    // Create or link Shopify customer using Admin API
    if (SHOPIFY_ACCESS_TOKEN) {
      const shopifyCustomerId = await createOrLinkShopifyCustomer(
        shop,
        SHOPIFY_ACCESS_TOKEN,
        lineProfile.userId,
        lineProfile.displayName,
        idTokenData?.email
      );
      
      if (shopifyCustomerId) {
        console.log(`Successfully linked LINE user to Shopify customer: ${shopifyCustomerId}`);
        
        // For Shopify Plus stores, we could use Multipass for seamless login
        // For regular stores, we need to redirect to the login page
        // Here we'll redirect to the account page with a special parameter
        return redirect(`https://${shop}/account?line_login=success&customer_id=${shopifyCustomerId}`);
      }
    }
    
    // If we couldn't create/link a customer or don't have an access token,
    // redirect to the login page with LINE user info
    const params = new URLSearchParams({
      line_login: 'success',
      line_id: lineProfile.userId,
      name: lineProfile.displayName,
      email: idTokenData?.email || ''
    });
    
    return redirect(`https://${shop}/account/login?${params.toString()}`);
    
  } catch (error) {
    console.error("Error processing LINE callback:", error);
    return redirect("/?error=server_error");
  }
}
