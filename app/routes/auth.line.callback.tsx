import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { 
  getLineAccessToken, 
  getLineProfile, 
  parseIdToken
} from "../utils/line-auth.server";

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
    
    console.log(`Successfully authenticated LINE user: ${lineProfile.displayName}`);
    
    // Since we're having issues with the LineUser table, skip the database operations
    // and just pass the LINE user info to the login page
    
    // Prepare parameters for the redirect
    const params = new URLSearchParams({
      line_login: 'success',
      line_id: lineProfile.userId,
      name: lineProfile.displayName,
      email: idTokenData?.email || ''
    });
    
    // Redirect the user directly to the login page with LINE user information
    return redirect(`https://${shop}/account/login?${params.toString()}`);
    
  } catch (error) {
    console.error("Error processing LINE callback:", error);
    return redirect("/?error=server_error");
  }
}
