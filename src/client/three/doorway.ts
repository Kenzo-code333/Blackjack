// The doorways between the rooms: a carved archway with pilasters and a keystone, double
// doors standing open, a glimpse of the room beyond, velvet ropes on brass posts, a pair of
// lanterns and a clean plaque on the wall saying where it leads. Shared by all three rooms
// so every door in the game looks like it belongs to the same place.

import * as THREE from 'three';
import { canvasTex, roundRect } from './decor.js';
import { glowTexture, suitPath } from './textures.js';
import type { Room, WorldCtx } from './world-types.js';

export interface DoorwayOptions {
  /** Where the doorway is, on the wall (floor level). */
  x: number;
  z: number;
  /** +1 when the room is on the +z side of this wall, -1 for -z. */
  facing: 1 | -1;
  /** The room it leads to (sets the view through it, the colours and the plaque). */
  to: Room;
  /** 'classic' = dark wood and gold; 'neon' = dark metal with glowing blue edges (the Arcade). */
  style: 'classic' | 'neon';
}

const DEST: Record<Room, { title: string; sub: string; accent: string; glow: number }> = {
  casino: { title: 'CASINO', sub: 'Blackjack · Roulette · Poker · Slots', accent: '#e9c46a', glow: 0xffc46b },
  arcade: { title: 'ARCADE', sub: 'Free games · No chips needed', accent: '#6fe3ff', glow: 0x3bc8ff },
  lounge: { title: 'THE LOUNGE', sub: 'Couches · Friends · Chat', accent: '#ffcf8a', glow: 0xffb070 },
};

const W = 2.0; // the opening
const SPRING = 2.15; // where the arch starts
const R = W / 2;

