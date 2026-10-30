// After `vite build -c vite.preview.config.ts`: inline the JS and CSS into one HTML
// page (dist/preview/blackjack-table.html) in the shape claude.ai artifacts expect.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = 'dist/preview/assets';
const pick = (ext) => readFileSync(path.join(dir, readdirSync(dir).find((f) => f.endsWith(ext))), 'utf8');
const js = pick('.js').replace(/<\/script/gi, '<\\/script');
const css = pick('.css');
const html = `<title>Blackjack Table</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;800&family=Inter:wght@400;600;700&display=swap">
<style>
${css}
</style>
<div id="app"></div>
<script type="module">
${js}
</script>
`;
const out = 'dist/preview/blackjack-table.html';
writeFileSync(out, html);
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`);
