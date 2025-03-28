import { ActionFunctionArgs, json } from "@remix-run/node";
import { verifyGoogleJWT } from "../utils/google-auth.server";

/**
 * This endpoint verifies a JWT token and returns the decoded payload
 * It serves as a secure interface between client and server for Google login credentials
 */
export async function action({ request }: ActionFunctionArgs) {
  // Only accept POST requests
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // Get the token from the request
    const requestData = await request.json();
    const { token } = requestData;

    if (!token) {
      return json({ error: "Missing token" }, { status: 400 });
    }

    // Verify the JWT token
    const decodedToken = await verifyGoogleJWT(token);
    
    // If token verification fails, return an error
    if (!decodedToken) {
      return json({ error: "Invalid token" }, { status: 401 });
    }

    // Return the verified user data
    return json(decodedToken);
  } catch (error) {
    console.error("Error verifying Google JWT:", error);
    return json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * Handle preflight OPTIONS requests for CORS
 */
export async function loader() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
