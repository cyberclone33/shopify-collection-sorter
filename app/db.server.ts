import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

declare global {
  var prisma: PrismaClient;
}

// Get the database URL from environment variable or use a default
function getDatabaseUrl() {
  // If DATABASE_URL is set, use that
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  
  // Use persistent storage on Render
  const renderDataDir = "/data";
  const renderPrismaDir = path.join(renderDataDir, "prisma");
  
  if (process.env.NODE_ENV === "production") {
    // Ensure the data directories exist
    try {
      if (!fs.existsSync(renderDataDir)) {
        console.log(` Creating Render data directory at ${renderDataDir}...`);
        fs.mkdirSync(renderDataDir, { recursive: true });
      }
      
      if (!fs.existsSync(renderPrismaDir)) {
        console.log(` Creating Render prisma directory at ${renderPrismaDir}...`);
        fs.mkdirSync(renderPrismaDir, { recursive: true });
      }
      
      // Log the directories for debugging
      console.log(` Render directories status: data=${fs.existsSync(renderDataDir)}, prisma=${fs.existsSync(renderPrismaDir)}`);
      
      // Set permissive permissions
      try {
        fs.chmodSync(renderDataDir, 0o777); // rwxrwxrwx
        fs.chmodSync(renderPrismaDir, 0o777); // rwxrwxrwx
        console.log(` Directory permissions set for data directories`);
      } catch (permError) {
        console.error(` Error setting data directory permissions:`, permError);
      }
      
      return `file:${path.join(renderPrismaDir, "prod.db")}`;
    } catch (dirError) {
      console.error(` Error creating data directories:`, dirError);
      // Fall back to project directory if we can't create the data directory
      return `file:${path.resolve(process.cwd(), "./prisma/prod.db")}`;
    }
  }
  
  // Default fallback for local development
  return `file:${path.resolve(process.cwd(), "./prisma/prod.db")}`;
}

