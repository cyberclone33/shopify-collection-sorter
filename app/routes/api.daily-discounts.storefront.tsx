import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Public API endpoint for fetching daily discounted products
 * This endpoint supports CORS and can be accessed from the storefront
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Support CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }
    
    // Get URL parameters
    const url = new URL(request.url);
    const maxProducts = parseInt(url.searchParams.get('max') || '4', 10);
    const sortBy = url.searchParams.get('sort') || 'newest';
    const shop = url.searchParams.get('shop');
    const tag = url.searchParams.get('tag') || 'DailyDiscount_每日優惠';
    
    console.log(`Storefront API request for discounted products - shop: ${shop}, maxProducts: ${maxProducts}, sortBy: ${sortBy}, tag: ${tag}`);
    
    // More flexible shop validation
    let shopDomain = shop;
    
    // If no shop parameter, try to extract from origin or referer
    if (!shopDomain) {
      const referer = request.headers.get('referer');
      const origin = request.headers.get('origin');
      
      if (referer) {
        try {
          const refererUrl = new URL(referer);
          // Extract shop domain from referer - support both myshopify and custom domains
          shopDomain = refererUrl.hostname;
        } catch (e) {
          console.error("Error parsing referer:", e);
        }
      }
      
      if (!shopDomain && origin) {
        try {
          const originUrl = new URL(origin);
          shopDomain = originUrl.hostname;
        } catch (e) {
          console.error("Error parsing origin:", e);
        }
      }
    }
    
    if (!shopDomain) {
      return json({ 
        status: "error", 
        message: "Unable to determine shop. Please provide a shop parameter." 
      }, { 
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        }
      });
    }
    
    // Try to find a session for this shop
    const session = await prisma.session.findFirst({
      where: {
        shop: shopDomain.includes('.myshopify.com') ? shopDomain : `${shopDomain}.myshopify.com`
      },
      orderBy: {
        expires: 'desc'
      }
    });
    
    if (!session) {
      console.log(`No session found for shop ${shopDomain}`);
      // Still return cached data if available
      
      // For now, look for recent logs
      const recentLogs = await prisma.dailyDiscountLog.findMany({
        where: {
          shop: shopDomain.includes('.myshopify.com') ? shopDomain : `${shopDomain}.myshopify.com`
        },
        orderBy: {
          appliedAt: 'desc'
        },
        take: maxProducts
      });
      
      if (recentLogs.length > 0) {
        // We can return this limited data even without admin API access
        return json({
          status: "success",
          source: "cached",
          products: recentLogs.map(log => ({
            productId: log.productId,
            productTitle: log.productTitle,
            variantId: log.variantId,
            variantTitle: log.variantTitle,
            originalPrice: log.originalPrice,
            discountedPrice: log.discountedPrice,
            compareAtPrice: log.compareAtPrice,
            discountPercentage: log.discountPercentage,
            savingsAmount: log.savingsAmount,
            savingsPercentage: log.savingsPercentage,
            currencyCode: log.currencyCode,
            imageUrl: log.imageUrl,
            inventoryQuantity: log.inventoryQuantity
          }))
        }, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Cache-Control': 'max-age=300' // Cache for 5 minutes
          }
        });
      }
      
      return json({
        status: "error",
        message: "No shop session found and no cached data available"
      }, { 
        status: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        }
      });
    }
    
    // We have a session, use it to authenticate with the admin API
    let admin;
    try {
      const { admin: sessionAdmin } = await authenticate.admin(
        new Request(request.url, {
          headers: {
            authorization: `Bearer ${session.accessToken}`
          }
        })
      );
      
      admin = sessionAdmin;
    } catch (sessionAuthError) {
      console.error("Session authentication failed:", sessionAuthError);
      
      // Return a more friendly error
      return json({
        status: "error",
        message: "Shop session is expired, please refresh from the admin panel"
      }, { 
        status: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        }
      });
    }
    
    // Fetch products with the specified tag using the Shopify GraphQL API
    console.log(`Querying Shopify for products with tag: ${tag}`);
    const response = await admin.graphql(`
      query GetTaggedProducts($tag: String!, $first: Int!) {
        products(first: $first, query: $tag) {
          edges {
            node {
              id
              title
              handle
              featuredImage {
                url
                altText
              }
              variants(first: 1) {
                edges {
                  node {
                    id
                    title
                    price
                    compareAtPrice
                    inventoryQuantity
                  }
                }
              }
              priceRangeV2 {
                minVariantPrice {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    `, {
      variables: {
        tag: `tag:${tag}`,
        first: maxProducts
      }
    });
    
    const responseJson = await response.json();
    const products = responseJson.data?.products?.edges || [];
    
    console.log(`Found ${products.length} products with tag "${tag}" for shop ${shopDomain}`);
    
    // Format product data for the frontend
    const formattedProducts = products.map(edge => {
      const product = edge.node;
      const variant = product.variants.edges[0]?.node;
      
      if (!variant) {
        return null; // Skip products without variants
      }
      
      const price = parseFloat(variant.price);
      const compareAtPrice = variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : price;
      const savingsAmount = compareAtPrice - price;
      const savingsPercentage = compareAtPrice > 0 ? (savingsAmount / compareAtPrice) * 100 : 0;
      
      return {
        productId: product.id,
        productTitle: product.title,
        productHandle: product.handle,
        variantId: variant.id,
        variantTitle: variant.title !== "Default Title" ? variant.title : null,
        originalPrice: compareAtPrice,
        discountedPrice: price,
        compareAtPrice: compareAtPrice,
        discountPercentage: savingsPercentage,
        savingsAmount: savingsAmount,
        savingsPercentage: savingsPercentage,
        currencyCode: product.priceRangeV2.minVariantPrice.currencyCode,
        imageUrl: product.featuredImage?.url || null,
        imageAlt: product.featuredImage?.altText || product.title,
        inventoryQuantity: variant.inventoryQuantity || 0
      };
    }).filter(Boolean); // Remove null entries
    
    // Apply sorting based on the requested sort parameter
    if (sortBy === 'highest_discount') {
      formattedProducts.sort((a, b) => b.savingsPercentage - a.savingsPercentage);
    } else if (sortBy === 'lowest_price') {
      formattedProducts.sort((a, b) => a.discountedPrice - b.discountedPrice);
    }
    
    // Limit to requested number of products
    const limitedProducts = formattedProducts.slice(0, maxProducts);
    
    // Return the product data with CORS headers
    return json({
      status: "success",
      products: limitedProducts
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'max-age=300' // Cache for 5 minutes
      }
    });
    
  } catch (error) {
    console.error("Error fetching discounted products:", error);
    return json({ 
      status: "error", 
      message: error instanceof Error ? error.message : "An unknown error occurred"
    }, { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      }
    });
  }
};
