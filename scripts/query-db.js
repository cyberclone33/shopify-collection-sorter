// Simple script to query the Prisma database
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get the current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Function to get the database URL from environment or default
function getDatabaseUrl() {
  // If DATABASE_URL is set, use that
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  
  // Use persistent storage on Render
  if (process.env.NODE_ENV === 'production' && fs.existsSync('/data')) {
    return 'file:/data/prisma/prod.db';
  }
  
  // Default fallback depending on environment
  if (process.env.NODE_ENV === 'production') {
    return `file:${path.resolve(projectRoot, './prisma/prod.db')}`;
  } else {
    return `file:${path.resolve(projectRoot, './prisma/dev.db')}`;
  }
}

// Create Prisma client with proper database connection
const dbUrl = getDatabaseUrl();
console.log(`Connecting to database at: ${dbUrl}`);

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  }
});

async function main() {
  try {
    // Get database tables
    console.log('Fetching database tables...');
    const tables = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table'`;
    console.log('Database tables:', tables.map(t => t.name));
    
    // Query sessions using raw SQL to avoid schema mismatches
    console.log('\nFetching all sessions...');
    try {
      const sessions = await prisma.$queryRaw`SELECT * FROM "Session"`;
      console.log(`Found ${sessions.length} sessions:`);
      console.log(JSON.stringify(sessions, null, 2));
    } catch (error) {
      console.error('Error querying sessions:', error.message);
    }
    
    // Query sorted collections using raw SQL to avoid schema mismatches
    console.log('\nFetching all sorted collections...');
    try {
      // Get column names first to understand the table structure
      const columns = await prisma.$queryRaw`PRAGMA table_info("SortedCollection")`;
      console.log('SortedCollection columns:', columns.map(c => c.name));
      
      const sortedCollections = await prisma.$queryRaw`SELECT * FROM "SortedCollection"`;
      console.log(`Found ${sortedCollections.length} sorted collections:`);
      console.log(JSON.stringify(sortedCollections, null, 2));
    } catch (error) {
      console.error('Error querying sorted collections:', error.message);
    }
    
  } catch (error) {
    console.error('Error querying database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
