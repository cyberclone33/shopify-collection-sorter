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
  email?: string,
  password?: string
): Promise<string | null> {
  try {
    const customerData: any = {
      customer: {
        first_name: firstName,
        email: email,
        accepts_marketing: true
      }
    };
    
    // Add password if provided
    if (password) {
      customerData.customer.password = password;
      customerData.customer.password_confirmation = password;
      customerData.customer.send_email_welcome = false;
    }
    
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
 * Set a password for an existing customer
 */
export async function setCustomerPassword(
  shop: string, 
  accessToken: string, 
  customerId: string, 
  password: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://${shop}/admin/api/2024-01/customers/${customerId}.json`,
      {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          customer: {
            id: customerId,
            password: password,
            password_confirmation: password
          }
        })
      }
    );
    
    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }
    
    return true;
  } catch (error) {
    console.error("Error setting customer password:", error);
    return false;
  }
}

/**
 * Create or find a Shopify customer and link to social login user
 */
export async function createOrLinkShopifyCustomer(
  shop: string,
  accessToken: string,
  socialUserId: string,
  displayName: string,
  email?: string,
  password?: string
): Promise<string | null> {
  try {
    let customerId = null;
    
    // Try to find existing customer by email
    if (email) {
      customerId = await findCustomerByEmail(shop, accessToken, email);
    }
    
    // If no customer found, create a new one
    if (!customerId) {
      customerId = await createShopifyCustomer(shop, accessToken, displayName, email, password);
    } else if (password) {
      // If customer exists and password provided, update the password
      await setCustomerPassword(shop, accessToken, customerId, password);
    }
    
    // If we have a customer ID, update the user record
    if (customerId) {
      // Try to update LINE user if this is a LINE login
      try {
        await prisma.$executeRaw`
          UPDATE "LineUser"
          SET "shopifyCustomerId" = ${customerId}
          WHERE "shop" = ${shop} AND "lineId" = ${socialUserId}
        `;
      } catch (lineError) {
        console.log("Not a LINE user or error updating LINE user:", lineError);
      }
      
      // Try to update Google user if this is a Google login
      try {
        await prisma.$executeRaw`
          UPDATE "GoogleUser"
          SET "shopifyCustomerId" = ${customerId}
          WHERE "shop" = ${shop} AND "googleId" = ${socialUserId}
        `;
      } catch (googleError) {
        console.log("Not a Google user or error updating Google user:", googleError);
      }
    }
    
    return customerId;
  } catch (error) {
    console.error("Error linking customer:", error);
    return null;
  }
}
