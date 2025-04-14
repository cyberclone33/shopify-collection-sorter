// productCache.ts - Utility for caching product data to avoid redundant API calls

/**
 * Product cache for Daily Discounts feature
 * Stores fetched products and their metadata to avoid repeated API calls
 */

interface ProductCacheOptions {
  TTL?: number; // Cache time-to-live in milliseconds
  maxSize?: number; // Maximum number of products to cache
}

// Default options
const DEFAULT_OPTIONS: ProductCacheOptions = {
  TTL: 30 * 60 * 1000, // 30 minutes default TTL
  maxSize: 1000, // Store up to 1000 products by default
};

// ProductStats interface
export interface ProductStats {
  total: number;
  withImage: number;
  withVariant: number;
  withInventory: number;
  withCost: number;
  eligible: number;
}

// Product interface
export interface Product {
  id: string;
  title: string;
  imageUrl: string;
  imageAlt?: string;
  cost: number;
  sellingPrice: number;
  compareAtPrice: number | null;
  inventoryQuantity: number;
  variantId: string;
  variantTitle?: string | null;
  currencyCode: string;
  hasCostData: boolean;
}

class ProductCache {
  private data: Product[] | null = null;
  private timestamp: number = 0;
  private TTL: number;
  private maxSize: number;
  private randomSelections: Product[] = [];
  private productStats: ProductStats | null = null;
  private shopId: string | null = null;

  constructor(options: ProductCacheOptions = {}) {
    this.TTL = options.TTL || DEFAULT_OPTIONS.TTL!;
    this.maxSize = options.maxSize || DEFAULT_OPTIONS.maxSize!;
  }

  /**
   * Check if the cache is valid
   * @param shopId Current shop ID to verify we're using the right cache
   * @returns Boolean indicating if the cache is valid
   */
  isValid(shopId: string): boolean {
    const now = Date.now();
    const isExpired = now - this.timestamp > this.TTL;
    const isRightShop = this.shopId === shopId;
    
    return !isExpired && this.data !== null && isRightShop;
  }

  /**
   * Store products and metadata in the cache
   * @param products Array of product data to cache
   * @param stats Product statistics
   * @param randomSelections Pre-selected random products
   * @param shopId Shop ID this cache belongs to
   */
  store(products: Product[], stats: ProductStats, randomSelections: Product[], shopId: string): void {
    this.data = products.slice(0, this.maxSize); // Limit to maxSize
    this.timestamp = Date.now();
    this.productStats = stats;
    this.randomSelections = randomSelections;
    this.shopId = shopId;
  }

  /**
   * Get all cached products
   * @returns Array of cached products or null if cache is invalid
   */
  getProducts(): Product[] | null {
    return this.data;
  }

  /**
   * Get cached random product selections
   * @returns Array of preselected random products
   */
  getRandomSelections(): Product[] {
    return this.randomSelections;
  }

  /**
   * Get cached product statistics
   * @returns Product statistics
   */
  getProductStats(): ProductStats | null {
    return this.productStats;
  }

  /**
   * Get information about the cache status
   * @returns Cache status information
   */
  getStatus(): { 
    isCached: boolean;
    cacheAge: number;
    cacheExpiry: number;
    productsCount: number;
  } {
    const now = Date.now();
    return {
      isCached: this.data !== null,
      cacheAge: Math.round((now - this.timestamp) / 1000), // seconds
      cacheExpiry: Math.round((this.TTL - (now - this.timestamp)) / 1000), // seconds remaining
      productsCount: this.data?.length || 0
    };
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.data = null;
    this.timestamp = 0;
    this.randomSelections = [];
    this.productStats = null;
    this.shopId = null;
  }

  /**
   * Check the "freshness" of the cache
   * @returns Percentage of TTL that has elapsed (0-100)
   */
  getFreshness(): number {
    const now = Date.now();
    const elapsed = now - this.timestamp;
    return Math.max(0, Math.min(100, 100 - (elapsed / this.TTL * 100)));
  }
}

// Export a singleton instance
export const productCache = new ProductCache();

// Fisher-Yates shuffle algorithm
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]; // Create a copy to avoid modifying the original
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export default productCache;
