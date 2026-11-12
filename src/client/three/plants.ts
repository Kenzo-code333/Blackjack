// Potted plants that look like real ones: feathery areca palms whose fronds arch and droop
// under their own weight, and leafy rubber plants with glossy, veined, cupped leaves on
// woody stems, in shaped ceramic pots with soil. Leaves are curved strips cut out by a
// painted leaf picture (two shades in one picture for variety), so a whole plant (and every
// plant in a room) shares a handful of materials and merges into a few draw calls.

import * as THREE from 'three';
import { canvasTex } from './decor.js';

export type PlantKind = 'palm' | 'leafy';
export type PotStyle = 'cream' | 'black' | 'terracotta';

// ---------- Pictures (made once) ----------

let frondMat: THREE.MeshStandardMaterial | null = null;
let leafMat: THREE.MeshStandardMaterial | null = null;

/** Two palm fronds side by side (a fresh green and a deeper one): a stalk with leaflets. */
function frondMaterial(): THREE.MeshStandardMaterial {
  if (frondMat) return frondMat;
  const tex = canvasTex(256, 512, (c) => {
    for (const [half, light] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const ox = half * 128;
      const cx = ox + 64;
      let s = 7 + half * 13;
      const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      // Leaflets from the stalk, longest in the middle, angled toward the tip.
      for (let y = 500; y > 10; y -= 9 + rand() * 3) {
        const t = 1 - y / 512; // 0 at the base, 1 at the tip
        const len = (Math.sin(Math.min(1, t * 1.25) * Math.PI) * 0.85 + 0.15) * 60;
        for (const side of [-1, 1]) {
          const tilt = 0.55 + rand() * 0.2;
          const ex = cx + side * len * Math.cos(tilt);
          const ey = y - len * Math.sin(tilt) * 1.3;
          const g = c.createLinearGradient(cx, y, ex, ey);
          const l = light ? 38 : 28;
          g.addColorStop(0, `hsl(${100 + rand() * 12}, 48%, ${l}%)`);
          g.addColorStop(1, `hsl(${92 + rand() * 14}, 52%, ${l + 10}%)`);
          c.fillStyle = g;
          c.beginPath();
          c.moveTo(cx, y + 2);
          c.quadraticCurveTo(cx + side * len * 0.5, y - len * 0.25 + 3, ex, ey);
          c.quadraticCurveTo(cx + side * len * 0.45, y - len * 0.45, cx, y - 5);
          c.fill();
          // The leaflet's own midrib.
          c.strokeStyle = 'rgba(210, 230, 160, 0.25)';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(cx, y);
          c.lineTo(ex, ey);
          c.stroke();
        }
      }
      // The stalk.
      c.strokeStyle = light ? '#7f9a3e' : '#5f7a30';
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(cx, 512);
      c.lineTo(cx, 8);
      c.stroke();
    }
  });
  frondMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.62 });
  return frondMat;
}

/** Two broad leaves side by side: oval with a pointed tip, a pale midrib and fine veins. */
function leafMaterial(): THREE.MeshStandardMaterial {
  if (leafMat) return leafMat;
  const tex = canvasTex(256, 256, (c) => {
    for (const half of [0, 1] as const) {
      const ox = half * 128;
      const cx = ox + 64;
      const path = () => {
        c.beginPath();
        c.moveTo(cx, 252);
        c.bezierCurveTo(cx - 70, 200, cx - 62, 60, cx, 4);
        c.bezierCurveTo(cx + 62, 60, cx + 70, 200, cx, 252);
      };
      path();
      const g = c.createLinearGradient(ox, 0, ox + 128, 0);
      const l = half ? 20 : 27;
      g.addColorStop(0, `hsl(128, 45%, ${l - 6}%)`);
      g.addColorStop(0.5, `hsl(122, 48%, ${l + 6}%)`);
      g.addColorStop(1, `hsl(130, 45%, ${l - 4}%)`);
      c.fillStyle = g;
      c.fill();
      // A glossy sheen along one side.
      c.save();
      path();
      c.clip();
      const sheen = c.createRadialGradient(cx - 18, 110, 4, cx - 18, 110, 70);
      sheen.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
      sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
      c.fillStyle = sheen;
      c.fillRect(ox, 0, 128, 256);
      // Veins.
      c.strokeStyle = 'rgba(190, 220, 160, 0.35)';
      c.lineWidth = 1.2;
      for (let y = 220; y > 30; y -= 22) {
        for (const side of [-1, 1]) {
          c.beginPath();
          c.moveTo(cx, y);
          c.quadraticCurveTo(cx + side * 26, y - 14, cx + side * 52, y - 34);
          c.stroke();
        }
      }
      c.restore();
      c.strokeStyle = 'rgba(214, 232, 170, 0.75)';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(cx, 252);
      c.lineTo(cx, 10);
      c.stroke();
    }
  });
  leafMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.38, metalness: 0.05 });
  return leafMat;
}

