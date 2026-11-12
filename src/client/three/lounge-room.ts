// The Lounge: where everyone arrives. A cosy casino salon: burgundy damask walls over wood
// panelling, a gold-coffered ceiling with a crystal chandelier, a casino-carpet runner, velvet
// curtains around a night-city window, a crackling fireplace with candles, giant framed
// playing cards, a pair of giant dice turning on a velvet pedestal, a little bar shelf;
// two conversation corners with velvet couches around green-felt tables (chips and cards on
// them) where people (and a few bots) sit and chat; doorways to the Casino and the Arcade.

import * as THREE from 'three';
import { LOOK_OPTIONS, type Look, randomLook } from '../../shared/protocol.js';
import { blobShadow, canvasTex, makeSign } from './decor.js';
import { cardBackMaterial, cardFaceMaterial, glowTexture, suitPath, woodTexture } from './textures.js';
import { makeChip } from './pieces.js';
import { buildDoorway } from './doorway.js';
import { pottedPlant } from './plants.js';
import type { Suit } from '../../game/index.js';
import type { Station, WorldCtx } from './world-types.js';

export const LOUNGE_SIZE = { x: 9, z: 9, h: 4.2 };
export const LOUNGE_SPAWN = { pos: new THREE.Vector3(0, 0, 6.8), yaw: 0 };

const COUCH_COLORS = [0x1f5a43, 0x6e1828, 0x1d3266, 0x5a3a1c];

/** A couch's seats, in world space, given its center and the way it faces. */
function seatsOf(pos: THREE.Vector3, yaw: number): THREE.Vector3[] {
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  return [-0.7, 0, 0.7].map((o) => pos.clone().addScaledVector(right, o).addScaledVector(fwd, -0.12));
}

interface CouchSpec {
  id: string;
  pos: THREE.Vector3;
  yaw: number;
  color: number;
}

// Two corners, each with three couches around a coffee table.
const CORNERS = [new THREE.Vector3(-3.6, 0, -2.2), new THREE.Vector3(3.6, 0, -2.2)];
const COUCHES: CouchSpec[] = CORNERS.flatMap((c, ci) => [
  { id: `couch-${ci}-back`, pos: c.clone().add(new THREE.Vector3(0, 0, -1.55)), yaw: 0, color: COUCH_COLORS[ci * 2]! },
  { id: `couch-${ci}-left`, pos: c.clone().add(new THREE.Vector3(-1.75, 0, 0.2)), yaw: Math.PI / 2, color: COUCH_COLORS[ci * 2 + 1]! },
  { id: `couch-${ci}-right`, pos: c.clone().add(new THREE.Vector3(1.75, 0, 0.2)), yaw: -Math.PI / 2, color: COUCH_COLORS[(ci * 2 + 2) % 4]! },
]);

export const LOUNGE_STATIONS: Station[] = [
  ...COUCHES.map(
    (c): Station => ({ id: c.id, game: null, kind: 'couch', title: 'Couch', sub: 'Sit down and chat', pos: c.pos, yaw: c.yaw, radius: 0.55, span: 1.05, seats: seatsOf(c.pos, c.yaw) }),
  ),
  { id: 'door-casino', game: null, kind: 'door', to: 'casino', title: 'The Casino', sub: 'Blackjack · Roulette · Poker · Slots', pos: new THREE.Vector3(-4.6, 0, -8.6), yaw: 0, radius: 0.8 },
  { id: 'door-arcade', game: null, kind: 'door', to: 'arcade', title: 'The Arcade', sub: 'Free games · no chips needed', pos: new THREE.Vector3(4.6, 0, -8.6), yaw: 0, radius: 0.8 },
];

/** Which seats bots take (couch id → seat indexes). */
const BOT_SEATS: Record<string, number[]> = {
  'couch-0-back': [0, 2],
  'couch-0-left': [1],
  'couch-1-back': [1],
  'couch-1-right': [0, 2],
};

export function botSeats(): Set<string> {
  const taken = new Set<string>();
  for (const [id, idx] of Object.entries(BOT_SEATS)) for (const i of idx) taken.add(`${id}:${i}`);
  return taken;
}

// ---------- Textures ----------

