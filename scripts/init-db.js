#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Prisma client
const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Starting database initialization...');
  console.log(`DEBUG: Current working directory: ${process.cwd()}`);
  console.log(`DEBUG: Node version: ${process.version}`);
  console.log(`DEBUG: Environment variables: DATABASE_URL=${process.env.DATABASE_URL || 'not set'}`);
  
  try {
    // First, regenerate the Prisma client to ensure all models are available
    console.log('DEBUG: Regenerating Prisma client...');
    try {
      execSync('npx prisma generate', { stdio: 'inherit' });
      console.log('DEBUG: Successfully regenerated Prisma client');
    } catch (prismaGenErr) {
      console.error('DEBUG: Error regenerating Prisma client:', prismaGenErr);
    }
    
    // Check if /data directory exists and create it if it doesn't
    console.log('DEBUG: Checking if /data directory exists');
    if (!fs.existsSync('/data')) {
      console.log('DEBUG: /data directory does not exist, attempting to create it');
      try {
        fs.mkdirSync('/data', { recursive: true });
        console.log('DEBUG: Successfully created /data directory');
      } catch (err) {
        console.error('DEBUG: Error creating /data directory:', err);
        console.log('DEBUG: Attempting to create /data directory with execSync');
        try {
          execSync('mkdir -p /data', { stdio: 'inherit' });
          console.log('DEBUG: Successfully created /data directory with execSync');
        } catch (execErr) {
          console.error('DEBUG: Error creating /data directory with execSync:', execErr);
        }
      }
    } else {
      console.log('DEBUG: /data directory exists');
    }
    
    // Check permissions on /data directory
    try {
      fs.accessSync('/data', fs.constants.W_OK);
      console.log('DEBUG: /data directory is writable');
    } catch (err) {
      console.error('DEBUG: /data directory is not writable:', err);
      console.log('DEBUG: Attempting to fix permissions with chmod');
      try {
        execSync('chmod -R 777 /data', { stdio: 'inherit' });
        console.log('DEBUG: Successfully changed permissions on /data directory');
      } catch (chmodErr) {
        console.error('DEBUG: Error changing permissions:', chmodErr);
      }
    }
    
    // Get DATABASE_URL from environment
    const dbUrl = process.env.DATABASE_URL || '';
    console.log(`DEBUG: DATABASE_URL env var: ${dbUrl}`);
    
    // Parse the file path from DATABASE_URL
    let dbFilePath = '';
    if (dbUrl.startsWith('file:')) {
      dbFilePath = dbUrl.replace('file:', '');
      console.log(`DEBUG: Database file path: ${dbFilePath}`);
      
      // Get the directory path
      const dbDirPath = path.dirname(dbFilePath);
      console.log(`DEBUG: Database directory path: ${dbDirPath}`);
      
      // Create the directory structure if it doesn't exist
      console.log(`DEBUG: Creating directory structure: ${dbDirPath}`);
      try {
        fs.mkdirSync(dbDirPath, { recursive: true });
        console.log(`DEBUG: Directory structure created or already exists`);
      } catch (err) {
        console.error(`DEBUG: Error creating directory structure with fs.mkdirSync:`, err);
        console.log(`DEBUG: Attempting to create directory with execSync`);
        try {
          execSync(`mkdir -p ${dbDirPath}`, { stdio: 'inherit' });
          console.log(`DEBUG: Successfully created directory with execSync`);
        } catch (execErr) {
          console.error(`DEBUG: Error creating directory with execSync:`, execErr);
        }
      }
      
      // Check if directory is writable
      try {
        fs.accessSync(dbDirPath, fs.constants.W_OK);
        console.log(`DEBUG: Directory ${dbDirPath} is writable`);
      } catch (e) {
        console.error(`DEBUG: Directory ${dbDirPath} is not writable:`, e.message);
        console.log(`DEBUG: Attempting to fix permissions with chmod`);
        try {
          execSync(`chmod -R 777 ${dbDirPath}`, { stdio: 'inherit' });
          console.log(`DEBUG: Successfully changed permissions on ${dbDirPath}`);
        } catch (chmodErr) {
          console.error(`DEBUG: Error changing permissions:`, chmodErr);
        }
      }
    }
    
    // Run Prisma migrations
    console.log('DEBUG: Running Prisma migrations...');
    try {
      execSync('npx prisma migrate deploy', { stdio: 'inherit' });
      console.log('DEBUG: Prisma migrations completed successfully');
    } catch (migrationErr) {
      console.error('DEBUG: Error running Prisma migrations:', migrationErr);
      
      // Try direct database push as a fallback with --accept-data-loss flag
      console.log('DEBUG: Attempting direct database push as fallback with --accept-data-loss flag...');
      try {
        execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
        console.log('DEBUG: Prisma db push with --accept-data-loss completed successfully');
      } catch (dbPushErr) {
        console.error('DEBUG: Error running Prisma db push with --accept-data-loss:', dbPushErr);
        
        // Try one more time with force flag as a last resort
        console.log('DEBUG: Attempting one final database push with force reset...');
        try {
          execSync('npx prisma db push --force-reset', { stdio: 'inherit' });
          console.log('DEBUG: Prisma db push with --force-reset completed successfully');
          console.log('WARNING: Database was completely reset. All data has been lost.');
        } catch (forcePushErr) {
          console.error('DEBUG: Error running Prisma db push with --force-reset:', forcePushErr);
        }
      }
    }
    
    // Connect to the database
    console.log('DEBUG: Connecting to the database...');
    await prisma.$connect();
    console.log('DEBUG: Connected to the database');
    
    // Check if the Session table exists
    console.log('DEBUG: Checking if Session table exists...');
    let sessionTableExists = false;
    try {
      await prisma.$queryRaw`SELECT 1 FROM Session LIMIT 1`;
      sessionTableExists = true;
      console.log('DEBUG: Session table exists');
    } catch (err) {
      console.error('DEBUG: Error checking Session table:', err.message);
      console.log('DEBUG: Session table does not exist or cannot be accessed');
    }
    
    // Check if the LineUser table exists
    console.log('DEBUG: Checking if LineUser table exists...');
    let lineUserTableExists = false;
    try {
      await prisma.$queryRaw`SELECT 1 FROM LineUser LIMIT 1`;
      lineUserTableExists = true;
      console.log('DEBUG: LineUser table exists');
    } catch (err) {
      console.error('DEBUG: Error checking LineUser table:', err.message);
      console.log('DEBUG: LineUser table does not exist or cannot be accessed');
      console.log('DEBUG: This should be handled by Prisma migrations. Make sure to run "npx prisma migrate deploy" before starting the app.');
    }
    
    // Check if the GoogleUser table exists
    console.log('DEBUG: Checking if GoogleUser table exists...');
    let googleUserTableExists = false;
    try {
      await prisma.$queryRaw`SELECT 1 FROM GoogleUser LIMIT 1`;
      googleUserTableExists = true;
      console.log('DEBUG: GoogleUser table exists');
    } catch (err) {
      console.error('DEBUG: Error checking GoogleUser table:', err.message);
      console.log('DEBUG: GoogleUser table does not exist or cannot be accessed');
      console.log('DEBUG: This should be handled by Prisma migrations. Make sure to run "npx prisma migrate deploy" before starting the app.');
    }
    
    // Check if the FacebookUser table exists
    console.log('DEBUG: Checking if FacebookUser table exists...');
    let facebookUserTableExists = false;
    try {
      await prisma.$queryRaw`SELECT 1 FROM FacebookUser LIMIT 1`;
      facebookUserTableExists = true;
      console.log('DEBUG: FacebookUser table exists');
    } catch (err) {
      console.error('DEBUG: Error checking FacebookUser table:', err.message);
      console.log('DEBUG: FacebookUser table does not exist or cannot be accessed');
      console.log('DEBUG: This should be handled by Prisma migrations. Make sure to run "npx prisma migrate deploy" before starting the app.');
    }
    
    // Check if the ShelfLifeItemPriceChange table exists
    console.log('DEBUG: Checking if ShelfLifeItemPriceChange table exists...');
    let priceChangeTableExists = false;
    try {
      await prisma.$queryRaw`SELECT 1 FROM ShelfLifeItemPriceChange LIMIT 1`;
      priceChangeTableExists = true;
      console.log('DEBUG: ShelfLifeItemPriceChange table exists');
    } catch (err) {
      console.log('DEBUG: ShelfLifeItemPriceChange table does not exist or cannot be accessed, creating it now...');
      
      try {
        // Create the ShelfLifeItemPriceChange table
        await prisma.$executeRaw`
          CREATE TABLE IF NOT EXISTS "ShelfLifeItemPriceChange" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "shop" TEXT NOT NULL,
            "shelfLifeItemId" TEXT NOT NULL,
            "shopifyVariantId" TEXT NOT NULL,
            "originalPrice" REAL NOT NULL,
            "originalCompareAtPrice" REAL,
            "newPrice" REAL NOT NULL,
            "newCompareAtPrice" REAL NOT NULL,
            "currencyCode" TEXT,
            "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "appliedByUserId" TEXT,
            "appliedByUserName" TEXT,
            "status" TEXT NOT NULL DEFAULT 'APPLIED',
            "notes" TEXT,
            FOREIGN KEY ("shelfLifeItemId") REFERENCES "ShelfLifeItem"("id") ON DELETE CASCADE
          )
        `;
        
        // Create indices for performance
        await prisma.$executeRaw`
          CREATE INDEX IF NOT EXISTS "shelfLifeItemId_idx" ON "ShelfLifeItemPriceChange"("shelfLifeItemId")
        `;
        
        await prisma.$executeRaw`
          CREATE INDEX IF NOT EXISTS "shopifyVariantId_idx" ON "ShelfLifeItemPriceChange"("shopifyVariantId")
        `;
        
        console.log('DEBUG: Successfully created ShelfLifeItemPriceChange table');
        priceChangeTableExists = true;
      } catch (createErr) {
        console.error('DEBUG: Error creating ShelfLifeItemPriceChange table:', createErr.message);
        console.log('DEBUG: Attempting to create table using raw SQL via execSync...');
        
        try {
          // Get database file path from environment variable
          const dbUrl = process.env.DATABASE_URL || '';
          let dbPath = '';
          if (dbUrl.startsWith('file:')) {
            dbPath = dbUrl.replace('file:', '');
          } else {
            // Default to a path that makes sense for your app
            dbPath = path.join(process.cwd(), 'prisma', 'prod.db');
          }
          
          const createTableSQL = `
            CREATE TABLE IF NOT EXISTS "ShelfLifeItemPriceChange" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "shop" TEXT NOT NULL,
              "shelfLifeItemId" TEXT NOT NULL,
              "shopifyVariantId" TEXT NOT NULL,
              "originalPrice" REAL NOT NULL,
              "originalCompareAtPrice" REAL,
              "newPrice" REAL NOT NULL,
              "newCompareAtPrice" REAL NOT NULL,
              "currencyCode" TEXT,
              "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "appliedByUserId" TEXT,
              "appliedByUserName" TEXT,
              "status" TEXT NOT NULL DEFAULT 'APPLIED',
              "notes" TEXT,
              FOREIGN KEY ("shelfLifeItemId") REFERENCES "ShelfLifeItem"("id") ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS "shelfLifeItemId_idx" ON "ShelfLifeItemPriceChange"("shelfLifeItemId");
            CREATE INDEX IF NOT EXISTS "shopifyVariantId_idx" ON "ShelfLifeItemPriceChange"("shopifyVariantId");
          `;
          
          execSync(`sqlite3 "${dbPath}" "${createTableSQL}"`, { stdio: 'inherit' });
          console.log('DEBUG: Successfully created ShelfLifeItemPriceChange table with execSync');
          priceChangeTableExists = true;
        } catch (execErr) {
          console.error('DEBUG: Failed to create ShelfLifeItemPriceChange table with execSync:', execErr);
        }
      }
    }
    
    console.log('✅ Database initialization completed');
    console.log(`DEBUG: Session table exists: ${sessionTableExists}`);
    console.log(`DEBUG: LineUser table exists: ${lineUserTableExists}`);
    console.log(`DEBUG: GoogleUser table exists: ${googleUserTableExists}`);
    console.log(`DEBUG: FacebookUser table exists: ${facebookUserTableExists}`);
    console.log(`DEBUG: ShelfLifeItemPriceChange table exists: ${priceChangeTableExists}`);
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
