import { redirect } from "@remix-run/node";
import axios from "axios";
import { PrismaClient } from "@prisma/client";
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
const GOOGLE_PROFILE_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

// Interface for Google user profile
interface GoogleProfile {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
}

// Interface for Google token response
interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
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
    access_type: "offline",
    prompt: "consent", // Force to show the consent screen to get refresh token
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
 * Save Google user data to database
 */
export async function saveGoogleUser(
  shop: string,
  googleProfile: GoogleProfile,
  tokenData: GoogleTokenResponse
): Promise<any> {
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
  
  // Convert optional values to null if undefined
  const displayName = googleProfile.name || null;
  const pictureUrl = googleProfile.picture || null;
  const email = googleProfile.email || null;

  try {
    console.log(`Attempting to save Google user data for: ${displayName} (${googleProfile.id})`);
    
    // Use Prisma's type-safe API
    try {
      const socialLogin = await prisma.SocialLogin.upsert({
        where: {
          shop_provider_googleId: {
            shop,
            provider: "google",
            googleId: googleProfile.id
          }
        },
        update: {
          googleAccessToken: tokenData.access_token,
          googleRefreshToken: tokenData.refresh_token,
          tokenExpiresAt: expiresAt,
          displayName,
          pictureUrl,
          email
        },
        create: {
          shop,
          provider: "google",
          googleId: googleProfile.id,
          googleAccessToken: tokenData.access_token,
          googleRefreshToken: tokenData.refresh_token,
          tokenExpiresAt: expiresAt,
          displayName,
          pictureUrl,
          email
        }
      });
      
      console.log(`Successfully saved Google user data for: ${displayName} (${googleProfile.id})`);
      return socialLogin;
    } catch (prismaError) {
      console.error('Error using Prisma type-safe API:', prismaError);
      
      // Only for deployment/initialization scenarios where migrations haven't run
      if (prismaError instanceof Error && prismaError.message.includes('no such table')) {
        console.error('SocialLogin table does not exist. This should be handled by Prisma migrations.');
        console.error('As a temporary fallback, returning a mock object to continue the authentication flow.');
        
        // Return a mock object to ensure the authentication flow continues
        return {
          id: crypto.randomUUID(),
          shop,
          provider: "google",
          googleId: googleProfile.id,
          googleAccessToken: tokenData.access_token,
          googleRefreshToken: tokenData.refresh_token,
          tokenExpiresAt: expiresAt,
          displayName,
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
