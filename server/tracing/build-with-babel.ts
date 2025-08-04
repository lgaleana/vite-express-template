import babel from '@babel/core';
import * as fs from 'fs';
import * as path from 'path';

// Simple safeToString function to inject
const safeToStringCode = `
function safeToString(value) {
  try {
    return JSON.stringify(value, (key, val) => {
      if (val instanceof Error) return String(val);
      return val;
    });
  } catch (e) {
    try {
      return String(value);
    } catch (e2) {
      return '[stringify error]';
    }
  }
}
`;

export function buildWithBabel(): void {
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const serverRoot = path.dirname(__dirname); // Go up one level from tracing/ to server/
  const srcDir = path.join(serverRoot, 'src');
  const outDir = path.join(serverRoot, 'dist/instrumented');
  
  // Clear output directory
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
  }
  fs.mkdirSync(outDir, { recursive: true });
  
  // Process all TypeScript files
  const files = getTypeScriptFiles(srcDir);
  
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    
    try {
      const result = babel.transformSync(source, {
        filename: file,
        presets: ['@babel/preset-typescript'],
        plugins: [
          path.join(__dirname, 'babel-plugin-function-logger.js')
        ]
      });

      if (!result || !result.code) {
        console.error(`❌ No output for ${file}`);
        continue;
      }
      
      // Add safeToString function at the top
      const instrumentedCode = safeToStringCode + '\n' + result.code;
      
      // Write to output directory
      const relativePath = path.relative(srcDir, file);
      const outputPath = path.join(outDir, relativePath.replace('.ts', '.js'));
      const outputDir = path.dirname(outputPath);
      
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      fs.writeFileSync(outputPath, instrumentedCode);
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, (error as Error).message);
    }
  }
}

function getTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  
  function walk(currentDir: string): void {
    const items = fs.readdirSync(currentDir);
    
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (item.endsWith('.ts') && !item.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }
  }
  
  walk(dir);
  return files;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  buildWithBabel();
} 