export function buildDoorway(ctx: WorldCtx, o: DoorwayOptions): void {
  const d = DEST[o.to];
  const neon = o.style === 'neon';
  const g = new THREE.Group();
  g.position.set(o.x, 0, o.z);
  g.rotation.y = o.facing === 1 ? 0 : Math.PI;

  const frameMat = new THREE.MeshStandardMaterial(neon ? { color: 0x1b2036, metalness: 0.7, roughness: 0.35 } : { color: 0x3a1d10, roughness: 0.45 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af5a, metalness: 1, roughness: 0.28 });
  const trimMat = neon ? new THREE.MeshStandardMaterial({ color: 0x3bc8ff, emissive: 0x3bc8ff, emissiveIntensity: 1.4 }) : gold;

  // The view through the doorway, cut to the arch's shape.
  const view = new THREE.Mesh(
    new THREE.PlaneGeometry(W, SPRING + R),
    new THREE.MeshBasicMaterial({ map: vistaTexture(o.to), transparent: true, alphaTest: 0.5, toneMapped: false, fog: false }),
  );
  view.position.set(0, (SPRING + R) / 2, 0.02);
  g.add(view);

  // Pilasters with a base and a capital, either side of the opening.
  for (const s of [-1, 1]) {
    const px = s * (R + 0.16);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.3, SPRING, 0.2), frameMat);
    shaft.position.set(px, SPRING / 2, 0.1);
    const flute = new THREE.Mesh(new THREE.BoxGeometry(0.06, SPRING - 0.6, 0.02), trimMat);
    flute.position.set(px, SPRING / 2, 0.205);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.28), frameMat);
    base.position.set(px, 0.11, 0.12);
    const baseTrim = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.3), gold);
    baseTrim.position.set(px, 0.23, 0.12);
    const capital = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.3), gold);
    capital.position.set(px, SPRING - 0.02, 0.12);
    g.add(shaft, flute, base, baseTrim, capital);
  }
  // The arch, an inner edge, and a keystone.
  const arch = new THREE.Mesh(new THREE.TorusGeometry(R + 0.16, 0.15, 10, 40, Math.PI), frameMat);
  arch.position.set(0, SPRING, 0.1);
  arch.scale.z = 0.7;
  const inner = new THREE.Mesh(new THREE.TorusGeometry(R + 0.02, 0.03, 8, 40, Math.PI), trimMat);
  inner.position.set(0, SPRING, 0.2);
  const key = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.26), gold);
  key.position.set(0, SPRING + R + 0.1, 0.14);
  g.add(arch, inner, key);
  for (const s of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.03, SPRING, 0.06), trimMat);
    jamb.position.set(s * (R + 0.02), SPRING / 2, 0.2);
    g.add(jamb);
  }

  // Double doors standing open into the room: raised panels, a round window, brass handles.
  const leafMat = new THREE.MeshStandardMaterial(neon ? { color: 0x141a30, metalness: 0.6, roughness: 0.4 } : { color: 0x5a2a14, roughness: 0.5 });
  const panelMat = new THREE.MeshStandardMaterial(neon ? { color: 0x222a48, metalness: 0.5, roughness: 0.4 } : { color: 0x6e3a1e, roughness: 0.42 });
  const porthole = new THREE.MeshBasicMaterial({ color: d.glow, transparent: true, opacity: 0.55, toneMapped: false, fog: false });
  const LEAF = R - 0.02;
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(s * (R - 0.01), 0, 0.12);
    // Swung ~78° into the room.
    hinge.rotation.y = s * 1.36;
    const leaf = new THREE.Group();
    leaf.position.x = -s * (LEAF / 2);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(LEAF, SPRING - 0.06, 0.06), leafMat);
    slab.position.y = (SPRING - 0.06) / 2;
    leaf.add(slab);
    for (const face of [-1, 1]) {
      const low = new THREE.Mesh(new THREE.BoxGeometry(LEAF - 0.24, 0.7, 0.02), panelMat);
      low.position.set(0, 0.5, face * 0.035);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 8, 28), gold);
      ring.position.set(0, 1.55, face * 0.036);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.18, 28), porthole);
      glass.position.set(0, 1.55, face * 0.032);
      if (face < 0) glass.rotation.y = Math.PI;
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.34, 8), gold);
      handle.position.set(s * (LEAF / 2 - 0.1), 1.05, face * 0.07);
      leaf.add(low, ring, glass, handle);
    }
    const kick = new THREE.Mesh(new THREE.BoxGeometry(LEAF, 0.12, 0.075), gold);
    kick.position.y = 0.08;
    leaf.add(kick);
    hinge.add(leaf);
    g.add(hinge);
  }

  // A welcome mat in front, in the destination's colours.
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshStandardMaterial({ map: matTexture(o.to), roughness: 0.95 }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(0, 0.007, 0.75);
  g.add(mat);

  // Brass posts with a velvet rope, guiding you in.
  const brass = new THREE.MeshStandardMaterial({ color: 0xd8b25e, metalness: 1, roughness: 0.25 });
  const rope = new THREE.MeshStandardMaterial(neon ? { color: 0x1f6fd1, roughness: 0.6 } : { color: 0x8a0f24, roughness: 0.7 });
  for (const s of [-1, 1]) {
    const posts = [new THREE.Vector3(s * 1.75, 0, 0.45), new THREE.Vector3(s * 1.75, 0, 1.55)];
    for (const p of posts) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.95, 12), brass);
      post.position.copy(p).setY(0.475);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.04, 20), brass);
      base.position.copy(p).setY(0.02);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), brass);
      top.position.copy(p).setY(0.97);
      g.add(post, base, top);
    }
    const a = posts[0]!.clone().setY(0.88);
    const b = posts[1]!.clone().setY(0.88);
    const mid = a.clone().lerp(b, 0.5).setY(0.66);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 16, 0.022, 8), rope));
  }

  // Lanterns either side, glowing in the destination's colour.
  const glow = glowTexture();
  const lanternGlass = new THREE.MeshStandardMaterial({ color: 0xfff1d8, emissive: d.glow, emissiveIntensity: 1.1 });
  for (const s of [-1, 1]) {
    const lx = s * (R + 0.62);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.32, 0.03), gold);
    plate.position.set(lx, 1.95, 0.015);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.18), gold);
    arm.position.set(lx, 2.0, 0.1);
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.24, 6), lanternGlass);
    cage.position.set(lx, 1.92, 0.2);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.1, 6), gold);
    cap.position.set(lx, 2.09, 0.2);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: d.glow, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(0.8);
    halo.position.set(lx, 1.94, 0.22);
    g.add(plate, arm, cage, cap, halo);
  }

  // The plaque above: where this door leads, clean and easy to read.
  const plaqueY = SPRING + R + 0.58;
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.62, 0.05), neon ? frameMat : gold);
  back.position.set(0, plaqueY, 0.03);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.56), new THREE.MeshBasicMaterial({ map: plaqueTexture(o.to, neon), toneMapped: false, fog: false }));
  plaque.position.set(0, plaqueY, 0.06);
  const wash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: d.glow, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  wash.scale.set(3.4, 1.4, 1);
  wash.position.set(0, plaqueY, 0.02);
  g.add(wash, back, plaque);

  ctx.add(g);
  // Keep people out of the posts and the open doors.
  const toWorld = (lx: number, lz: number) => new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y).add(g.position);
  for (const [lx, lz, r] of [
    [-1.75, 0.45, 0.22],
    [-1.75, 1.55, 0.22],
    [1.75, 0.45, 0.22],
    [1.75, 1.55, 0.22],
    [-0.9, 0.55, 0.15],
    [0.9, 0.55, 0.15],
  ] as const) {
    const p = toWorld(lx, lz);
    ctx.collide(p.x, p.z, r);
  }
  // The lanterns flicker very gently.
  ctx.animate((_, t) => (lanternGlass.emissiveIntensity = 1.05 + Math.sin(t * 7.3) * 0.06 + Math.sin(t * 13.1) * 0.04));
}

