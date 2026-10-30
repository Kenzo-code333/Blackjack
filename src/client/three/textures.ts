// Every texture is drawn in code on a <canvas>: original card faces, felt print, chips, wood.

import * as THREE from 'three';
import type { Card, Suit } from '../../game/index.js';
import { CENTER, FELT_BOUNDS, R_CIRCLE, R_INSURANCE, seatAngle } from './layout.js';

const RED = '#b81f2c';
const BLACK = '#161616';
const SERIF = '"Playfair Display", Georgia, "Times New Roman", serif';

let maxAnisotropy = 4;
export function setMaxAnisotropy(n: number): void {
  maxAnisotropy = n;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, opts: { repeat?: boolean } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAnisotropy;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- Suits, drawn as paths so they look the same on every device ----------

export function suitPath(ctx: CanvasRenderingContext2D, suit: Suit, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.beginPath();
  const heart = (flip: number) => {
    ctx.moveTo(0, 0.42 * flip);
    ctx.bezierCurveTo(-0.08, 0.32 * flip, -0.5, 0.06 * flip, -0.5, -0.16 * flip);
    ctx.bezierCurveTo(-0.5, -0.42 * flip, -0.12, -0.5 * flip, 0, -0.24 * flip);
    ctx.bezierCurveTo(0.12, -0.5 * flip, 0.5, -0.42 * flip, 0.5, -0.16 * flip);
    ctx.bezierCurveTo(0.5, 0.06 * flip, 0.08, 0.32 * flip, 0, 0.42 * flip);
  };
  const stem = () => {
    ctx.moveTo(0, 0.05);
    ctx.quadraticCurveTo(0.04, 0.38, 0.2, 0.5);
    ctx.lineTo(-0.2, 0.5);
    ctx.quadraticCurveTo(-0.04, 0.38, 0, 0.05);
  };
  switch (suit) {
    case 'H':
      heart(1);
      break;
    case 'D':
      ctx.moveTo(0, -0.5);
      ctx.quadraticCurveTo(0.18, -0.2, 0.38, 0);
      ctx.quadraticCurveTo(0.18, 0.2, 0, 0.5);
      ctx.quadraticCurveTo(-0.18, 0.2, -0.38, 0);
      ctx.quadraticCurveTo(-0.18, -0.2, 0, -0.5);
      break;
    case 'S':
      ctx.save();
      ctx.translate(0, -0.06);
      ctx.scale(1, 0.95);
      heart(-1);
      ctx.restore();
      stem();
      break;
    case 'C':
      ctx.arc(0, -0.24, 0.21, 0, Math.PI * 2);
      ctx.moveTo(-0.02, 0.06);
      ctx.arc(-0.24, 0.06, 0.21, 0, Math.PI * 2);
      ctx.moveTo(0.45, 0.06);
      ctx.arc(0.24, 0.06, 0.21, 0, Math.PI * 2);
      ctx.moveTo(0, 0);
      stem();
      break;
  }
  ctx.fill();
  ctx.restore();
}

// ---------- Cards ----------

const CARD_PX_W = 256;
const CARD_PX_H = 358;

// Pip positions on a 3×7 grid (column, row) for number cards.
const PIPS: Record<string, [number, number][]> = {
  '2': [[1, 0], [1, 6]],
  '3': [[1, 0], [1, 3], [1, 6]],
  '4': [[0, 0], [2, 0], [0, 6], [2, 6]],
  '5': [[0, 0], [2, 0], [1, 3], [0, 6], [2, 6]],
  '6': [[0, 0], [2, 0], [0, 3], [2, 3], [0, 6], [2, 6]],
  '7': [[0, 0], [2, 0], [1, 1.5], [0, 3], [2, 3], [0, 6], [2, 6]],
  '8': [[0, 0], [2, 0], [1, 1.5], [0, 3], [2, 3], [1, 4.5], [0, 6], [2, 6]],
  '9': [[0, 0], [2, 0], [0, 2], [2, 2], [1, 3], [0, 4], [2, 4], [0, 6], [2, 6]],
  '10': [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2], [0, 4], [2, 4], [1, 5], [0, 6], [2, 6]],
};

function drawCorner(ctx: CanvasRenderingContext2D, card: Card, color: string): void {
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const ten = card.rank === '10';
  ctx.font = `700 ${ten ? 40 : 46}px ${SERIF}`;
  ctx.fillText(card.rank, 30, 52);
  suitPath(ctx, card.suit, 30, 78, 30);
}

