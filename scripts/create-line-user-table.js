#!/usr/bin/env node

/**
 * This script properly sets up the LineUser table and regenerates Prisma client
 * This ensures the Prisma type-safe API will work correctly
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Starting Prisma setup for LineUser table...');
  
  try {
    // Step 1: Make sure schema.prisma is properly set up
    console.log('✅ Verifying schema.prisma includes LineUser model');
    const schemaPath = path.join(projectRoot, 'prisma', 'schema.prisma');
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    
    if (!schemaContent.includes('model LineUser')) {
      console.error('❌ LineUser model not found in schema.prisma!');
      return;
    }
    
    // Step 2: Regenerate Prisma client
    console.log('🔄 Regenerating Prisma client...');
    execSync('npx prisma generate', { 
      stdio: 'inherit',
      cwd: projectRoot
    });
    console.log('✅ Prisma client regenerated successfully');
    
    // Step 3: Push schema changes to the database
    console.log('🔄 Pushing schema to database...');
    execSync('npx prisma db push', { 
      stdio: 'inherit',
      cwd: projectRoot
    });
    console.log('✅ Schema pushed to database successfully');
    
    // Step 4: Verify the LineUser table exists
    try {
      console.log('🔍 Verifying LineUser table...');
      await prisma.$queryRaw`SELECT 1 FROM LineUser LIMIT 1`;
      console.log('✅ LineUser table exists in database');
    } catch (tableCheckErr) {
      console.error('❌ Table verification failed:', tableCheckErr);
      
      // If table doesn't exist, create it with direct SQL
      console.log('🔄 Creating LineUser table with direct SQL...');
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS "LineUser" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "shop" TEXT NOT NULL,
          "lineId" TEXT NOT NULL,
          "lineAccessToken" TEXT,
          "lineRefreshToken" TEXT,
          "tokenExpiresAt" DATETIME,
          "displayName" TEXT,
          "pictureUrl" TEXT,
          "email" TEXT,
          "shopifyCustomerId" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "LineUser_shop_lineId_key" ON "LineUser"("shop", "lineId");
      `;
      
      await prisma.$executeRawUnsafe(createTableSQL);
      console.log('✅ Direct SQL table creation completed');
      
      // Final verification
      try {
        await prisma.$queryRaw`SELECT 1 FROM LineUser LIMIT 1`;
        console.log('✅ LineUser table confirmed to exist after direct creation');
      } catch (finalCheckErr) {
        console.error('❌ Final table verification failed:', finalCheckErr);
      }
    }
    
    // Step 5: Test the Prisma model API directly
    console.log('🔍 Testing Prisma model API for LineUser...');
    try {
      // @ts-ignore - Type checking will fail if client not regenerated
      const testCount = await prisma.lineUser.count();
      console.log(`✅ Prisma model API working correctly! Found ${testCount} LineUser records`);
    } catch (modelErr) {
      console.error('❌ Prisma model API test failed:', modelErr);
      console.log('💡 This suggests your Prisma client needs to be restarted with the new schema');
    }
  } catch (error) {
    console.error('❌ Error setting up LineUser table:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => console.log('✅ Script completed successfully'))
  .catch(e => console.error('❌ Script failed:', e));
