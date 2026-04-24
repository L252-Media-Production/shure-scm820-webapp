import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(__dirname, '../public/icon.svg'));

for (const size of [192, 512]) {
  const dest = join(__dirname, `../public/pwa-${size}x${size}.png`);
  await sharp(svg).resize(size, size).png().toFile(dest);
  console.log(`  generated pwa-${size}x${size}.png`);
}