// ---------- Shapes ----------

/**
 * A leaf (or frond) as a curved strip: it leaves its base at `lean` radians from upright and
 * curves over by `bend` radians toward the tip; `fold` lifts the edges (a V across the midrib).
 * Points along +z when its group isn't rotated. `half` picks which of the two pictures.
 */
function curvedLeaf(width: number, length: number, lean: number, bend: number, fold: number, half: 0 | 1, segs = 7): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let y = 0;
  let z = 0;
  const ds = length / segs;
  for (let i = 0; i <= segs; i++) {
    const v = i / segs;
    const phi = lean + bend * v * v; // droops more toward the tip
    // Narrower toward both ends so the picture's outline isn't squashed.
    const w = width * (0.55 + 0.45 * Math.sin(Math.min(1, v * 1.15) * Math.PI));
    for (const u of [-1, 0, 1]) {
      // The edges rise above the midrib (the leaf's upper side faces up and out).
      const lift = Math.abs(u) * fold * w * 0.5;
      pos.push((u * w) / 2, y + Math.sin(phi) * lift, z - Math.cos(phi) * lift);
      uv.push(half * 0.5 + ((u + 1) / 2) * 0.5, v);
    }
    y += Math.cos(phi) * ds;
    z += Math.sin(phi) * ds;
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < 2; k++) {
      const a = i * 3 + k;
      const b = a + 1;
      const c = a + 3;
      const d = a + 4;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A shaped pot (turned on a lathe): a foot, a gentle belly, a rolled rim; soil inside. */
function pot(style: PotStyle, height: number, radius: number): THREE.Group {
  const g = new THREE.Group();
  const r = radius;
  const h = height;
  const profile = [
    [0, 0],
    [r * 0.62, 0],
    [r * 0.66, h * 0.04],
    [r * 0.74, h * 0.06],
    [r * 0.86, h * 0.35],
    [r * 0.97, h * 0.72],
    [r, h * 0.9],
    [r * 1.07, h * 0.93],
    [r * 1.08, h * 0.99],
    [r * 1.0, h],
    [r * 0.93, h * 0.97],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const color = { cream: 0xe8dfcc, black: 0x161616, terracotta: 0xb4583a }[style];
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 28),
    new THREE.MeshStandardMaterial({ color, roughness: style === 'terracotta' ? 0.85 : style === 'black' ? 0.22 : 0.35, metalness: style === 'black' ? 0.1 : 0 }),
  );
  const soil = new THREE.Mesh(new THREE.CircleGeometry(r * 0.93, 24), new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 1 }));
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = h * 0.93;
  g.add(body, soil);
  if (style !== 'terracotta') {
    // A thin gold band under the rim.
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 1.0, 0.012, 6, 32), new THREE.MeshStandardMaterial({ color: 0xd4af5a, metalness: 1, roughness: 0.3 }));
    band.rotation.x = Math.PI / 2;
    band.position.y = h * 0.86;
    g.add(band);
  }
  return g;
}

const stemMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.8 });
const caneMat = new THREE.MeshStandardMaterial({ color: 0x8a9a52, roughness: 0.6 });

