import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * API endpoint to load more discount logs
 * Returns paginated discount logs based on type (manual or api)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    // Authenticate the request
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    
    // Get URL parameters
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "manual";
    const skip = parseInt(url.searchParams.get("skip") || "0", 10);
    const take = parseInt(url.searchParams.get("take") || "20", 10);
    
    // Validate the parameters
    if (isNaN(skip) || isNaN(take) || take > 100) {
      return json({
        status: "error",
        message: "Invalid pagination parameters. Take must be <= 100."
      }, { status: 400 });
    }
    
    // Prepare the query based on the type
    let whereClause;
    if (type === "manual") {
      whereClause = {
        shop,
        OR: [
          {
            notes: {
              contains: "Manual UI Discount",
              mode: 'insensitive'
            }
          },
          {
            notes: {
              contains: "Manual UI Discount Reverted",
              mode: 'insensitive'
            }
          }
        ]
      };
    } else if (type === "api") {
      whereClause = {
        shop,
        OR: [
          {
            notes: {
              contains: "Auto Discount",
              mode: 'insensitive'
            }
          },
          {
            notes: {
              contains: "Auto Discount Reverted",
              mode: 'insensitive'
            }
          }
        ]
      };
    } else {
      return json({
        status: "error",
        message: "Invalid type parameter. Use 'manual' or 'api'."
      }, { status: 400 });
    }
    
    // Query the database
    const logs = await prisma.dailyDiscountLog.findMany({
      where: whereClause,
      orderBy: {
        appliedAt: 'desc'
      },
      skip,
      take
    });
    
    // Return the logs
    return json({
      status: "success",
      logs,
      meta: {
        type,
        skip,
        take,
        count: logs.length
      }
    });
    
  } catch (error) {
    console.error("Error fetching discount logs:", error);
    return json({
      status: "error",
      message: error instanceof Error ? error.message : "An unknown error occurred"
    }, { status: 500 });
  }
}
