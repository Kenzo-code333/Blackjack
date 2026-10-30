import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Offline, single-page preview: `npx vite build -c vite.preview.config.ts`.
// The game server runs inside the page (src/client/preview/local-server.ts), solo only.
export default defineConfig({
  root: 'src/client',
  publicDir: false,
  resolve: {
    alias: [{ find: 'node:crypto', replacement: fileURLToPath(new URL('./src/client/preview/crypto-shim.ts', import.meta.url)) }],
  },
  build: {
    outDir: '../../dist/preview',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/client/preview.html', import.meta.url)),
      output: { inlineDynamicImports: true },
    },
  },
});