/** Simple geometric emblem for J/Q/K: an original design, not a copy of any deck. */
function drawCourtEmblem(ctx: CanvasRenderingContext2D, rank: 'J' | 'Q' | 'K', color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (rank === 'K') {
    // Crown
    ctx.moveTo(-34, 0);
    ctx.lineTo(-38, -34);
    ctx.lineTo(-18, -16);
    ctx.lineTo(0, -42);
    ctx.lineTo(18, -16);
    ctx.lineTo(38, -34);
    ctx.lineTo(34, 0);
    ctx.closePath();
    ctx.fill();
    for (const x of [-38, 0, 38]) {
      ctx.beginPath();
      ctx.arc(x, x === 0 ? -46 : -38, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (rank === 'Q') {
    // Tiara with a jewel
    ctx.moveTo(-36, 0);
    ctx.quadraticCurveTo(-30, -26, -12, -22);
    ctx.quadraticCurveTo(0, -46, 12, -22);
    ctx.quadraticCurveTo(30, -26, 36, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f6efe0';
    ctx.beginPath();
    ctx.arc(0, -16, 6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Shield with a chevron
    ctx.moveTo(-26, -40);
    ctx.lineTo(26, -40);
    ctx.lineTo(26, -14);
    ctx.quadraticCurveTo(26, 4, 0, 10);
    ctx.quadraticCurveTo(-26, 4, -26, -14);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#f6efe0';
    ctx.beginPath();
    ctx.moveTo(-16, -30);
    ctx.lineTo(0, -16);
    ctx.lineTo(16, -30);
    ctx.stroke();
  }
}

function drawCardFace(card: Card): HTMLCanvasElement {
  const [c, ctx] = canvas(CARD_PX_W, CARD_PX_H);
  const W = CARD_PX_W;
  const H = CARD_PX_H;
  const red = card.suit === 'H' || card.suit === 'D';
  const color = red ? RED : BLACK;

  roundRect(ctx, 1, 1, W - 2, H - 2, 18);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#fffdf6');
  g.addColorStop(1, '#f1ebdc');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  drawCorner(ctx, card, color);
  ctx.save();
  ctx.translate(W, H);
  ctx.rotate(Math.PI);
  drawCorner(ctx, card, color);
  ctx.restore();

  ctx.fillStyle = color;
  if (card.rank === 'A') {
    suitPath(ctx, card.suit, W / 2, H / 2, card.suit === 'S' ? 128 : 96);
  } else if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') {
    const fx = 56;
    const fy = 64;
    const fw = W - fx * 2;
    const fh = H - fy * 2;
    roundRect(ctx, fx, fy, fw, fh, 10);
    ctx.fillStyle = red ? '#f7e3d7' : '#e3e6ee';
    ctx.fill();
    ctx.strokeStyle = '#c59a3c';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    roundRect(ctx, fx + 6, fy + 6, fw - 12, fh - 12, 7);
    ctx.stroke();
    // Two-headed design: draw the top half, then the same rotated.
    for (const flip of [0, 1]) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(flip * Math.PI);
      ctx.translate(0, -24);
      ctx.save();
      ctx.translate(0, -18);
      ctx.scale(0.9, 0.9);
      drawCourtEmblem(ctx, card.rank, color);
      ctx.restore();
      ctx.fillStyle = color;
      ctx.font = `800 40px ${SERIF}`;
      ctx.textAlign = 'center';
      ctx.fillText(card.rank, -32, 18);
      suitPath(ctx, card.suit, 32, 6, 30);
      ctx.restore();
    }
  } else {
    const left = W * 0.29;
    const right = W * 0.71;
    const top = H * 0.2;
    const bottom = H * 0.8;
    for (const [col, row] of PIPS[card.rank]!) {
      const x = left + ((right - left) * col) / 2;
      const y = top + ((bottom - top) * row) / 6;
      ctx.save();
      ctx.translate(x, y);
      if (row > 3) ctx.rotate(Math.PI);
      suitPath(ctx, card.suit, 0, 0, 46);
      ctx.restore();
    }
  }
  return c;
}

function drawCardBack(): HTMLCanvasElement {
  const [c, ctx] = canvas(CARD_PX_W, CARD_PX_H);
  const W = CARD_PX_W;
  const H = CARD_PX_H;
  roundRect(ctx, 1, 1, W - 2, H - 2, 18);
  ctx.fillStyle = '#f6f1e4';
  ctx.fill();
  roundRect(ctx, 14, 14, W - 28, H - 28, 10);
  ctx.fillStyle = '#7d1622';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 214, 140, 0.35)';
  ctx.lineWidth = 2;
  for (let i = -H; i < W + H; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.moveTo(i, H);
    ctx.lineTo(i + H, 0);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#d8b060';
  ctx.lineWidth = 3;
  roundRect(ctx, 24, 24, W - 48, H - 48, 8);
  ctx.stroke();
  // Center medallion
  ctx.fillStyle = '#7d1622';
  ctx.beginPath();
  ctx.ellipse(W / 2, H / 2, 46, 60, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#d8b060';
  suitPath(ctx, 'S', W / 2, H / 2 - 2, 52);
  return c;
}

const faceCache = new Map<string, THREE.MeshStandardMaterial>();
let backMaterial: THREE.MeshStandardMaterial | null = null;

function cardMaterial(c: HTMLCanvasElement): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.55, metalness: 0, alphaTest: 0.5, transparent: false });
}

export function cardFaceMaterial(card: Card): THREE.MeshStandardMaterial {
  const key = card.rank + card.suit;
  let m = faceCache.get(key);
  if (!m) {
    m = cardMaterial(drawCardFace(card));
    faceCache.set(key, m);
  }
  return m;
}

export function cardBackMaterial(): THREE.MeshStandardMaterial {
  backMaterial ??= cardMaterial(drawCardBack());
  return backMaterial;
}

// ---------- Felt ----------

const FELT_W = 2048;
const FELT_H = 1024;

/** Converts a table position (x, z in meters) to felt canvas pixels. */
function feltPx(x: number, z: number): [number, number] {
  const { minX, maxX, minZ, maxZ } = FELT_BOUNDS;
  return [((x - minX) / (maxX - minX)) * FELT_W, ((z - minZ) / (maxZ - minZ)) * FELT_H];
}

const PX_PER_M = FELT_W / (FELT_BOUNDS.maxX - FELT_BOUNDS.minX);

function arcText(ctx: CanvasRenderingContext2D, text: string, radiusM: number, font: string, color: string, spacing = 1): void {
  const [cx, cy] = feltPx(CENTER.x, CENTER.z);
  const r = radiusM * PX_PER_M;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const widths = [...text].map((ch) => ctx.measureText(ch).width * spacing * (ch === ' ' ? 1.8 : 1));
  const total = widths.reduce((a, b) => a + b, 0);
  let angle = -total / r / 2;
  [...text].forEach((ch, i) => {
    const w = widths[i]!;
    const a = angle + w / r / 2;
    ctx.save();
    ctx.translate(cx + Math.sin(a) * r, cy + Math.cos(a) * r);
    ctx.rotate(-a);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    angle += w / r;
  });
}

export function feltTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(FELT_W, FELT_H);
  const [cx, cy] = feltPx(CENTER.x, CENTER.z);
  const g = ctx.createRadialGradient(cx, cy + 300, 50, cx, cy + 200, 1300);
  g.addColorStop(0, '#1b8455');
  g.addColorStop(0.55, '#136a43');
  g.addColorStop(1, '#0b4a2e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FELT_W, FELT_H);

  // Fine fibre noise.
  const [n, nctx] = canvas(128, 128);
  const img = nctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 18;
  }
  nctx.putImageData(img, 0, 0);
  ctx.fillStyle = ctx.createPattern(n, 'repeat')!;
  ctx.fillRect(0, 0, FELT_W, FELT_H);

  const ink = 'rgba(246, 232, 196, 0.82)';
  const gold = 'rgba(232, 196, 110, 0.9)';

  arcText(ctx, 'BLACKJACK PAYS 3 TO 2', 0.4, `700 54px ${SERIF}`, gold, 1.18);
  arcText(ctx, 'DEALER STANDS ON SOFT 17 · DRAWS TO 16', 0.5, `600 26px ${SERIF}`, ink, 1.25);

  // Insurance band.
  const rIn = (R_INSURANCE - 0.035) * PX_PER_M;
  const rOut = (R_INSURANCE + 0.035) * PX_PER_M;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  for (const r of [rIn, rOut]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI / 2 - 1.15, Math.PI / 2 + 1.15);
    ctx.stroke();
  }
  arcText(ctx, 'INSURANCE PAYS 2 TO 1', R_INSURANCE, `700 30px ${SERIF}`, ink, 1.35);

  // Betting circles.
  for (let s = 0; s < 5; s++) {
    const a = seatAngle(s);
    const [x, y] = feltPx(CENTER.x + Math.sin(a) * R_CIRCLE, CENTER.z + Math.cos(a) * R_CIRCLE);
    const r = 0.068 * PX_PER_M;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r - 10, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Dealer's card line.
  ctx.strokeStyle = 'rgba(246, 232, 196, 0.25)';
  ctx.lineWidth = 2;
  const [lx, ly] = feltPx(-0.24, CENTER.z + 0.17);
  roundRect(ctx, lx, ly, 0.48 * PX_PER_M, 0.15 * PX_PER_M, 18);
  ctx.stroke();

  return toTexture(c);
}

