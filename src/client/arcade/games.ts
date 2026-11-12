// The arcade's games: the player's own games, bundled as whole HTML pages (Gridiron Blitz
// was a multi-file game: its scripts, styles and the 3D library are bundled into one page).
// Loaded only when someone presses Play (this module is a separate download).

import gameNight from './game-night.html?raw';
import gridironBlitz from './gridiron-blitz.html?raw';
import orbitHop from './orbit-hop.html?raw';
import polyrush from './polyrush.html?raw';

import type { ArcadeGameId } from './catalog.js';

export const GAME_HTML: Record<ArcadeGameId, string> = { 'orbit-hop': orbitHop, polyrush, 'gridiron-blitz': gridironBlitz, 'game-night': gameNight };
