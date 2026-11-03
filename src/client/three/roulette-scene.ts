// The first-person roulette table: a polished single-zero wheel at one end, the betting
// layout along the felt, the croupier between them, and players around the table.
//
// The wheel turns all the time. When the server says "spin", the croupier spins the
// wheel and launches the ball the other way. The ball rolls around the track, slows,
// drops over the diamonds, bounces between the frets and settles in exactly the pocket
// the server chose. As with the other tables, events play first, then the scene snaps
// to the server's state.

import * as THREE from 'three';
import { WHEEL_ORDER, pocketColor, spotNumbers } from '../../game/index.js';
import type { AnyEvent, AnyState, RouletteEvent, RouletteState } from '../../shared/protocol.js';
import type { Sound } from '../audio.js';
import { money, pocketName } from '../format.js';
import type { TableRenderer } from '../renderer.js';
import { Avatar } from './avatar.js';
import { Dealer } from './dealer.js';
import { Celebrations } from './effects.js';
import { addEnvironmentLight } from './env-light.js';
import { buildRoom } from './environment.js';
import { CHIP_H, TABLE_Y } from './layout.js';
import { ChipStack, setChipDetail } from './pieces.js';
import { LabelSprite, feltTextureFrom, setMaxAnisotropy, woodTexture } from './textures.js';
import { Animator, damp, ease, lerp } from './tween.js';

export interface RouletteSceneOptions {
  sound: Sound;
  low: boolean;
  /** A tap on the layout: put the selected chip there. */
  onSpot?: (spot: string) => void;
  onAutoLow?: () => void;
}

// ---------- Table layout (meters; the felt is at TABLE_Y) ----------

const TABLE = { minX: -1.55, maxX: 1.2, minZ: -0.55, maxZ: 0.55 };
const WHEEL = new THREE.Vector3(-1.0, TABLE_Y, 0);
const DEALER_AT = new THREE.Vector3(-0.38, 0, -0.66);

// The number grid: zero on the left, 12 columns of 3, "2 to 1" boxes on the right.
const GX = -0.4; // left edge of the "1, 2, 3" column
const CW = 0.1; // cell width (along x)
const RH = 0.1; // cell depth (along z)
const GZ = -0.34; // far edge of the top row (3, 6, 9…)

/** Where each seat is (an avatar's origin) and which way it faces. */
const SEATS: { x: number; z: number; yaw: number }[] = [
  { x: 1.6, z: 0, yaw: -Math.PI / 2 }, // the far end
  { x: 0.75, z: 0.93, yaw: Math.PI },
  { x: -0.15, z: 0.93, yaw: Math.PI },
  { x: 0.3, z: 0.93, yaw: Math.PI },
  { x: 0.75, z: -0.93, yaw: 0 },
  { x: 0.25, z: -0.93, yaw: 0 },
];

const seatVec = (seat: number, y = 0) => new THREE.Vector3(SEATS[seat]!.x, y, SEATS[seat]!.z);

/** Center of a betting spot on the felt. */
export function spotCenter(spot: string): THREE.Vector3 {
  const at = (x: number, z: number) => new THREE.Vector3(x, TABLE_Y, z);
  if (spot.startsWith('n:')) {
    const n = Number(spot.slice(2));
    if (n === 0) return at(GX - CW / 2, GZ + RH * 1.5);
    const c = Math.floor((n - 1) / 3);
    const row = 2 - ((n - 1) % 3); // 0 = top row (3, 6…), 2 = bottom row (1, 4…)
    return at(GX + CW * (c + 0.5), GZ + RH * (row + 0.5));
  }
  const [kind, which] = spot.split(':');
  const k = Number(which);
  if (kind === 'col') return at(GX + CW * 12.5, GZ + RH * (3 - k + 0.5));
  if (kind === 'dozen') return at(GX + CW * (4 * (k - 1) + 2), GZ + RH * 3.5);
  const i = ['low', 'even', 'red', 'black', 'odd', 'high'].indexOf(spot);
  return at(GX + CW * (2 * i + 1), GZ + RH * 4.5);
}

/** The size of a spot's box (for the hover highlight). */
function spotSize(spot: string): [number, number] {
  if (spot.startsWith('n:')) return spot === 'n:0' ? [CW, RH * 3] : [CW, RH];
  if (spot.startsWith('col:')) return [CW, RH];
  if (spot.startsWith('dozen:')) return [CW * 4, RH];
  return [CW * 2, RH];
}

/** Which spot (if any) is at a point on the felt. */
export function spotAt(x: number, z: number): string | null {
  const row = Math.floor((z - GZ) / RH);
  if (row < 0 || row > 4) return null;
  if (row <= 2) {
    if (x >= GX - CW && x < GX) return 'n:0';
    const c = Math.floor((x - GX) / CW);
    if (c >= 0 && c < 12) return `n:${3 * c + (3 - row)}`;
    if (c === 12) return `col:${3 - row}`;
    return null;
  }
  if (x < GX || x >= GX + CW * 12) return null;
  if (row === 3) return `dozen:${Math.floor((x - GX) / (CW * 4)) + 1}`;
  return ['low', 'even', 'red', 'black', 'odd', 'high'][Math.floor((x - GX) / (CW * 2))]!;
}

// ---------- The wheel (meters, relative to the wheel center at felt height) ----------

const STEP = (Math.PI * 2) / 37;
/** Local angle of pocket i around the wheel head (clockwise from above). */
const pocketAngle = (i: number) => -i * STEP;
const R_RIM = 0.42;
const R_TRACK = 0.384; // where the ball rolls, against the outer wall
const Y_TRACK = 0.083;
const R_POCKET = 0.205;
const Y_POCKET = 0.03;
const BALL_R = 0.0095;
const R_NUMBERS_OUT = 0.29;
const R_NUMBERS_IN = 0.236;
const R_CONE = 0.176;

const RED = '#b0122a';
const BLACK = '#141414';
const GREEN = '#0e7a40';
const colorOf = (n: number) => ({ red: RED, black: BLACK, green: GREEN })[pocketColor(n)];

