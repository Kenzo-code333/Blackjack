// Things worn on the head, modeled after the real objects:
//  - Glasses: tortoiseshell acetate frames, clear lenses with a glint, keyhole bridge,
//    metal hinges and rivets, temples that curve back over the ears.
//  - Sunglasses: gold wire aviators with teardrop gradient lenses, a double bridge,
//    nose pads on little arms, and dark temple tips.
//  - Cap: a six-panel baseball cap with top-stitched seams, eyelets, a top button, an
//    embroidered spade on the front, a curved stitched brim with a grey-green underside,
//    and an adjustable strap with a buckle at the back.
//  - Beanie: a knitted beanie with real-looking V stitches, a folded ribbed cuff, a
//    woven tag and a fluffy pom-pom.
// Head coordinates (see human.ts): head radius 0.1, eyes at y 0.013 / z 0.087, ears at x ±0.087.

import * as THREE from 'three';
import { LOOK_OPTIONS, type Look } from '../../shared/protocol.js';

const R = 0.1;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, shadow = false): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadow;
  return m;
}

const shade = (hex: string, amount: number, sat = 0) => {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, sat, amount);
  return `#${c.getHexString()}`;
};

// ---------- Textures (drawn once, cached) ----------

const textures = new Map<string, THREE.CanvasTexture>();

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, color = true): THREE.CanvasTexture {
  const hit = textures.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  textures.set(key, tex);
  return tex;
}

