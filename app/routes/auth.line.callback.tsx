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
            
            // Generate a random password for the customer
            const randomPassword = generateRandomPassword(16);
            
            // Set the password for the customer using Admin API
            try {
              await setCustomerPassword(shop, customerId, randomPassword);
              
              // Try to create a customer access token using the new password
              try {
                const token = await createCustomerAccessToken(shop, idTokenData?.email || "", randomPassword);
                
                if (token) {
                  console.log("Successfully created customer access token");
                  
                  // Create a special HTML response that will automatically log in the customer
                  return createLoginResponse(token, lineProfile.displayName, idTokenData?.email || `line_${lineProfile.userId}@example.com`, randomPassword);
                }
              } catch (tokenError) {
                console.error("Customer access token errors:", tokenError);
                // Fall back to the old approach if this fails
              }
            } catch (passwordError) {
              console.error("Error setting customer password:", passwordError);
              // Fall back to the old approach if this fails
            }
            
            // Fallback: If we couldn't create a customer access token,
            // redirect to the login page with LINE user info
            const params = new URLSearchParams({
              line_login: 'success',
              customer_id: customerId,
              name: lineProfile.displayName,
              customer_email: idTokenData?.email || `line_${lineProfile.userId}@example.com`,
              return_url: '/account' // Add return_url for proper redirection after login
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
      access_token: tokenData.access_token, // Include LINE access token for auto-login
      return_url: '/account' // Add return_url for proper redirection after login
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
 * Create an HTML response that sets a customer access token cookie and redirects to the account page
 */
function createLoginResponse(customerAccessToken: string, displayName: string, customerEmail: string, randomPassword: string): Response {
  // Updated to directly set the cookie and redirect to account page
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Logging in with LINE...</title>
        <style>
          html, body {
            height: 100%;
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #f9f9f9;
          }
          
          .container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            text-align: center;
            padding: 0 20px;
          }
          
          .card {
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
            padding: 30px;
            width: 100%;
            max-width: 400px;
          }
          
          h1 {
            color: #06C755;
            font-size: 1.5rem;
            margin-bottom: 10px;
          }
          
          p {
            color: #666;
            margin-bottom: 20px;
          }
          
          .spinner {
            display: inline-block;
            width: 40px;
            height: 40px;
            border: 4px solid rgba(6, 199, 85, 0.3);
            border-radius: 50%;
            border-top-color: #06C755;
            animation: spin 1s ease-in-out infinite;
            margin-bottom: 20px;
          }
          
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          
          .line-logo {
            width: 60px;
            height: 60px;
            margin-bottom: 20px;
          }
          
          .user-name {
            color: #06C755;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <svg class="line-logo" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
              <path fill="#06C755" d="M36 17.478C36 8.072 27.936 0 18 0S0 8.072 0 17.478c0 8.306 7.378 15.29 17.355 16.617.67.144 1.582.445 1.814.997.21.502.14 1.3.07 1.802 0 0-.234 1.393-.285 1.693-.88.502-.4 1.96 1.71 1.07s11.376-6.704 15.518-11.48c2.86-3.15 4.818-6.3 4.818-10.67z"/>
            </svg>
            <h1>Successfully Connected</h1>
            <p>Welcome, <span class="user-name">${displayName}</span>!</p>
            <div class="spinner"></div>
            <p>Logging you in automatically...</p>
          </div>
        
          <script>
            // Directly set the customerAccessToken cookie
            document.cookie = \`customerAccessToken=${customerAccessToken}; path=/; secure; SameSite=None\`;
            
            // Then redirect straight to the account page
            setTimeout(function() {
              window.location.href = "https://${SHOPIFY_STORE_DOMAIN}/account";
            }, 2000);
          </script>
        </div>
      </body>
    </html>
  `;
  
  return new Response(htmlContent, {
    status: 200,
    headers: {
      "Content-Type": "text/html",
    },
  });
}
