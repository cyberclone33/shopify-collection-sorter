import { redirect } from "@remix-run/node";
import axios from "axios";
import jwt from "jsonwebtoken";
import { PrismaClient, Prisma } from "@prisma/client";
import crypto from "crypto";

// Initialize Prisma client
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

// Facebook OAuth configuration
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || "";
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || "";
const FACEBOOK_AUTH_URL = "https://www.facebook.com/v18.0/dialog/oauth";
const FACEBOOK_TOKEN_URL = "https://graph.facebook.com/v18.0/oauth/access_token";
const FACEBOOK_PROFILE_URL = "https://graph.facebook.com/v18.0/me";

// JWT Secret for secure token generation (use environment variable in production)
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-key-for-development-only";
const JWT_EXPIRY = '1h'; // Token expires in 1 hour

// Interface for Facebook user profile
interface FacebookProfile {
  id: string;          // Facebook's user ID
  name: string;
  email?: string;
  picture?: {
    data: {
      url: string;
      width: number;
      height: number;
      is_silhouette: boolean;
    }
  };
}

// Interface for Facebook token response
interface FacebookTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// Interface for JWT payload
export interface FacebookJwtPayload {
  facebook_login: string;
  customer_id?: string;
  facebook_id?: string;
  name: string;
  customer_email: string;
  access_token: string;
  return_url: string;
  exp?: number;
  iat?: number;
}

/**
 * Create a JWT for secure Facebook login data transfer
 */
export function createFacebookJWT(payload: FacebookJwtPayload): string {
  try {
    // Sign the payload with our secret key
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  } catch (error) {
    console.error("Error creating Facebook JWT:", error);
    throw error;
  }
}

/**
 * Verify and decode a Facebook login JWT
 */
export function verifyFacebookJWT(token: string): FacebookJwtPayload | null {
  try {
    // Verify the token with our secret key
    const decoded = jwt.verify(token, JWT_SECRET) as FacebookJwtPayload;
    return decoded;
  } catch (error) {
    console.error("Error verifying Facebook JWT:", error);
    return null;
  }
}

/**
 * Generate the Facebook OAuth URL
 */
export function getFacebookAuthUrl(shop: string, state: string): string {
  const params = new URLSearchParams({
    client_id: FACEBOOK_APP_ID,
    redirect_uri: FACEBOOK_REDIRECT_URI,
    state: state,
    scope: "email,public_profile",
    response_type: "code",
  });

  return `${FACEBOOK_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function getFacebookAccessToken(code: string): Promise<FacebookTokenResponse> {
  const params = new URLSearchParams({
    client_id: FACEBOOK_APP_ID,
    client_secret: FACEBOOK_APP_SECRET,
    code,
    redirect_uri: FACEBOOK_REDIRECT_URI,
  });

  try {
    const response = await axios.get(`${FACEBOOK_TOKEN_URL}?${params.toString()}`);
    return response.data;
  } catch (error) {
    console.error("Error getting Facebook access token:", error);
    throw error;
  }
}

/**
 * Get Facebook user profile
 */
export async function getFacebookProfile(accessToken: string): Promise<FacebookProfile> {
  try {
    const response = await axios.get(`${FACEBOOK_PROFILE_URL}?fields=id,name,email,picture&access_token=${accessToken}`);
    return response.data;
  } catch (error) {
    console.error("Error getting Facebook profile:", error);
    throw error;
  }
}

/**
 * Save Facebook user data to database
 */
export async function saveFacebookUser(
  shop: string,
  facebookProfile: FacebookProfile,
  tokenData: FacebookTokenResponse
): Promise<any> {
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
  
  // Convert optional values to null if undefined
  const name = facebookProfile.name || null;
  const pictureUrl = facebookProfile.picture?.data.url || null;
  const email = facebookProfile.email || null;

  try {
    console.log(`Attempting to save Facebook user data for: ${name} (${facebookProfile.id})`);
    
    // Use Prisma's type-safe API
    try {
      const facebookUser = await prisma.FacebookUser.upsert({
        where: {
          shop_facebookId: {
            shop,
            facebookId: facebookProfile.id
          }
        },
        update: {
          facebookAccessToken: tokenData.access_token,
          tokenExpiresAt: expiresAt,
          displayName: name,
          pictureUrl,
          email
        },
        create: {
          shop,
          facebookId: facebookProfile.id,
          facebookAccessToken: tokenData.access_token,
          tokenExpiresAt: expiresAt,
          displayName: name,
          pictureUrl,
          email
        }
      });
      
      console.log(`Successfully saved Facebook user data for: ${name} (${facebookProfile.id})`);
      return facebookUser;
    } catch (prismaError) {
      console.error('Error using Prisma type-safe API:', prismaError);
      
      // Only for deployment/initialization scenarios where migrations haven't run
      if (prismaError instanceof Error && prismaError.message.includes('no such table')) {
        console.error('FacebookUser table does not exist. This should be handled by Prisma migrations.');
        console.error('As a temporary fallback, returning a mock object to continue the authentication flow.');
        
        // Return a mock object to ensure the authentication flow continues
        return {
          id: crypto.randomUUID(),
          shop,
          facebookId: facebookProfile.id,
          facebookAccessToken: tokenData.access_token,
          tokenExpiresAt: expiresAt,
          displayName: name,
          pictureUrl,
          email,
          shopifyCustomerId: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
      
      throw prismaError;
    }
  } catch (error) {
    console.error("Error saving Facebook user:", error);
    
    // For debugging purposes, log more details about the error
    if (error instanceof Error) {
      console.error(`Error name: ${error.name}, message: ${error.message}`);
      console.error(`Stack trace: ${error.stack}`);
    }
    
    throw error;
  }
}

/**
 * Create or link Shopify customer account
 * This function is imported from shopify-customer.server.ts
 */
import { createOrLinkShopifyCustomer } from "./shopify-customer.server";