/** Seeded random numbers, so every copy of a texture looks the same. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Brown-and-amber tortoiseshell, like real acetate. */
function tortoiseTexture(): THREE.CanvasTexture {
  return canvasTexture('tortoise', 256, 256, (ctx) => {
    ctx.fillStyle = '#3a1d0c';
    ctx.fillRect(0, 0, 256, 256);
    const rand = rng(7);
    for (let i = 0; i < 140; i++) {
      const x = rand() * 256;
      const y = rand() * 256;
      const r = 6 + rand() * 22;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const amber = rand() < 0.5;
      g.addColorStop(0, amber ? 'rgba(196, 120, 40, 0.75)' : 'rgba(120, 60, 20, 0.6)');
      g.addColorStop(1, 'rgba(60, 25, 8, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.5 + rand() * 0.6), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(20, 8, 2, ${0.3 + rand() * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(rand() * 256, rand() * 256, 2 + rand() * 6, 1 + rand() * 4, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Clear lens: nearly invisible, with a soft diagonal reflection. */
function glintTexture(): THREE.CanvasTexture {
  return canvasTexture('glint', 128, 128, (ctx) => {
    ctx.fillStyle = 'rgba(220, 235, 245, 0.10)';
    ctx.fillRect(0, 0, 128, 128);
    const g = ctx.createLinearGradient(20, 0, 70, 50);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(10, 40);
    ctx.lineTo(50, 0);
    ctx.lineTo(72, 0);
    ctx.lineTo(18, 60);
    ctx.fill();
  });
}

/** Aviator lens: dark green-grey at the top fading lighter at the bottom, with a sheen. */
function gradientLensTexture(): THREE.CanvasTexture {
  return canvasTexture('aviator', 128, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(18, 28, 24, 0.97)');
    g.addColorStop(0.6, 'rgba(38, 52, 44, 0.9)');
    g.addColorStop(1, 'rgba(70, 86, 74, 0.72)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const s = ctx.createLinearGradient(0, 30, 128, 70);
    s.addColorStop(0, 'rgba(255,255,255,0)');
    s.addColorStop(0.45, 'rgba(200,220,255,0.22)');
    s.addColorStop(0.55, 'rgba(255,255,255,0)');
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, 128, 128);
  });
}

/** Six cap panels: twill weave, seams with two rows of stitching, eyelets, an embroidered spade, the strap at the back. */
function capCrownTexture(color: string): THREE.CanvasTexture {
  return canvasTexture(`cap|${color}`, 1024, 256, (ctx) => {
    const W = 1024;
    const H = 256;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
    // Twill: fine diagonal lines.
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 1;
    for (let x = -H; x < W; x += 3) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + H, 0);
      ctx.stroke();
    }
    // Panel seams: u = 0.25 is the front (center seam), then every sixth.
    for (let k = 0; k < 6; k++) {
      const x = ((0.25 + k / 6) % 1) * W;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x - 1.5, 0, 3, H);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + 2, 0, 1, H);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      for (const off of [-7, 7]) for (let y = 8; y < H; y += 7) ctx.fillRect(x + off - 0.75, y, 1.5, 4);
    }
    // Eyelets: a small stitched hole near the top of each panel.
    for (let k = 0; k < 6; k++) {
      const x = ((0.25 + (k + 0.5) / 6) % 1) * W;
      ctx.fillStyle = shade(color, -0.12);
      ctx.beginPath();
      ctx.arc(x, 70, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0c0c0c';
      ctx.beginPath();
      ctx.arc(x, 70, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Back: the opening above the adjustable strap, and the strap itself.
    const back = 0.75 * W;
    ctx.fillStyle = 'rgba(8, 6, 5, 0.85)';
    ctx.beginPath();
    ctx.ellipse(back, H, 60, 62, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = shade(color, -0.08);
    ctx.fillRect(back - 70, H - 26, 140, 20);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let x = back - 66; x < back + 66; x += 7) ctx.fillRect(x, H - 23, 4, 1.5);
    // Front: an embroidered gold spade straddling the center seam (drawn apart, then pasted on).
    const e = document.createElement('canvas');
    e.width = e.height = 128;
    const ec = e.getContext('2d')!;
    ec.font = 'bold 92px Georgia, serif';
    ec.textAlign = 'center';
    ec.textBaseline = 'middle';
    ec.lineWidth = 6;
    ec.strokeStyle = '#5a3d0e';
    ec.strokeText('♠', 64, 64);
    const gold = ec.createLinearGradient(0, 24, 0, 104);
    gold.addColorStop(0, '#fbe7a1');
    gold.addColorStop(0.5, '#d4a640');
    gold.addColorStop(1, '#9a6c1c');
    ec.fillStyle = gold;
    ec.fillText('♠', 64, 64);
    // Satin-stitch texture, only on the thread.
    ec.globalCompositeOperation = 'source-atop';
    ec.strokeStyle = 'rgba(255,255,255,0.2)';
    ec.lineWidth = 1;
    for (let y = 0; y < 140; y += 3) {
      ec.beginPath();
      ec.moveTo(0, y);
      ec.lineTo(128, y - 16);
      ec.stroke();
    }
    ctx.drawImage(e, 0.25 * W - 64, 165 - 64);
  });
}

/** Top of the brim: rows of stitching that follow the front edge. */
function brimTexture(color: string): THREE.CanvasTexture {
  return canvasTexture(`brim|${color}`, 512, 128, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    for (let x = -128; x < 512; x += 3) {
      ctx.beginPath();
      ctx.moveTo(x, 128);
      ctx.lineTo(x + 128, 0);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (const v of [0.3, 0.45, 0.6, 0.74, 0.88]) {
      const y = (1 - v) * 128;
      for (let x = 4; x < 512; x += 9) ctx.fillRect(x, y, 5, 1.6);
    }
  });
}

/** Knitting: columns of V stitches (each a pair of slanted loops). Returns colour and bump maps. */
function knitTextures(color: string, ribbed: boolean): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 512;
  const Hh = 192;
  const draw = (ctx: CanvasRenderingContext2D, base: string, loop: (a: number) => string, gap: string) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, Hh);
    const cw = 8;
    const rh = 6;
    for (let x = 0; x < W; x += cw) {
      // Ribbing: every other pair of columns sits back (purl), darker and flatter.
      const purl = ribbed && Math.floor(x / cw) % 4 >= 2;
      ctx.fillStyle = gap;
      ctx.fillRect(x + cw / 2 - 0.5, 0, 1, Hh);
      for (let y = 0; y < Hh; y += rh) {
        for (const s of [-1, 1]) {
          ctx.save();
          ctx.translate(x + cw / 2 + s * 1.9, y + rh / 2);
          ctx.rotate(s * -0.55);
          ctx.fillStyle = loop(purl ? 0.45 : 1);
          ctx.beginPath();
          ctx.ellipse(0, 0, 1.9, 3.8, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  };
  const map = canvasTexture(`knit|${color}|${ribbed}`, W, Hh, (ctx) =>
    draw(ctx, shade(color, -0.14), (a) => (a < 1 ? shade(color, -0.07) : shade(color, 0.03)), 'rgba(0,0,0,0.35)'),
  );
  const bump = canvasTexture(
    `knitbump|${ribbed}`,
    W,
    Hh,
    (ctx) => draw(ctx, '#202020', (a) => `rgb(${Math.round(230 * a)},${Math.round(230 * a)},${Math.round(230 * a)})`, '#000'),
    false,
  );
  return { map, bump };
}

// ---------- Shared shapes ----------

function roundedRect(w: number, h: number, r: number, path: THREE.Path = new THREE.Shape()): THREE.Path {
  const x = -w / 2;
  const y = -h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

/** ExtrudeGeometry and ShapeGeometry give UVs in meters; map them to 0–1 over the shape. */
function fitUVs(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const uv = geo.attributes.uv!;
  const pos = geo.attributes.position!;
  const w = b.max.x - b.min.x || 1;
  const h = b.max.y - b.min.y || 1;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - b.min.x) / w, (pos.getY(i) - b.min.y) / h);
  uv.needsUpdate = true;
  return geo;
}

const tube = (points: THREE.Vector3[], radius: number, material: THREE.Material, closed = false, segs = 40) =>
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed, 'centripetal'), segs, radius, 8, closed), material);

