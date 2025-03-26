import { LoaderFunctionArgs, redirect, json } from "@remix-run/node";
import { getLineAuthUrl } from "../utils/line-auth.server";
import { authenticate } from "../shopify.server";

/**
 * This route initiates the LINE OAuth flow
 * It generates a state parameter for security and redirects to LINE's authorization page
 */
export async function loader({ request }: LoaderFunctionArgs) {
  // Get the shop from the session
  const { session } = await authenticate.public.appProxy(request);
  const shop = session?.shop;

  if (!shop) {
    return redirect("/");
  }

  // For debugging - check if environment variables are set
  const LINE_CLIENT_ID = process.env.LINE_CLIENT_ID || "";
  const LINE_REDIRECT_URI = process.env.LINE_REDIRECT_URI || "";
  
  if (!LINE_CLIENT_ID || !LINE_REDIRECT_URI) {
    console.error("Missing LINE OAuth configuration:", {
      clientIdSet: !!LINE_CLIENT_ID,
      redirectUriSet: !!LINE_REDIRECT_URI
    });
    return json({ error: "Missing LINE OAuth configuration" }, { status: 500 });
  }

  // Generate a state parameter to prevent CSRF attacks
  const state = Math.random().toString(36).substring(2, 15);
  
  // Store state in session or cookie for verification when the user returns
  // This is a simplified example - in production you should use a more secure method
  
  // Generate the LINE authorization URL
  const lineAuthUrl = getLineAuthUrl(shop, state);
  
  // For debugging - log the generated URL
  console.log("Generated LINE auth URL:", lineAuthUrl);
  
  // Redirect to LINE login
  return redirect(lineAuthUrl);
}
