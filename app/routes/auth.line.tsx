import { LoaderFunctionArgs, redirect } from "@remix-run/node";
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

  // Generate a state parameter to prevent CSRF attacks
  const state = Math.random().toString(36).substring(2, 15);
  
  // Store state in session or cookie for verification when the user returns
  // This is a simplified example - in production you should use a more secure method
  
  // Generate the LINE authorization URL
  const lineAuthUrl = getLineAuthUrl(shop, state);
  
  // Redirect to LINE login
  return redirect(lineAuthUrl);
}
