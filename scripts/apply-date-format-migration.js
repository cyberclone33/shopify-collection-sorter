import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

async function applyDateFormatMigration() {
  console.log('🔄 Starting date format migration...');
  
  try {
    // Run Prisma migration to apply schema changes
    console.log('Running Prisma migration...');
    try {
      execSync('npx prisma migrate dev --name date_format_to_iso8601', { stdio: 'inherit' });
      console.log('✅ Prisma migration created and applied successfully');
    } catch (migrationErr) {
      console.error('Error creating migration:', migrationErr);
      
      // Try direct database push as a fallback
      console.log('Attempting direct database push as fallback...');
      try {
        execSync('npx prisma db push', { stdio: 'inherit' });
        console.log('✅ Prisma db push completed successfully');
      } catch (dbPushErr) {
        console.error('Error running Prisma db push:', dbPushErr);
        throw dbPushErr;
      }
    }
    
    console.log('✅ Date format migration completed successfully');
    console.log('The LineUser table now stores dates in ISO8601 format');
    console.log('New records will be stored in the correct format');
    
  } catch (error) {
    console.error('❌ Date format migration failed:', error);
    process.exit(1);
  }
}

applyDateFormatMigration();