// ---------- Pictures ----------

/** The glimpse of the next room, in the shape of the arch (transparent outside it). */
function vistaTexture(to: Room): THREE.CanvasTexture {
  const w = 256;
  const h = Math.round((256 * (SPRING + R)) / W);
  return canvasTex(w, h, (c) => {
    c.save();
    c.beginPath();
    c.moveTo(0, h);
    c.lineTo(0, w / 2);
    c.arc(w / 2, w / 2, w / 2, Math.PI, 0);
    c.lineTo(w, h);
    c.closePath();
    c.clip();
    let s = to.length * 97;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const bokeh = (cols: string[], n: number, ymin: number, ymax: number) => {
      for (let i = 0; i < n; i++) {
        const x = rand() * w;
        const y = ymin + rand() * (ymax - ymin);
        const r = 4 + rand() * 14;
        const gr = c.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, cols[i % cols.length]!);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = gr;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }
    };
    if (to === 'casino') {
      const bg = c.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#2a0d0a');
      bg.addColorStop(0.55, '#5a1d12');
      bg.addColorStop(1, '#3a120c');
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
      // A chandelier glow, table lamps and the green tables under them.
      const ch = c.createRadialGradient(w / 2, h * 0.18, 0, w / 2, h * 0.18, 90);
      ch.addColorStop(0, 'rgba(255, 230, 170, 0.9)');
      ch.addColorStop(1, 'rgba(255, 200, 120, 0)');
      c.fillStyle = ch;
      c.fillRect(0, 0, w, h);
      bokeh(['rgba(255, 214, 140, 0.9)', 'rgba(255, 120, 90, 0.7)', 'rgba(255, 240, 200, 0.8)'], 40, h * 0.1, h * 0.6);
      for (const [x, y, sc] of [
        [60, 0.68, 1],
        [196, 0.7, 1],
        [128, 0.6, 0.7],
      ] as const) {
        const cone = c.createLinearGradient(0, h * (y - 0.25), 0, h * y);
        cone.addColorStop(0, 'rgba(255, 220, 160, 0)');
        cone.addColorStop(1, 'rgba(255, 220, 160, 0.35)');
        c.fillStyle = cone;
        c.beginPath();
        c.moveTo(x - 6 * sc, h * (y - 0.25));
        c.lineTo(x + 6 * sc, h * (y - 0.25));
        c.lineTo(x + 46 * sc, h * y);
        c.lineTo(x - 46 * sc, h * y);
        c.fill();
        c.fillStyle = '#0f5a38';
        c.beginPath();
        c.ellipse(x, h * y, 48 * sc, 12 * sc, 0, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#2a120a';
        c.lineWidth = 4 * sc;
        c.stroke();
      }
      // The red carpet leading in.
      c.fillStyle = '#7a1424';
      c.beginPath();
      c.moveTo(w * 0.38, h * 0.62);
      c.lineTo(w * 0.62, h * 0.62);
      c.lineTo(w * 0.85, h);
      c.lineTo(w * 0.15, h);
      c.fill();
      c.strokeStyle = 'rgba(233, 196, 106, 0.8)';
      c.lineWidth = 3;
      c.stroke();
    } else if (to === 'arcade') {
      const bg = c.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#03041a');
      bg.addColorStop(0.6, '#0a0f3a');
      bg.addColorStop(1, '#050620');
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
      // Glowing cabinets along the sides and a big screen at the back.
      const scr = c.createLinearGradient(0, h * 0.2, 0, h * 0.45);
      scr.addColorStop(0, '#3bc8ff');
      scr.addColorStop(1, '#a24bff');
      c.fillStyle = scr;
      c.shadowColor = '#3bc8ff';
      c.shadowBlur = 30;
      c.fillRect(w * 0.28, h * 0.22, w * 0.44, h * 0.2);
      for (const [x, col] of [
        [18, '#ff4fd8'],
        [52, '#3bc8ff'],
        [190, '#7dff8a'],
        [222, '#ff4fd8'],
      ] as const) {
        c.fillStyle = col;
        c.shadowColor = col;
        c.fillRect(x, h * 0.42, 22, h * 0.2);
      }
      c.shadowBlur = 0;
      // A neon grid floor.
      c.strokeStyle = 'rgba(59, 200, 255, 0.55)';
      c.lineWidth = 1.5;
      const hz = h * 0.62;
      for (let i = -8; i <= 8; i++) {
        c.beginPath();
        c.moveTo(w / 2 + i * 8, hz);
        c.lineTo(w / 2 + i * 60, h);
        c.stroke();
      }
      for (let k = 0; k < 7; k++) {
        const y = hz + (h - hz) * Math.pow(k / 6, 1.7);
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
      }
      bokeh(['rgba(120, 220, 255, 0.8)', 'rgba(255, 90, 220, 0.7)'], 22, h * 0.05, h * 0.35);
    } else {
      const bg = c.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#24120a');
      bg.addColorStop(0.6, '#4a2414');
      bg.addColorStop(1, '#2a140a');
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
      // A fire's glow, a pendant lamp and a velvet couch.
      const fire = c.createRadialGradient(w * 0.2, h * 0.62, 0, w * 0.2, h * 0.62, 90);
      fire.addColorStop(0, 'rgba(255, 150, 60, 0.85)');
      fire.addColorStop(1, 'rgba(255, 120, 40, 0)');
      c.fillStyle = fire;
      c.fillRect(0, 0, w, h);
      const lamp = c.createRadialGradient(w * 0.62, h * 0.3, 0, w * 0.62, h * 0.3, 70);
      lamp.addColorStop(0, 'rgba(255, 225, 170, 0.9)');
      lamp.addColorStop(1, 'rgba(255, 200, 130, 0)');
      c.fillStyle = lamp;
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#6e1828';
      roundRect(c, w * 0.38, h * 0.56, w * 0.5, h * 0.09, 10);
      c.fill();
      roundRect(c, w * 0.36, h * 0.63, w * 0.54, h * 0.07, 8);
      c.fill();
      c.fillStyle = '#140805';
      c.fillRect(w * 0.4, h * 0.7, 6, 8);
      c.fillRect(w * 0.84, h * 0.7, 6, 8);
      bokeh(['rgba(255, 214, 140, 0.8)', 'rgba(255, 170, 90, 0.6)'], 18, h * 0.05, h * 0.5);
      // Parquet.
      c.fillStyle = 'rgba(120, 60, 30, 0.5)';
      c.fillRect(0, h * 0.74, w, h * 0.26);
    }
    // Light spilling out at the bottom and a soft vignette at the edges.
    const v = c.createRadialGradient(w / 2, h * 0.55, w * 0.25, w / 2, h * 0.55, w * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.65)');
    c.fillStyle = v;
    c.fillRect(0, 0, w, h);
    c.restore();
  });
}