/** A temple (arm) from the hinge, back along the side of the head, over and behind the ear. */
function templePoints(s: number, hingeX: number, y: number): THREE.Vector3[] {
  return [V(s * hingeX, y, 0.093), V(s * 0.072, y, 0.072), V(s * 0.086, y, 0.04), V(s * 0.093, y + 0.001, 0.005), V(s * 0.094, y - 0.004, -0.014), V(s * 0.089, y - 0.02, -0.027)];
}

// ---------- The accessories ----------

const metal = (color: number, roughness = 0.28) => new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness });

function glasses(group: THREE.Group): void {
  const acetate = new THREE.MeshPhysicalMaterial({ map: tortoiseTexture(), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15 });
  const lensMat = new THREE.MeshPhysicalMaterial({
    map: glintTexture(),
    transparent: true,
    roughness: 0.03,
    metalness: 0,
    clearcoat: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const silver = metal(0xd8d8dc);
  const W = 0.036;
  const H = 0.026;
  const rim = 0.0032;
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    // The front of the frame around one lens: a rounded rectangle with the lens hole cut out.
    const outer = roundedRect(W + rim * 2, H + rim * 2, 0.011) as THREE.Shape;
    outer.holes.push(roundedRect(W, H, 0.0085, new THREE.Path()));
    const frontGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.0028, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0005, bevelSegments: 2, curveSegments: 14 });
    frontGeo.translate(0, 0, -0.0014);
    const front = mesh(fitUVs(frontGeo), acetate);
    const lens = mesh(fitUVs(new THREE.ShapeGeometry(roundedRect(W + 0.001, H + 0.001, 0.009) as THREE.Shape, 14)), lensMat);
    lens.renderOrder = 2;
    // Decorative rivets (the hinge pins) on the outer top corner.
    const rivet = mesh(new THREE.CylinderGeometry(0.0011, 0.0011, 0.0008, 10), silver);
    rivet.rotation.x = Math.PI / 2;
    rivet.position.set(W / 2 - 0.001, H / 2 - 0.0005, 0.0018);
    eye.add(front, lens, rivet);
    eye.position.set(s * 0.033, 0.014, 0.101);
    eye.rotation.y = s * 0.12; // the frame wraps slightly around the face
    group.add(eye);
    // End piece and the metal hinge.
    const end = mesh(new THREE.BoxGeometry(0.009, 0.006, 0.004), acetate);
    end.position.set(s * 0.058, 0.0185, 0.096);
    end.rotation.y = s * 0.55;
    const hinge = mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.006, 8), silver);
    hinge.position.set(s * 0.062, 0.0185, 0.093);
    group.add(end, hinge);
    group.add(tube(templePoints(s, 0.063, 0.0185), 0.0017, acetate));
  }
  // Keyhole bridge arching over the nose.
  group.add(tube([V(-0.0128, 0.0105, 0.1015), V(-0.006, 0.0175, 0.1035), V(0.006, 0.0175, 0.1035), V(0.0128, 0.0105, 0.1015)], 0.0019, acetate, false, 16));
}

