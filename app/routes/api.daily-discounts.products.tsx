import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Get URL parameters
    const url = new URL(request.url);
    const maxProducts = parseInt(url.searchParams.get('max') || '4', 10);
    const sortBy = url.searchParams.get('sort') || 'newest';
    const shop = url.searchParams.get('shop');
    const tag = url.searchParams.get('tag') || 'DailyDiscount_每日優惠';
    const accessToken = url.searchParams.get('token'); // Add support for direct token
    
    console.log(`API request for discounted products - shop: ${shop}, maxProducts: ${maxProducts}, sortBy: ${sortBy}, tag: ${tag}`);
    
    // More flexible shop validation
    let shopDomain = shop;
    
    // If no shop parameter, try to extract from origin or referer
    if (!shopDomain) {
      const referer = request.headers.get('referer');
      const origin = request.headers.get('origin');
      
      if (referer) {
        try {
          const refererUrl = new URL(referer);
          // Extract myshopify domain from referer
          const refererHostMatch = refererUrl.host.match(/([a-zA-Z0-9-]+)\.myshopify\.com/);
          if (refererHostMatch) {
            shopDomain = `${refererHostMatch[1]}.myshopify.com`;
            console.log(`Extracted shop domain from referer: ${shopDomain}`);
          }
        } catch (e) {
          console.error("Error parsing referer:", e);
        }
      }
      
      if (!shopDomain && origin) {
        try {
          const originUrl = new URL(origin);
          // Extract myshopify domain from origin
          const originHostMatch = originUrl.host.match(/([a-zA-Z0-9-]+)\.myshopify\.com/);
          if (originHostMatch) {
            shopDomain = `${originHostMatch[1]}.myshopify.com`;
            console.log(`Extracted shop domain from origin: ${shopDomain}`);
          }
        } catch (e) {
          console.error("Error parsing origin:", e);
        }
      }
    }
    
    if (!shopDomain) {
      // Last resort for development environment - try to get the most recent session
      if (process.env.NODE_ENV === 'development') {
        const mostRecentSession = await prisma.session.findFirst({
          orderBy: {
            expires: 'desc'
          }
        });
        
        if (mostRecentSession) {
          shopDomain = mostRecentSession.shop;
          console.log(`Using most recent session shop in development: ${shopDomain}`);
        }
      }
    }
    
    // If we still don't have a shop domain, return a friendly error
    if (!shopDomain) {
      return json({ 
        status: "error", 
        message: "Unable to determine shop. Please provide a shop parameter or access from your Shopify admin." 
      }, { 
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        }
      });
    }
    
    let admin;
    try {
      // First try: Direct token authentication if token provided
      if (accessToken) {
        try {
          console.log(`Attempting direct token authentication for ${shopDomain}`);
          const { admin: tokenAdmin } = await authenticate.admin(
            new Request(request.url, {
              headers: {
                authorization: `Bearer ${accessToken}`
              }
            })
          );
          admin = tokenAdmin;
        } catch (tokenError) {
          console.error("Token authentication failed:", tokenError);
          // Fall through to other methods
        }
      }
      
      // Second try: App proxy authentication (for storefront)
      if (!admin) {
        try {
          console.log(`Attempting app proxy authentication for ${shopDomain}`);
          const auth = await authenticate.public.appProxy(request);
          admin = auth.admin;
        } catch (proxyError) {
          console.error("App proxy authentication failed:", proxyError);
          // Fall through to fallback method
        }
      }
      
      // Third try: Session lookup fallback
      if (!admin) {
        console.log(`Attempting session lookup for ${shopDomain}`);
        const session = await prisma.session.findFirst({
          where: {
            shop: shopDomain
          },
          orderBy: {
            expires: 'desc'
          }
        });
        
        if (session) {
          console.log(`Found session for ${shopDomain}, expires: ${session.expires}`);
          
          // Check if session is still valid
          if (session.expires && new Date(session.expires) > new Date()) {
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
              // Session token might be invalid or expired
            }
          } else {
            console.log("Session is expired, needs refresh");
          }
        } else {
          console.log(`No session found for shop ${shopDomain}`);
        }
      }
      
      // If still no admin, try a different approach for embedded apps
      if (!admin && request.headers.get('authorization')) {
        try {
          console.log("Attempting to use provided authorization header");
          const { admin: headerAdmin } = await authenticate.admin(request);
          admin = headerAdmin;
        } catch (headerAuthError) {
          console.error("Header authorization failed:", headerAuthError);
        }
      }
      
      // Last chance - check if we're in a test/development environment
      if (!admin && process.env.NODE_ENV === 'development' && process.env.SHOPIFY_API_KEY) {
        console.log("Development environment detected, using test authentication");
        // In development, try to get any session as a fallback
        const anySession = await prisma.session.findFirst({
          orderBy: {
            expires: 'desc'
          }
        });
        
        if (anySession) {
          try {
            const { admin: devAdmin } = await authenticate.admin(
              new Request(request.url, {
                headers: {
                  authorization: `Bearer ${anySession.accessToken}`
                }
              })
            );
            
            admin = devAdmin;
          } catch (devAuthError) {
            console.error("Development fallback authentication failed:", devAuthError);
          }
        }
      }
    } catch (authError) {
      console.error("All authentication methods failed:", authError);
    }
    
    // If we couldn't authenticate with any method
    if (!admin) {
      console.log("Authentication failed with all methods");
      return json({
        status: "error",
        message: "Authentication failed. Please refresh your session and try again.",
        shopDomain: shopDomain
      }, { 
        status: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        }
      });
    }
    
    // Query parameters for findMany
    let orderBy: any = { appliedAt: 'desc' }; // Default to newest
    
    // Apply sorting options
    if (sortBy === 'highest_discount') {
      orderBy = { savingsPercentage: 'desc' };
    } else if (sortBy === 'lowest_price') {
      orderBy = { discountedPrice: 'asc' };
    }
    
    // We already have admin access from earlier authentication
    // No need to authenticate again
    
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
    
    console.log(`Found ${products.length} products with tag "${tag}" for shop ${shop}`);
    
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
    
    // Return the product data
    return json({
      status: "success",
      products: formattedProducts
    });
    
  } catch (error) {
    console.error("Error fetching discounted products:", error);
    return json({ 
      status: "error", 
      message: error instanceof Error ? error.message : "An unknown error occurred"
    }, { status: 500 });
  }
};
