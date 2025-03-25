// Simple script to query the Prisma database
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Create Prisma client with proper database connection
let prisma;
if (process.env.NODE_ENV === 'production') {
  const dbPath = path.resolve(projectRoot, './prisma/prod.db');
  console.log('Connecting to production database at:', dbPath);
  
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: `file:${dbPath}?mode=rwc`
      }
    }
  });
} else {
  // Development mode - use dev.db
  const dbPath = path.resolve(projectRoot, './prisma/dev.db');
  console.log('Connecting to development database at:', dbPath);
  
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: `file:${dbPath}?mode=rwc`
      }
    }
  });
}

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
