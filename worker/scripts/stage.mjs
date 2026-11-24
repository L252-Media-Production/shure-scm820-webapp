// Copies the signed bundle(s), update.json and app-id.json from client/iwa-out into ./public.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../client/iwa-out');
const dest = path.resolve(here, '../public');

if (!existsSync(src)) {
  console.error('client/iwa-out not found. Run `npm run build:iwa` in client/ first.');
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const name of readdirSync(src)) {
  cpSync(path.join(src, name), path.join(dest, name));
  console.log(`staged ${name}`);
}
