import { LoaderFunctionArgs, redirect, json } from "@remix-run/node";
import { 
  getLineAccessToken, 
  getLineProfile, 
  parseIdToken,
  saveLineUser,
  createLineJWT
} from "../utils/line-auth.server";
import { createOrLinkShopifyCustomer } from "../utils/shopify-customer.server";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { checkRateLimit } from "../utils/rate-limiter.server";

// Constants for Shopify store domain and API tokens
const SHOPIFY_STORE_DOMAIN = "alphapetstw.myshopify.com";
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN || "";
const SHOPIFY_STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN || "";

/**
 * Generate a secure random password
 * Creates a 32-character string with numbers, lowercase and uppercase letters
 */
function generateSecurePassword(length = 32): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  
  // Use crypto.randomBytes for better randomness
  const randomBytes = crypto.randomBytes(length);
  
  for (let i = 0; i < length; i++) {
    const randomIndex = randomBytes[i] % charset.length;
    password += charset[randomIndex];
  }
  
  return password;
}

/**
 * This route handles the callback from LINE OAuth
 * It exchanges the authorization code for an access token,
 * fetches the user's profile, and creates/updates the user in our database
 */
export async function loader({ request }: LoaderFunctionArgs) {
  // Get client IP for rate limiting
  const ip = request.headers.get("x-forwarded-for") || 
             request.headers.get("x-real-ip") ||
             "unknown";
  
  // Check rate limit (5 auth callback attempts per minute - more restrictive for callbacks)
  const rateLimitResult = checkRateLimit(ip, 5, 60000);
  
  if (rateLimitResult.isRateLimited) {
    console.warn(`Rate limit exceeded for callback IP: ${ip}`);
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

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const encodedState = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  
  let marketingConsent = false;
  let shop = SHOPIFY_STORE_DOMAIN;
  
  // Try to decode the state parameter
  try {
    // Decode the base64 state
    const decodedState = Buffer.from(encodedState || '', 'base64').toString();
    const stateObj = JSON.parse(decodedState);
    
    // Extract marketing consent from state
    marketingConsent = stateObj.marketingConsent === true;
    
    // Extract shop from state if available
    if (stateObj.shop) {
      shop = stateObj.shop;
    }
    
    console.log(`LINE callback - Decoded state:`, stateObj);
    console.log(`LINE callback - Marketing consent from state: ${marketingConsent} (${typeof marketingConsent})`);
  } catch (stateError) {
    console.error("Error parsing state parameter:", stateError);
    // If state cannot be parsed, check for the legacy parameter in the URL
    const legacyConsent = url.searchParams.get("marketing_consent");
    if (legacyConsent === "1") {
      marketingConsent = true;
    }
  }

  // Handle errors from LINE
  if (error) {
    console.error(`LINE OAuth error: ${error} - ${errorDescription}`);
    return redirect(`/?error=${error}`);
  }

  // Validate required parameters
  if (!code || !encodedState) {
    console.error("Missing required parameters from LINE callback");
    return redirect("/?error=invalid_request");
  }

  try {
    // Exchange code for access token
    const tokenData = await getLineAccessToken(code);
    
    // Get user profile from LINE
    const lineProfile = await getLineProfile(tokenData.access_token);
    
    // Parse ID token to get additional user info (like email)
    const idTokenData = tokenData.id_token ? parseIdToken(tokenData.id_token) : null;
    
    console.log(`Successfully authenticated LINE user: ${lineProfile.displayName}`);
    
    // Try to save LINE user data to our database
    try {
      const lineUser = await saveLineUser(shop, lineProfile, tokenData, idTokenData);
      
      // Try to create or link Shopify customer using Admin API
      if (SHOPIFY_ACCESS_TOKEN) {
        try {
          const customerId = await createOrLinkShopifyCustomer(
            shop,
            SHOPIFY_ACCESS_TOKEN,
            lineProfile.userId,
            lineProfile.displayName,
            idTokenData?.email,
            undefined, // password will be set later
            marketingConsent
          );
          
          if (customerId) {
            console.log(`Successfully linked LINE user to Shopify customer: ${customerId}`);
            
            // Generate a secure random password instead of using LINE access token
            const password = generateSecurePassword(32);
            
            // Set the password for the customer using Admin API
            try {
              await setCustomerPassword(shop, customerId, password);
              
              // Create a JWT token with all necessary information
              const email = idTokenData?.email || `line_${lineProfile.userId}@example.com`;
              const jwt = createLineJWT(
                customerId,
                email,
                lineProfile.displayName,
                password,
                '/account'
              );
              
              // Redirect to login page with JWT token
              return redirect(`https://${shop}/account/login?line_token=${jwt}`);
            } catch (passwordError) {
              console.error("Error setting customer password:", passwordError);
            }
          }
        } catch (customerError) {
          console.error("Error linking customer:", customerError);
          // Continue to fallback redirect
        }
      }
    } catch (dbError) {
      console.error("Database operation failed:", dbError);
      // Continue to fallback redirect
    }
    
    // Fallback: If we couldn't create/link a customer or don't have an access token,
    // create a JWT token with LINE user info
    const email = idTokenData?.email || `line_${lineProfile.userId}@example.com`;
    const jwt = createLineJWT(
      lineProfile.userId,
      email,
      lineProfile.displayName,
      tokenData.access_token,
      '/account'
    );
    
    return redirect(`https://${shop}/account/login?line_token=${jwt}`);
    
  } catch (error) {
    console.error("Error processing LINE callback:", error);
    return redirect("/?error=server_error");
  }
}

/**
 * Set a password for a customer using the Shopify Admin API
 */
async function setCustomerPassword(shop: string, customerId: string, password: string): Promise<void> {
  const adminApiEndpoint = `https://${shop}/admin/api/2023-10/customers/${customerId}.json`;
  
  const response = await fetch(adminApiEndpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
    },
    body: JSON.stringify({
      customer: {
        id: customerId,
        password: password,
        password_confirmation: password
      }
    })
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to set customer password: ${JSON.stringify(errorData)}`);
  }
}
