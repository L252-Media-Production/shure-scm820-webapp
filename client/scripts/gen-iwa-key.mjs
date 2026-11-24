// Generates the Ed25519 key that signs the Isolated Web App. The Web Bundle ID (the app's
// permanent identity) is derived from this key: lose it and the app can never be updated in
// place; leak it and anyone can publish updates as you. Back it up, never commit it.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as wbnSign from 'wbn-sign';

const KEY_PATH = process.env.IWA_KEY_PATH
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../iwa-signing-key.pem');

if (existsSync(KEY_PATH)) {
  console.error(`Refusing to overwrite existing key: ${KEY_PATH}`);
  process.exit(1);
}

const { privateKey } = generateKeyPairSync('ed25519');
writeFileSync(KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

const id = new wbnSign.WebBundleId(wbnSign.parsePemKey(
  (await import('node:fs')).readFileSync(KEY_PATH, 'utf-8'),
)).serialize();
console.log(`Wrote ${KEY_PATH}`);
console.log(`Web Bundle ID: ${id}`);
console.log(`Origin:        isolated-app://${id}/`);
