// The rooms you walk around (lounge, casino, arcade) and the spots in them you can walk
// up to: game tables, the cashier, slot machines, couches, arcade games and doorways.

import type * as THREE from 'three';
import type { ArcadeGameId } from '../arcade/catalog.js';
import type { GameKind } from '../../shared/protocol.js';

export type Room = 'lounge' | 'casino' | 'arcade';

export type StationId = string;

export interface Station {
  id: StationId;
  /** A casino table game; null for everything else (see `kind`). */
  game: GameKind | null;
  kind?: 'cashier' | 'slots' | 'couch' | 'door' | 'arcade' | 'screen';
  /** For a doorway: the room it leads to. */
  to?: Room;
  /** For an arcade cabinet or the giant screen: which game it plays. */
  arcade?: ArcadeGameId;
  /** For a couch: where people sit (world positions, facing `yaw`). */
  seats?: THREE.Vector3[];
  /** For a long thing (a row of machines, a couch): half its length. */
  span?: number;
  title: string;
  sub: string;
  /** Center on the floor. */
  pos: THREE.Vector3;
  /** Which way it faces (toward the people using it). */
  yaw: number;
  /** Collision radius. */
  radius: number;
}

/** What room builders use to add things to the world. */
export interface WorldCtx {
  readonly low: boolean;
  add(...objects: THREE.Object3D[]): void;
  collide(x: number, z: number, r: number): void;
  pickable(mesh: THREE.Object3D, station: Station): void;
  sign(sprite: THREE.Sprite, station: Station): void;
  /** Material whose colour gently pulses (neon, screens). */
  blink(mat: THREE.Material & { color: THREE.Color }, speed?: number): void;
  /** A seated person (bot) who stays put; `couch` = legs showing. */
  sitter(look: import('../../shared/protocol.js').Look, at: THREE.Vector3, yaw: number, couch: boolean): void;
  /** Something animated each frame. */
  animate(fn: (dt: number, t: number) => void): void;
}
