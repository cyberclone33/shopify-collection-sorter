import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    // Extract shop and product id
    const { admin, session } = await authenticate.public.appProxy(request);
    const shop = session.shop;
    const productId = params.id;
    
    if (!productId) {
      return json({ status: "error", message: "Product ID is required" }, { status: 400 });
    }
    
    // Find the discounted product
    const discountLog = await prisma.dailyDiscountLog.findFirst({
      where: {
        shop: shop,
        id: productId
      }
    });
    
    if (!discountLog) {
      return json({ status: "error", message: "Product not found" }, { status: 404 });
    }
    
    // Get product handle using Shopify API
    const variantIdNumeric = discountLog.variantId.split('/').pop();
    
    // Query GraphQL to get the product handle
    const response = await admin.graphql(`
      query GetProductHandle {
        productVariant(id: "${discountLog.variantId}") {
          product {
            handle
          }
        }
      }
    `);
    
    const responseJson = await response.json();
    const productHandle = responseJson.data?.productVariant?.product?.handle;
    
    if (!productHandle) {
      return json({ status: "error", message: "Could not retrieve product handle" }, { status: 500 });
    }
    
    // Redirect to the product page
    return redirect(`/products/${productHandle}?variant=${variantIdNumeric}`);
    
  } catch (error) {
    console.error("Error redirecting to product:", error);
    return json({ 
      status: "error", 
      message: error instanceof Error ? error.message : "An unknown error occurred"
    }, { status: 500 });
  }
};
