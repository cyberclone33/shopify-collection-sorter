import { LoaderFunctionArgs, redirect, json } from "@remix-run/node";
import { getFacebookAuthUrl } from "../utils/facebook-auth.server";

/**
 * This route initiates the Facebook OAuth flow
 * It generates a state parameter for security and redirects to Facebook's authorization page
 */
export async function loader({ request }: LoaderFunctionArgs) {
  // Get the shop from the query parameter
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  
  if (!shop) {
    console.error("No shop parameter provided");
    return json({ error: "No shop parameter provided" }, { status: 400 });
  }

  // For debugging - check if environment variables are set
  const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || "";
  const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || "";
  
  if (!FACEBOOK_APP_ID || !FACEBOOK_REDIRECT_URI) {
    console.error("Missing Facebook OAuth configuration:", {
      appIdSet: !!FACEBOOK_APP_ID,
      redirectUriSet: !!FACEBOOK_REDIRECT_URI
    });
    return json({ error: "Missing Facebook OAuth configuration" }, { status: 500 });
  }

  // Generate a state parameter to prevent CSRF attacks
  const state = Math.random().toString(36).substring(2, 15);
  
  // Generate the Facebook authorization URL
  const facebookAuthUrl = getFacebookAuthUrl(shop, state);
  
  // For debugging - log the generated URL
  console.log("Generated Facebook auth URL:", facebookAuthUrl);
  
  // Redirect to Facebook login
  return redirect(facebookAuthUrl);
}
