/**
 * Utility functions for price formatting and calculations
 */

/**
 * Format a number as currency
 * @param amount The amount to format
 * @param currencyCode The currency code (default: USD)
 * @returns Formatted currency string
 */
export const formatCurrency = (amount: number, currencyCode: string = "USD"): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2
  }).format(amount);
};

/**
 * Calculate savings amount between two prices
 * @param originalPrice The original price
 * @param discountedPrice The discounted price
 * @returns The amount saved
 */
export const calculateSavingsAmount = (originalPrice: number, discountedPrice: number): number => {
  return originalPrice - discountedPrice;
};

/**
 * Calculate savings percentage
 * @param originalPrice The original price
 * @param discountedPrice The discounted price
 * @returns The savings percentage
 */
export const calculateSavingsPercentage = (originalPrice: number, discountedPrice: number): number => {
  if (originalPrice <= 0) return 0;
  return (calculateSavingsAmount(originalPrice, discountedPrice) / originalPrice) * 100;
};

/**
 * Calculate profit margin percentage
 * @param cost The cost price
 * @param sellingPrice The selling price
 * @returns The profit margin percentage
 */
export const calculateProfitMargin = (cost: number, sellingPrice: number): number => {
  if (sellingPrice <= 0) return 0;
  const profit = sellingPrice - cost;
  return (profit / sellingPrice) * 100;
};

/**
 * Round a price to the nearest cent
 * @param price The price to round
 * @returns The rounded price
 */
export const roundPrice = (price: number): number => {
  return Math.ceil(price * 100) / 100; // Round up to nearest cent
};