function sunglasses(group: THREE.Group): void {
  const gold = metal(0xcaa25a, 0.22);
  const tipMat = new THREE.MeshPhysicalMaterial({ color: 0x141210, roughness: 0.3, clearcoat: 0.8 });
  const lensMat = new THREE.MeshPhysicalMaterial({
    map: gradientLensTexture(),
    transparent: true,
    roughness: 0.04,
    metalness: 0.35,
    clearcoat: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const padMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, roughness: 0.2 });
  // The aviator teardrop (right lens; the left one is a mirror image). Outer edge is +x.
  const drop = new THREE.Shape();
  drop.moveTo(-0.019, 0.01);
  drop.bezierCurveTo(-0.008, 0.0135, 0.013, 0.0135, 0.0215, 0.0085);
  drop.bezierCurveTo(0.0265, 0.002, 0.0225, -0.012, 0.0125, -0.0175);
  drop.bezierCurveTo(0.004, -0.0215, -0.0125, -0.0195, -0.0175, -0.008);
  drop.bezierCurveTo(-0.0205, -0.002, -0.0212, 0.006, -0.019, 0.01);
  const outline = drop.getSpacedPoints(64).map((p) => V(p.x, p.y, 0));
  outline.pop();
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    const lens = mesh(fitUVs(new THREE.ShapeGeometry(drop, 24)), lensMat);
    lens.renderOrder = 2;
    eye.add(lens, tube(outline, 0.0011, gold, true, 96));
    eye.position.set(s * 0.034, 0.011, 0.101);
    eye.rotation.y = s * 0.1;
    eye.scale.x = s; // mirror for the left eye
    group.add(eye);
    // Nose pad on its little wire arm.
    group.add(tube([V(s * 0.0135, 0.012, 0.1012), V(s * 0.011, 0.006, 0.1005), V(s * 0.0095, 0.002, 0.0985)], 0.0006, gold, false, 10));
    const pad = mesh(new THREE.SphereGeometry(0.0042, 12, 8), padMat);
    pad.scale.set(0.35, 1, 0.7);
    pad.position.set(s * 0.0088, 0.001, 0.0975);
    pad.rotation.y = s * 0.5;
    group.add(pad);
    // Temple: thin gold wire with a dark acetate tip behind the ear.
    const pts = templePoints(s, 0.057, 0.02);
    pts[0] = V(s * 0.056, 0.02, 0.098);
    group.add(tube(pts.slice(0, 4), 0.0009, gold, false, 30));
    group.add(tube(pts.slice(3), 0.0016, tipMat, false, 16));
    const hinge = mesh(new THREE.BoxGeometry(0.004, 0.003, 0.004), gold);
    hinge.position.set(s * 0.056, 0.02, 0.097);
    group.add(hinge);
  }
  // Double bridge: the straight brow bar and the arched bridge below it.
  group.add(tube([V(-0.016, 0.0225, 0.1015), V(0, 0.0232, 0.1035), V(0.016, 0.0225, 0.1015)], 0.0009, gold, false, 16));
  group.add(tube([V(-0.0146, 0.0135, 0.1015), V(-0.005, 0.0175, 0.1035), V(0.005, 0.0175, 0.1035), V(0.0146, 0.0135, 0.1015)], 0.0011, gold, false, 16));
}

