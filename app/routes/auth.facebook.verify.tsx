import { ActionFunctionArgs, json } from "@remix-run/node";
import { verifyFacebookJWT } from "../utils/facebook-auth.server";

/**
 * This endpoint verifies a JWT token and returns the decoded payload
 * It serves as a secure interface between client and server for Facebook login credentials
 */
export async function action({ request }: ActionFunctionArgs) {
  // Only accept POST requests
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { 
      status: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  try {
    // Get the token from the request
    const requestData = await request.json();
    const { token } = requestData;

    if (!token) {
      return json({ error: "Missing token" }, { 
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    // Verify the JWT token
    const decodedToken = verifyFacebookJWT(token);
    
    // If token verification fails, return an error
    if (!decodedToken) {
      return json({ error: "Invalid token" }, { 
        status: 401,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    // Return the verified user data
    return json(decodedToken, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  } catch (error) {
    console.error("Error verifying Facebook JWT:", error);
    return json({ error: "Server error" }, { 
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }
}

/**
 * Handle preflight OPTIONS requests for CORS
 */
export async function loader({ request }: ActionFunctionArgs) {
  // Handle OPTIONS requests for CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  return json({ error: "Method not allowed" }, { status: 405 });
}
