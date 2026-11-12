// After `vite build -c vite.file.config.ts`: inline the script and styles into one
// HTML file (dist/blackjack.html) that works when opened straight from disk.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = 'dist/file/assets';
const pick = (ext) => readFileSync(path.join(dir, readdirSync(dir).find((f) => f.endsWith(ext))), 'utf8');
const js = pick('.js').replace(/<\/script/gi, '<\\/script');
const css = pick('.css');
const icon =
  "data:image/svg+xml," +
  encodeURIComponent(readFileSync('src/client/public/favicon.svg', 'utf8'));
// The build's identity: the file compares it with the latest published one (updater.ts).
let commit = 'dev';
try {
  commit = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  /* not a git checkout */
}
const build = { built: Date.now(), version: commit };
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0f0c">
<title>Blackjack</title>
<link rel="icon" href="${icon}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;800&family=Inter:wght@400;600;700&display=swap">
<style>
${css}
</style>
</head>
<body>
<script>window.__BJ_FILE__ = ${JSON.stringify(build)};</script>
<div id="app"></div>
<noscript>This game needs JavaScript.</noscript>
<script type="module">
${js}
</script>
</body>
</html>
`;
writeFileSync('dist/blackjack.html', html);
writeFileSync('dist/version.json', JSON.stringify(build) + '\n');
console.log(`Wrote dist/blackjack.html (${Math.round(html.length / 1024)} KB)`);
