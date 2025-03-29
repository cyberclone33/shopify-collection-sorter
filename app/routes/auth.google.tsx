import { LoaderFunctionArgs, redirect, json } from "@remix-run/node";
import { getGoogleAuthUrl } from "../utils/google-auth.server";

/**
 * This route initiates the Google OAuth flow
 * It generates a state parameter for security and redirects to Google's authorization page
 */
export async function loader({ request }: LoaderFunctionArgs) {
  // Get the shop from the query parameter
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const marketingConsent = url.searchParams.get("marketing_consent") || "0";
  
  if (!shop) {
    console.error("No shop parameter provided");
    return json({ error: "No shop parameter provided" }, { status: 400 });
  }

  // For debugging - check if environment variables are set
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
  const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";
  
  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
    console.error("Missing Google OAuth configuration:", {
      clientIdSet: !!GOOGLE_CLIENT_ID,
      redirectUriSet: !!GOOGLE_REDIRECT_URI
    });
    return json({ error: "Missing Google OAuth configuration" }, { status: 500 });
  }

  // Generate a state parameter that includes a random string for CSRF protection
  // and the marketing consent value
  const randomState = Math.random().toString(36).substring(2, 15);
  const state = JSON.stringify({
    random: randomState,
    marketingConsent: marketingConsent === "1",
    shop
  });
  
  // Base64 encode the state to ensure it's URL-safe
  const encodedState = Buffer.from(state).toString('base64');
  
  // Generate the Google authorization URL with the encoded state
  const googleAuthUrl = getGoogleAuthUrl(shop, encodedState);
  
  // For debugging - log the generated URL and state
  console.log("Google auth state:", state);
  console.log("Generated Google auth URL:", googleAuthUrl);
  
  // Redirect to Google login
  return redirect(googleAuthUrl);
}
