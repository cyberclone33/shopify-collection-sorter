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
    
    console.log(`API request for discounted products - shop: ${shop}, maxProducts: ${maxProducts}, sortBy: ${sortBy}, tag: ${tag}`);
    
    // Validate shop parameter
    if (!shop) {
      return json({ 
        status: "error", 
        message: "Missing shop parameter" 
      }, { status: 400 });
    }
    
    let admin;
    try {
      // Attempt to authenticate via app proxy
      const auth = await authenticate.public.appProxy(request);
      admin = auth.admin;
    } catch (authError) {
      console.error("Authentication error:", authError);
      // Fallback for local development - try to find the session in the database
      const session = await prisma.session.findFirst({
        where: {
          shop: shop
        }
      });
      
      if (!session) {
        return json({
          status: "error",
          message: "Authentication failed and no session found for shop"
        }, { status: 401 });
      }
      
      // Use the session from the database
      const { admin: sessionAdmin } = await authenticate.admin(
        new Request(request.url, {
          headers: {
            authorization: `Bearer ${session.accessToken}`
          }
        })
      );
      
      admin = sessionAdmin;
    }
    
    // Query parameters for findMany
    let orderBy: any = { appliedAt: 'desc' }; // Default to newest
    
    // Apply sorting options
    if (sortBy === 'highest_discount') {
      orderBy = { savingsPercentage: 'desc' };
    } else if (sortBy === 'lowest_price') {
      orderBy = { discountedPrice: 'asc' };
    }
    
    // Get admin API access for the shop
    const { admin } = await authenticate.public.appProxy(request);
    
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
