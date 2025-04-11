import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Files to fix
const filesToFix = [
  './app/routes/app._index.tsx',
  './app/routes/app.shelf-life.tsx'
];

// Process each file
for (const filePath of filesToFix) {
  const fullPath = path.resolve(__dirname, filePath);
  
  try {
    // Read file content
    const data = await fs.readFile(fullPath, 'utf8');
    
    // Fix import statements for polaris-icons
    let fixedContent = data.replace(
      /from\s+["']@shopify\/polaris-icons["']?\s*;?/g, 
      'from "@shopify/polaris-icons";'
    );
    
    // Fix specific import for RefreshMinor and UndoMinor
    fixedContent = fixedContent.replace(
      /import\s+{\s*RefreshMinor,\s*UndoMinor\s*}\s+from\s+["']@shopify\/polaris-icons["']?\s*;?/g,
      'import { RefreshMinor, UndoMinor } from "@shopify/polaris-icons";'
    );
    
    // Fix import for NoteIcon and RefreshIcon
    fixedContent = fixedContent.replace(
      /import\s+{\s*NoteIcon,\s*RefreshIcon\s*}\s+from\s+["']@shopify\/polaris-icons["']?\s*;?/g,
      'import { NoteIcon, RefreshIcon } from "@shopify/polaris-icons";'
    );
    
    // Write the fixed content back to the file
    await fs.writeFile(fullPath, fixedContent, 'utf8');
    console.log(`Successfully fixed imports in ${filePath}`);
    
  } catch (err) {
    console.error(`Error processing ${filePath}:`, err);
  }
}
