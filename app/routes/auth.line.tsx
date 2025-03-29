import { LoaderFunctionArgs, redirect, json } from "@remix-run/node";
import { getLineAuthUrl } from "../utils/line-auth.server";

/**
 * This route initiates the LINE OAuth flow
 * It generates a state parameter for security and redirects to LINE's authorization page
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
  
  // Generate the LINE authorization URL
  const lineAuthUrl = getLineAuthUrl(shop, encodedState);
  
  // For debugging - log the generated URL and state
  console.log("LINE auth state:", state);
  console.log("Generated LINE auth URL:", lineAuthUrl);
  
  // Redirect to LINE login
  return redirect(lineAuthUrl);
}
