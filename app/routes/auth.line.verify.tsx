import { ActionFunctionArgs, json, LoaderFunctionArgs } from "@remix-run/node";
import jwt from "jsonwebtoken";
import { LineJwtPayload } from "../utils/line-auth.server";

// JWT Secret key - should match the one used to create the token
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-key-for-development-only";

/**
 * Loader function to handle GET and OPTIONS requests
 */
export async function loader({ request }: LoaderFunctionArgs) {
  // Handle CORS for OPTIONS requests
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // For GET requests, return a simple message
  return json(
    { message: "LINE verification endpoint" },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    }
  );
}

/**
 * Verify a JWT token for LINE login
 */
export async function action({ request }: ActionFunctionArgs) {
  // Handle CORS for cross-origin requests from the Shopify store
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  try {
    // Get the token from the request body
    const body = await request.json();
    const { token } = body;

    if (!token) {
      return json({ error: "No token provided" }, { status: 400 });
    }

    try {
      // Verify the token
      const decoded = jwt.verify(token, JWT_SECRET) as LineJwtPayload;
      
      // Return the verified data
      return json({
        line_login: "success",
        customer_id: decoded.customer_id,
        customer_email: decoded.customer_email,
        name: decoded.name,
        access_token: decoded.access_token,
        return_url: decoded.return_url || "/account",
      }, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    } catch (verifyError) {
      console.error("JWT verification failed:", verifyError);
      return json({ error: "Invalid token" }, { 
        status: 401,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }
  } catch (error) {
    console.error("Error processing request:", error);
    return json({ error: "Server error" }, { 
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
}
