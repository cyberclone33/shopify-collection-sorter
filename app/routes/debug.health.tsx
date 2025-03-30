import { json } from "@remix-run/node";

/**
 * Health check route for debugging connections
 */
export function loader() {
  return json({
    status: "ok",
    message: "App is running!",
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
    env_check: {
      SHOPIFY_API_KEY: Boolean(process.env.SHOPIFY_API_KEY),
      SHOPIFY_API_SECRET: Boolean(process.env.SHOPIFY_API_SECRET),
      SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
      JWT_SECRET: Boolean(process.env.JWT_SECRET),
      DATABASE_URL: Boolean(process.env.DATABASE_URL)
    }
  });
}
