import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { 
  getLineAccessToken, 
  getLineProfile, 
  parseIdToken,
  saveLineUser
} from "../utils/line-auth.server";
import { createOrLinkShopifyCustomer } from "../utils/shopify-customer.server";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

// Constants for Shopify store domain and API tokens
const SHOPIFY_STORE_DOMAIN = "alphapetstw.myshopify.com";
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN || "";
const SHOPIFY_STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN || "";

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
  const shop = SHOPIFY_STORE_DOMAIN;
  
  // In production, you should verify the state parameter matches what was sent
  
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
            idTokenData?.email
          );
          
          if (customerId) {
            console.log(`Successfully linked LINE user to Shopify customer: ${customerId}`);
            
            // Use LINE access token as password for consistency
            const password = tokenData.access_token.substring(0, 40);
            
            // Set the password for the customer using Admin API
            try {
              await setCustomerPassword(shop, customerId, password);
              
              // Redirect to login page with all necessary parameters
              const params = new URLSearchParams({
                line_login: 'success',
                customer_id: customerId,
                name: lineProfile.displayName,
                customer_email: idTokenData?.email || `line_${lineProfile.userId}@example.com`,
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
    // redirect to the login page with LINE user info
    const params = new URLSearchParams({
      line_login: 'success',
      line_id: lineProfile.userId,
      name: lineProfile.displayName,
      customer_email: idTokenData?.email || `line_${lineProfile.userId}@example.com`,
      access_token: tokenData.access_token.substring(0, 40),
      return_url: '/account'
    });
    
    return redirect(`https://${shop}/account/login?${params.toString()}`);
    
  } catch (error) {
    console.error("Error processing LINE callback:", error);
    return redirect("/?error=server_error");
  }
}

/**
 * Generate a secure random password
 */
function generateRandomPassword(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
  let password = '';
  const randomBytes = crypto.randomBytes(length);
  
  for (let i = 0; i < length; i++) {
    const randomIndex = randomBytes[i] % chars.length;
    password += chars.charAt(randomIndex);
  }
  
  return password;
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

/**
 * Create a customer access token using the Shopify Storefront API
 */
async function createCustomerAccessToken(shop: string, email: string, password: string): Promise<string | null> {
  const storefrontApiEndpoint = `https://${shop}/api/2023-10/graphql.json`;
  
  const query = `
    mutation customerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
      customerAccessTokenCreate(input: $input) {
        customerAccessToken {
          accessToken
          expiresAt
        }
        customerUserErrors {
          code
          field
          message
        }
      }
    }
  `;
  
  const variables = {
    input: {
      email: email,
      password: password
    }
  };
  
  const response = await fetch(storefrontApiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': SHOPIFY_STOREFRONT_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });
  
  const data = await response.json();
  
  if (data.errors) {
    throw data.errors;
  }
  
  const result = data.data.customerAccessTokenCreate;
  
  if (result.customerUserErrors && result.customerUserErrors.length > 0) {
    throw result.customerUserErrors;
  }
  
  return result.customerAccessToken.accessToken;
}
