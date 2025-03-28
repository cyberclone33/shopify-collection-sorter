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

// Google OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_PROFILE_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

// JWT Secret for secure token generation (use environment variable in production)
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
const JWT_EXPIRY = '1h'; // Token expires in 1 hour

// Interface for Google user profile
interface GoogleProfile {
  sub: string;          // Google's user ID
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

// Interface for Google token response
interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token: string;
}

// Interface for JWT payload
interface GoogleJwtPayload {
  google_login: string;
  customer_id?: string;
  google_id?: string;
  name: string;
  customer_email: string;
  access_token: string;
  return_url: string;
}

/**
 * Create a JWT for secure Google login data transfer
 */
export async function createGoogleJWT(payload: GoogleJwtPayload): Promise<string> {
  try {
    // Sign the payload with our secret key
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  } catch (error) {
    console.error("Error creating Google JWT:", error);
    throw error;
  }
}

/**
 * Verify and decode a Google login JWT
 */
export async function verifyGoogleJWT(token: string): Promise<GoogleJwtPayload | null> {
  try {
    // Verify the token with our secret key
    const decoded = jwt.verify(token, JWT_SECRET) as GoogleJwtPayload;
    return decoded;
  } catch (error) {
    console.error("Error verifying Google JWT:", error);
    return null;
  }
}

/**
 * Generate the Google OAuth URL
 */
export function getGoogleAuthUrl(shop: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    state: state,
    scope: "profile email openid",
    prompt: "select_account",
    access_type: "offline",
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function getGoogleAccessToken(code: string): Promise<GoogleTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: GOOGLE_REDIRECT_URI,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
  });

  try {
    const response = await axios.post(GOOGLE_TOKEN_URL, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    return response.data;
  } catch (error) {
    console.error("Error getting Google access token:", error);
    throw error;
  }
}

/**
 * Get Google user profile
 */
export async function getGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  try {
    const response = await axios.get(GOOGLE_PROFILE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return response.data;
  } catch (error) {
    console.error("Error getting Google profile:", error);
    throw error;
  }
}

/**
 * Parse ID token to get additional user information
 */
export function parseIdToken(idToken: string): any {
  try {
    // Note: In production, you should verify the token signature
    const decoded = jwt.decode(idToken);
    return decoded;
  } catch (error) {
    console.error("Error parsing ID token:", error);
    return null;
  }
}

/**
 * Save Google user data to database
 */
export async function saveGoogleUser(
  shop: string,
  googleProfile: GoogleProfile,
  tokenData: GoogleTokenResponse
): Promise<any> {
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
  
  // Convert optional values to null if undefined
  const name = googleProfile.name || null;
  const pictureUrl = googleProfile.picture || null;
  const email = googleProfile.email || null;

  try {
    console.log(`Attempting to save Google user data for: ${name} (${googleProfile.sub})`);
    
    // Use Prisma's type-safe API
    try {
      const googleUser = await prisma.GoogleUser.upsert({
        where: {
          shop_googleId: {
            shop,
            googleId: googleProfile.sub
          }
        },
        update: {
          googleAccessToken: tokenData.access_token,
          googleRefreshToken: tokenData.refresh_token || null,
          tokenExpiresAt: expiresAt,
          displayName: name,
          pictureUrl,
          email
        },
        create: {
          shop,
          googleId: googleProfile.sub,
          googleAccessToken: tokenData.access_token,
          googleRefreshToken: tokenData.refresh_token || null,
          tokenExpiresAt: expiresAt,
          displayName: name,
          pictureUrl,
          email
        }
      });
      
      console.log(`Successfully saved Google user data for: ${name} (${googleProfile.sub})`);
      return googleUser;
    } catch (prismaError) {
      console.error('Error using Prisma type-safe API:', prismaError);
      
      // Only for deployment/initialization scenarios where migrations haven't run
      if (prismaError instanceof Error && prismaError.message.includes('no such table')) {
        console.error('GoogleUser table does not exist. This should be handled by Prisma migrations.');
        console.error('As a temporary fallback, returning a mock object to continue the authentication flow.');
        
        // Return a mock object to ensure the authentication flow continues
        return {
          id: crypto.randomUUID(),
          shop,
          googleId: googleProfile.sub,
          googleAccessToken: tokenData.access_token,
          googleRefreshToken: tokenData.refresh_token || null,
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
    console.error("Error saving Google user:", error);
    
    // For debugging purposes, log more details about the error
    if (error instanceof Error) {
      console.error(`Error name: ${error.name}, message: ${error.message}`);
      console.error(`Stack trace: ${error.stack}`);
    }
    
    throw error;
  }
}
