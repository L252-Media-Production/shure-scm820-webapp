import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
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
});