function cap(group: THREE.Group, color: string): void {
  const crownTex = capCrownTexture(color);
  const fabric = new THREE.MeshStandardMaterial({ map: crownTex, bumpMap: crownTex, bumpScale: 0.6, roughness: 0.92 });
  // Crown: the six-panel dome, sitting just above the brows and lower at the back.
  const dome = mesh(new THREE.SphereGeometry(0.104, 48, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), fabric, true);
  dome.position.set(0, 0.045, -0.006);
  dome.scale.set(0.93, 0.84, 1);
  dome.rotation.x = -0.12;
  // Top button and the binding around the bottom edge (children: they follow the dome's shape).
  const button = mesh(new THREE.SphereGeometry(0.0085, 16, 8), new THREE.MeshStandardMaterial({ color: shade(color, -0.04), roughness: 0.9 }));
  button.position.y = 0.104;
  button.scale.set(1, 0.5, 1);
  const binding = mesh(new THREE.TorusGeometry(0.1035, 0.0017, 6, 64), new THREE.MeshStandardMaterial({ color: shade(color, -0.1), roughness: 0.9 }));
  binding.rotation.x = Math.PI / 2;
  const buckle = mesh(new THREE.BoxGeometry(0.014, 0.008, 0.003), metal(0xb8b8bc, 0.35));
  buckle.position.set(0.016, 0.012, -0.103);
  dome.add(button, binding, buckle);
  group.add(dome);

  // Brim: a grid between the crown's front edge and a flatter front arc, curved down at the sides.
  const N = 40;
  const M = 8;
  const span = 1.22;
  const backEdge = (a: number) => V(Math.sin(a) * 0.0967, 0.045 + 0.0125 * Math.cos(a), Math.cos(a) * 0.103 - 0.006);
  const point = (a: number, t: number, lift: number) => {
    const b = backEdge(a);
    const reach = 0.074 * Math.max(0, Math.cos(a * 1.18)) ** 0.75;
    const x = b.x + Math.sin(a) * reach * 0.55;
    const z = b.z + Math.cos(a) * reach;
    const y = b.y - 0.006 * t - 0.013 * (x / 0.1) ** 2 * t + lift;
    return V(x, y, z);
  };
  const brimGeo = (lift: number) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= M; j++) {
      for (let i = 0; i <= N; i++) {
        const a = -span + (2 * span * i) / N;
        const p = point(a, j / M, lift);
        pos.push(p.x, p.y, p.z);
        uv.push(i / N, j / M);
      }
    }
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * (N + 1) + i;
        idx.push(k, k + N + 1, k + 1, k + 1, k + N + 1, k + N + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // One surface, two materials: the top faces up, the classic grey-green underside faces down.
  const brim = brimGeo(0);
  const top = mesh(brim, new THREE.MeshStandardMaterial({ map: brimTexture(shade(color, 0.03)), roughness: 0.9, side: THREE.FrontSide }), true);
  const under = mesh(brim, new THREE.MeshStandardMaterial({ color: 0x4f5e50, roughness: 0.95, side: THREE.BackSide }));
  const edgePts: THREE.Vector3[] = [];
  for (let i = 0; i <= 30; i++) edgePts.push(point(-span + (2 * span * i) / 30, 1, 0));
  const edge = tube(edgePts, 0.0019, new THREE.MeshStandardMaterial({ color: shade(color, -0.07), roughness: 0.9 }), false, 60);
  const seamPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 30; i++) seamPts.push(point(-span + (2 * span * i) / 30, 0, 0.0005));
  const seam = tube(seamPts, 0.0016, new THREE.MeshStandardMaterial({ color: shade(color, -0.12), roughness: 0.9 }), false, 60);
  group.add(top, under, edge, seam);
}

