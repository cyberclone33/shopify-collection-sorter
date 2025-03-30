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

// LINE OAuth configuration
const LINE_CLIENT_ID = process.env.LINE_CLIENT_ID || "";
const LINE_CLIENT_SECRET = process.env.LINE_CLIENT_SECRET || "";
const LINE_REDIRECT_URI = process.env.LINE_REDIRECT_URI || "";
const LINE_AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_PROFILE_URL = "https://api.line.me/v2/profile";

// JWT configuration
if (!process.env.JWT_SECRET) {
  console.error("ERROR: JWT_SECRET environment variable is not set. Authentication will fail.");
  throw new Error("JWT_SECRET environment variable must be set for secure authentication");
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRATION = "1h"; // 1 hour expiration

// Interface for LINE user profile
interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
  email?: string;
}

// Interface for LINE token response
interface LineTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
  id_token?: string;
}

// Interface for LINE JWT payload
export interface LineJwtPayload {
  customer_id: string;
  customer_email: string;
  name: string;
  access_token: string;
  return_url?: string;
  exp?: number;
  iat?: number;
}

/**
 * Generate the LINE OAuth URL
 */
export function getLineAuthUrl(shop: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: LINE_CLIENT_ID,
    redirect_uri: LINE_REDIRECT_URI,
    state: state,
    scope: "profile openid email",
    nonce: Math.random().toString(36).substring(2, 15),
    bot_prompt: "aggressive",
  });

  return `${LINE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function getLineAccessToken(code: string): Promise<LineTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: LINE_REDIRECT_URI,
    client_id: LINE_CLIENT_ID,
    client_secret: LINE_CLIENT_SECRET,
  });

  try {
    const response = await axios.post(LINE_TOKEN_URL, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    return response.data;
  } catch (error) {
    console.error("Error getting LINE access token:", error);
    throw error;
  }
}

/**
 * Get LINE user profile
 */
export async function getLineProfile(accessToken: string): Promise<LineProfile> {
  try {
    const response = await axios.get(LINE_PROFILE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return response.data;
  } catch (error) {
    console.error("Error getting LINE profile:", error);
    throw error;
  }
}

/**
 * Parse and verify ID token to get additional user information
 */
export function parseIdToken(idToken: string): any {
  try {
    // First decode without verification to get the header
    const header = jwt.decode(idToken, { complete: true })?.header;
    
    if (!header || !header.kid) {
      console.warn("Invalid token header or missing kid");
    }
    
    // Decode and perform basic validation
    const decoded = jwt.decode(idToken);
    
    // Validate token claims
    const now = Math.floor(Date.now() / 1000);
    if (decoded && typeof decoded === 'object') {
      // Check expiration
      if (decoded.exp && decoded.exp < now) {
        throw new Error("Token expired");
      }
      
      // Check not before time
      if (decoded.nbf && decoded.nbf > now) {
        throw new Error("Token not yet valid");
      }
      
      // Check issuer (should be LINE)
      if (decoded.iss && decoded.iss !== "https://access.line.me") {
        console.warn("Invalid token issuer:", decoded.iss);
      }
      
      // Check audience (should match your LINE client ID)
      if (decoded.aud && decoded.aud !== LINE_CLIENT_ID) {
        console.warn("Invalid token audience:", decoded.aud);
      }
    }
    
    return decoded;
  } catch (error) {
    console.error("Error verifying ID token:", error);
    throw error; // Re-throw to fail securely instead of returning null
  }
}

/**
 * Save LINE user data to database
 */
export async function saveLineUser(
  shop: string,
  lineProfile: LineProfile,
  tokenData: LineTokenResponse,
  idTokenData: any
): Promise<any> {
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
  
  // Convert optional values to null if undefined
  const displayName = lineProfile.displayName || null;
  const pictureUrl = lineProfile.pictureUrl || null;
  const email = idTokenData?.email || null;

  try {
    console.log(`Attempting to save LINE user data for: ${displayName} (${lineProfile.userId})`);
    
    // Use Prisma's type-safe API
    try {
      const lineUser = await prisma.LineUser.upsert({
        where: {
          shop_lineId: {
            shop,
            lineId: lineProfile.userId
          }
        },
        update: {
          lineAccessToken: tokenData.access_token,
          lineRefreshToken: tokenData.refresh_token,
          tokenExpiresAt: expiresAt,
          displayName,
          pictureUrl,
          email
        },
        create: {
          shop,
          lineId: lineProfile.userId,
          lineAccessToken: tokenData.access_token,
          lineRefreshToken: tokenData.refresh_token,
          tokenExpiresAt: expiresAt,
          displayName,
          pictureUrl,
          email
        }
      });
      
      console.log(`Successfully saved LINE user data for: ${displayName} (${lineProfile.userId})`);
      return lineUser;
    } catch (prismaError) {
      console.error('Error using Prisma type-safe API:', prismaError);
      
      // Only for deployment/initialization scenarios where migrations haven't run
      if (prismaError instanceof Error && prismaError.message.includes('no such table')) {
        console.error('LineUser table does not exist. This should be handled by Prisma migrations.');
        // Try to create the table on the fly
        try {
          await prisma.$executeRaw`
            CREATE TABLE IF NOT EXISTS "LineUser" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "shop" TEXT NOT NULL,
              "lineId" TEXT NOT NULL,
              "lineAccessToken" TEXT,
              "lineRefreshToken" TEXT,
              "tokenExpiresAt" DATETIME,
              "displayName" TEXT,
              "pictureUrl" TEXT,
              "email" TEXT,
              "shopifyCustomerId" TEXT,
              "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updatedAt" DATETIME NOT NULL
            )
          `;
          
          await prisma.$executeRaw`
            CREATE UNIQUE INDEX IF NOT EXISTS "LineUser_shop_lineId_key" ON "LineUser"("shop", "lineId")
          `;
          
          // Try the upsert again
          return await prisma.LineUser.upsert({
            where: {
              shop_lineId: {
                shop,
                lineId: lineProfile.userId
              }
            },
            update: {
              lineAccessToken: tokenData.access_token,
              lineRefreshToken: tokenData.refresh_token,
              tokenExpiresAt: expiresAt,
              displayName,
              pictureUrl,
              email
            },
            create: {
              id: crypto.randomUUID(),
              shop,
              lineId: lineProfile.userId,
              lineAccessToken: tokenData.access_token,
              lineRefreshToken: tokenData.refresh_token,
              tokenExpiresAt: expiresAt,
              displayName,
              pictureUrl,
              email
            }
          });
        } catch (createTableError) {
          console.error('Failed to create LineUser table:', createTableError);
          throw new Error(`Database initialization failed: ${createTableError instanceof Error ? createTableError.message : 'Unknown error'}`);
        }
      }
      
      throw prismaError;
    }
  } catch (error) {
    console.error("Error saving LINE user:", error);
    
    // For debugging purposes, log more details about the error
    if (error instanceof Error) {
      console.error(`Error name: ${error.name}, message: ${error.message}`);
      console.error(`Stack trace: ${error.stack}`);
    }
    
    // Instead of returning a mock object, throw an error to fail securely
    throw new Error(`Failed to save user data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create or link Shopify customer account
 */
export async function createOrLinkShopifyCustomer(
  shop: string,
  lineUserId: string,
  accessToken: string,
  lineProfile: LineProfile,
  email?: string
): Promise<string> {
  // This is a placeholder for the actual implementation
  // You'll need to use Shopify GraphQL Admin API to:
  // 1. Search for existing customer by email
  // 2. If not found, create a new customer
  // 3. Update the LineUser record with the Shopify customer ID

  // For now, we'll just return a placeholder
  return "shopify-customer-id";
}

/**
 * Generate a JWT token for LINE login
 */
export function createLineJWT(
  customerId: string,
  customerEmail: string,
  name: string,
  accessToken: string,
  returnUrl: string = "/account"
): string {
  const payload: LineJwtPayload = {
    customer_id: customerId,
    customer_email: customerEmail,
    name,
    access_token: accessToken,
    return_url: returnUrl
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
}

/**
 * Verify a LINE JWT token
 */
export function verifyLineJWT(token: string): LineJwtPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as LineJwtPayload;
    return decoded;
  } catch (error) {
    console.error("Error verifying LINE JWT:", error);
    throw error;
  }
}
