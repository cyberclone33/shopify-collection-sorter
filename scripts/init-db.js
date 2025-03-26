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
      
      // Try direct database push as a fallback
      console.log('DEBUG: Attempting direct database push as fallback...');
      try {
        execSync('npx prisma db push', { stdio: 'inherit' });
        console.log('DEBUG: Prisma db push completed successfully');
      } catch (dbPushErr) {
        console.error('DEBUG: Error running Prisma db push:', dbPushErr);
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
    }
    
    console.log('✅ Database initialization completed');
    console.log(`DEBUG: Session table exists: ${sessionTableExists}`);
    console.log(`DEBUG: LineUser table exists: ${lineUserTableExists}`);
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
