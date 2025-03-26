import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { 
  getLineAccessToken, 
  getLineProfile, 
  parseIdToken,
  saveLineUser
} from "../utils/line-auth.server";
import { createOrLinkShopifyCustomer } from "../utils/shopify-customer.server";

// Admin API access token - in production, store this in environment variables
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN || "";
const SHOPIFY_STORE_DOMAIN = "alphapetstw.myshopify.com";
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
          const shopifyCustomerId = await createOrLinkShopifyCustomer(
            shop,
            SHOPIFY_ACCESS_TOKEN,
            lineProfile.userId,
            lineProfile.displayName,
            idTokenData?.email
          );
          
          if (shopifyCustomerId) {
            console.log(`Successfully linked LINE user to Shopify customer: ${shopifyCustomerId}`);
            
            // Now use the Storefront API to create a customer access token
            if (SHOPIFY_STOREFRONT_TOKEN) {
              try {
                // Get the customer's email 
                const email = idTokenData?.email || `line_${lineProfile.userId}@example.com`;
                
                // Create a unique password (we'll never use this for actual login)
                // This is just for the API call - customers will login with LINE 
                const password = `LINE_${Math.random().toString(36).substring(2, 15)}`;
                
                // Call the Storefront API to create a customer access token
                const customerAccessToken = await createCustomerAccessToken(shop, email, password);
                
                if (customerAccessToken) {
                  console.log("Successfully created customer access token");
                  
                  // Create a special HTML response that will automatically log in the customer
                  return createLoginResponse(shop, customerAccessToken, lineProfile.displayName);
                }
              } catch (tokenError) {
                console.error("Error creating customer access token:", tokenError);
                // Fall back to the old approach if this fails
              }
            }
            
            // Fallback: If we couldn't create a customer access token,
            // redirect to the login page with LINE user info
            const params = new URLSearchParams({
              line_login: 'success',
              customer_id: shopifyCustomerId,
              name: lineProfile.displayName,
              customer_email: idTokenData?.email || `line_${lineProfile.userId}@example.com`
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
      email: idTokenData?.email || ''
    });
    
    return redirect(`https://${shop}/account/login?${params.toString()}`);
    
  } catch (error) {
    console.error("Error processing LINE callback:", error);
    return redirect("/?error=server_error");
  }
}

/**
 * Call the Shopify Storefront API to create a customer access token
 */
async function createCustomerAccessToken(shop: string, email: string, password: string): Promise<string | null> {
  const storefrontApiUrl = `https://${shop}/api/2023-10/graphql.json`;
  
  const mutation = `
    mutation customerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
      customerAccessTokenCreate(input: $input) {
        customerAccessToken {
          accessToken
          expiresAt
        }
        customerUserErrors {
          message
          code
        }
      }
    }
  `;
  
  try {
    const response = await fetch(storefrontApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': SHOPIFY_STOREFRONT_TOKEN
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: { email, password }
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Storefront API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      return null;
    }
    
    const result = data.data.customerAccessTokenCreate;
    
    if (result.customerUserErrors && result.customerUserErrors.length > 0) {
      console.error('Customer access token errors:', result.customerUserErrors);
      return null;
    }
    
    if (result.customerAccessToken) {
      return result.customerAccessToken.accessToken;
    }
    
    return null;
  } catch (error) {
    console.error('Error creating customer access token:', error);
    return null;
  }
}

/**
 * Create a special HTML response that sets the customer access token as a cookie
 * and redirects to the account page
 */
function createLoginResponse(shop: string, accessToken: string, displayName: string): Response {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>LINE Login - Logging in...</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background-color: #f8f8f8;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
        }
        .container {
          text-align: center;
          background-color: white;
          border-radius: 8px;
          padding: 30px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          max-width: 500px;
        }
        h1 {
          color: #06C755;
          margin-top: 0;
        }
        .line-logo {
          width: 60px;
          height: 60px;
          margin-bottom: 20px;
        }
        .message {
          margin: 20px 0;
          color: #333;
        }
        .loader {
          border: 5px solid #f3f3f3;
          border-top: 5px solid #06C755;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
          margin: 20px auto;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <svg class="line-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
          <path fill="#00C300" d="M36 17.478C36 8.072 27.936 0 18 0S0 8.072 0 17.478c0 8.306 7.378 15.29 17.355 16.617.67.144 1.582.445 1.814.997.21.502.14 1.3.07 1.802 0 0-.234 1.393-.285 1.693-.88.502-.4 1.96 1.71 1.07s11.376-6.704 15.518-11.48c2.86-3.15 4.818-6.3 4.818-10.67z"/>
          <path fill="#FFF" d="M32.542 17.478c0-7.522-7.385-13.648-16.458-13.648S-.375 9.956-.375 17.478c0 6.73 5.97 12.372 14.035 13.424.55.118 1.3.365 1.49.817.17.412.11 1.064.05 1.477 0 0-.19 1.142-.23 1.39-.07.412-.33 1.608 1.4.877 1.74-.73 9.33-5.497 12.73-9.418 2.35-2.58 3.44-5.16 3.44-8.74z"/>
          <path fill="#00C300" d="M15.52 13.37h-1.1c-.17 0-.3.14-.3.3v6.8c0 .17.13.3.3.3h1.1c.17 0 .3-.13.3-.3v-6.8c0-.16-.13-.3-.3-.3zm5.06 0h-1.1c-.16 0-.3.14-.3.3v4.06l-3.13-4.23c-.03-.05-.07-.08-.12-.1-.05-.03-.1-.04-.15-.04h-1.1c-.17 0-.3.14-.3.3v6.8c0 .17.13.3.3.3h1.1c.16 0 .3-.13.3-.3v-4.05l3.13 4.24c.05.08.14.12.27.12h1.1c.17 0 .3-.13.3-.3v-6.8c0-.16-.13-.3-.3-.3zm-10.33 5.8H7.16v-5.5c0-.17-.13-.3-.3-.3h-1.1c-.17 0-.3.14-.3.3v6.8c0 .08.03.15.1.2.05.06.13.1.2.1h4.5c.16 0 .3-.13.3-.3v-1c0-.16-.14-.3-.3-.3zm15.96-5.8h-4.5c-.17 0-.3.14-.3.3v6.8c0 .17.13.3.3.3h4.5c.17 0 .3-.13.3-.3v-1c0-.16-.13-.3-.3-.3h-3.1v-1.3h3.1c.17 0 .3-.13.3-.3v-1c0-.16-.13-.3-.3-.3h-3.1v-1.3h3.1c.17 0 .3-.13.3-.3v-1c0-.16-.13-.3-.3-.3z"/>
        </svg>
        <h1>LINE Login Successful</h1>
        <p class="message">Welcome, ${displayName}! Logging you in...</p>
        <div class="loader"></div>
        
        <script>
          // Store the customer access token in localStorage
          localStorage.setItem('customerAccessToken', '${accessToken}');
          
          // Create a cookie with the customer access token
          // Note: This would normally be handled by Shopify's login system
          document.cookie = "_shopify_y=${accessToken}; path=/; domain=.${shop}; secure; samesite=none";
          
          // Redirect to the account page
          setTimeout(function() {
            window.location.href = "https://${shop}/account";
          }, 2000);
        </script>
      </div>
    </body>
    </html>
  `;
  
  return new Response(htmlContent, {
    headers: {
      "Content-Type": "text/html",
      // Set cookies for Shopify customer session
      "Set-Cookie": `_shopify_y=${accessToken}; path=/; domain=.${shop}; secure; samesite=none`
    },
  });
}
