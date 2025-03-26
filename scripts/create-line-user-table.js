#!/usr/bin/env node

/**
 * This script directly creates the LineUser table in SQLite
 * Run it manually on Render to fix the missing table issue
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting manual LineUser table creation...');
  
  try {
    // First attempt: Use Prisma db push
    console.log('Attempting Prisma db push...');
    execSync('npx prisma db push --force-reset', { stdio: 'inherit' });
    console.log('Prisma db push completed successfully');
    
    // Verify the table exists
    try {
      await prisma.$queryRaw`SELECT 1 FROM LineUser LIMIT 1`;
      console.log('SUCCESS: LineUser table now exists!');
    } catch (tableCheckErr) {
      console.error('Table verification failed:', tableCheckErr);
      
      // If Prisma failed, try direct SQLite command
      console.log('Attempting direct SQLite table creation...');
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
      console.log('Direct SQLite table creation attempted');
      
      // Verify again
      try {
        await prisma.$queryRaw`SELECT 1 FROM LineUser LIMIT 1`;
        console.log('SUCCESS: LineUser table now exists after direct creation!');
      } catch (finalCheckErr) {
        console.error('Final table verification failed:', finalCheckErr);
      }
    }
  } catch (error) {
    console.error('Error creating LineUser table:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => console.log('Script completed'))
  .catch(e => console.error('Script failed:', e));
