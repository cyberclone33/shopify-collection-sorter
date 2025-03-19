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
      // Check if migrations directory exists
      const migrationsPath = path.resolve(process.cwd(), "./prisma/migrations");
      const schemaPath = path.resolve(process.cwd(), "./prisma/schema.prisma");
      
      if (fs.existsSync(schemaPath)) {
        console.log("✅ Found schema.prisma");
        
        try {
          // Try to run a simple Prisma command to check if database exists
          console.log("🔍 Checking database connection...");
          execSync("npx prisma validate", { stdio: "inherit" });
          
          // Directly try to run the migration
          console.log("🔄 Running database migrations...");
          execSync("npx prisma migrate deploy", { stdio: "inherit" });
          console.log("✅ Database migrations completed");
        } catch (error) {
          console.error("⚠️ Error during migration:", error);
          
          // If migration fails, try reset as a fallback
          try {
            console.log("🔄 Attempting database reset...");
            execSync("npx prisma migrate reset --force", { stdio: "inherit" });
            console.log("✅ Database reset completed");
          } catch (resetError) {
            console.error("❌ Database reset failed:", resetError);
            
            // Last resort: create SQLite file directly
            try {
              console.log("🔄 Creating SQLite database file directly...");
              const dbPath = process.env.DATABASE_URL?.replace("file:", "") || "./prisma/dev.sqlite";
              const dbDir = path.dirname(dbPath);
              
              if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
              }
              
              if (!fs.existsSync(dbPath)) {
                fs.writeFileSync(dbPath, "");
              }
              
              execSync("npx prisma db push --force-reset", { stdio: "inherit" });
              console.log("✅ Database created and schema pushed");
            } catch (createError) {
              console.error("❌ Failed to create database directly:", createError);
            }
          }
        }
      } else {
        console.error("❌ schema.prisma not found");
      }
    }
  } catch (error) {
    console.error("❌ Database initialization failed:", error);
  }
}

// Initialize database before creating the client
if (process.env.NODE_ENV === "production") {
  console.log("🚀 Running database initialization in production mode");
  initializeDatabase();
}

let prisma: PrismaClient;

if (process.env.NODE_ENV !== "production") {
  if (!global.prisma) {
    global.prisma = new PrismaClient();
  }
  prisma = global.prisma;
} else {
  prisma = new PrismaClient();
}

export default prisma;