function parquet(): THREE.CanvasTexture {
  const t = canvasTex(
    512,
    512,
    (ctx) => {
      const rand = (() => {
        let s = 9;
        return () => ((s = (s * 16807) % 2147483647) / 2147483647);
      })();
      for (let y = 0; y < 512; y += 32) {
        for (let x = (y / 32) % 2 ? -64 : 0; x < 512; x += 128) {
          const l = 30 + rand() * 12;
          ctx.fillStyle = `hsl(${24 + rand() * 6}, 45%, ${l}%)`;
          ctx.fillRect(x, y, 128, 32);
          ctx.strokeStyle = 'rgba(20, 10, 4, 0.55)';
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, 128, 32);
          ctx.strokeStyle = 'rgba(255, 220, 180, 0.06)';
          for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            ctx.moveTo(x, y + 6 + k * 6 + rand() * 3);
            ctx.lineTo(x + 128, y + 6 + k * 6 + rand() * 3);
            ctx.stroke();
          }
        }
      }
    },
    true,
  );
  t.repeat.set(6, 6);
  return t;
}

function rugTexture(hue: number): THREE.CanvasTexture {
  return canvasTex(512, 512, (ctx) => {
    ctx.fillStyle = `hsl(${hue}, 45%, 22%)`;
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = `hsla(40, 70%, 65%, 0.55)`;
    ctx.lineWidth = 10;
    ctx.strokeRect(24, 24, 464, 464);
    ctx.lineWidth = 3;
    ctx.strokeRect(46, 46, 420, 420);
    ctx.strokeStyle = `hsla(${hue + 20}, 60%, 55%, 0.5)`;
    for (let r = 40; r < 200; r += 36) {
      ctx.beginPath();
      ctx.ellipse(256, 256, r * 1.1, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

/** Burgundy damask with little gold card suits, like the walls of an old casino salon. */
function wallTexture(): THREE.CanvasTexture {
  const t = canvasTex(
    256,
    256,
    (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, '#4a1420');
      g.addColorStop(1, '#3a0f19');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      // Soft vertical stripes of the fabric.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      for (let x = 0; x < 256; x += 64) ctx.fillRect(x + 28, 0, 8, 256);
      // A diamond lattice with a suit in each diamond.
      ctx.strokeStyle = 'rgba(214, 170, 90, 0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [x, y] of [
        [128, 0],
        [256, 128],
        [128, 256],
        [0, 128],
        [128, 0],
      ]) ctx.lineTo(x!, y!);
      ctx.stroke();
      ctx.fillStyle = 'rgba(214, 170, 90, 0.3)';
      const suits: Suit[] = ['S', 'H', 'C', 'D'];
      for (const [i, [x, y]] of ([
        [128, 128],
        [0, 0],
        [256, 0],
        [0, 256],
        [256, 256],
      ] as const).entries()) {
        ctx.beginPath();
        suitPath(ctx, suits[i % 4]!, x, y, 30);
        ctx.fill();
      }
    },
    true,
  );
  return t;
}

/** A casino-carpet runner: deep red with a gold border, swirls and scattered suits. */
function runnerTexture(): THREE.CanvasTexture {
  const t = canvasTex(
    256,
    512,
    (ctx) => {
      ctx.fillStyle = '#5c0f1b';
      ctx.fillRect(0, 0, 256, 512);
      let s = 21;
      const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 26; i++) {
        ctx.strokeStyle = `hsla(${38 + rand() * 12}, 70%, ${45 + rand() * 15}%, 0.35)`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(rand() * 256, rand() * 512, 14 + rand() * 30, rand() * 6, rand() * 6 + 3);
        ctx.stroke();
      }
      const suits: Suit[] = ['S', 'H', 'D', 'C'];
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(240, 200, 110, 0.55)' : 'rgba(20, 60, 40, 0.8)';
        ctx.beginPath();
        suitPath(ctx, suits[i % 4]!, 64 + (i % 2) * 128, 32 + i * 64, 26);
        ctx.fill();
      }
      // The borders down both sides.
      ctx.fillStyle = '#c9a24c';
      ctx.fillRect(0, 0, 14, 512);
      ctx.fillRect(242, 0, 14, 512);
      ctx.fillStyle = '#1a3a2a';
      ctx.fillRect(18, 0, 6, 512);
      ctx.fillRect(232, 0, 6, 512);
    },
    true,
  );
  t.repeat.set(1, 6);
  return t;
}

/** Heavy velvet folds for the curtains. */
function velvetFolds(): THREE.CanvasTexture {
  return canvasTex(256, 64, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 256, 0);
    for (let i = 0; i <= 8; i++) {
      g.addColorStop(i / 8, i % 2 ? '#3d0a12' : '#8e1a2a');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 64);
  });
}

