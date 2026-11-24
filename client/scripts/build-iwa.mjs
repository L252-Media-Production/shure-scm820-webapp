// Builds the Isolated Web App: Vite build (--mode iwa) -> Web Bundle -> signed .swbn,
// plus the update manifest the Cloudflare Worker serves. Output: ./iwa-out
//
//   IWA_KEY_PATH            signing key (default: client/iwa-signing-key.pem)
//   IWA_UPDATE_MANIFEST_URL HTTPS URL of the deployed update.json (baked into the app manifest
//                           so installed copies can self-update). Omit for a one-off local build.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as wbn from 'wbn';
import * as wbnSign from 'wbn-sign';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist-iwa');
const OUT = path.join(ROOT, 'iwa-out');
const KEY_PATH = process.env.IWA_KEY_PATH || path.join(ROOT, 'iwa-signing-key.pem');
const UPDATE_URL = process.env.IWA_UPDATE_MANIFEST_URL || '';
const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

// Baseline headers every IWA response needs (cross-origin isolation + strict CSP).
const IWA_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': [
    "base-uri 'none'", "default-src 'self'", "object-src 'none'",
    "frame-src 'self' https: blob: data:", "connect-src 'self' https: wss: blob: data:",
    "script-src 'self' 'wasm-unsafe-eval'", "img-src 'self' https: blob: data:",
    "media-src 'self' https: blob: data:", "font-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'", "require-trusted-types-for 'script'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
};

// direct-sockets: raw TCP to the SCM820. midi: X-Touch over USB. Must be in BOTH the manifest
// and the response header to take effect.
const PERMISSIONS = {
  'direct-sockets': ['self'],
  'direct-sockets-private': ['self'],
  'cross-origin-isolated': ['self'],
  midi: ['self'],
};
const permissionsHeader = Object.entries(PERMISSIONS)
  .map(([name, list]) => `${name}=(${list.join(' ')})`).join(', ');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

if (!existsSync(KEY_PATH)) {
  console.error(`No signing key at ${KEY_PATH}. Run: npm run iwa:key`);
  process.exit(1);
}

const vite = spawnSync('npx', ['vite', 'build', '--mode', 'iwa'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
if (vite.status !== 0) process.exit(vite.status ?? 1);

const privateKey = wbnSign.parsePemKey(readFileSync(KEY_PATH, 'utf-8'));
const webBundleId = new wbnSign.WebBundleId(privateKey).serialize();
const origin = `isolated-app://${webBundleId}`;

const manifest = {
  name: 'SCM820 Virtual Mixer',
  short_name: 'SCM820',
  description: 'Virtual mixer for the Shure SCM820 (direct TCP, USB X-Touch)',
  version,
  start_url: '/',
  display: 'standalone',
  theme_color: '#18181b',
  background_color: '#18181b',
  icons: [
    { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
    { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
  permissions_policy: PERMISSIONS,
  ...(UPDATE_URL ? { update_manifest_url: UPDATE_URL } : {}),
};
const wellKnownDir = path.join(DIST, '.well-known');
mkdirSync(wellKnownDir, { recursive: true });
writeFileSync(path.join(wellKnownDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

const builder = new wbn.BundleBuilder();
const addFile = (urlPath, file) => {
  const type = CONTENT_TYPES[path.extname(file)] || 'application/octet-stream';
  builder.addExchange(`${origin}${urlPath}`, 200,
    { 'Content-Type': type, 'Permissions-Policy': permissionsHeader, ...IWA_HEADERS },
    readFileSync(file));
};
for (const file of walk(DIST)) {
  const rel = '/' + path.relative(DIST, file).split(path.sep).join('/');
  addFile(rel, file);
  if (rel === '/index.html') addFile('/', file);
}
builder.setPrimaryURL(`${origin}/`);

const signed = await wbnSign.SignedWebBundle.fromWebBundle(
  Buffer.from(builder.createBundle()),
  [new wbnSign.NodeCryptoSigningStrategy(privateKey)],
);

mkdirSync(OUT, { recursive: true });
const swbnName = `scm820-${version}.swbn`;
writeFileSync(path.join(OUT, swbnName), signed.getSignedWebBundleBytes());

// Update manifest: keep earlier versions, replace this version's entry, newest last.
const updatePath = path.join(OUT, 'update.json');
const previous = existsSync(updatePath) ? JSON.parse(readFileSync(updatePath, 'utf-8')).versions ?? [] : [];
const versions = [...previous.filter((v) => v.version !== version), { version, src: `./${swbnName}` }];
writeFileSync(updatePath, JSON.stringify({ versions }, null, 2));
writeFileSync(path.join(OUT, 'app-id.json'), JSON.stringify({ webBundleId, origin, version, updateManifestUrl: UPDATE_URL || null }, null, 2));

console.log(`\nSigned bundle: iwa-out/${swbnName}`);
console.log(`Web Bundle ID: ${webBundleId}`);
console.log(`Origin:        ${origin}/`);
if (!UPDATE_URL) console.log('Note: IWA_UPDATE_MANIFEST_URL not set — this build will not self-update.');