function beanie(group: THREE.Group, color: string): void {
  const knit = knitTextures(color, false);
  knit.map.repeat.set(2, 1);
  knit.bump.repeat.set(2, 1);
  const knitMat = new THREE.MeshStandardMaterial({ map: knit.map, bumpMap: knit.bump, bumpScale: 2.2, roughness: 1 });
  const crown = mesh(new THREE.SphereGeometry(R * 1.09, 48, 20, 0, Math.PI * 2, 0, Math.PI * 0.56), knitMat, true);
  crown.scale.set(0.93, 1.12, 1.0);
  crown.position.set(0, 0.03, -0.01);
  crown.rotation.x = -0.32;

  // The folded cuff: a thick rounded band with ribbing, turned up above the brows.
  const ribs = knitTextures(shade(color, -0.04), true);
  const cuffMap = ribs.map.clone();
  const cuffBump = ribs.bump.clone();
  cuffMap.repeat.set(2.2, 0.35);
  cuffBump.repeat.set(2.2, 0.35);
  cuffMap.needsUpdate = cuffBump.needsUpdate = true;
  const r0 = R * 1.035;
  const profile = [V(r0, -0.017, 0), V(r0 + 0.0045, -0.0165, 0), V(r0 + 0.0068, -0.012, 0), V(r0 + 0.0074, 0, 0), V(r0 + 0.0068, 0.012, 0), V(r0 + 0.0045, 0.0165, 0), V(r0, 0.017, 0)].map(
    (p) => new THREE.Vector2(p.x, p.y),
  );
  const cuffGroup = new THREE.Group();
  cuffGroup.position.set(0, 0.07, -0.018);
  cuffGroup.rotation.x = -0.32;
  const cuff = mesh(new THREE.LatheGeometry(profile, 64), new THREE.MeshStandardMaterial({ map: cuffMap, bumpMap: cuffBump, bumpScale: 2.6, roughness: 1 }), true);
  cuff.scale.set(0.93, 1, 1);
  // A small woven tag stitched to the cuff, off to one side.
  const tagTex = canvasTexture('beanie-tag', 128, 80, (ctx) => {
    ctx.fillStyle = '#e9dfc8';
    ctx.fillRect(0, 0, 128, 80);
    ctx.strokeStyle = 'rgba(80, 50, 20, 0.6)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, 116, 68);
    ctx.fillStyle = '#7a1e2c';
    ctx.font = 'bold 40px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('V♠A', 64, 42);
  });
  const a = 0.55;
  const tag = mesh(new THREE.BoxGeometry(0.02, 0.012, 0.0012), new THREE.MeshStandardMaterial({ map: tagTex, roughness: 0.8 }));
  tag.position.set(Math.sin(a) * (r0 + 0.0078) * 0.93, 0.001, Math.cos(a) * (r0 + 0.0078));
  tag.rotation.y = a * 0.85;
  cuffGroup.add(cuff, tag);

  // Pom-pom: a lumpy ball of yarn ends.
  const rand = rng(11);
  const pomGeo = new THREE.IcosahedronGeometry(0.025, 4);
  const p = pomGeo.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const v = V(p.getX(i), p.getY(i), p.getZ(i));
    v.multiplyScalar(1 + (rand() - 0.5) * 0.22);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  pomGeo.computeVertexNormals();
  const fluffTex = canvasTexture(
    'fluff',
    128,
    128,
    (ctx) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 128, 128);
      const r = rng(3);
      for (let i = 0; i < 900; i++) {
        const x = r() * 128;
        const y = r() * 128;
        const ang = r() * Math.PI * 2;
        const l = 3 + r() * 6;
        ctx.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l);
        ctx.stroke();
      }
    },
    false,
  );
  const pom = mesh(pomGeo, new THREE.MeshStandardMaterial({ color: shade(color, 0.1), bumpMap: fluffTex, bumpScale: 3, roughness: 1 }), true);
  pom.position.set(0, 0.142, -0.062);
  group.add(crown, cuffGroup, pom);
}

/** Adds the look's accessory (if any) to a head group. */
export function addAccessory(group: THREE.Group, look: Look): void {
  const extra = LOOK_OPTIONS.extra[look.extra] ?? 'None';
  const color = LOOK_OPTIONS.outfit[look.outfit] ?? LOOK_OPTIONS.outfit[0];
  if (extra === 'Glasses') glasses(group);
  else if (extra === 'Sunglasses') sunglasses(group);
  else if (extra === 'Cap') cap(group, color);
  else if (extra === 'Beanie') beanie(group, color);
}
