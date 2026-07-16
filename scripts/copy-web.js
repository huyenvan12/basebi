import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');

const ENTRIES = [
  'index.html',
  'basebi.css',
  'js',
  'favicon.ico',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'apple-touch-icon.png',
  'basebi-import-template.json',
];

rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW);

for (const entry of ENTRIES) {
  cpSync(path.join(ROOT, entry), path.join(WWW, entry), { recursive: true });
}

console.log(`Copied ${ENTRIES.length} entries to www/`);
