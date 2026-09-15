import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
    // In dev the frontend is served by Vite and the API by Express on a
    // separate port. Without this proxy, /api/* requests hit Vite itself
    // (404 / SPA HTML) and every auth call fails with "Request failed".
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    // The Express backend writes its SQLite DB under <project>/data on every
    // request (and the WAL on every streaming delta). That directory lives inside
    // this Vite root, so without ignoring it each write trips the file watcher and
    // triggers a full page reload — which wipes auth/setup React state mid-flow.
    // The frontend (src/) never imports from server/ or data/, so ignoring them is
    // safe. node_modules/.git/dist are listed so this doesn't drop the defaults.
    watch: {
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/data/**', '**/server/**'],
    },
  },
});
