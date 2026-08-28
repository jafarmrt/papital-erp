import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, callback);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      callback(fullPath);
    }
  }
}

let modifiedFiles = 0;
let replacedCount = 0;

walkDir(path.join(process.cwd(), 'src'), (filePath) => {
  let content = fs.readFileSync(filePath, 'utf-8');
  const original = content;

  // 1. Replace catch (err: any) with catch (err)
  const catchRegex = /catch\s*\(\s*([a-zA-Z0-9_$]+)\s*:\s*any\s*\)/g;
  const matches = content.match(catchRegex);
  if (matches) {
    replacedCount += matches.length;
    content = content.replace(catchRegex, 'catch ($1)');
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf-8');
    modifiedFiles++;
  }
});

console.log(`Modified ${modifiedFiles} files, replaced ${replacedCount} catch instances.`);
