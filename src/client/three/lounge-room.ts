// The Lounge: where everyone arrives. A warm room with a parquet floor, rugs, a crackling
// fireplace and a night-city window; two conversation corners with velvet couches where
// people (and a few bots) sit and chat; doorways to the Casino and the Arcade.

import * as THREE from 'three';
import { LOOK_OPTIONS, type Look, randomLook } from '../../shared/protocol.js';
import { blobShadow, canvasTex, makeSign } from './decor.js';
import { glowTexture, woodTexture } from './textures.js';
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

function wallTexture(): THREE.CanvasTexture {
  const t = canvasTex(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#16302a';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      for (let x = 0; x < 256; x += 32) ctx.fillRect(x, 0, 16, 256);
      ctx.strokeStyle = 'rgba(214, 170, 90, 0.18)';
      ctx.lineWidth = 2;
      ctx.strokeRect(16, 16, 224, 224);
    },
    true,
  );
  return t;
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
    rail.position.set(0, 1.0, 0.03);
    g.add(wall, base, rail);
    ctx.add(g);
  }
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(X * 2, Z * 2), new THREE.MeshStandardMaterial({ color: 0x1a120d, roughness: 0.9 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  ctx.add(ceiling);

  // The big window on the back wall, between the two doorways.
  const win = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.9), new THREE.MeshBasicMaterial({ map: skyline(), toneMapped: false }));
  win.position.set(0, 2.1, -Z + 0.03);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.1, 0.06), trim);
  frame.position.set(0, 2.1, -Z + 0.01);
  for (const x of [-1.25, 0, 1.25]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.05), trim);
    bar.position.set(x, 2.1, -Z + 0.06);
    ctx.add(bar);
  }
  ctx.add(frame, win);

  // Doorways: glowing archways with signs.
  for (const [x, color, title, sub] of [
    [-4.6, 0xffc46b, 'CASINO', 'Blackjack · Roulette · Poker'],
    [4.6, 0x3bc8ff, 'ARCADE', 'Free games'],
  ] as const) {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.6), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    glow.position.set(x, 1.3, -Z + 0.02);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 10, 40, Math.PI), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2 }));
    arch.position.set(x, 2.5, -Z + 0.08);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.5, 0.16), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2 }));
      post.position.set(x + s * 1.05, 1.25, -Z + 0.08);
      ctx.add(post);
    }
    const sign = makeSign(title, sub, color === 0x3bc8ff ? '#7fe3ff' : '#ffd37a', 0.75, color === 0x3bc8ff ? '#3bc8ff' : '#d9b45a');
    sign.position.set(x, 3.55, -Z + 0.3);
    ctx.add(glow, arch, sign);
  }

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
  const table = new THREE.Group();
  table.position.copy(c);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 40), new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0x7a4422, roughness: 0.35, metalness: 0.05 }));
  top.position.y = 0.42;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 1, roughness: 0.3 }));
  leg.position.y = 0.2;
  table.add(top, leg);
  // Drinks and a bowl of chips on the table.
  const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05 });
  const drink = new THREE.MeshStandardMaterial({ color: 0xd9822b, transparent: true, opacity: 0.85, roughness: 0.1 });
  for (const [x, z] of [
    [0.25, 0.1],
    [-0.2, 0.25],
    [-0.1, -0.3],
  ] as const) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.12, 16), glass);
    cup.position.set(x, 0.505, z);
    const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.032, 0.07, 16), drink);
    fill.position.set(x, 0.48, z);
    table.add(cup, fill);
  }
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.4, side: THREE.DoubleSide }));
  bowl.position.set(0, 0.57, 0);
  table.add(bowl);
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
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6a34, roughness: 0.7, side: THREE.DoubleSide });
  const potMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.4 });
  for (const [px, pz] of [
    [-X + 0.8, -Z + 0.8],
    [X - 0.8, -Z + 0.8],
    [-X + 0.8, Z - 0.8],
    [X - 0.8, Z - 0.8],
    [-1.7, -Z + 0.7],
    [1.7, -Z + 0.7],
  ] as const) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.55, 20), potMat);
    pot.position.set(px, 0.275, pz);
    ctx.add(pot);
    for (let i = 0; i < 8; i++) {
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.9), leafMat);
      const a = (i / 8) * Math.PI * 2;
      leaf.position.set(px + Math.cos(a) * 0.25, 1.0, pz + Math.sin(a) * 0.25);
      leaf.rotation.set(0.8, -a + Math.PI / 2, 0);
      ctx.add(leaf);
    }
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
  // Welcome sign above the entrance.
  const sign = makeSign('THE LOUNGE', 'Sit down, meet people, chat', '#ffd37a', 1);
  sign.position.set(0, 3.3, Z - 0.3);
  ctx.add(sign);
}
