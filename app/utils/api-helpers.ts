/**
 * Utility functions for handling API authentication and requests
 */

/**
 * Gets the current shop domain, either from session or localStorage
 */
export function getCurrentShop(): string | null {
  try {
    // Try to get from localStorage first (client-side)
    if (typeof window !== 'undefined' && window.localStorage) {
      const storedShop = localStorage.getItem('shopify:shop');
      if (storedShop) return storedShop;
    }
    
    // If we're in an iframe embedded in Shopify Admin
    if (typeof window !== 'undefined' && window.location.ancestorOrigins) {
      const adminOrigin = Array.from(window.location.ancestorOrigins).find(origin => 
        origin.includes('.myshopify.com') || 
        origin.includes('admin.shopify.com')
      );
      
      if (adminOrigin) {
        // Extract shop domain
        const match = adminOrigin.match(/([a-zA-Z0-9-]+)\.myshopify\.com/) || 
                    adminOrigin.match(/admin\.shopify\.com\/store\/([a-zA-Z0-9-]+)/);
        
        if (match && match[1]) {
          const shop = `${match[1]}.myshopify.com`;
          // Save it for future use
          if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.setItem('shopify:shop', shop);
          }
          return shop;
        }
      }
    }
    
    // Extract from current URL if possible
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const shopParam = urlParams.get('shop');
      if (shopParam) {
        // Save it for future use
        if (window.localStorage) {
          localStorage.setItem('shopify:shop', shopParam);
        }
        return shopParam;
      }
    }
    
    return null;
  } catch (e) {
    console.error("Error getting current shop:", e);
    return null;
  }
}

/**
 * Get the current session token if available
 */
export function getCurrentToken(): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem('shopify:token');
    }
    return null;
  } catch (e) {
    console.error("Error getting token:", e);
    return null;
  }
}

/**
 * Adds authentication parameters to the API URL
 */
export function addAuthToUrl(url: string): string {
  const shop = getCurrentShop();
  const token = getCurrentToken();
  
  const separator = url.includes('?') ? '&' : '?';
  let authUrl = url;
  
  if (shop) {
    authUrl += `${separator}shop=${encodeURIComponent(shop)}`;
  }
  
  if (token) {
    authUrl += `&token=${encodeURIComponent(token)}`;
  }
  
  return authUrl;
}

/**
 * Helper function to fetch API data with authentication
 */
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const authUrl = addAuthToUrl(url);
  
  // Add token to headers if available
  const token = getCurrentToken();
  if (token && options.headers) {
    options.headers = {
      ...options.headers,
      Authorization: `Bearer ${token}`
    };
  }
  
  return fetch(authUrl, options);
}

/**
 * Store a session token for future API calls
 */
export function storeSessionToken(token: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.setItem('shopify:token', token);
  }
}
