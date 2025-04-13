#!/usr/bin/env node

/**
 * This script fixes a failed migration by manually creating the required tables
 * Run this on your server (Render) to fix the migration issue
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Starting migration fix...');
  
  try {
    // First check if the _prisma_migrations table exists
    console.log('Checking migration history...');
    try {
      await prisma.$queryRaw`SELECT * FROM _prisma_migrations WHERE migration_name = '20250413031745_update_daily_discount_log' LIMIT 1`;
      console.log('Migration record exists in _prisma_migrations table');
      
      // Check if migration is marked as failed
      const migrationRecord = await prisma.$queryRaw`
        SELECT * FROM _prisma_migrations 
        WHERE migration_name = '20250413031745_update_daily_discount_log' 
        LIMIT 1
      `;
      
      if (Array.isArray(migrationRecord) && migrationRecord.length > 0) {
        const record = migrationRecord[0];
        console.log('Migration record:', record);
        
        if (record.applied === 0) {
          console.log('Migration is marked as failed. Updating to applied status...');
          await prisma.$executeRaw`
            UPDATE _prisma_migrations
            SET applied = 1, finished_at = datetime('now')
            WHERE migration_name = '20250413031745_update_daily_discount_log'
          `;
          console.log('Migration record updated to applied status');
        } else {
          console.log('Migration is already marked as applied');
        }
      }
    } catch (e) {
      console.log('Error querying migration record:', e);
      console.log('Will proceed with creating tables directly');
    }
    
    // Check if the DailyDiscountLog table exists
    try {
      await prisma.$queryRaw`SELECT 1 FROM DailyDiscountLog LIMIT 1`;
      console.log('DailyDiscountLog table already exists');
    } catch (e) {
      console.log('DailyDiscountLog table does not exist, creating it...');
      
      // Create the DailyDiscountLog table
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "DailyDiscountLog" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "shop" TEXT NOT NULL,
          "productId" TEXT NOT NULL,
          "productTitle" TEXT NOT NULL,
          "variantId" TEXT NOT NULL,
          "variantTitle" TEXT,
          "originalPrice" REAL NOT NULL,
          "discountedPrice" REAL NOT NULL,
          "compareAtPrice" REAL,
          "costPrice" REAL,
          "profitMargin" REAL,
          "discountPercentage" REAL NOT NULL,
          "savingsAmount" REAL NOT NULL,
          "savingsPercentage" REAL NOT NULL,
          "currencyCode" TEXT NOT NULL DEFAULT 'USD',
          "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "appliedByUserId" TEXT,
          "imageUrl" TEXT,
          "inventoryQuantity" INTEGER,
          "isRandomDiscount" BOOLEAN NOT NULL DEFAULT true,
          "notes" TEXT
        )
      `;
      
      // Create the indexes
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "DailyDiscountLog_shop_idx" ON "DailyDiscountLog"("shop")`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "DailyDiscountLog_variantId_idx" ON "DailyDiscountLog"("variantId")`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "DailyDiscountLog_appliedAt_idx" ON "DailyDiscountLog"("appliedAt")`;
      
      console.log('DailyDiscountLog table created successfully');
    }
    
    // Check if the ShelfLifeItemPriceChange table exists (also part of the migration)
    try {
      await prisma.$queryRaw`SELECT 1 FROM ShelfLifeItemPriceChange LIMIT 1`;
      console.log('ShelfLifeItemPriceChange table already exists');
    } catch (e) {
      console.log('ShelfLifeItemPriceChange table does not exist, creating it...');
      
      // Create the ShelfLifeItemPriceChange table
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "ShelfLifeItemPriceChange" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "shop" TEXT NOT NULL,
          "shelfLifeItemId" TEXT,
          "shopifyVariantId" TEXT NOT NULL,
          "originalPrice" REAL NOT NULL,
          "originalCompareAtPrice" REAL,
          "newPrice" REAL NOT NULL,
          "newCompareAtPrice" REAL NOT NULL,
          "currencyCode" TEXT,
          "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          