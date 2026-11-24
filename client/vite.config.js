import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));

const SERVER_DIR = path.resolve(__dirname, '../server');
const SHIMS_DIR = path.resolve(__dirname, 'src/backend/shims');

// `vite build --mode iwa` produces the Isolated Web App payload: no service worker / PWA
// manifest (the IWA gets its own manifest at build time) and the Direct Sockets transport.
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      // Code shared with the Node server: protocol parser and the X-Touch MCU bridge.
      '@server': SERVER_DIR,
      // xtouchBridge.js imports these two Node-flavoured packages.
      events: path.join(SHIMS_DIR, 'events.js'),
      debug: path.join(SHIMS_DIR, 'debug.js'),
    },
  },
  build: mode === 'iwa' ? { outDir: 'dist-iwa', emptyOutDir: true } : undefined,
  plugins: [
    react(),
    mode !== 'iwa' && VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'SCM820 Virtual Mixer',
        short_name: 'SCM820',
        description: 'Web-based virtual mixer for the Shure SCM820',
        theme_color: '#18181b',
        background_color: '#18181b',
        display: 'standalone',
        orientation: 'landscape',
        start_url: '/',
        icons: [
          { src: 'icon.svg',          sizes: 'any',     type: 'image/svg+xml' },
          { src: 'pwa-192x192.png',   sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png',   sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    cors: true,
    allowedHosts: 'all',
  },
}));
