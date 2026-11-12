// The arcade's games: three of the player's own mobile games, bundled as whole HTML pages.
// Loaded only when someone presses Play (this module is a separate download).

import gameNight from './game-night.html?raw';
import orbitHop from './orbit-hop.html?raw';
import polyrush from './polyrush.html?raw';

import type { ArcadeGameId } from './catalog.js';

export const GAME_HTML: Record<ArcadeGameId, string> = { 'orbit-hop': orbitHop, polyrush, 'game-night': gameNight };
