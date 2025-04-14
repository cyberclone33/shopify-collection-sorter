/**
 * Utilities for generating random discounts
 */
import { roundPrice, calculateProfitMargin, calculateSavingsAmount, calculateSavingsPercentage } from './pricingUtils';

// Define interfaces for product and discount data
export interface ProductData {
  id: string;
  title: string;
  imageUrl: string;
  cost: number;
  sellingPrice: number;
  compareAtPrice: number | null;
  inventoryQuantity: number;
  variantId: string;
  currencyCode: string;
  variantTitle?: string;
  hasCostData?: boolean;
}

export interface DiscountData {
  profitMargin: number;
  discountPercentage: number;
  originalPrice: number;
  discountedPrice: number;
  savingsAmount: number;
  savingsPercentage: number;
}

/**
 * Generate a random discount percentage between min and max values
 * @param min Minimum discount percentage (default: 10)
 * @param max Maximum discount percentage (default: 25)
 * @returns Random discount percentage
 */
export const generateRandomDiscountPercentage = (min: number = 10, max: number = 25): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Generate a discount for a product
 * @param product The product data
 * @returns Discount data or null if product is invalid
 */
export const generateDiscount = (product: ProductData): DiscountData | null => {
  if (!product) return null;
  
  // Calculate profit margin
  const profit = product.sellingPrice - product.cost;
  const profitMargin = calculateProfitMargin(product.cost, product.sellingPrice);
  
  // Generate random discount percentage between 10% and 25%
  const discountPercentage = generateRandomDiscountPercentage();
  
  // Calculate discounted profit (applying discount to the profit)
  const discountFactor = 1 - (discountPercentage / 100);
  const discountedProfit = profit * discountFactor;
  
  // Calculate new price (cost + discounted profit)
  const newPrice = product.cost + discountedProfit;
  const discountedPrice = roundPrice(newPrice); // Round up to nearest cent
  
  // Calculate savings
  const savingsAmount = calculateSavingsAmount(product.sellingPrice, discountedPrice);
  const savingsPercentage = calculateSavingsPercentage(product.sellingPrice, discountedPrice);
  
  // Return discount data
  return {
    profitMargin,
    discountPercentage,
    originalPrice: product.sellingPrice,
    discountedPrice,
    savingsAmount,
    savingsPercentage
  };
};

/**
 * Prepare form data for submitting a discount
 * @param product The product data
 * @param discount The discount data
 * @param isManual Whether this is a manual UI discount
 * @returns Form data object
 */
export const prepareDiscountFormData = (
  product: ProductData, 
  discount: DiscountData, 
  isManual: boolean = true
): FormData => {
  const formData = new FormData();
  
  // Basic product information
  formData.append("variantId", product.variantId);
  formData.append("newPrice", discount.discountedPrice.toString());
  
  // Get product ID from the product's full ID
  let productId = product.id;
  if (!productId.includes("gid://shopify/Product/") && /^\d+$/.test(productId)) {
    productI