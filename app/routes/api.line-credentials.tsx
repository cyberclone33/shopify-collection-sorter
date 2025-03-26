import { LoaderFunctionArgs, json } from "@remix-run/node";
import prisma from "../db.server";

/**
 * API endpoint to securely retrieve Shopify credentials for a LINE user
 * This will be used by the frontend for auto-login
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    // Get the line user ID from query parameter
    const url = new URL(request.url);
    const lineUserId = url.searchParams.get("lineUserId");
    const accessToken = url.searchParams.get("accessToken");
    
    // Validate required parameters
    if (!lineUserId || !accessToken) {
      return json({ error: "Missing required parameters" }, { status: 400 });
    }
    
    // Find the LINE user in our database
    const lineUser = await prisma.lineUser.findFirst({
      where: {
        lineId: lineUserId,
        lineAccessToken: accessToken // Verify access token for additional security
      }
    });
    
    if (!lineUser) {
      return json({ error: "User not found" }, { status: 404 });
    }
    
    // Return the email and access token (used as password)
    return json({
      email: lineUser.email || `line_${lineUser.lineId}@example.com`,
      password: lineUser.lineAccessToken // Using LINE access token as password
    });
  } catch (error) {
    console.error("Error getting LINE user credentials:", error);
    return json({ error: "Server error" }, { status: 500 });
  }
}
