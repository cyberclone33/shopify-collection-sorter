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
            
            // Use first 40 chars of LINE access token as password
            const password = tokenData.access_token.substring(0, 40);
            
            // Set the password for the customer using Admin API
            try {
              await setCustomerPassword(shop, customerId, password);
              
              // Try to create a customer access token using the new password
              try {
                const customerEmail = idTokenData?.email || `line_${lineProfile.userId}@example.com`;
                const token = await createCustomerAccessToken(shop, customerEmail, password);
                
                if (token) {
                  console.log("Successfully created customer access token");
                  
                  // Create an HTML response that auto-submits Shopify's native login form
                  return createLoginResponse(token, lineProfile.displayName, customerEmail, password);
                }
              } catch (tokenError) {
                console.error("Error creating customer access token:", tokenError);
              }
            } catch (passwordError) {
              console.error("Error setting customer password:", passwordError);
            }
            
            // Fallback: If we couldn't create a customer access token,
            // redirect to the login page with LINE user info
            const params = new URLSearchParams({
              line_login: 'success',
              customer_id: customerId,
              name: lineProfile.displayName,
              customer_email: idTokenData?.email || `line_${lineProfile.userId}@example.com`,
              access_token: tokenData.access_token.substring(0, 40), // Use truncated token
              return_url: '/account'
            });
            
            return redirect(`https://${shop}/account/login?${params.toString()}`);
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
      access_token: tokenData.access_token.substring(0, 40), // Use truncated token
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

/**
 * Create an HTML response that auto-submits Shopify's native login form
 */
function createLoginResponse(customerAccessToken: string, displayName: string, customerEmail: string, password: string): Response {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Logging in...</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: #f5f5f5;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .loading-container {
            text-align: center;
            padding: 2rem;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .line-brand {
            color: #06C755;
            font-weight: bold;
          }
          .spinner {
            width: 40px;
            height: 40px;
            margin: 20px auto;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #06C755;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="loading-container">
          <h2>Welcome back, <span class="line-brand">${displayName}</span>!</h2>
          <p>Completing your LINE login...</p>
          <div class="spinner"></div>
          
          <!-- Hidden Shopify login form -->
          <form id="shopify-login" method="post" action="/account/login" style="display: none;">
            <input type="email" name="customer[email]" value="${customerEmail}">
            <input type="password" name="customer[password]" value="${password}">
            <input type="hidden" name="form_type" value="customer_login">
            <input type="hidden" name="utf8" value="✓">
          </form>
          
          <script>
            // Auto-submit the form after a short delay
            setTimeout(() => {
              document.getElementById('shopify-login').submit();
            }, 1500);
          </script>
        </div>
      </body>
    </html>
  `;
  
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html",
    },
  });
}
