import { shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaClient } from "@prisma/client";

// Create a new prisma client instance
const prisma = new PrismaClient();

/**
 * Search for a customer by email
 */
export async function findCustomerByEmail(shop: string, accessToken: string, email: string): Promise<string | null> {
  if (!email) return null;
  
  try {
    const response = await fetch(
      `https://${shop}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(email)}`,
      {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.customers && data.customers.length > 0) {
      return data.customers[0].id.toString();
    }
    
    return null;
  } catch (error) {
    console.error("Error finding customer by email:", error);
    return null;
  }
}

/**
 * Create a new customer in Shopify
 */
export async function createShopifyCustomer(
  shop: string, 
  accessToken: string, 
  firstName: string, 
  email?: string
): Promise<string | null> {
  try {
    const customerData = {
      customer: {
        first_name: firstName,
        email: email,
        accepts_marketing: true
      }
    };
    
    const response = await fetch(
      `https://${shop}/admin/api/2024-01/customers.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(customerData)
      }
    );
    
    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.customer && data.customer.id) {
      return data.customer.id.toString();
    }
    
    return null;
  } catch (error) {
    console.error("Error creating customer:", error);
    return null;
  }
}

/**
 * Create or find a Shopify customer and link to social login
 */
export async function createOrLinkShopifyCustomer(
  shop: string,
  accessToken: string,
  socialUserId: string,
  displayName: string,
  email?: string,
  provider: string = "line" // Default to "line" for backward compatibility
): Promise<string | null> {
  try {
    let customerId = null;
    
    // Try to find existing customer by email
    if (email) {
      customerId = await findCustomerByEmail(shop, accessToken, email);
    }
    
    // If no customer found, create a new one
    if (!customerId) {
      customerId = await createShopifyCustomer(shop, accessToken, displayName, email);
    }
    
    // If we have a customer ID, update the social login record
    if (customerId) {
      // Determine which ID field to use based on provider
      if (provider === "google") {
        await prisma.$executeRaw`
          UPDATE "SocialLogin"
          SET "shopifyCustomerId" = ${customerId}
          WHERE "shop" = ${shop} AND "provider" = 'google' AND "googleId" = ${socialUserId}
        `;
      } else {
        await prisma.$executeRaw`
          UPDATE "SocialLogin"
          SET "shopifyCustomerId" = ${customerId}
          WHERE "shop" = ${shop} AND "provider" = 'line' AND "lineId" = ${socialUserId}
        `;
      }
    }
    
    return customerId;
  } catch (error) {
    console.error("Error linking customer:", error);
    return null;
  }
}
