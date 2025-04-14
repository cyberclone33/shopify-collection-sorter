/**
 * Webhook authentication utility
 * Validates incoming webhook requests using a secret key
 */

/**
 * Validates a webhook request using a secret key
 * @param request - The incoming request
 * @param secretKey - The secret key to validate against
 * @returns True if authenticated, false otherwise
 */
export async function authenticateWebhook(request: Request, secretKey?: string): Promise<boolean> {
  // If no secret key is provided, use the environment variable
  const expectedSecretKey = secretKey || process.env.WEBHOOK_SECRET_KEY;
  
  if (!expectedSecretKey) {
    console.error("No webhook secret key defined in environment variables");
    return false;
  }
  
  try {
    // Check for the secret key in headers
    const headerSecretKey = request.headers.get("X-Webhook-Secret");
    if (headerSecretKey === expectedSecretKey) {
      return true;
    }
    
    // Check URL search params
    const url = new URL(request.url);
    const querySecretKey = url.searchParams.get("secretKey");
    if (querySecretKey === expectedSecretKey) {
      return true;
    }
    
    // If it's a POST request, check the body
    if (request.method === "POST" && request.headers.get("content-type") === "application/json") {
      const clonedRequest = request.clone(); // Clone to avoid consuming the body
      const body = await clonedRequest.json();
      if (body.secretKey === expectedSecretKey) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error("Error authenticating webhook:", error);
    return false;
  }
}
