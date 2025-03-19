import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

declare global {
  var prisma: PrismaClient;
}

// Function to initialize the database
async function initializeDatabase() {
  console.log("🔄 Initializing database...");
  
  try {
    // Make sure we're in production before running migrations
    if (process.env.NODE_ENV === "production") {
      // Ensure the prisma directory exists
      const prismaDir = path.resolve(process.cwd(), "./prisma");
      if (!fs.existsSync(prismaDir)) {
        console.log("📁 Creating prisma directory...");
        fs.mkdirSync(prismaDir, { recursive: true });
      }
      
      // Create empty database file if it doesn't exist
      const dbPath = path.resolve(prismaDir, "./prod.db");
      if (!fs.existsSync(dbPath)) {
        console.log("📄 Creating database file at", dbPath);
        fs.writeFileSync(dbPath, "");
        console.log("✅ Database file created");
      }
      
      try {
        // Try to run migrations directly
        console.log("🔄 Running database migrations...");
        execSync("npx prisma migrate deploy", { 
          stdio: "inherit",
          env: {
            ...process.env,
            DATABASE_URL: `file:${dbPath}`
          }
        });
        console.log("✅ Database migrations completed");
      } catch (error) {
        console.error("⚠️ Error during migration, trying alternative approaches...");
        
        try {
          // Try manually creating the Session table
          console.log("🔄 Manually creating Session table...");
          
          // Create an instance of PrismaClient with the correct database URL
          const tempPrisma = new PrismaClient({
            datasources: {
              db: {
                url: `file:${dbPath}`
              }
            }
          });
          
          // Execute raw SQL to create the Session table
          await tempPrisma.$executeRaw`
            CREATE TABLE IF NOT EXISTS "Session" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "shop" TEXT NOT NULL,
              "state" TEXT NOT NULL,
              "isOnline" BOOLEAN NOT NULL DEFAULT false,
              "scope" TEXT,
              "expires" DATETIME,
              "accessToken" TEXT NOT NULL,
              "userId" BIGINT,
              "firstName" TEXT,
              "lastName" TEXT,
              "email" TEXT,
              "accountOwner" BOOLEAN NOT NULL DEFAULT false,
              "locale" TEXT,
              "collaborator" BOOLEAN DEFAULT false,
              "emailVerified" BOOLEAN DEFAULT false
            );
          `;
          
          console.log("✅ Session table created manually");
          await tempPrisma.$disconnect();
        } catch (sqlError) {
          console.error("❌ Failed to create table manually:", sqlError);
        }
      }
    }
  } catch (error) {
    console.error("❌ Database initialization failed:", error);
  }
}

// Initialize database before creating the client
if (process.env.NODE_ENV === "production") {
  console.log("🚀 Running database initialization in production mode");
  // Run initialization
  initializeDatabase().catch(e => {
    console.error("Failed to initialize database:", e);
  });
}

// Create Prisma client
let prisma: PrismaClient;

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || "file:./prisma/prod.db"
      }
    }
  });
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient();
  }
  prisma = global.prisma;
}

export default prisma;
