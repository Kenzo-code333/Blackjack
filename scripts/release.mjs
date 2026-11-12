// Publishes the downloadable file: copies dist/blackjack.html and dist/version.json into
// release/. Once committed and pushed, every copy of the file that people already have
// offers to update itself (see src/client/updater.ts). Run with `npm run release`.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';

mkdirSync('release', { recursive: true });
copyFileSync('dist/blackjack.html', 'release/blackjack.html');
copyFileSync('dist/version.json', 'release/version.json');
const v = JSON.parse(readFileSync('release/version.json', 'utf8'));
console.log(`release/ now holds version ${v.version} built ${new Date(v.built).toISOString()} — commit and push it.`);