/** UVs for the felt: map world x/z straight onto the canvas. */
export function feltUV(x: number, z: number): [number, number] {
  const { minX, maxX, minZ, maxZ } = FELT_BOUNDS;
  return [(x - minX) / (maxX - minX), 1 - (z - minZ) / (maxZ - minZ)];
}

// ---------- Chips ----------

export const CHIP_COLORS: Record<number, string> = {
  1: '#e9e4d6',
  5: '#c62f37',
  25: '#1f8a4c',
  100: '#262626',
  500: '#6b3fa0',
  1000: '#d98a1f',
};

export function chipTopTexture(value: number): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const color = CHIP_COLORS[value] ?? '#888';
  const light = value === 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  // Edge inserts.
  ctx.fillStyle = light ? '#3a6fb5' : '#f4efe3';
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate((i / 8) * Math.PI * 2);
    ctx.fillRect(-7, -S / 2, 14, 15);
    ctx.restore();
  }
  ctx.strokeStyle = light ? '#3a6fb5' : 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.33, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = light ? '#1d1d1d' : '#ffffff';
  ctx.font = `800 ${value >= 100 ? 30 : 36}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), S / 2, S / 2 + 1);
  return toTexture(c);
}

export function chipSideTexture(value: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 8);
  ctx.fillStyle = CHIP_COLORS[value] ?? '#888';
  ctx.fillRect(0, 0, 128, 8);
  ctx.fillStyle = value === 1 ? '#3a6fb5' : '#f4efe3';
  for (let i = 0; i < 8; i++) ctx.fillRect(i * 16 + 4, 0, 7, 8);
  return toTexture(c);
}

// ---------- Room ----------

export function woodTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 128);
  ctx.fillStyle = '#5a2e17';
  ctx.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(${30 + Math.random() * 40}, ${12 + Math.random() * 20}, 5, ${0.15 + Math.random() * 0.25})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    const y = Math.random() * 128;
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 4);
    ctx.stroke();
  }
  return toTexture(c, { repeat: true });
}

export function carpetTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#2a0b10';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(200, 150, 70, 0.28)';
  ctx.lineWidth = 3;
  for (const [x, y] of [
    [0, 0],
    [S, 0],
    [0, S],
    [S, S],
    [S / 2, S / 2],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 54, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(120, 30, 40, 0.5)';
  ctx.fillRect(S / 2 - 6, 0, 12, S);
  ctx.fillRect(0, S / 2 - 6, S, 12);
  const t = toTexture(c, { repeat: true });
  t.repeat.set(14, 14);
  return t;
}

export function glowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

// ---------- Text labels (hand totals, name tags) ----------

export class LabelSprite extends THREE.Sprite {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private key = '';

  constructor(
    private readonly widthPx = 320,
    private readonly heightPx = 80,
    worldHeight = 0.04,
  ) {
    const [c, ctx] = canvas(widthPx, heightPx);
    const tex = toTexture(c);
    super(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    this.ctx = ctx;
    this.tex = tex;
    this.scale.set((worldHeight * widthPx) / heightPx, worldHeight, 1);
    this.renderOrder = 10;
  }

  set(lines: { text: string; color?: string; bg?: string; sub?: string }): void {
    const key = JSON.stringify(lines);
    if (key === this.key) return;
    this.key = key;
    const { ctx, widthPx: W, heightPx: H } = this;
    ctx.clearRect(0, 0, W, H);
    this.visible = Boolean(lines.text);
    if (!lines.text) return;
    ctx.font = `700 ${lines.sub ? H * 0.36 : H * 0.5}px Inter, system-ui, sans-serif`;
    const tw = Math.max(ctx.measureText(lines.text).width, lines.sub ? ctx.measureText(lines.sub).width * 0.8 : 0);
    const w = Math.min(W - 4, tw + H * 0.6);
    roundRect(ctx, (W - w) / 2, 2, w, H - 4, (H - 4) / 2.4);
    ctx.fillStyle = lines.bg ?? 'rgba(10, 12, 10, 0.78)';
    ctx.fill();
    ctx.fillStyle = lines.color ?? '#f3eedf';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (lines.sub) {
      ctx.fillText(lines.text, W / 2, H * 0.36);
      ctx.font = `600 ${H * 0.27}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(243, 238, 223, 0.75)';
      ctx.fillText(lines.sub, W / 2, H * 0.72);
    } else {
      ctx.fillText(lines.text, W / 2, H / 2 + 1);
    }
    this.tex.needsUpdate = true;
  }
}