/** Top-down drawing of the wheel head: the number ring and the pocket floors. */
function wheelFaceTexture(): THREE.CanvasTexture {
  const S = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const px = S / (2 * R_NUMBERS_OUT);
  const cx = S / 2;
  for (let i = 0; i < 37; i++) {
    const n = WHEEL_ORDER[i]!;
    // Canvas angle: x = sin(theta), y = cos(theta) on the table, so alpha = pi/2 - theta.
    const mid = Math.PI / 2 - pocketAngle(i);
    const a0 = mid - STEP / 2;
    const a1 = mid + STEP / 2;
    // Number ring.
    ctx.beginPath();
    ctx.arc(cx, cx, R_NUMBERS_OUT * px, a0, a1);
    ctx.arc(cx, cx, R_NUMBERS_IN * px, a1, a0, true);
    ctx.closePath();
    const g = ctx.createRadialGradient(cx, cx, R_NUMBERS_IN * px, cx, cx, R_NUMBERS_OUT * px);
    const base = colorOf(n);
    g.addColorStop(0, shadeHex(base, -0.25));
    g.addColorStop(0.5, base);
    g.addColorStop(1, shadeHex(base, -0.15));
    ctx.fillStyle = g;
    ctx.fill();
    // Pocket floor (slightly darker; the frets are separate meshes).
    ctx.beginPath();
    ctx.arc(cx, cx, R_NUMBERS_IN * px, a0, a1);
    ctx.arc(cx, cx, R_CONE * px, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = shadeHex(base, -0.2);
    ctx.fill();
    // The number, upright when read from outside the wheel.
    ctx.save();
    ctx.translate(cx + Math.cos(mid) * ((R_NUMBERS_IN + R_NUMBERS_OUT) / 2) * px, cx + Math.sin(mid) * ((R_NUMBERS_IN + R_NUMBERS_OUT) / 2) * px);
    ctx.rotate(mid - Math.PI / 2);
    ctx.fillStyle = '#f5efe0';
    ctx.font = `700 ${Math.round(0.026 * px)}px "Playfair Display", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
  }
  // Gold lines between the numbers and around the ring.
  ctx.strokeStyle = '#d9b45a';
  ctx.lineWidth = 3;
  for (let i = 0; i < 37; i++) {
    const a = Math.PI / 2 - pocketAngle(i) - STEP / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R_NUMBERS_IN * px, cx + Math.sin(a) * R_NUMBERS_IN * px);
    ctx.lineTo(cx + Math.cos(a) * R_NUMBERS_OUT * px, cx + Math.sin(a) * R_NUMBERS_OUT * px);
    ctx.stroke();
  }
  for (const r of [R_NUMBERS_OUT - 0.002, R_NUMBERS_IN + 0.001]) {
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cx, r * px, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function shadeHex(hex: string, l: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, l);
  return `#${c.getHexString()}`;
}

/** A flat ring in the XZ plane whose texture is the top-down wheel drawing. */
function wheelRing(rIn: number, rOut: number, y: number, map: THREE.Texture, roughness: number): THREE.Mesh {
  const geo = new THREE.RingGeometry(rIn, rOut, 148, 2);
  const pos = geo.attributes.position!;
  const uv = geo.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    // Geometry (x, y) becomes table (x, -z) after the rotation below; match the canvas.
    uv.setXY(i, pos.getX(i) / (2 * R_NUMBERS_OUT) + 0.5, pos.getY(i) / (2 * R_NUMBERS_OUT) + 0.5);
  }
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ map, roughness, clearcoat: 0.8, clearcoatRoughness: 0.2 }));
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

export interface Wheel {
  group: THREE.Group;
  rotor: THREE.Group;
  ball: THREE.Mesh;
}

export function buildWheel(low: boolean): Wheel {
  const group = new THREE.Group();
  group.position.copy(WHEEL);
  const mahogany = new THREE.MeshPhysicalMaterial({ map: woodTexture(), color: 0x8a3b1c, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
  const darkWood = new THREE.MeshPhysicalMaterial({ map: woodTexture(), color: 0x4a1d0c, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.12 });
  const track = new THREE.MeshPhysicalMaterial({ map: woodTexture(), color: 0xc78d55, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe9ecef, metalness: 1, roughness: 0.12 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd8b25e, metalness: 1, roughness: 0.22 });
  const seg = low ? 72 : 144;

  // The bowl: outer cabinet, rim, the ball track wall and the sloping apron.
  const bowl = (pts: [number, number][], mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat);
    m.castShadow = m.receiveShadow = true;
    return m;
  };
  group.add(
    bowl([[0.37, -0.01], [0.43, 0.0], [0.445, 0.04], [0.44, 0.095], [R_RIM, 0.108]], mahogany),
    bowl([[R_RIM, 0.108], [0.405, 0.106], [0.395, 0.092], [0.392, Y_TRACK - BALL_R + 0.001]], track),
    bowl([[0.392, Y_TRACK - BALL_R + 0.001], [0.36, 0.066], [0.3, 0.046], [0.294, 0.036]], darkWood),
  );
  // A thin brass bead around the top of the rim.
  const bead = new THREE.Mesh(new THREE.TorusGeometry(R_RIM - 0.004, 0.004, 8, seg), brass);
  bead.rotation.x = Math.PI / 2;
  bead.position.y = 0.108;
  group.add(bead);
  // Eight diamond deflectors on the apron, alternating upright and flat.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.014, 0), brass);
    d.scale.set(k % 2 ? 1.6 : 0.7, 0.45, k % 2 ? 0.7 : 1.6);
    d.position.set(Math.sin(a) * 0.335, 0.062, Math.cos(a) * 0.335);
    d.rotation.y = a;
    d.castShadow = true;
    group.add(d);
  }

  // The wheel head, which turns.
  const rotor = new THREE.Group();
  group.add(rotor);
  const face = wheelFaceTexture();
  rotor.add(wheelRing(R_NUMBERS_IN, R_NUMBERS_OUT, 0.034, face, 0.35), wheelRing(R_CONE, R_NUMBERS_IN, Y_POCKET - 0.002, face, 0.5));
  // Pocket walls: an outer lip and the base of the cone.
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(R_NUMBERS_IN, R_NUMBERS_IN, 0.006, seg, 1, true), darkWood);
  lip.position.y = 0.031;
  rotor.add(lip);
  // Frets: chrome separators between the pockets.
  const fretGeo = new THREE.BoxGeometry(0.0028, 0.013, R_NUMBERS_IN - R_CONE);
  for (let i = 0; i < 37; i++) {
    const a = pocketAngle(i) + STEP / 2;
    const f = new THREE.Mesh(fretGeo, chrome);
    const r = (R_NUMBERS_IN + R_CONE) / 2;
    f.position.set(Math.sin(a) * r, Y_POCKET + 0.004, Math.cos(a) * r);
    f.rotation.y = a;
    f.castShadow = !low;
    rotor.add(f);
  }
  // The cone, the turret and the cross handle on top.
  const cone = new THREE.Mesh(
    new THREE.LatheGeometry([[R_CONE + 0.002, Y_POCKET - 0.002], [R_CONE - 0.004, 0.04], [0.12, 0.062], [0.06, 0.08], [0.032, 0.084]].map(([r, y]) => new THREE.Vector2(r, y)), seg),
    mahogany,
  );
  cone.castShadow = cone.receiveShadow = true;
  rotor.add(cone);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.003, 8, seg), brass);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.062;
  rotor.add(ring);
  const turret = new THREE.Mesh(
    new THREE.LatheGeometry([[0.03, 0.084], [0.026, 0.1], [0.013, 0.118], [0.011, 0.15], [0.016, 0.158], [0.0, 0.166]].map(([r, y]) => new THREE.Vector2(r, y)), 48),
    chrome,
  );
  turret.castShadow = true;
  rotor.add(turret);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.09, 12), chrome);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(Math.cos(a) * 0.045, 0.142, -Math.sin(a) * 0.045);
    arm.rotation.y = a;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.011, 16, 12), chrome);
    knob.position.set(Math.cos(a) * 0.092, 0.142, -Math.sin(a) * 0.092);
    knob.castShadow = arm.castShadow = true;
    rotor.add(arm, knob);
  }

  // The ball: small, white and glossy.
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 24, 18),
    new THREE.MeshPhysicalMaterial({ color: 0xfbfaf6, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }),
  );
  ball.castShadow = true;
  group.add(ball);
  return { group, rotor, ball };
}

