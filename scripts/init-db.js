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
  
  try {
    // Ensure the prisma directory exists
    const prismaDir = path.join(__dirname, '..', 'prisma');
    if (!fs.existsSync(prismaDir)) {
      console.log('❌ Prisma directory not found.');
      process.exit(1);
    }

    // Run prisma generate to create Prisma client
    console.log('📦 Generating Prisma client...');
    execSync('npx prisma generate', { stdio: 'inherit' });
    
    // Check if database already exists and has tables
    try {
      console.log('🔍 Checking if Session table exists...');
      const sessionCount = await prisma.session.count();
      console.log(`✅ Session table exists with ${sessionCount} records.`);
    } catch (e) {
      console.log('⚠️ Session table not found, running migrations...');
      
      // Run migrations to create tables
      try {
        execSync('npx prisma migrate deploy', { stdio: 'inherit' });
        console.log('✅ Migration successful.');
      } catch (migrateError) {
        console.log('⚠️ Migration deploy failed, trying reset...');
        try {
          // If regular migration fails, try reset with force
          execSync('npx prisma migrate reset --force', { stdio: 'inherit' });
          console.log('✅ Migration reset successful.');
        } catch (resetError) {
          console.error('❌ Migration reset failed:', resetError);
          process.exit(1);
        }
      }
    }

    console.log('✅ Database initialization completed successfully.');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