/** The plaque: a small emblem, the room's name in spaced capitals, a thin rule, a short line. */
function plaqueTexture(to: Room, neon: boolean): THREE.CanvasTexture {
  const d = DEST[to];
  const w = 1024;
  const h = 250;
  return canvasTex(w, h, (c) => {
    const bg = c.createLinearGradient(0, 0, 0, h);
    if (neon) {
      bg.addColorStop(0, '#0b1030');
      bg.addColorStop(1, '#060820');
    } else {
      bg.addColorStop(0, '#1c120c');
      bg.addColorStop(1, '#0f0906');
    }
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    // A double border.
    c.strokeStyle = d.accent;
    c.lineWidth = 6;
    c.strokeRect(10, 10, w - 20, h - 20);
    c.globalAlpha = 0.45;
    c.lineWidth = 2;
    c.strokeRect(24, 24, w - 48, h - 48);
    c.globalAlpha = 1;
    // Corner diamonds.
    c.fillStyle = d.accent;
    for (const [x, y] of [
      [24, 24],
      [w - 24, 24],
      [24, h - 24],
      [w - 24, h - 24],
    ] as const) {
      c.beginPath();
      c.moveTo(x, y - 9);
      c.lineTo(x + 9, y);
      c.lineTo(x, y + 9);
      c.lineTo(x - 9, y);
      c.fill();
    }
    // The emblem on the left.
    const ex = 120;
    const ey = h / 2;
    c.strokeStyle = d.accent;
    c.lineWidth = 4;
    c.beginPath();
    c.arc(ex, ey, 62, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = d.accent;
    if (to === 'casino') {
      suitPath(c, 'S', ex, ey + 4, 70);
      c.fill();
    } else if (to === 'arcade') {
      // A joystick.
      c.fillRect(ex - 34, ey + 18, 68, 18);
      c.fillRect(ex - 4, ey - 22, 8, 42);
      c.beginPath();
      c.arc(ex, ey - 28, 15, 0, Math.PI * 2);
      c.fill();
    } else {
      suitPath(c, 'H', ex, ey + 4, 66);
      c.fill();
    }
    // The name and a short line, centred in the space to the right of the emblem.
    const cx = (220 + w - 40) / 2;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = d.accent;
    c.shadowBlur = neon ? 22 : 10;
    c.fillStyle = neon ? d.accent : '#f6e7c1';
    c.font = '700 92px "Playfair Display", Georgia, serif';
    const title = d.title.split('').join(String.fromCharCode(8202));
    c.fillText(title, cx, h * 0.4, w - 300);
    c.shadowBlur = 0;
    c.strokeStyle = d.accent;
    c.globalAlpha = 0.7;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx - 200, h * 0.63);
    c.lineTo(cx + 200, h * 0.63);
    c.stroke();
    c.globalAlpha = 1;
    c.fillStyle = 'rgba(240, 232, 214, 0.88)';
    c.font = '600 34px Inter, system-ui, sans-serif';
    c.fillText(d.sub.toUpperCase(), cx, h * 0.78, w - 320);
  });
}

/** A welcome mat: the destination's colour with a fine border and an emblem. */
function matTexture(to: Room): THREE.CanvasTexture {
  const d = DEST[to];
  return canvasTex(256, 128, (c) => {
    c.fillStyle = to === 'arcade' ? '#0d1a46' : to === 'casino' ? '#5c0f1b' : '#3a2416';
    c.fillRect(0, 0, 256, 128);
    c.strokeStyle = d.accent;
    c.lineWidth = 5;
    c.strokeRect(8, 8, 240, 112);
    c.lineWidth = 1.5;
    c.strokeRect(16, 16, 224, 96);
    c.fillStyle = d.accent;
    c.globalAlpha = 0.85;
    suitPath(c, to === 'lounge' ? 'H' : to === 'arcade' ? 'D' : 'S', 128, 66, 40);
    c.fill();
  });
}