/** A seeded random, so each plant always grows the same way. */
function seeded(seed: number): () => number {
  let s = Math.floor(seed * 9301 + 49297) % 233280 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** An areca palm: several slim canes, each crowned by long arching feathery fronds. */
function palm(top: number, size: number, rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const mat = frondMaterial();
  const canes = 5;
  for (let i = 0; i < canes; i++) {
    const az = (i / canes) * Math.PI * 2 + rand() * 0.8;
    const tilt = 0.08 + rand() * 0.18;
    const h = (0.25 + rand() * 0.55) * size;
    const cane = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, h, 6), caneMat);
    const tipX = Math.sin(az) * Math.sin(tilt) * h;
    const tipZ = Math.cos(az) * Math.sin(tilt) * h;
    cane.position.set(tipX / 2, top + h / 2, tipZ / 2);
    cane.rotation.set(Math.cos(az) * tilt, 0, -Math.sin(az) * tilt);
    g.add(cane);
    const fronds = 4 + Math.floor(rand() * 2);
    for (let k = 0; k < fronds; k++) {
      const len = (0.75 + rand() * 0.45) * size;
      const frond = new THREE.Mesh(curvedLeaf(0.42 * size, len, 0.45 + rand() * 0.5, 1.3 + rand() * 0.8, 0.3, rand() < 0.5 ? 0 : 1, 8), mat);
      frond.position.set(tipX, top + h, tipZ);
      frond.rotation.y = az + (k - fronds / 2) * 1.1 + rand() * 0.4;
      // A slight twist so the fronds don't look stamped out.
      frond.rotation.z = (rand() - 0.5) * 0.4;
      g.add(frond);
    }
  }
  // Young fronds springing from the soil.
  for (let k = 0; k < 4; k++) {
    const frond = new THREE.Mesh(curvedLeaf(0.3 * size, (0.5 + rand() * 0.25) * size, 0.4 + rand() * 0.3, 1.1 + rand() * 0.5, 0.3, 1, 6), mat);
    frond.position.y = top;
    frond.rotation.y = rand() * Math.PI * 2;
    g.add(frond);
  }
  return g;
}

/** A rubber plant: a few woody stems with glossy oval leaves spiralling up them. */
function leafy(top: number, size: number, rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const mat = leafMaterial();
  const stems = 3;
  for (let i = 0; i < stems; i++) {
    const az = (i / stems) * Math.PI * 2 + rand();
    const tilt = 0.12 + rand() * 0.2;
    const h = (0.55 + rand() * 0.45) * size;
    const dir = new THREE.Vector3(Math.sin(az) * Math.sin(tilt), Math.cos(tilt), Math.cos(az) * Math.sin(tilt));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.016, h, 6), stemMat);
    stem.position.copy(dir.clone().multiplyScalar(h / 2)).setY(top + (dir.y * h) / 2);
    stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.add(stem);
    // Leaves from a third of the way up to the top, smaller and more upright near the top.
    const n = 9 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const t = 0.2 + (0.8 * k) / (n - 1);
      const at = dir.clone().multiplyScalar(h * t);
      const scale = (1.05 - t * 0.45) * size;
      const leaf = new THREE.Mesh(curvedLeaf(0.24 * scale, 0.36 * scale, 0.75 + (1 - t) * 0.6 + rand() * 0.2, 0.55 + rand() * 0.3, 0.45, rand() < 0.4 ? 1 : 0, 5), mat);
      leaf.position.set(at.x, top + at.y, at.z);
      leaf.rotation.y = az + k * 2.4 + rand() * 0.5; // a spiral, like the real thing
      g.add(leaf);
    }
  }
  return g;
}

/**
 * A plant in a pot, standing on the floor at its group's origin. `height` is the pot's;
 * `size` scales the plant. The same `seed` always grows the same plant.
 */
export function pottedPlant(kind: PlantKind, style: PotStyle, opts: { height?: number; radius?: number; size?: number; seed?: number } = {}): THREE.Group {
  const height = opts.height ?? 0.55;
  const radius = opts.radius ?? 0.28;
  const size = opts.size ?? 1;
  const rand = seeded(opts.seed ?? 1);
  const g = new THREE.Group();
  g.add(pot(style, height, radius));
  const top = height * 0.93;
  g.add(kind === 'palm' ? palm(top, size, rand) : leafy(top, size, rand));
  return g;
}
