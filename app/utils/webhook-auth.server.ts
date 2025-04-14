/**
 * Webhook authentication utility
 * Validates incoming webhook requests using an admin API token
 */

/**
 * Validates a webhook request using an admin API token or a secret key
 * @param request - The incoming request
 * @returns True if authenticated, false otherwise
 */
export async function authenticateWebhook(request: Request): Promise<boolean> {
  try {
    // First priority: Use SHOPIFY_ADMIN_API_TOKEN for authentication if available
    const adminApiToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
    
    if (adminApiToken) {
      // Check for the API token in headers
      const headerApiToken = request.headers.get("X-Shopify-Admin-API-Token");
      if (headerApiToken === adminApiToken) {
        return true;
      }
      
      // Check URL search params
      const url = new URL(request.url);
      const queryApiToken = url.searchParams.get("apiToken");
      if (queryApiToken === adminApiToken) {
        return true;
      }
      
      // If it's a POST request, check the body
      if (request.method === "POST" && request.headers.get("content-type") === "application/json") {
        const clonedRequest = request.clone(); // Clone to avoid consuming the body
        const body = await clonedRequest.json();
        if (body.apiToken === adminApiToken) {
          return true;
        }
      }
    }
    
    // Fallback: If admin API token is not provided or doesn't match, 
    // try using the webhook secret key as before
    const webhookSecretKey = process.env.WEBHOOK_SECRET_KEY;
    
    if (webhookSecretKey) {
      // Check for the secret key in headers
      const headerSecretKey = request.headers.get("X-Webhook-Secret");
      if (headerSecretKey === webhookSecretKey) {
        return true;
      }
      
      // Check URL search params
      const url = new URL(request.url);
      const querySecretKey = url.searchParams.get("secretKey");
      if (querySecretKey === webhookSecretKey) {
        return true;
      }
      
      // If it's a POST request, check the body
      if (request.method === "POST" && request.headers.get("content-type") === "application/json") {
        const clonedRequest = request.clone(); // Clone to avoid consuming the body
        const body = await clonedRequest.json();
        if (body.secretKey === webhookSecretKey) {
          return true;
        }
      }
    }
    
    // If no authentication method succeeds, return false
    if (!adminApiToken && !webhookSecretKey) {
      console.error("No authentication credentials defined in environment variables");
    }
    
    return false;
  } catch (error) {
    console.error("Error authenticating webhook:", error);
    return false;
  }
}
