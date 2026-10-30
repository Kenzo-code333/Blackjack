// Cards and chips as 3D objects.

import * as THREE from 'three';
import type { Card } from '../../game/index.js';
import { CARD_H, CARD_T, CARD_W, CHIP_H, CHIP_R, jitter } from './layout.js';
import { cardBackMaterial, cardFaceMaterial, chipSideTexture, chipTopTexture } from './textures.js';

// ---------- Cards ----------

const cardGeometry = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H);
const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xeee6d2, roughness: 0.6 });

/**
 * A card lying on the table. Its top face shows the card, its bottom shows the back;
 * `rotation.z = π` turns it face down. An unknown card (the hole card) has backs on both sides.
 */
export class CardObject {
  readonly mesh: THREE.Mesh;
  card: Card | null;

  constructor(card: Card | null) {
    this.card = card;
    const back = cardBackMaterial();
    this.mesh = new THREE.Mesh(cardGeometry, [edgeMaterial, edgeMaterial, card ? cardFaceMaterial(card) : back, back, edgeMaterial, edgeMaterial]);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.rotation.order = 'YXZ';
  }

  setCard(card: Card | null): void {
    if (this.card && card && this.card.rank === card.rank && this.card.suit === card.suit) return;
    this.card = card;
    const mats = this.mesh.material as THREE.Material[];
    mats[2] = card ? cardFaceMaterial(card) : cardBackMaterial();
  }

  get faceUp(): boolean {
    return Math.abs(this.mesh.rotation.z) < Math.PI / 2;
  }
}

// ---------- Chips ----------

export const DENOMINATIONS = [1000, 500, 100, 25, 5, 1] as const;

const chipMaterials = new Map<number, THREE.Material[]>();
let chipGeometry: THREE.CylinderGeometry | null = null;

export function setChipDetail(low: boolean): void {
  chipGeometry = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, low ? 14 : 28);
}

function chipMats(value: number): THREE.Material[] {
  let m = chipMaterials.get(value);
  if (!m) {
    const side = chipSideTexture(value);
    const top = new THREE.MeshStandardMaterial({ map: chipTopTexture(value), roughness: 0.42 });
    m = [new THREE.MeshStandardMaterial({ map: side, roughness: 0.5 }), top, top];
    chipMaterials.set(value, m);
  }
  return m;
}

export function makeChip(value: number): THREE.Mesh {
  chipGeometry ??= new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 28);
  const chip = new THREE.Mesh(chipGeometry, chipMats(value));
  chip.castShadow = true;
  chip.receiveShadow = true;
  chip.userData.value = value;
  return chip;
}

/** Splits an amount into chips, biggest first (half chips are rounded away). */
export function breakdown(amount: number): number[] {
  const chips: number[] = [];
  let rest = Math.floor(amount);
  for (const d of DENOMINATIONS) {
    while (rest >= d && chips.length < 40) {
      chips.push(d);
      rest -= d;
    }
  }
  return chips;
}

/** A vertical stack of chips. Biggest denominations at the bottom. Taller stacks split into columns. */
export class ChipStack {
  readonly group = new THREE.Group();
  amount = -1;

  constructor(private readonly maxPerColumn = 12) {}

  set(amount: number, chips = breakdown(amount)): void {
    if (amount === this.amount) return;
    this.amount = amount;
    this.group.clear();
    const columns = Math.ceil(chips.length / this.maxPerColumn);
    chips.forEach((value, i) => {
      const col = Math.floor(i / this.maxPerColumn);
      const row = i % this.maxPerColumn;
      const chip = makeChip(value);
      const offset = columns > 1 ? (col - (columns - 1) / 2) * CHIP_R * 2.1 : 0;
      chip.position.set(offset + jitter(i * 3.1, 0.0012), CHIP_H / 2 + row * CHIP_H, jitter(i * 7.3, 0.0012));
      chip.rotation.y = jitter(i, Math.PI);
      this.group.add(chip);
    });
  }

  /** World position of the top of the stack, where the next chip lands. */
  topWorld(): THREE.Vector3 {
    const h = Math.min(this.group.children.length, this.maxPerColumn) * CHIP_H;
    return this.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, h, 0));
  }
}

/**
 * How a player's chips by the rail are shown: a few of each denomination,
 * so there's always something to pick from. Purely visual.
 */
export function playerStacks(balance: number): { value: number; count: number }[] {
  let rest = Math.floor(balance);
  const plan: { value: number; count: number }[] = [];
  const shares: [number, number][] = [
    [5, 0.08],
    [25, 0.2],
    [100, 0.35],
  ];
  for (const [value, share] of shares) {
    let count = Math.min(12, Math.floor((rest * share) / value));
    if (count === 0 && value === 5 && rest >= 5) count = 1;
    plan.push({ value, count });
    rest -= count * value;
  }
  plan.push({ value: 500, count: Math.min(24, Math.floor(rest / 500)) });
  rest -= plan[3]!.count * 500;
  // Put whatever is left into the smaller stacks.
  for (const p of [plan[2]!, plan[1]!, plan[0]!]) {
    const add = Math.min(12 - p.count, Math.floor(rest / p.value));
    if (add > 0) {
      p.count += add;
      rest -= add * p.value;
    }
  }
  return plan;
}