/** The felt with the betting layout printed on it. */
function layoutTexture(): THREE.CanvasTexture {
  const S = 800; // pixels per meter
  const W = Math.round((TABLE.maxX - TABLE.minX) * S);
  const H = Math.round((TABLE.maxZ - TABLE.minZ) * S);
  const X = (x: number) => (x - TABLE.minX) * S;
  const Z = (z: number) => (z - TABLE.minZ) * S;
  return feltTextureFrom(W, H, (ctx) => {
    const line = 'rgba(246, 236, 210, 0.92)';
    const gold = '#e3c271';
    ctx.lineJoin = 'round';
    // Number cells.
    for (let n = 0; n <= 36; n++) {
      const spot = `n:${n}`;
      const c = spotCenter(spot);
      const [w, h] = spotSize(spot);
      const x0 = X(c.x - w / 2);
      const z0 = Z(c.z - h / 2);
      if (n === 0) {
        // The zero cell has a pointed end toward the wheel.
        ctx.beginPath();
        ctx.moveTo(X(GX), z0);
        ctx.lineTo(X(GX - CW * 0.55), z0);
        ctx.lineTo(X(GX - CW), Z(c.z));
        ctx.lineTo(X(GX - CW * 0.55), z0 + h * S);
        ctx.lineTo(X(GX), z0 + h * S);
        ctx.closePath();
        ctx.fillStyle = 'rgba(14, 122, 64, 0.55)';
        ctx.fill();
        ctx.strokeStyle = line;
        ctx.lineWidth = 4;
        ctx.stroke();
      } else {
        ctx.strokeStyle = line;
        ctx.lineWidth = 4;
        ctx.strokeRect(x0, z0, w * S, h * S);
      }
      // The number on a colored oval, turned to read from the players' side.
      ctx.save();
      ctx.translate(X(c.x), Z(c.z));
      ctx.fillStyle = colorOf(n);
      ctx.beginPath();
      ctx.ellipse(0, 0, CW * S * 0.36, RH * S * 0.33, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 240, 200, 0.5)';
      ctx.stroke();
      ctx.fillStyle = '#fbf6ea';
      ctx.font = `700 ${Math.round(RH * S * 0.4)}px "Playfair Display", Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), 0, 3);
      ctx.restore();
    }
    // Columns, dozens and the even-money boxes.
    const box = (spot: string, label: string, draw?: (cx: number, cz: number) => void) => {
      const c = spotCenter(spot);
      const [w, h] = spotSize(spot);
      ctx.strokeStyle = line;
      ctx.lineWidth = 4;
      ctx.strokeRect(X(c.x - w / 2), Z(c.z - h / 2), w * S, h * S);
      if (draw) return draw(X(c.x), Z(c.z));
      ctx.fillStyle = line;
      ctx.font = `700 ${Math.round(RH * S * 0.3)}px "Playfair Display", Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, X(c.x), Z(c.z) + 2);
    };
    for (const k of [1, 2, 3]) box(`col:${k}`, '2 to 1');
    box('dozen:1', '1st 12');
    box('dozen:2', '2nd 12');
    box('dozen:3', '3rd 12');
    box('low', '1 to 18');
    box('even', 'EVEN');
    box('odd', 'ODD');
    box('high', '19 to 36');
    const diamond = (color: string) => (cx: number, cz: number) => {
      const w = CW * S * 0.62;
      const h = RH * S * 0.32;
      ctx.beginPath();
      ctx.moveTo(cx - w, cz);
      ctx.lineTo(cx, cz - h);
      ctx.lineTo(cx + w, cz);
      ctx.lineTo(cx, cz + h);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = line;
      ctx.lineWidth = 2;
      ctx.stroke();
    };
    box('red', 'RED', diamond(RED));
    box('black', 'BLACK', diamond(BLACK));
    // Gold trim around the whole layout, and the house name.
    ctx.strokeStyle = gold;
    ctx.lineWidth = 6;
    ctx.strokeRect(X(GX - CW) - 14, Z(GZ) - 14, (CW * 14) * S + 28, RH * 5 * S + 28);
    ctx.fillStyle = gold;
    ctx.textAlign = 'center';
    ctx.font = `700 46px "Playfair Display", Georgia, serif`;
    ctx.fillText('THE VELVET ACE · ROULETTE', X(GX + CW * 6), Z(GZ + RH * 5) + 70);
    ctx.font = `600 24px "Playfair Display", Georgia, serif`;
    ctx.fillStyle = 'rgba(246, 236, 210, 0.75)';
    ctx.fillText('SINGLE ZERO · STRAIGHT UP PAYS 35 TO 1 · CHIPS 5 TO 500', X(GX + CW * 6), Z(GZ + RH * 5) + 108);
  });
}

