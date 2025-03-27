import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { 
  getGoogleAccessToken, 
  getGoogleProfile, 
  parseIdToken,
  saveGoogleUser
} from "../utils/google-auth.server";
import { createOrLinkShopifyCustomer } from "../utils/shopify-customer.server";
import crypto from "crypto";

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
 * This route handles the callback from Google OAuth
 * It exchanges the authorization code for an access token,
 * fetches the user's profile, and creates/updates the user in our database
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Handle errors from Google
  if (error) {
    console.error(`Google OAuth error: ${error}`);
    return redirect(`/?error=${error}`);
  }

  // Validate required parameters
  if (!code || !state) {
    console.error("Missing required parameters from Google callback");
    return redirect("/?error=invalid_request");
  }

  // Extract shop from state parameter (we should encode this in the state)
  // For now, use a default shop
  const shop = SHOPIFY_STORE_DOMAIN;
  
  try {
    // Exchange code for access token
    const tokenData = await getGoogleAccessToken(code);
    
    // Get user profile from Google
    const googleProfile = await getGoogleProfile(tokenData.access_token);
    
    // Parse ID token to get additional user info
    const idTokenData = tokenData.id_token ? parseIdToken(tokenData.id_token) : null;
    
    console.log(`Successfully authenticated Google user: ${googleProfile.name}`);
    
    // Try to save Google user data to our database
    try {
      const googleUser = await saveGoogleUser(shop, googleProfile, tokenData);
      
      // Try to create or link Shopify customer using Admin API
      if (SHOPIFY_ACCESS_TOKEN) {
        try {
          const customerId = await createOrLinkShopifyCustomer(
            shop,
            SHOPIFY_ACCESS_TOKEN,
            googleProfile.sub,
            googleProfile.name,
            googleProfile.email
          );
          
          if (customerId) {
            console.log(`Successfully linked Google user to Shopify customer: ${customerId}`);
            
            // Generate a secure random password instead of using Google access token
            const password = generateSecurePassword(32);
            
            // Set the password for the customer using Admin API
            try {
              await setCustomerPassword(shop, customerId, password);
              
              // Redirect to login page with all necessary parameters
              const params = new URLSearchParams({
                google_login: 'success',
                customer_id: customerId,
                name: encodeURIComponent(googleProfile.name),
                customer_email: googleProfile.email || `google_${googleProfile.sub}@example.com`,
                access_token: password,
                return_url: '/account'
              });
              
              return redirect(`https://${shop}/account/login?${params.toString()}`);
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
    // redirect to the login page with Google user info
    const params = new URLSearchParams({
      google_login: 'success',
      google_id: googleProfile.sub,
      name: encodeURIComponent(googleProfile.name),
      customer_email: googleProfile.email || `google_${googleProfile.sub}@example.com`,
      access_token: tokenData.access_token,
      return_url: '/account'
    });
    
    return redirect(`https://${shop}/account/login?${params.toString()}`);
    
  } catch (error) {
    console.error("Error processing Google callback:", error);
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