function skyline(): THREE.CanvasTexture {
  return canvasTex(1024, 384, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 384);
    g.addColorStop(0, '#0a0f2a');
    g.addColorStop(0.7, '#2a1a3e');
    g.addColorStop(1, '#4a2a3a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 384);
    let s = 3;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rand() * 0.8})`;
      ctx.fillRect(rand() * 1024, rand() * 150, 2, 2);
    }
    for (let x = 0; x < 1024; ) {
      const w = 30 + rand() * 70;
      const h = 80 + rand() * 220;
      ctx.fillStyle = `hsl(240, 25%, ${8 + rand() * 6}%)`;
      ctx.fillRect(x, 384 - h, w, h);
      for (let wy = 384 - h + 10; wy < 380; wy += 14) {
        for (let wx = x + 6; wx < x + w - 6; wx += 12) {
          if (rand() < 0.45) {
            ctx.fillStyle = rand() < 0.8 ? 'rgba(255, 210, 130, 0.85)' : 'rgba(160, 210, 255, 0.85)';
            ctx.fillRect(wx, wy, 6, 8);
          }
        }
      }
      x += w + 4;
    }
  });
}

// ---------- Building ----------

/** The room itself and all its lights (lights must exist from the start). */
export function buildLoungeShell(ctx: WorldCtx): void {
  const { x: X, z: Z, h: H } = LOUNGE_SIZE;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X * 2, Z * 2), new THREE.MeshStandardMaterial({ map: parquet(), roughness: 0.55 }));
  floor.rotation.x = -Math.PI / 2;
  ctx.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0x6b3a1e, roughness: 0.45 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af5a, metalness: 1, roughness: 0.3 });
  const panelMat = new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0x7a4426, roughness: 0.4 });
  for (const [wx, wz, ry, len] of [
    [0, -Z, 0, X * 2],
    [0, Z, Math.PI, X * 2],
    [-X, 0, Math.PI / 2, Z * 2],
    [X, 0, -Math.PI / 2, Z * 2],
  ] as const) {
    const g = new THREE.Group();
    g.position.set(wx, 0, wz);
    g.rotation.y = ry;
    const tex = (wallMat.map as THREE.Texture).clone();
    tex.repeat.set(len / 2, H / 2);
    tex.needsUpdate = true;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, H), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    wall.position.y = H / 2;
    const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.22, 0.05), trim);
    base.position.set(0, 0.11, 0.025);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.06), gold);
    rail.position.set(0, 1.0, 0.05);
    // Wood panelling below the rail, with raised panels.
    const wains = new THREE.Mesh(new THREE.BoxGeometry(len, 0.98, 0.03), trim);
    wains.position.set(0, 0.5, 0.015);
    g.add(wall, wains, base, rail);
    for (let px = -len / 2 + 0.6; px < len / 2 - 0.3; px += 1.2) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 0.02), panelMat);
      panel.position.set(px + 0.0, 0.58, 0.04);
      g.add(panel);
    }
    // A thin gold crown line under the ceiling.
    const crown = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.08), trim);
    crown.position.set(0, H - 0.06, 0.04);
    const crownGold = new THREE.Mesh(new THREE.BoxGeometry(len, 0.025, 0.09), gold);
    crownGold.position.set(0, H - 0.13, 0.045);
    g.add(crown, crownGold);
    ctx.add(g);
  }
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(X * 2, Z * 2), new THREE.MeshStandardMaterial({ color: 0x1a120d, roughness: 0.9 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  ctx.add(ceiling);

  // A coffered ceiling: dark wood beams edged in gold.
  for (let i = -X + 3; i < X; i += 3) {
    for (const along of ['x', 'z'] as const) {
      const beam = new THREE.Mesh(along === 'x' ? new THREE.BoxGeometry(X * 2, 0.16, 0.2) : new THREE.BoxGeometry(0.2, 0.16, Z * 2), trim);
      if (along === 'x') beam.position.set(0, H - 0.08, i);
      else beam.position.set(i, H - 0.08, 0);
      const edge = new THREE.Mesh(along === 'x' ? new THREE.BoxGeometry(X * 2, 0.02, 0.22) : new THREE.BoxGeometry(0.22, 0.02, Z * 2), gold);
      edge.position.copy(beam.position).setY(H - 0.165);
      ctx.add(beam, edge);
    }
  }

  // The casino-carpet runner from the entrance to the doorways.
  const runner = new THREE.Mesh(new THREE.PlaneGeometry(2.6, Z * 2 - 0.6), new THREE.MeshStandardMaterial({ map: runnerTexture(), roughness: 0.95 }));
  runner.rotation.x = -Math.PI / 2;
  runner.position.set(0, 0.004, 0);
  ctx.add(runner);

  // Velvet curtains on either side of the window, under a gold-trimmed pelmet.
  const velvet = new THREE.MeshStandardMaterial({ map: velvetFolds(), roughness: 0.8, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) {
    const drape = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 3.3, 24, 1, true, 0, Math.PI), velvet);
    drape.scale.z = 0.35;
    drape.position.set(sx * 2.85, 1.65, -Z + 0.18);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 24), gold);
    tie.rotation.x = Math.PI / 2;
    tie.scale.set(1.05, 0.4, 1);
    tie.position.set(sx * 2.85, 1.3, -Z + 0.2);
    ctx.add(drape, tie);
  }
  const pelmet = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.42, 0.2), velvet);
  pelmet.position.set(0, 3.38, -Z + 0.14);
  const pelmetGold = new THREE.Mesh(new THREE.BoxGeometry(6.45, 0.05, 0.22), gold);
  pelmetGold.position.set(0, 3.16, -Z + 0.15);
  ctx.add(pelmet, pelmetGold);
  ctx.collide(-2.85, -Z + 0.3, 0.4);
  ctx.collide(2.85, -Z + 0.3, 0.4);

  // A crystal chandelier over the middle of the room.
  const CH = new THREE.Vector3(0, H - 0.2, 0.6);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 8), gold);
  chain.position.copy(CH).setY(H - 0.25 / 1);
  const crystal = new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xffd9a0, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.05 });
  const ringY = H - 0.75;
  for (const [r, n, dy] of [
    [0.75, 22, 0],
    [0.5, 16, -0.22],
    [0.25, 10, -0.42],
  ] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 8, 48), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(CH.x, ringY + dy, CH.z);
    ctx.add(ring);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const drop = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), crystal);
      drop.scale.y = 1.8;
      drop.position.set(CH.x + Math.cos(a) * r, ringY + dy - 0.1, CH.z + Math.sin(a) * r);
      ctx.add(drop);
    }
    for (const k of [0, 1, 2, 3]) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, r, 6), gold);
      arm.rotation.z = Math.PI / 2;
      arm.rotation.y = -a;
      arm.position.set(CH.x + (Math.cos(a) * r) / 2, ringY + dy, CH.z + (Math.sin(a) * r) / 2);
      ctx.add(arm);
    }
  }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.8, 12), gold);
  stem.position.set(CH.x, ringY - 0.1, CH.z);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, H - ringY, 6), gold);
  rod.position.set(CH.x, (H + ringY) / 2, CH.z);
  ctx.add(stem, rod);
  const glowTex = glowTexture();
  const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe2b0, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  heart.scale.setScalar(2.2);
  heart.position.set(CH.x, ringY - 0.15, CH.z);
  ctx.add(heart);
  ctx.animate((_, t) => ((heart.material as THREE.SpriteMaterial).opacity = 0.65 + Math.sin(t * 2.3) * 0.06));

  // Brass wall sconces with warm glows along the side walls.
  const sconceMat = new THREE.MeshStandardMaterial({ color: 0xc9a24c, metalness: 1, roughness: 0.35 });
  const sconceGlow = new THREE.SpriteMaterial({ map: glowTex, color: 0xffc98a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const cupMat = new THREE.MeshStandardMaterial({ color: 0xfff0d8, emissive: 0xffc98a, emissiveIntensity: 0.9, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) {
    for (const z of [-5.6, 0.6, 6.4]) {
      const x = sx * (X - 0.06);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.14), sconceMat);
      plate.position.set(x, 2.2, z);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.05, 0.14, 16, 1, true), cupMat);
      cup.position.set(x - sx * 0.12, 2.36, z);
      const sp = new THREE.Sprite(sconceGlow);
      sp.scale.setScalar(0.9);
      sp.position.set(x - sx * 0.14, 2.42, z);
      ctx.add(plate, cup, sp);
    }
  }

  // The big window on the back wall, between the two doorways.
  const win = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.9), new THREE.MeshBasicMaterial({ map: skyline(), toneMapped: false, fog: false }));
  win.position.set(0, 2.1, -Z + 0.05);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.1, 0.06), trim);
  frame.position.set(0, 2.1, -Z + 0.01);
  for (const x of [-1.25, 0, 1.25]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.05), trim);
    bar.position.set(x, 2.1, -Z + 0.075);
    ctx.add(bar);
  }
  ctx.add(frame, win);

  // Doorways to the Casino and the Arcade.
  buildDoorway(ctx, { x: -4.6, z: -Z, facing: 1, to: 'casino', style: 'classic' });
  buildDoorway(ctx, { x: 4.6, z: -Z, facing: 1, to: 'arcade', style: 'classic' });

  // Fireplace on the left wall.
  const hearth = new THREE.Group();
  hearth.position.set(-X + 0.35, 0, 3.2);
  hearth.rotation.y = Math.PI / 2;
  const stone = new THREE.MeshStandardMaterial({ color: 0x5a524a, roughness: 0.95 });
  const mantel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.5), trim);
  mantel.position.y = 1.25;
  const surround = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 0.4), stone);
  surround.position.y = 0.6;
  const opening = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), new THREE.MeshBasicMaterial({ color: 0x120604 }));
  opening.position.set(0, 0.45, 0.205);
  const fireMat = new THREE.MeshBasicMaterial({ map: fireTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const fire = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), fireMat);
  fire.position.set(0, 0.42, 0.21);
  hearth.add(surround, mantel, opening, fire);
  ctx.add(hearth);
  ctx.collide(-X + 0.4, 3.2, 1.1);
  ctx.animate((_, t) => {
    fire.scale.y = 0.9 + Math.sin(t * 13) * 0.05 + Math.sin(t * 7.3) * 0.05;
    fireMat.opacity = 0.8 + Math.sin(t * 17) * 0.1;
  });

  // Lights: warm, low and cosy. All of them exist from the start.
  ctx.add(new THREE.HemisphereLight(0xffe0c0, 0x2a160c, 0.65));
  const fireLight = new THREE.PointLight(0xff8a3c, 6, 8, 1.8);
  fireLight.position.set(-X + 1.2, 0.8, 3.2);
  ctx.animate((_, t) => (fireLight.intensity = 5.5 + Math.sin(t * 11) * 0.8 + Math.sin(t * 5.7) * 0.6));
  ctx.add(fireLight);
  for (const c of CORNERS) {
    const lamp = new THREE.PointLight(0xffd6a0, 9, 9, 1.6);
    lamp.position.copy(c).setY(2.9);
    ctx.add(lamp);
  }
  const chandelier = new THREE.PointLight(0xffd2a0, 10, 11, 1.5);
  chandelier.position.set(0, LOUNGE_SIZE.h - 1.1, 0.6);
  ctx.add(chandelier);
  const door = new THREE.PointLight(0xaee8ff, 3, 6, 2);
  door.position.set(4.6, 2, -Z + 1);
  ctx.add(door);
  // Pendant shades over the two corners.
  const glow = glowTexture();
  for (const c of CORNERS) {
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.55, 0.35, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x1f3a30, side: THREE.DoubleSide, roughness: 0.5 }));
    shade.position.copy(c).setY(3.1);
    const bulb = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    bulb.scale.setScalar(1.1);
    bulb.position.copy(c).setY(2.92);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    cord.position.copy(c).setY(3.7);
    ctx.add(shade, bulb, cord);
  }
}

function fireTexture(): THREE.CanvasTexture {
  return canvasTex(256, 192, (ctx) => {
    for (let i = 0; i < 40; i++) {
      const x = 40 + Math.random() * 176;
      const g = ctx.createRadialGradient(x, 170, 0, x, 120, 70 + Math.random() * 30);
      g.addColorStop(0, 'rgba(255, 240, 180, 0.9)');
      g.addColorStop(0.3, 'rgba(255, 150, 40, 0.6)');
      g.addColorStop(1, 'rgba(200, 40, 0, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, 140, 18, 60, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** One couch: base, three seat cushions, back cushions, arms and little feet. */
function couch(c: CouchSpec): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(c.pos);
  g.rotation.y = c.yaw;
  const velvet = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(c.color).multiplyScalar(0.6), roughness: 0.9 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a160c, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.28, 0.9), dark);
  base.position.y = 0.22;
  g.add(base);
  for (const x of [-0.7, 0, 0.7]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.14, 0.72, 1, 1, 1), velvet);
    seat.position.set(x, 0.42, 0.04);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.48, 0.18), velvet);
    back.position.set(x, 0.66, -0.34);
    back.rotation.x = -0.12;
    g.add(seat, back);
  }
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.88), velvet);
    arm.position.set(s * 1.13, 0.5, 0);
    g.add(arm);
    for (const z of [-0.36, 0.36]) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.08, 8), wood);
      foot.position.set(s * 1.05, 0.04, z);
      g.add(foot);
    }
  }
  const pool = blobShadow(2.8, 1.4, 0.55);
  pool.position.z = 0.05;
  g.add(pool);
  return g;
}

/** A couch corner: three couches, a coffee table with drinks, a rug, the bots sitting there. */
export function buildCorner(ctx: WorldCtx, ci: number, stations: Station[]): void {
  const c = CORNERS[ci]!;
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 4.6), new THREE.MeshStandardMaterial({ map: rugTexture(ci ? 220 : 350), roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.copy(c).setY(0.006);
  ctx.add(rug);
  // A round card table: green felt in a padded leather rail, on a brass pedestal.
  const table = new THREE.Group();
  table.position.copy(c);
  const felt = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.05, 40), new THREE.MeshStandardMaterial({ color: 0x146b45, roughness: 0.95 }));
  felt.position.y = 0.42;
  const railRing = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 12, 48), new THREE.MeshStandardMaterial({ color: 0x3a1c10, roughness: 0.45 }));
  railRing.rotation.x = Math.PI / 2;
  railRing.position.y = 0.45;
  const brassRing = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.012, 6, 48), new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 1, roughness: 0.3 }));
  brassRing.rotation.x = Math.PI / 2;
  brassRing.position.y = 0.43;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 1, roughness: 0.3 }));
  leg.position.y = 0.2;
  table.add(felt, railRing, brassRing, leg);
  // Drinks, stacks of chips and a few cards left face up.
  const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05 });
  const drink = new THREE.MeshStandardMaterial({ color: 0xd9822b, transparent: true, opacity: 0.85, roughness: 0.1 });
  for (const [x, z] of [
    [0.3, 0.12],
    [-0.28, 0.2],
  ] as const) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.12, 16), glass);
    cup.position.set(x, 0.505, z);
    const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.032, 0.07, 16), drink);
    fill.position.set(x, 0.48, z);
    table.add(cup, fill);
  }
  // Each stack is one cylinder whose edge texture repeats once per chip (cheap to draw).
  const CHIP_SCALE = 2.2;
  for (const [x, z, value, n] of [
    [-0.1, -0.22, 25, 6],
    [0.06, -0.26, 100, 4],
    [0.2, -0.12, 500, 3],
  ] as const) {
    const [sideMat, topMat] = makeChip(value).material as THREE.MeshStandardMaterial[];
    const edge = sideMat!.map!.clone();
    edge.wrapS = edge.wrapT = THREE.RepeatWrapping;
    edge.repeat.set(1, n);
    edge.needsUpdate = true;
    const h = 0.0042 * CHIP_SCALE * n;
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.022 * CHIP_SCALE, 0.022 * CHIP_SCALE, h, 24), [new THREE.MeshStandardMaterial({ map: edge, roughness: 0.5 }), topMat!, topMat!]);
    stack.position.set(x, 0.447 + h / 2, z);
    stack.rotation.y = Math.random() * 6;
    table.add(stack);
  }
  const cards: [string, Suit][] = ci ? [['A', 'H'], ['K', 'H']] : [['A', 'S'], ['J', 'S']];
  for (const [i, [rank, suit]] of cards.entries()) {
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.07 * 2.2, 0.098 * 2.2), cardFaceMaterial({ rank: rank as 'A', suit }));
    card.rotation.set(-Math.PI / 2, 0, 0.3 - i * 0.35);
    card.position.set(-0.06 + i * 0.09, 0.447 + i * 0.001, 0.08);
    table.add(card);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.07 * 2.2, 0.03, 0.098 * 2.2), cardBackMaterial());
  deck.position.set(-0.3, 0.463, -0.12);
  deck.rotation.y = 0.4;
  table.add(deck);
  ctx.add(table, blobShadowAt(c, 1.6));
  ctx.collide(c.x, c.z, 0.65);
  for (const spec of COUCHES.filter((x) => x.id.startsWith(`couch-${ci}-`))) {
    ctx.add(couch(spec));
    const station = stations.find((s) => s.id === spec.id)!;
    // Collide along the couch.
    const right = new THREE.Vector3(Math.cos(spec.yaw), 0, -Math.sin(spec.yaw));
    for (const o of [-0.8, 0, 0.8]) {
      const p = spec.pos.clone().addScaledVector(right, o);
      ctx.collide(p.x, p.z, 0.45);
    }
    const pick = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 1), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.copy(spec.pos).setY(0.55);
    pick.rotation.y = spec.yaw;
    ctx.add(pick);
    ctx.pickable(pick, station);
    // Bots sitting there.
    for (const i of BOT_SEATS[spec.id] ?? []) {
      const look: Look = randomLook();
      look.extra = Math.random() < 0.5 ? 0 : 1 + Math.floor(Math.random() * (LOOK_OPTIONS.extra.length - 1));
      ctx.sitter(look, station.seats![i]!, spec.yaw, true);
    }
  }
}

function blobShadowAt(p: THREE.Vector3, size: number): THREE.Mesh {
  const m = blobShadow(size, size, 0.5);
  m.position.copy(p).setY(0.008);
  return m;
}

/** Plants, a sideboard with a record player, wall sconces. */
export function buildLoungeDecor(ctx: WorldCtx): void {
  const { x: X, z: Z } = LOUNGE_SIZE;
  // Palms in the corners, rubber plants either side of the window.
  for (const [i, [px, pz, kind]] of ([
    [-X + 0.95, -Z + 0.95, 'palm'],
    [X - 0.95, -Z + 0.95, 'palm'],
    [-X + 0.95, Z - 0.95, 'palm'],
    [X - 0.95, Z - 0.95, 'palm'],
    [-1.7, -Z + 0.7, 'leafy'],
    [1.7, -Z + 0.7, 'leafy'],
  ] as const).entries()) {
    const plant = pottedPlant(kind, 'cream', { height: 0.55, radius: 0.28, size: kind === 'palm' ? 1.15 : 1, seed: i + 3 });
    plant.position.set(px, 0, pz);
    plant.rotation.y = i * 1.3;
    ctx.add(plant);
    ctx.collide(px, pz, 0.45);
  }
  // Sideboard with a record player on the right wall.
  const sb = new THREE.Group();
  sb.position.set(X - 0.35, 0, 3);
  sb.rotation.y = -Math.PI / 2;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 0.5), new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0x8a5230, roughness: 0.4 }));
  cab.position.y = 0.4;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.35), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 }));
  deck.position.set(-0.5, 0.85, 0);
  const record = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 32), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2 }));
  record.position.set(-0.5, 0.91, 0);
  ctx.animate((dt) => (record.rotation.y += dt * 3.5));
  sb.add(cab, deck, record);
  ctx.add(sb);
  ctx.collide(X - 0.4, 2.2, 0.5);
  ctx.collide(X - 0.4, 3.8, 0.5);
  // Bottles on a glowing shelf above the sideboard: a little bar.
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 2.2), new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0x6b3a1e, roughness: 0.4 }));
  shelf.position.set(X - 0.16, 1.55, 3);
  const backGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.75), new THREE.MeshBasicMaterial({ color: 0xffb860, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  backGlow.rotation.y = -Math.PI / 2;
  backGlow.position.set(X - 0.03, 1.85, 3);
  ctx.add(shelf, backGlow);
  const bottleColors = [0x2f6a34, 0x7a2a12, 0xd9a03b, 0x3a1a4a, 0x8a1a22];
  const bottleMats = bottleColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 }));
  for (let i = 0; i < 9; i++) {
    const m = bottleMats[i % bottleMats.length]!;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.24 + (i % 3) * 0.04, 14), m);
    const z = 2.05 + i * 0.24;
    body.position.set(X - 0.17, 1.7 + (i % 3) * 0.02, z);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 0.1, 10), m);
    neck.position.set(X - 0.17, 1.88 + (i % 3) * 0.04, z);
    ctx.add(body, neck);
  }
  for (const z of [2.4, 3.6]) {
    const tumbler = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05 }));
    tumbler.position.set(X - 0.3, 0.845, z);
    ctx.add(tumbler);
  }

  // Giant playing cards in gold frames on the side walls.
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xc9a24c, metalness: 1, roughness: 0.3 });
  for (const [x, z, rank, suit] of [
    [-X, -4.4, 'A', 'S'],
    [-X, -0.4, 'K', 'H'],
    [X, -4.4, 'Q', 'D'],
    [X, -0.4, 'J', 'C'],
  ] as const) {
    const side = x < 0 ? 1 : -1;
    const g = new THREE.Group();
    g.position.set(x + side * 0.04, 2.25, z);
    g.rotation.y = (side * Math.PI) / 2;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.98, 1.32, 0.05), frameMat);
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.2), new THREE.MeshStandardMaterial({ color: 0x0f2a1e, roughness: 0.9 }));
    mat.position.z = 0.03;
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.98), cardFaceMaterial({ rank, suit }));
    card.position.z = 0.035;
    g.add(frame, mat, card);
    ctx.add(g);
  }

  // Candles and a little gold card stand on the mantel.
  const candleMat = new THREE.MeshStandardMaterial({ color: 0xf3ead6, roughness: 0.6 });
  const flameGlow = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb35c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const [dz, hgt] of [
    [-0.9, 0.22],
    [-0.75, 0.16],
    [0.8, 0.2],
    [0.95, 0.14],
  ] as const) {
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, hgt, 12), candleMat);
    candle.position.set(-X + 0.32, 1.31 + hgt / 2, 3.2 + dz);
    const f = new THREE.Sprite(flameGlow);
    f.scale.set(0.12, 0.2, 1);
    f.position.set(-X + 0.32, 1.33 + hgt + 0.05, 3.2 + dz);
    ctx.add(candle, f);
  }
  ctx.animate((_, t) => (flameGlow.opacity = 0.8 + Math.sin(t * 9) * 0.1 + Math.sin(t * 23) * 0.05));
  const mantelCard = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), cardFaceMaterial({ rank: 'A', suit: 'H' }));
  mantelCard.rotation.y = Math.PI / 2;
  mantelCard.rotation.z = 0;
  mantelCard.position.set(-X + 0.2, 1.68, 3.2);
  ctx.add(mantelCard);

  // The centrepiece: a velvet pedestal with two giant dice turning slowly under the chandelier.
  const ped = new THREE.Group();
  ped.position.set(0, 0, 0.6);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.12, 40), new THREE.MeshStandardMaterial({ color: 0xc9a24c, metalness: 1, roughness: 0.3 }));
  plinth.position.y = 0.06;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.5, 0.62, 40), new THREE.MeshStandardMaterial({ color: 0x6e1828, roughness: 0.85 }));
  drum.position.y = 0.43;
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.06, 40), new THREE.MeshStandardMaterial({ color: 0xc9a24c, metalness: 1, roughness: 0.3 }));
  lip.position.y = 0.77;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.02, 40), new THREE.MeshStandardMaterial({ color: 0x146b45, roughness: 0.95 }));
  top.position.y = 0.8;
  ped.add(plinth, drum, lip, top);
  ctx.add(ped, blobShadowAt(new THREE.Vector3(0, 0, 0.6), 1.6));
  ctx.collide(0, 0.6, 0.7);
  const dice: THREE.Mesh[] = [];
  for (const [i, [dx, dz]] of ([
    [-0.17, 0.05],
    [0.18, -0.05],
  ] as const).entries()) {
    // Each die has its own material, so it stays a separate (turning) object.
    const die = new THREE.Mesh(diceGeometry(0.26), diceMaterial(i));
    die.position.set(dx, 0.95 + i * 0.05, 0.6 + dz);
    die.rotation.set(0.3 * i, i * 0.8, 0.2);
    dice.push(die);
    ctx.add(die);
  }
  ctx.animate((dt, t) => {
    dice[0]!.rotation.y += dt * 0.35;
    dice[0]!.position.y = 0.97 + Math.sin(t * 1.3) * 0.025;
    dice[1]!.rotation.y -= dt * 0.28;
    dice[1]!.rotation.x = 0.3 + Math.sin(t * 0.7) * 0.15;
    dice[1]!.position.y = 1.0 + Math.sin(t * 1.3 + 2) * 0.025;
  });

  // Welcome sign above the entrance.
  const sign = makeSign('THE LOUNGE', 'Sit down, meet people, chat', '#ffd37a', 1);
  sign.position.set(0, 3.3, Z - 0.3);
  ctx.add(sign);
}

/** A cube whose six faces each show one cell of a 3×2 picture (see diceMaterial). */
function diceGeometry(size: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(size, size, size);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let face = 0; face < 6; face++) {
    const col = face % 3;
    const row = Math.floor(face / 3);
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      uv.setXY(i, (col + uv.getX(i)) / 3, (row + uv.getY(i)) / 2);
    }
  }
  return g;
}

/** A red casino die: one picture with all six faces (opposite faces add up to 7). */
function diceMaterial(which: number): THREE.MeshStandardMaterial {
  const pips: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.27, 0.27], [0.73, 0.73]],
    3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
    5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
    6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
  };
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
  const faces = [3, 4, 1, 6, 2, 5];
  const tex = canvasTex(384, 256, (ctx) => {
    faces.forEach((n, face) => {
      const ox = (face % 3) * 128;
      // Canvas rows run top-down while texture rows run bottom-up.
      const oy = (1 - Math.floor(face / 3)) * 128;
      const g = ctx.createRadialGradient(ox + 50, oy + 40, 10, ox + 64, oy + 64, 100);
      g.addColorStop(0, '#e2394a');
      g.addColorStop(1, '#9a1222');
      ctx.fillStyle = g;
      ctx.fillRect(ox, oy, 128, 128);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 6;
      ctx.strokeRect(ox + 3, oy + 3, 122, 122);
      ctx.fillStyle = '#fdf8ec';
      for (const [x, y] of pips[n]!) {
        ctx.beginPath();
        ctx.arc(ox + x * 128, oy + y * 128, 11, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  });
  // Its own material (`which`), so the die stays a separate, turning object.
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.18 });
  m.name = `die-${which}`;
  return m;
}
