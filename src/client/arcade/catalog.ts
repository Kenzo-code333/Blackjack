// What the arcade offers (no chips needed), and where each game keeps its saves.

export type ArcadeGameId = 'orbit-hop' | 'polyrush' | 'gridiron-blitz' | 'game-night';

export interface ArcadeGame {
  id: ArcadeGameId;
  title: string;
  tagline: string;
  /** Neon colour of its cabinet and card. */
  color: string;
  /** The browser-storage names the game saves under (they go into your account). */
  saves: string[];
}

export const ARCADE: ArcadeGame[] = [
  { id: 'orbit-hop', title: 'Orbit Hop', tagline: 'Hop from planet to planet. How far can you go?', color: '#3be3ff', saves: ['orbitHop'] },
  { id: 'polyrush', title: 'PolyRush', tagline: 'Race low-poly cars on wild tracks, or build your own.', color: '#ff5ad1', saves: ['polyrush.'] },
  { id: 'gridiron-blitz', title: 'Gridiron Blitz', tagline: '3-on-3 arcade football in a packed 3D stadium. Juke, spin and dive for the end zone!', color: '#6dff7a', saves: ['gblitz.'] },
  { id: 'game-night', title: 'Game Night', tagline: 'The party platform: mini-games for everyone on the giant screen.', color: '#ffd34d', saves: ['gamenight.'] },
];

/** Every storage-name start that belongs to an arcade game. */
export const ARCADE_SAVE_PREFIXES = ARCADE.flatMap((g) => g.saves);