/** The roulette table without the wheel: felt layout, cabinet, rail, legs and the chip float. */
export function buildRouletteTable(): { group: THREE.Group; felt: THREE.Mesh } {
  const g = new THREE.Group();
  const w = TABLE.maxX - TABLE.minX;
  const d = TABLE.maxZ - TABLE.minZ;
  const cx = (TABLE.minX + TABLE.maxX) / 2;
  const felt = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: layoutTexture(), roughness: 0.93 }));
  felt.rotation.x = -Math.PI / 2;
  felt.position.set(cx, TABLE_Y, 0);
  felt.receiveShadow = true;
  // Cabinet and a padded rail all the way round.
  const woodMat = new THREE.MeshPhysicalMaterial({ map: woodTexture(), color: 0xb7764a, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, 0.14, d + 0.16), woodMat);
  body.position.set(cx, TABLE_Y - 0.072, 0);
  body.castShadow = body.receiveShadow = true;
  const r = 0.06;
  const path = new THREE.Shape();
  const x0 = TABLE.minX - 0.02;
  const x1 = TABLE.maxX + 0.02;
  const z0 = TABLE.minZ - 0.02;
  const z1 = TABLE.maxZ + 0.02;
  path.moveTo(x0 + r, z0);
  path.lineTo(x1 - r, z0);
  path.quadraticCurveTo(x1, z0, x1, z0 + r);
  path.lineTo(x1, z1 - r);
  path.quadraticCurveTo(x1, z1, x1 - r, z1);
  path.lineTo(x0 + r, z1);
  path.quadraticCurveTo(x0, z1, x0, z1 - r);
  path.lineTo(x0, z0 + r);
  path.quadraticCurveTo(x0, z0, x0 + r, z0);
  const pts = path.getSpacedPoints(220).map((p) => new THREE.Vector3(p.x, TABLE_Y + 0.03, p.y));
  const rail = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 400, 0.05, 16, true),
    new THREE.MeshPhysicalMaterial({ color: 0x2a1410, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.4 }),
  );
  rail.castShadow = rail.receiveShadow = true;
  // Legs.
  for (const [lx, lz] of [
    [TABLE.minX + 0.2, TABLE.minZ + 0.15],
    [TABLE.minX + 0.2, TABLE.maxZ - 0.15],
    [TABLE.maxX - 0.2, TABLE.minZ + 0.15],
    [TABLE.maxX - 0.2, TABLE.maxZ - 0.15],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, TABLE_Y - 0.14, 14), woodMat);
    leg.position.set(lx, (TABLE_Y - 0.14) / 2, lz);
    leg.castShadow = true;
    g.add(leg);
  }
  // The croupier's chip float, by the wheel.
  const float = new THREE.Group();
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.12), new THREE.MeshPhysicalMaterial({ color: 0x1a1a1c, roughness: 0.2, clearcoat: 1 }));
  tray.position.y = 0.015;
  float.add(tray);
  const colors = [0xb3262e, 0x1f5fa8, 0x2c8a4b, 0x111111, 0x6d3ba3, 0xd9a43a];
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 14; k++) {
      const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, CHIP_H, 20), new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.4 }));
      chip.rotation.z = Math.PI / 2;
      chip.position.set(-0.14 + i * 0.055, 0.045, -0.04 + k * CHIP_H * 1.05 + 0.01);
      chip.rotation.y = Math.PI / 2;
      float.add(chip);
    }
  }
  float.position.set(-0.45, TABLE_Y, -0.47);
  g.add(felt, body, rail, float);
  return { group: g, felt };
}

// ---------- The scene ----------

interface BetView {
  key: string;
  playerId: string;
  spot: string;
  stack: ChipStack;
}

interface SeatView {
  id: string;
  seat: number;
  avatar: Avatar | null;
  stacks: ChipStack[];
}

/** An active spin: rotor and ball both follow formulas, so the ball lands exactly. */
interface Spin {
  number: number;
  start: number;
  duration: number;
  rotor0: number;
  ball0: number;
  /** Free-rolling ball angle travel (radians, negative = clockwise). */
  travel: number;
}

const ROTOR_IDLE = 0.32; // rad/s
const ROTOR_BOOST = 2.6;
const ROTOR_TAU = 2.4;

