// Where everything sits on the table, in meters. The table is a half-moon:
// a flat edge on the dealer's side and an arc on the players' side.
//
//   −z (dealer)                 shoe at +x (dealer's left)
//     ┌────────────────────┐
//      \   seat 5 … seat 1 /    seat 1 ("first base") is on the dealer's left,
//        \______________/       i.e. on the right as seen by the players.
//   +z (players)

import * as THREE from 'three';

export const TABLE_Y = 0.78; // felt height
export const CENTER = new THREE.Vector3(0, TABLE_Y, -0.5); // center of the arc
export const TABLE_RADIUS = 1.2;
export const FELT_BOUNDS = { minX: -1.3, maxX: 1.3, minZ: -0.55, maxZ: 0.75 };

export const CARD_W = 0.07;
export const CARD_H = 0.098;
export const CARD_T = 0.0007;
export const CHIP_R = 0.022;
export const CHIP_H = 0.0042;

export const R_CIRCLE = 0.98; // betting circles
export const R_CARDS = 0.82; // player cards
export const R_INSURANCE = 0.63;
export const R_STACKS = 1.1; // the player's own chips, by the rail
export const R_AVATAR = 1.68;
export const R_EYES = 1.58; // a seated player's eyes, a little behind the rail
export const EYE_Y = 1.17;

export const SHOE_POS = new THREE.Vector3(0.74, TABLE_Y, -0.45);
export const SHOE_MOUTH = new THREE.Vector3(0.66, TABLE_Y + 0.06, -0.38);
export const DISCARD_POS = new THREE.Vector3(-0.72, TABLE_Y, -0.44);
export const RACK_POS = new THREE.Vector3(0, TABLE_Y, -0.44);
export const DEALER_POS = new THREE.Vector3(0, 0, -0.78);

/** Angle of a seat around the arc (radians from +z). Seat 0 is first base (+x). */
export function seatAngle(visualSeat: number): number {
  return ((2 - visualSeat) * Math.PI) / 6;
}

/** A point on the table at `radius` from the arc center, at the seat's angle. */
export function onArc(angle: number, radius: number, y = TABLE_Y): THREE.Vector3 {
  return new THREE.Vector3(CENTER.x + Math.sin(angle) * radius, y, CENTER.z + Math.cos(angle) * radius);
}

/** Unit vector pointing to the player's right, along the table edge. */
function tangent(angle: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
}

export function towardDealer(angle: number): THREE.Vector3 {
  return new THREE.Vector3(-Math.sin(angle), 0, -Math.cos(angle));
}

const HAND_SPACING = 0.12;

/** Center of hand `index` (of `count`) for a seat. Hand 0 is on the player's right. */
export function handAnchor(angle: number, index: number, count: number): THREE.Vector3 {
  const offset = ((count - 1) / 2 - index) * HAND_SPACING;
  return onArc(angle, R_CARDS).add(tangent(angle).multiplyScalar(offset));
}

/** Where card `k` of a player's hand lies: fanned diagonally toward the dealer. */
export function playerCardPos(angle: number, index: number, count: number, k: number): THREE.Vector3 {
  return handAnchor(angle, index, count)
    .add(tangent(angle).multiplyScalar(-0.017 * k))
    .add(towardDealer(angle).multiplyScalar(0.026 * k))
    .setY(TABLE_Y + 0.001 + k * CARD_T * 1.6);
}

/** The bet for hand `index`, in front of the cards (or the circle itself for one hand). */
export function betPos(angle: number, index: number, count: number): THREE.Vector3 {
  if (count <= 1) return onArc(angle, R_CIRCLE);
  return handAnchor(angle, index, count).add(towardDealer(angle).multiplyScalar(-0.15));
}

export function winPos(angle: number, index: number, count: number): THREE.Vector3 {
  return betPos(angle, index, count).add(tangent(angle).multiplyScalar(-0.055));
}

export function insurancePos(angle: number): THREE.Vector3 {
  return onArc(angle, R_INSURANCE + 0.01).add(tangent(angle).multiplyScalar(0.06));
}

/** The player's chips by the rail: one column per denomination. */
export function stackPos(angle: number, column: number, columns: number): THREE.Vector3 {
  return onArc(angle, R_STACKS).add(tangent(angle).multiplyScalar((column - (columns - 1) / 2) * 0.052));
}

export function dealerCardPos(k: number, count: number): THREE.Vector3 {
  const spread = 0.062;
  return new THREE.Vector3((k - (Math.max(count, 2) - 1) / 2) * spread, TABLE_Y + 0.001 + k * CARD_T * 1.6, CENTER.z + 0.24);
}

/** Small deterministic wobble, so stacks and cards don't look machine-perfect. */
export function jitter(seed: number, amount: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * amount;
}
