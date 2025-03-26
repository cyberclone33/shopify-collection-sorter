#!/usr/bin/env node

/**
 * This script regenerates the Prisma client to ensure all models are properly recognized
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  console.log('🔄 Regenerating Prisma client...');
  
  try {
    // Regenerate Prisma client
    execSync('npx prisma generate', { 
      stdio: 'inherit',
      cwd: projectRoot
    });
    console.log('✅ Prisma client regenerated successfully');
    
    // Verify the generated client
    console.log('🔍 Verifying the generated Prisma client...');
    const generatedClientPath = path.join(projectRoot, 'node_modules', '.prisma', 'client', 'index.d.ts');
    execSync(`grep -n "lineUser" ${generatedClientPath}`, { 
      stdio: 'inherit',
      cwd: projectRoot
    });
    
    console.log('✅ Verification complete. If you see "lineUser" in the output above, the model was generated correctly.');
    console.log('📋 Note: In Prisma, model names are automatically converted to camelCase in the generated client.');
    console.log('   So "LineUser" in your schema becomes "lineUser" in the client API.');
  } catch (error) {
    console.error('❌ Error regenerating Prisma client:', error);
  }
}

main()
  .then(() => console.log('✅ Script completed successfully'))
  .catch(e => console.error('❌ Script failed:', e));
