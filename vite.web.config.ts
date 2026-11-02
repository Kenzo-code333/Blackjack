import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Website build for static hosting such as GitHub Pages: `npm run build:web` → dist/web.
// Tables run in the host's browser; online tables use a public relay (src/client/web/relay.ts).
export default defineConfig({
  root: 'src/client',
  base: './',
  publicDir: 'public',
  resolve: {
    alias: [{ find: 'node:crypto', replacement: fileURLToPath(new URL('./src/client/preview/crypto-shim.ts', import.meta.url)) }],
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: { index: fileURLToPath(new URL('./src/client/web.html', import.meta.url)) },
    },
  },
});
