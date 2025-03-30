/**
 * Security headers to add to all responses
 * These headers help protect against common web vulnerabilities
 */
export function getSecurityHeaders() {
  return {
    // Content Security Policy to mitigate XSS attacks - Allow embedding in Shopify Admin
    "Content-Security-Policy": "default-src 'self' https://*.shopify.com https://cdn.shopify.com; script-src 'self' 'unsafe-inline' https://*.shopify.com; style-src 'self' 'unsafe-inline' https://*.shopify.com; img-src 'self' data: https://*.shopify.com https://cdn.shopify.com; connect-src 'self' https://*.shopify.com https://api.line.me https://accounts.google.com https://graph.facebook.com; frame-ancestors 'self' https://*.shopify.com https://admin.shopify.com;",
    
    // HTTP Strict Transport Security to enforce HTTPS
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    
    // Prevent MIME type sniffing
    "X-Content-Type-Options": "nosniff",
    
    // NOTE: Removed X-Frame-Options as it conflicts with App Bridge embedding
    // Shopify needs to embed our app in an iframe, so we use frame-ancestors in CSP instead
    
    // Add XSS protection as a defense-in-depth measure
    "X-XSS-Protection": "1; mode=block",
    
    // Control referrer information
    "Referrer-Policy": "strict-origin-when-cross-origin"
  };
}
