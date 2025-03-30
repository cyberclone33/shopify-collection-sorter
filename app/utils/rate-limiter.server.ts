/**
 * Simple in-memory rate limiter
 * Note: For production, you should use a Redis-based rate limiter for distributed deployments
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

// Maps IP addresses to rate limit records
const ipLimiter = new Map<string, RateLimitRecord>();

// Clear expired records every hour to prevent memory leaks
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of ipLimiter.entries()) {
      if (record.resetAt <= now) {
        ipLimiter.delete(ip);
      }
    }
  }, 60 * 60 * 1000);
}

/**
 * Check if a request should be rate limited
 * @param ip Client IP address
 * @param maxRequests Maximum requests allowed in the window
 * @param windowMs Time window in milliseconds
 * @returns Object containing limit information
 */
export function checkRateLimit(ip: string, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  
  // Get or create rate limit record
  let record = ipLimiter.get(ip);
  if (!record || record.resetAt <= now) {
    record = { count: 0, resetAt: now + windowMs };
    ipLimiter.set(ip, record);
  }
  
  // Increment counter
  record.count++;
  
  // Check if rate limit exceeded
  const isRateLimited = record.count > maxRequests;
  const remaining = Math.max(0, maxRequests - record.count);
  const resetAt = record.resetAt;
  
  return {
    isRateLimited,
    remaining,
    resetAt,
    limit: maxRequests,
    windowMs
  };
}
