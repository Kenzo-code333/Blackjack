import { defineConfig } from 'vite';

// The browser code lives in src/client. `npm run build` writes it to dist/client,
// which the Node server serves in production.
export default defineConfig({
  root: 'src/client',
  publicDir: 'public',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    host: true, // reachable from your phone on the same Wi-Fi
    proxy: {
      // During development Vite serves the page and forwards real-time traffic to the game server.
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
