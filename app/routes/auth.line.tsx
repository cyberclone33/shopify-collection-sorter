import { LoaderFunctionArgs, redirect, json } from "@remix-run/node";
import { getLineAuthUrl } from "../utils/line-auth.server";
import { checkRateLimit } from "../utils/rate-limiter.server";

/**
 * This route initiates the LINE OAuth flow
 * It generates a state parameter for security and redirects to LINE's authorization page
 */
export async function loader({ request }: LoaderFunctionArgs) {
  // Get client IP for rate limiting
  const ip = request.headers.get("x-forwarded-for") || 
             request.headers.get("x-real-ip") ||
             "unknown";
  
  // Check rate limit (10 auth attempts per minute)
  const rateLimitResult = checkRateLimit(ip, 10, 60000);
  
  if (rateLimitResult.isRateLimited) {
    console.warn(`Rate limit exceeded for IP: ${ip}`);
    return json(
      { error: "Too many requests, please try again later" },
      { 
        status: 429,
        headers: {
          "Retry-After": Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000).toString(),
          "X-RateLimit-Limit": rateLimitResult.limit.toString(),
          "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
          "X-RateLimit-Reset": Math.ceil(rateLimitResult.resetAt / 1000).toString()
        }
      }
    );
  }
  
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