export class RouletteScene3D implements TableRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.03, 60);
  private readonly anim = new Animator();
  private readonly dealer: Dealer;
  private readonly lamp: THREE.SpotLight;
  private readonly extras: THREE.Object3D[];
  private readonly wheel: Wheel;
  private readonly felt: THREE.Mesh;
  private readonly hover: THREE.Mesh;
  private readonly dolly: THREE.Group;
  private readonly dealerBubble = new LabelSprite(640, 96, 0.07);
  private readonly resultSign = new LabelSprite(420, 120, 0.12);
  private readonly celebrations: Celebrations;
  private readonly observer: ResizeObserver;
  private readonly bets = new Map<string, BetView>();
  private readonly payouts: ChipStack[] = [];
  private readonly seats = new Map<string, SeatView>();
  private readonly raycaster = new THREE.Raycaster();
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private me: string | null = null;
  private state: RouletteState | null = null;
  private low: boolean;
  private disposed = false;
  private frame = 0;
  private last = performance.now();
  private clock = 0;
  private bubbleUntil = 0;
  private rotorAngle = 0;
  private spin: Spin | null = null;
  /** After a spin: the pocket the ball sits in. */
  private restingIn: number | null = null;
  private ballHidden = true;
  private serverOffset = 0;
  // Camera.
  private readonly eye = new THREE.Vector3(0, 1.6, 1.6);
  private readonly look = new THREE.Vector3(-0.2, 0.8, 0);
  private readonly eyeTarget = new THREE.Vector3(0, 1.6, 1.6);
  private readonly lookTarget = new THREE.Vector3(-0.2, 0.8, 0);
  private yaw = 0;
  private pitch = 0;
  private yawTarget = 0;
  private pitchTarget = 0;
  private drag: { x: number; y: number; moved: number } | null = null;
  private zoomWheel = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private slow = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: RouletteSceneOptions,
  ) {
    this.low = opts.low;
    setChipDetail(this.low);
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.low, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x080605);
    this.scene.fog = new THREE.FogExp2(0x080605, 0.07);
    addEnvironmentLight(this.renderer, this.scene, 0.28);

    const room = buildRoom();
    this.lamp = room.lamp;
    this.lamp.position.set(-0.2, 2.7, 0);
    this.lamp.target.position.set(-0.2, TABLE_Y, 0);
    this.lamp.angle = 1.0;
    this.lamp.distance = 7;
    this.extras = room.extras;
    this.scene.add(room.group);
    // A second lamp right over the wheel, so it gleams.
    const wheelLamp = new THREE.SpotLight(0xffe2b8, 9, 4, 0.5, 0.6, 1.3);
    wheelLamp.position.set(WHEEL.x, 2.3, WHEEL.z + 0.2);
    wheelLamp.target.position.copy(WHEEL);
    this.scene.add(wheelLamp, wheelLamp.target);

    const table = buildRouletteTable();
    this.felt = table.felt;
    this.scene.add(table.group);
    this.wheel = buildWheel(this.low);
    this.scene.add(this.wheel.group);

    this.dealer = new Dealer(this.anim, DEALER_AT);
    this.scene.add(this.dealer.group, this.dealer.limbs);
    this.dealer.lookAt(new THREE.Vector3(0.2, 1.1, 1));

    // Hover highlight for the spot under the pointer.
    this.hover = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.hover.rotation.x = -Math.PI / 2;
    this.hover.visible = false;
    this.hover.renderOrder = 2;
    this.scene.add(this.hover);

    // The dolly: the marker the croupier puts on the winning number.
    this.dolly = new THREE.Group();
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.022, 0.05, 24),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.6, transparent: true, opacity: 0.75, roughness: 0.05, clearcoat: 1, thickness: 0.02 }),
    );
    glass.position.y = 0.025;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.016, 20, 12), new THREE.MeshStandardMaterial({ color: 0xd8b25e, metalness: 1, roughness: 0.2 }));
    cap.position.y = 0.056;
    cap.scale.y = 0.6;
    glass.castShadow = cap.castShadow = true;
    this.dolly.add(glass, cap);
    this.dolly.visible = false;
    this.scene.add(this.dolly);

    this.dealerBubble.position.set(DEALER_AT.x, 1.76, DEALER_AT.z + 0.1);
    this.dealerBubble.visible = false;
    this.resultSign.position.set(WHEEL.x, TABLE_Y + 0.42, WHEEL.z);
    this.resultSign.visible = false;
    this.scene.add(this.dealerBubble, this.resultSign);

    this.celebrations = new Celebrations(this.scene);
    this.applyQuality();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.wireInput();
    this.frame = requestAnimationFrame(this.loop);
  }

  // ---------- Input: tap the layout to bet; drag to look around ----------

  private wireInput(): void {
    const el = this.renderer.domElement;
    const pick = (e: PointerEvent): string | null => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = this.raycaster.intersectObject(this.felt)[0];
      return hit ? spotAt(hit.point.x, hit.point.z) : null;
    };
    el.addEventListener('pointerdown', (e) => (this.drag = { x: e.clientX, y: e.clientY, moved: 0 }));
    el.addEventListener('pointermove', (e) => {
      if (this.drag) {
        const h = Math.max(1, el.clientHeight);
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        if (this.drag.moved > 8) {
          this.yawTarget = THREE.MathUtils.clamp(this.yawTarget + (dx * 2.2) / h, -1, 1);
          this.pitchTarget = THREE.MathUtils.clamp(this.pitchTarget + (dy * 2.2) / h, -0.45, 0.4);
        }
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
      }
      if (e.pointerType === 'mouse') this.showHover(this.canBet() ? pick(e) : null);
    });
    el.addEventListener('pointerup', (e) => {
      const wasTap = this.drag && this.drag.moved <= 8;
      this.drag = null;
      if (!wasTap || !this.canBet()) return;
      const spot = pick(e);
      if (spot) {
        this.showHover(spot);
        this.opts.onSpot?.(spot);
        if (e.pointerType !== 'mouse') setTimeout(() => this.showHover(null), 350);
      }
    });
    for (const ev of ['pointercancel', 'pointerleave']) el.addEventListener(ev, () => (this.drag = null));
    el.addEventListener('dblclick', () => (this.yawTarget = this.pitchTarget = 0));
  }

  private canBet(): boolean {
    const s = this.state;
    const mine = s?.players.find((p) => p.id === this.me);
    return Boolean(s && mine && mine.seat !== null && (s.phase === 'betting' || s.phase === 'waiting'));
  }

  private showHover(spot: string | null): void {
    this.hover.visible = Boolean(spot);
    this.renderer.domElement.style.cursor = spot ? 'pointer' : 'grab';
    if (!spot) return;
    const c = spotCenter(spot);
    const [w, h] = spotSize(spot);
    this.hover.position.set(c.x, TABLE_Y + 0.0015, c.z);
    this.hover.scale.set(w * 0.96, h * 0.92, 1);
  }

  // ---------- TableRenderer ----------

  update(anyState: AnyState, anyEvents: AnyEvent[], me: string | null): void {
    if (anyState.game !== 'roulette') return;
    const state = anyState;
    this.serverOffset = state.serverTime - Date.now();
    const events = anyEvents as RouletteEvent[];
    this.me = me;
    this.pending++;
    this.queue = this.queue
      .then(() => this.play(state, events))
      .catch((err) => console.error('roulette animation error', err))
      .finally(() => this.pending--);
  }

  setLowGraphics(low: boolean): void {
    this.low = low;
    this.applyQuality();
  }

  say(playerId: string, text: string): void {
    this.seats.get(playerId)?.avatar?.say(text);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- Events ----------

  private async play(state: RouletteState, events: RouletteEvent[]): Promise<void> {
    if (this.disposed) return;
    const prev = this.state;
    this.state = state;
    this.syncSeats(state);
    for (const e of events) {
      if (this.disposed) return;
      await this.animate(e, state);
    }
    this.reconcile(state, prev);
  }

  private dealerSays(text: string, voice = true): void {
    this.dealerBubble.set({ text, bg: 'rgba(250, 246, 236, 0.95)', color: '#1d1a16' });
    this.dealerBubble.visible = true;
    this.bubbleUntil = this.clock + 3;
    if (voice) this.opts.sound.speak(text);
  }

  private seatOf(playerId: string): number | null {
    return this.state?.players.find((p) => p.id === playerId)?.seat ?? null;
  }

  /** Where a player's chips sit on the rail in front of them. */
  private railPoint(seat: number): THREE.Vector3 {
    const s = SEATS[seat]!;
    const facing = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    return new THREE.Vector3(s.x, TABLE_Y, s.z).addScaledVector(facing, 0.45);
  }

  /** Each player's chips sit a little off-center on a spot, so several players' bets don't overlap. */
  private betPoint(spot: string, seat: number): THREE.Vector3 {
    const c = spotCenter(spot);
    const k = [0, 1, 2, 3, 4, 5][seat]!;
    return c.add(new THREE.Vector3(((k % 3) - 1) * 0.022, 0, (Math.floor(k / 3) - 0.5) * 0.022));
  }

  private async animate(e: RouletteEvent, state: RouletteState): Promise<void> {
    switch (e.type) {
      case 'rbet': {
        const seat = this.seatOf(e.playerId);
        if (seat === null) return;
        const key = `${e.playerId}|${e.spot}`;
        let view = this.bets.get(key);
        const isNew = !view;
        if (!view) {
          view = { key, playerId: e.playerId, spot: e.spot, stack: new ChipStack(20) };
          this.bets.set(key, view);
          this.scene.add(view.stack.group);
        }
        const target = this.betPoint(e.spot, seat);
        const now = state.players.find((p) => p.id === e.playerId)?.bets.find((b) => b.spot === e.spot)?.amount ?? e.amount;
        view.stack.set(now);
        if (e.playerId !== this.me) this.opts.sound.play('chip', { gain: 0.5 });
        if (isNew) {
          const from = this.railPoint(seat);
          view.stack.group.position.copy(from);
          await this.anim.tween(0.28, (k) => {
            view!.stack.group.position.lerpVectors(from, target, k);
            view!.stack.group.position.y = TABLE_Y + Math.sin(k * Math.PI) * 0.06;
          }, ease.outCubic);
        }
        view.stack.group.position.copy(target);
        break;
      }
      case 'rclear':
        for (const v of [...this.bets.values()]) if (v.playerId === e.playerId) this.removeBet(v);
        break;
      case 'nomore': {
        this.dealerSays('No more bets!');
        // A wave of the hand over the layout.
        const a = new THREE.Vector3(-0.2, TABLE_Y + 0.12, -0.15);
        const b = new THREE.Vector3(0.45, TABLE_Y + 0.12, -0.15);
        void this.dealer.reach('left', a, 0.25).then(() => this.dealer.reach('left', b, 0.45)).then(() => this.dealer.rest('left', 0.35));
        this.restingIn = null;
        this.ballHidden = true;
        this.dolly.visible = false;
        this.resultSign.visible = false;
        break;
      }
      case 'spin': {
        // The croupier spins the wheel head and flicks the ball the other way.
        const handle = WHEEL.clone().add(new THREE.Vector3(0.08, 0.15, 0));
        void this.dealer.reach('right', handle, 0.3).then(() => this.dealer.reach('right', handle.clone().add(new THREE.Vector3(0, 0, 0.12)), 0.2)).then(() => this.dealer.rest('right', 0.4));
        this.dealer.lookAt(WHEEL.clone().setY(0.9));
        this.startSpin(e.number, e.durationMs, 0);
        this.opts.sound.play('ballSpin', { pan: this.panFor(WHEEL) });
        break;
      }
      case 'result': {
        // Let the ball finish (the event can arrive a hair before the animation ends).
        while (this.spin && this.clock < this.spin.start + this.spin.duration && !this.disposed) await this.anim.wait(0.05);
        this.spin = null;
        this.restingIn = e.number;
        this.ballHidden = false;
        const name = pocketName(e.number);
        this.dealerSays(`${name}!`);
        this.resultSign.set({ text: String(e.number), bg: { red: 'rgba(176, 18, 42, 0.95)', black: 'rgba(20, 20, 20, 0.95)', green: 'rgba(14, 122, 64, 0.95)' }[pocketColor(e.number)], sub: pocketColor(e.number).toUpperCase() });
        this.resultSign.visible = true;
        // The dolly goes on the winning number.
        const spot = spotCenter(`n:${e.number}`);
        this.dolly.position.copy(spot).setY(TABLE_Y + 0.25);
        this.dolly.visible = true;
        await this.dealer.reach('left', spot.clone().setY(TABLE_Y + 0.08), 0.35);
        await this.anim.tween(0.25, (k) => (this.dolly.position.y = lerp(TABLE_Y + 0.06, TABLE_Y, k)), ease.outCubic);
        this.opts.sound.play('tap', { gain: 0.6 });
        void this.dealer.rest('left', 0.3);
        await this.anim.wait(0.5);
        // Losing chips are swept away; winning bets get paid next to them.
        const losers = [...this.bets.values()].filter((v) => !spotNumbers(v.spot).includes(e.number));
        if (losers.length) {
          this.opts.sound.play('chipSlide');
          const to = DEALER_AT.clone().setY(TABLE_Y).add(new THREE.Vector3(0, 0, 0.3));
          await Promise.all(
            losers.map((v) => {
              const from = v.stack.group.position.clone();
              return this.anim.tween(0.45, (k) => v.stack.group.position.lerpVectors(from, to, k), ease.inOutCubic).then(() => this.removeBet(v));
            }),
          );
        }
        for (const v of this.bets.values()) {
          const stake = state.players.find((p) => p.id === v.playerId)?.bets.find((b) => b.spot === v.spot)?.amount ?? 0;
          const win = stake * (36 / spotNumbers(v.spot).length - 1);
          if (win <= 0) continue;
          const pay = new ChipStack(20);
          pay.set(win);
          this.scene.add(pay.group);
          this.payouts.push(pay);
          const from = DEALER_AT.clone().setY(TABLE_Y).add(new THREE.Vector3(0, 0, 0.3));
          const to = v.stack.group.position.clone().add(new THREE.Vector3(0.026, 0, 0.01));
          this.opts.sound.play('chips', { delay: 0.05 });
          await this.anim.tween(0.4, (k) => pay.group.position.lerpVectors(from, to, k), ease.outCubic);
        }
        const myWin = e.winners.find((w) => w.playerId === this.me);
        if (myWin) {
          this.opts.sound.play('win');
          const mine = [...this.bets.values()].find((v) => v.playerId === this.me);
          const big = myWin.amount >= 300;
          this.celebrations.burst(mine ? mine.stack.group.position.clone() : spot, big, this.low);
          if (big) this.opts.sound.play('applause', { delay: 0.3 });
        }
        break;
      }
      case 'clear':
        for (const v of [...this.bets.values()]) this.removeBet(v);
        for (const p of this.payouts.splice(0)) p.group.removeFromParent();
        this.dolly.visible = false;
        this.resultSign.visible = false;
        break;
    }
  }

  private removeBet(v: BetView): void {
    v.stack.group.removeFromParent();
    this.bets.delete(v.key);
  }

  private panFor(pos: THREE.Vector3): number {
    const v = pos.clone().applyMatrix4(this.camera.matrixWorldInverse);
    return THREE.MathUtils.clamp((v.x / Math.max(0.3, -v.z)) * 0.8, -0.9, 0.9);
  }

  // ---------- The spin ----------

  private rotorAt(spin: Spin, t: number): number {
    return spin.rotor0 + ROTOR_IDLE * t + ROTOR_BOOST * ROTOR_TAU * (1 - Math.exp(-t / ROTOR_TAU));
  }

  /** `elapsed`: seconds already gone (when joining in the middle of a spin). */
  private startSpin(number: number, durationMs: number, elapsed: number): void {
    const duration = durationMs / 1000;
    const index = WHEEL_ORDER.indexOf(number as (typeof WHEEL_ORDER)[number]);
    const spin: Spin = { number, start: this.clock - elapsed, duration, rotor0: 0, ball0: Math.random() * Math.PI * 2, travel: 0 };
    // Keep the wheel where it is now: rotor0 is where it "was" when the spin began.
    spin.rotor0 = this.rotorAngle - this.rotorAt(spin, elapsed);
    // Where the pocket will be when the ball arrives; the ball goes around ~7 laps the other way to meet it.
    const end = pocketAngle(index) + this.rotorAt(spin, duration);
    let travel = end - spin.ball0;
    travel -= Math.ceil(travel / (Math.PI * 2)) * Math.PI * 2; // make it negative (clockwise)
    travel -= Math.PI * 2 * 7;
    spin.travel = travel;
    this.spin = spin;
    this.restingIn = null;
    this.ballHidden = false;
  }

  /** Ball position (wheel coordinates) during a spin, at time u = 0…1. */
  private ballDuringSpin(spin: Spin, t: number): THREE.Vector3 {
    const u = THREE.MathUtils.clamp(t / spin.duration, 0, 1);
    // Free roll: fast at first, slowing down (an ease-out curve that ends with zero speed).
    const g = 1 - (1 - u) ** 2.2;
    const free = spin.ball0 + spin.travel * g;
    // At the end the ball rides in its pocket, so blend toward the pocket's moving angle.
    const index = WHEEL_ORDER.indexOf(spin.number as (typeof WHEEL_ORDER)[number]);
    const pocketNow = pocketAngle(index) + this.rotorAt(spin, t);
    const pocketEnd = pocketAngle(index) + this.rotorAt(spin, spin.duration);
    const freeEnd = spin.ball0 + spin.travel;
    const pocketUnwrapped = pocketNow + (freeEnd - pocketEnd);
    const s = THREE.MathUtils.smoothstep(u, 0.8, 0.97);
    const angle = lerp(free, pocketUnwrapped, s);
    // Radius and height: on the track, then dropping over the apron, bouncing between frets.
    const drop = THREE.MathUtils.smoothstep(u, 0.56, 0.84);
    let r = lerp(R_TRACK, R_POCKET, drop);
    let y = lerp(Y_TRACK, Y_POCKET + BALL_R, THREE.MathUtils.smoothstep(u, 0.6, 0.86));
    if (u > 0.72 && u < 0.97) {
      const k = (u - 0.72) / 0.25;
      const bounce = Math.abs(Math.sin(k * Math.PI * 5)) * (1 - k) ** 1.5;
      y += bounce * 0.018;
      r += bounce * 0.012;
    }
    return new THREE.Vector3(Math.sin(angle) * r, y, Math.cos(angle) * r);
  }

  // ---------- Snapping to the state ----------

  private syncSeats(state: RouletteState): void {
    const present = new Set<string>();
    for (const p of state.players) {
      if (p.seat === null) continue;
      present.add(p.id);
      let v = this.seats.get(p.id);
      if (v && v.seat !== p.seat) {
        this.removeSeat(v);
        v = undefined;
      }
      if (!v) {
        v = { id: p.id, seat: p.seat, avatar: null, stacks: [] };
        this.seats.set(p.id, v);
      }
      const isMe = p.id === this.me;
      if (!isMe && !v.avatar) {
        const s = SEATS[p.seat]!;
        v.avatar = new Avatar(0, p.look, { position: new THREE.Vector3(s.x, 0, s.z), rotationY: s.yaw });
        this.scene.add(v.avatar.group);
      } else if (isMe && v.avatar) {
        v.avatar.dispose();
        v.avatar = null;
      }
    }
    for (const v of [...this.seats.values()]) if (!present.has(v.id)) this.removeSeat(v);
  }

  private removeSeat(v: SeatView): void {
    v.avatar?.dispose();
    for (const s of v.stacks) s.group.removeFromParent();
    this.seats.delete(v.id);
  }

  private reconcile(state: RouletteState, prev: RouletteState | null): void {
    // Bets on the layout.
    const want = new Map<string, { playerId: string; spot: string; amount: number; seat: number }>();
    const showBets = state.phase === 'betting' || state.phase === 'spinning' || state.phase === 'waiting';
    for (const p of state.players) {
      if (p.seat === null) continue;
      for (const b of p.bets) {
        if (!showBets && state.result !== null && !spotNumbers(b.spot).includes(state.result)) continue;
        want.set(`${p.id}|${b.spot}`, { playerId: p.id, spot: b.spot, amount: b.amount, seat: p.seat });
      }
    }
    for (const v of [...this.bets.values()]) if (!want.has(v.key)) this.removeBet(v);
    for (const [key, w] of want) {
      let v = this.bets.get(key);
      if (!v) {
        v = { key, playerId: w.playerId, spot: w.spot, stack: new ChipStack(20) };
        this.bets.set(key, v);
        this.scene.add(v.stack.group);
      }
      v.stack.set(w.amount);
      v.stack.group.position.copy(this.betPoint(w.spot, w.seat));
    }
    if (state.phase !== 'results') {
      for (const p of this.payouts.splice(0)) p.group.removeFromParent();
    }

    // Players: their chips on the rail, and name tags.
    for (const p of state.players) {
      const v = this.seats.get(p.id);
      if (!v || p.seat === null) continue;
      const plan = railChips(p.balance);
      while (v.stacks.length < plan.length) {
        const s = new ChipStack(20);
        v.stacks.push(s);
        this.scene.add(s.group);
      }
      const base = this.railPoint(p.seat);
      const s = SEATS[p.seat]!;
      const right = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
      v.stacks.forEach((stack, i) => {
        const item = plan[i];
        stack.group.visible = Boolean(item && item.count > 0);
        if (!item || !item.count) return;
        stack.set(item.count * item.value, Array(item.count).fill(item.value));
        stack.group.position.copy(base).addScaledVector(right, (i - (plan.length - 1) / 2) * 0.048);
      });
      v.avatar?.setLook(p.look);
      const won = state.phase === 'results' && p.won > 0;
      v.avatar?.setInfo({
        name: p.name,
        balance: won ? `wins ${money(p.won)}` : `${money(p.balance)} chips`,
        isTurn: won,
        away: !p.connected,
        host: p.isHost,
        bot: p.bot,
      });
    }

    // The wheel: joining mid-spin starts the ball where it should be.
    if (state.phase === 'spinning' && state.spin && !this.spin) {
      const elapsed = (state.spin.durationMs - (state.spin.endsAt - (Date.now() + this.serverOffset))) / 1000;
      if (elapsed < state.spin.durationMs / 1000 - 0.3) this.startSpin(state.spin.number, state.spin.durationMs, Math.max(0, elapsed));
    }
    if (state.phase === 'results' && state.result !== null && !this.spin) {
      this.restingIn = state.result;
      this.ballHidden = false;
      const spot = spotCenter(`n:${state.result}`);
      this.dolly.position.copy(spot);
      this.dolly.visible = true;
      if (!this.resultSign.visible) {
        this.resultSign.set({ text: String(state.result), sub: pocketColor(state.result).toUpperCase() });
        this.resultSign.visible = true;
      }
    }
    if (state.phase === 'betting' && prev?.phase !== 'betting') {
      this.dealerSays(prev?.phase === 'results' ? 'Place your bets, please.' : 'Place your bets!', prev !== null);
      this.dolly.visible = false;
      this.resultSign.visible = false;
    }

    // Camera: behind your place at the table, looking across the layout toward the wheel.
    const mine = state.players.find((p) => p.id === this.me);
    if (mine?.seat !== null && mine?.seat !== undefined) {
      // Standing a step back from your place, high enough to see the whole layout and the wheel.
      const s = SEATS[mine.seat]!;
      const facing = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
      this.eyeTarget.set(s.x, 1.72, s.z).addScaledVector(facing, -0.22);
      if (Math.abs(s.z) > 0.5) this.eyeTarget.x = lerp(s.x, -0.05, 0.4);
      this.lookTarget.set(-0.2, 0.62, 0).lerp(new THREE.Vector3(s.x, 0.62, s.z * 0.2), 0.2);
    } else {
      this.eyeTarget.set(0.1, 1.95, 1.9);
      this.lookTarget.set(-0.3, 0.7, 0);
    }
  }

  // ---------- Frame loop ----------

  private loop = (now: number) => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    this.anim.timeScale = Math.min(6, 1 + Math.max(0, this.pending - 1) * 1.5);
    this.anim.tick(dt);
    this.dealer.update(dt);
    this.celebrations.update(dt);
    for (const v of this.seats.values()) v.avatar?.update(dt);
    if (this.dealerBubble.visible && this.clock > this.bubbleUntil) this.dealerBubble.visible = false;

    // Wheel and ball.
    const spin = this.spin;
    if (spin) {
      const t = this.clock - spin.start;
      this.rotorAngle = this.rotorAt(spin, Math.min(t, spin.duration)) + ROTOR_IDLE * Math.max(0, t - spin.duration);
      this.wheel.ball.position.copy(this.ballDuringSpin(spin, Math.min(t, spin.duration)));
      if (t > spin.duration + 0.5) {
        this.restingIn = spin.number;
        this.spin = null;
      }
    } else {
      this.rotorAngle += ROTOR_IDLE * dt;
    }
    this.wheel.rotor.rotation.y = this.rotorAngle;
    if (!spin) {
      if (this.restingIn !== null) {
        const a = pocketAngle(WHEEL_ORDER.indexOf(this.restingIn as (typeof WHEEL_ORDER)[number])) + this.rotorAngle;
        this.wheel.ball.position.set(Math.sin(a) * R_POCKET, Y_POCKET + BALL_R, Math.cos(a) * R_POCKET);
      } else {
        // Waiting in the croupier's hand: park the ball on the track near the dealer.
        this.wheel.ball.position.set(Math.sin(2.6) * R_TRACK, Y_TRACK, Math.cos(2.6) * R_TRACK);
      }
    }
    this.wheel.ball.visible = !this.ballHidden || Boolean(spin);
    // The ball spins as it rolls.
    this.wheel.ball.rotation.x += dt * (spin ? 30 : 0);

    for (const k of ['x', 'y', 'z'] as const) {
      this.eye[k] = damp(this.eye[k], this.eyeTarget[k], 3, dt);
      this.look[k] = damp(this.look[k], this.lookTarget[k], 3, dt);
    }
    // While the ball is rolling, the view drifts toward the wheel, like everyone's eyes do.
    const watching = spin ? THREE.MathUtils.smoothstep(this.clock - spin.start, 0, 1.2) * (1 - THREE.MathUtils.smoothstep(this.clock - spin.start, spin.duration + 1.5, spin.duration + 3)) : 0;
    this.zoomWheel = damp(this.zoomWheel, watching, 2.5, dt);
    this.yaw = damp(this.yaw, this.yawTarget, 6, dt);
    this.pitch = damp(this.pitch, this.pitchTarget, 6, dt);
    const t = this.clock;
    const portrait = this.camera.aspect < 0.85;
    const lookAt = this.look.clone().lerp(WHEEL.clone().setY(TABLE_Y + 0.05), this.zoomWheel * 0.75);
    const eye = this.eye.clone().lerp(new THREE.Vector3(WHEEL.x + 0.05, 1.5, WHEEL.z + (this.eye.z > 0 ? 0.85 : -0.85)), this.zoomWheel * 0.45);
    const back = eye.clone().sub(lookAt).setY(0).normalize().multiplyScalar(portrait ? 0.3 : 0);
    this.camera.position.copy(eye).add(back).add(new THREE.Vector3(Math.sin(t * 0.43) * 0.004, Math.sin(t * 0.9) * 0.003, 0));
    this.camera.lookAt(lookAt);
    this.camera.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -this.yaw);
    this.camera.rotateX(-this.pitch);
    this.renderer.render(this.scene, this.camera);

    if (!this.low && !document.hidden) {
      this.fpsFrames++;
      this.fpsTime += dt;
      if (this.fpsTime > 3) {
        this.slow = this.fpsFrames / this.fpsTime < 28 ? this.slow + 1 : 0;
        this.fpsFrames = this.fpsTime = 0;
        if (this.slow >= 2) {
          this.slow = 0;
          this.setLowGraphics(true);
          this.opts.onAutoLow?.();
        }
      }
    }
  };

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.fov = this.camera.aspect < 0.85 ? 80 : this.camera.aspect < 1.3 ? 68 : 58;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private applyQuality(): void {
    const low = this.low;
    this.renderer.setPixelRatio(low ? Math.min(window.devicePixelRatio, 1) : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !low;
    this.lamp.castShadow = !low;
    for (const o of this.extras) o.visible = !low;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
    this.resize();
  }
}

/** A player's chips by the rail: a few stacks of each color, purely to look at. */
function railChips(balance: number): { value: number; count: number }[] {
  const out: { value: number; count: number }[] = [];
  let left = balance;
  for (const value of [500, 100, 25, 5]) {
    const count = Math.min(12, Math.floor(left / value));
    out.push({ value, count });
    left -= count * value;
  }
  return out;
}