// Function to initialize the database
async function initializeDatabase() {
  console.log(" Initializing database...");
  
  try {
    // Make sure we're in production before running migrations
    if (process.env.NODE_ENV === "production") {
      // Get the database URL
      const dbUrl = getDatabaseUrl();
      console.log(` Using database URL: ${dbUrl}`);
      
      // Extract the file path from the URL
      const matches = dbUrl.match(/^file:(.+)(\?.*)?$/);
      if (!matches) {
        console.error(" Invalid DATABASE_URL format. Must start with 'file:'");
        return;
      }
      
      const dbPath = matches[1];
      const dbDir = path.dirname(dbPath);
      
      // Ensure the directory exists
      if (!fs.existsSync(dbDir)) {
        console.log(` Creating database directory at ${dbDir}...`);
        fs.mkdirSync(dbDir, { recursive: true });
      }
      
      // Log the directory contents
      try {
        console.log(` Database directory contents:`, fs.readdirSync(dbDir));
      } catch (readError) {
        console.error(` Error reading database directory:`, readError);
      }
      
      // Create empty database file if it doesn't exist
      if (!fs.existsSync(dbPath)) {
        console.log(` Creating database file at ${dbPath}`);
        fs.writeFileSync(dbPath, "");
        console.log(` Database file created`);
      }
      
      // Set permissive file permissions
      try {
        console.log(` Setting database file permissions...`);
        fs.chmodSync(dbPath, 0o666); // rw-rw-rw-
        console.log(` File permissions set`);
        
        // Also set directory permissions
        fs.chmodSync(dbDir, 0o777); // rwxrwxrwx
        console.log(` Directory permissions set`);
      } catch (permError) {
        console.error(` Error setting permissions:`, permError);
      }
      
      try {
        // Try to run migrations directly
        console.log(` Running database migrations...`);
        execSync("npx prisma migrate deploy", { 
          stdio: "inherit",
          env: {
            ...process.env,
            DATABASE_URL: dbUrl
          }
        });
        console.log(` Database migrations completed`);
        
        // Explicitly create the SortedCollection table to ensure it exists
        console.log(` Ensuring SortedCollection table exists...`);
        const createTableSQL = `
          CREATE TABLE IF NOT EXISTS "SortedCollection" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "shop" TEXT NOT NULL,
            "collectionId" TEXT NOT NULL,
            "collectionTitle" TEXT NOT NULL,
            "sortedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "sortOrder" TEXT NOT NULL DEFAULT 'MANUAL'
          );
          
          CREATE UNIQUE INDEX IF NOT EXISTS "shop_collectionId" ON "SortedCollection"("shop", "collectionId");
        `;
        
        // Write the SQL to a file
        fs.writeFileSync(path.join(dbDir, "create-sortedcollection.sql"), createTableSQL);
        
        // Execute it with sqlite3
        try {
          execSync(`cat ${path.join(dbDir, "create-sortedcollection.sql")} | sqlite3 ${dbPath}`, {
            stdio: "inherit"
          });
          console.log(` SortedCollection table ensured via direct SQL`);
        } catch (sqliteError) {
          console.error(` Error with direct SQL:`, sqliteError);
        }
        
        // Test the database connection immediately
        const testPrisma = new PrismaClient({
          datasources: {
            db: {
              url: dbUrl
            }
          }
        });
        
        try {
          await testPrisma.$queryRaw`SELECT 1`;
          console.log(` Database connection test successful`);
          
          // Also test the SortedCollection table
          try {
            await testPrisma.$queryRaw`SELECT COUNT(*) FROM SortedCollection`;
            console.log(` SortedCollection table exists and is accessible`);
          } catch (tableError) {
            console.error(` SortedCollection table test failed:`, tableError);
          }
          
          await testPrisma.$disconnect();
        } catch (testError) {
          console.error(` Database connection test failed:`, testError);
        }
      } catch (error) {
        console.error(` Error during migration, trying alternative approaches...`);
        
        try {
          // Try manually creating the Session table and SortedCollection table
          console.log(` Manually creating required tables...`);
          
          // Use the sqlite3 command line directly
          const createTableSQL = `
            CREATE TABLE IF NOT EXISTS "Session" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "shop" TEXT NOT NULL,
              "state" TEXT NOT NULL,
              "isOnline" BOOLEAN NOT NULL DEFAULT 0,
              "scope" TEXT,
              "expires" DATETIME,
              "accessToken" TEXT NOT NULL,
              "userId" INTEGER,
              "firstName" TEXT,
              "lastName" TEXT,
              "email" TEXT,
              "accountOwner" BOOLEAN NOT NULL DEFAULT 0,
              "locale" TEXT,
              "collaborator" BOOLEAN DEFAULT 0,
              "emailVerified" BOOLEAN DEFAULT 0
            );
            
            CREATE TABLE IF NOT EXISTS "SortedCollection" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "shop" TEXT NOT NULL,
              "collectionId" TEXT NOT NULL,
              "collectionTitle" TEXT NOT NULL,
              "sortedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "sortOrder" TEXT NOT NULL DEFAULT 'MANUAL'
            );
            
            CREATE UNIQUE INDEX IF NOT EXISTS "shop_collectionId" ON "SortedCollection"("shop", "collectionId");
          `;
          
          try {
            fs.writeFileSync(path.join(dbDir, "create-session.sql"), createTableSQL);
            execSync(`cat ${path.join(dbDir, "create-session.sql")} | sqlite3 ${dbPath}`, {
              stdio: "inherit"
            });
            console.log(` Tables created using sqlite3 CLI`);
          } catch (sqliteError) {
            console.error(` Failed to create tables using sqlite3:`, sqliteError);
            
            // Last resort: use node-sqlite3 if available
            try {
              console.log(` Attempting to create tables with raw SQL via Prisma...`);
              
              // Create direct database connection
              const directPrisma = new PrismaClient({
                datasources: {
                  db: {
                    url: `${dbUrl}?mode=rwc`
                  }
                }
              });
              
              await directPrisma.$executeRawUnsafe(createTableSQL);
              console.log(` Tables created using Prisma raw SQL`);
              await directPrisma.$disconnect();
            } catch (prismaError) {
              console.error(` All attempts to create database tables failed:`, prismaError);
            }
          }
        } catch (sqlError) {
          console.error(` Failed to create tables manually:`, sqlError);
        }
      }
    }
  } catch (error) {
    console.error(` Database initialization failed:`, error);
  }
}

// Initialize database before creating the client
if (process.env.NODE_ENV === "production") {
  console.log(" Running database initialization in production mode");
  // Run initialization
  initializeDatabase().catch(e => {
    console.error("Failed to initialize database:", e);
  });
}

// Create Prisma client
let prisma: PrismaClient;

if (process.env.NODE_ENV === "production") {
  // Use the DATABASE_URL from environment or our helper function
  const dbUrl = getDatabaseUrl();
  console.log(" Connecting to database at:", dbUrl);
  
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: dbUrl
      }
    }
  });
  
  // Verify the SortedCollection table exists immediately
  (async () => {
    try {
      await prisma.$queryRaw`SELECT count(*) FROM SortedCollection`;
      console.log(" SortedCollection table verified to exist");
    } catch (tableError) {
      console.error(" SortedCollection table verification failed:", tableError);
      
      // Try to create it
      try {
        await prisma.$executeRaw`
          CREATE TABLE IF NOT EXISTS "SortedCollection" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "shop" TEXT NOT NULL,
            "collectionId" TEXT NOT NULL,
            "collectionTitle" TEXT NOT NULL,
            "sortedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "sortOrder" TEXT NOT NULL DEFAULT 'MANUAL'
          )
        `;
        console.log(" SortedCollection table created during startup");
      } catch (createError) {
        console.error(" Failed to create SortedCollection table:", createError);
      }
    }
  })();
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient();
  }
  prisma = global.prisma;
}

export default prisma;
