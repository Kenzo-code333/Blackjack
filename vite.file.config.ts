import { defineConfig, mergeConfig } from 'vite';
import web from './vite.web.config.ts';

// One self-contained file you can download and double-click: `npm run build:file`
// → dist/blackjack.html. Same as the website build, with everything bundled into one script.
export default mergeConfig(
  web,
  defineConfig({
    publicDir: false,
    build: {
      outDir: '../../dist/file',
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  }),
);
