// The Arcade: the casino's look in electric blue. A dark room with a glowing grid floor,
// a cosmic-carpet runner and neon strips; rows of cabinets for Orbit Hop, PolyRush and
// Gridiron Blitz; a giant screen for Game Night with a stage and benches; neon signs, a
// lighting truss with coloured spots, claw machines, an air-hockey table, a prize counter
// and palms in the corners. Everything here is free to play.

import * as THREE from 'three';
import { LOOK_OPTIONS, type Look, randomLook } from '../../shared/protocol.js';
import { blobShadow, canvasTex, makeSign } from './decor.js';
import { glowTexture } from './textures.js';
import type { Station, WorldCtx } from './world-types.js';
import { buildDoorway } from './doorway.js';
import { pottedPlant } from './plants.js';

export const ARCADE_SIZE = { x: 12, z: 12, h: 5 };
export const ARCADE_SPAWN = { pos: new THREE.Vector3(0, 0, 9.6), yaw: 0 };

const NEON = { cyan: 0x3be3ff, pink: 0xff5ad1, gold: 0xffd34d, blue: 0x3b6bff, green: 0x6dff7a };

type CabinetGame = 'orbit-hop' | 'polyrush' | 'gridiron-blitz';
const CABINET: Record<CabinetGame, { color: number; css: string; light: string; name: string }> = {
  'orbit-hop': { color: NEON.cyan, css: '#3be3ff', light: '#7fe3ff', name: 'ORBIT HOP' },
  polyrush: { color: NEON.pink, css: '#ff5ad1', light: '#ff9ae6', name: 'POLYRUSH' },
  'gridiron-blitz': { color: NEON.green, css: '#6dff7a', light: '#b4ffbc', name: 'GRIDIRON BLITZ' },
};

export const ARCADE_STATIONS: Station[] = [
  { id: 'arcade-orbit-hop', game: null, kind: 'arcade', arcade: 'orbit-hop', title: 'Orbit Hop', sub: 'Free play', pos: new THREE.Vector3(-7.2, 0, -1), yaw: Math.PI / 2, radius: 0.7, span: 1.6 },
  { id: 'arcade-gridiron-blitz', game: null, kind: 'arcade', arcade: 'gridiron-blitz', title: 'Gridiron Blitz', sub: 'Free play', pos: new THREE.Vector3(-7.2, 0, 5.2), yaw: Math.PI / 2, radius: 0.7, span: 1.6 },
  { id: 'arcade-polyrush', game: null, kind: 'arcade', arcade: 'polyrush', title: 'PolyRush', sub: 'Free play', pos: new THREE.Vector3(7.2, 0, -1), yaw: -Math.PI / 2, radius: 0.7, span: 1.6 },
  { id: 'arcade-game-night', game: null, kind: 'screen', arcade: 'game-night', title: 'Game Night', sub: 'The giant screen', pos: new THREE.Vector3(0, 0, -7.4), yaw: 0, radius: 1.2, span: 3 },
  { id: 'door-lounge-a', game: null, kind: 'door', to: 'lounge', title: 'The Lounge', sub: 'Back to the couches', pos: new THREE.Vector3(0, 0, 11.6), yaw: Math.PI, radius: 0.8 },
];

// ---------- Textures ----------

function gridFloor(): THREE.CanvasTexture {
  const t = canvasTex(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#05071a';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(59, 160, 255, 0.55)';
      ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(59, 160, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(128, 0, 0.5, 256);
      ctx.strokeRect(0, 128, 256, 0.5);
    },
    true,
  );
  t.repeat.set(12, 12);
  return t;
}

/** The art on a cabinet's screen and marquee. */
function cabinetArt(game: CabinetGame): { screen: THREE.CanvasTexture; marquee: THREE.CanvasTexture } {
  const screen = canvasTex(256, 320, (ctx) => {
    if (game === 'orbit-hop') {
      const g = ctx.createRadialGradient(128, 160, 10, 128, 160, 220);
      g.addColorStop(0, '#1a2a6a');
      g.addColorStop(1, '#050816');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 320);
      for (let i = 0; i < 80; i++) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random()})`;
        ctx.fillRect(Math.random() * 256, Math.random() * 320, 2, 2);
      }
      for (const [x, y, r, c] of [
        [70, 230, 34, '#ff7a59'],
        [180, 140, 26, '#59d6ff'],
        [90, 70, 20, '#ffd34d'],
      ] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.arc(x, y, r + 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(128, 196, 7, 0, Math.PI * 2);
      ctx.fill();
    } else if (game === 'gridiron-blitz') {
      // A stadium at night: crowd, floodlights, a green field with yard lines and players.
      const sky = ctx.createLinearGradient(0, 0, 0, 120);
      sky.addColorStop(0, '#060a1e');
      sky.addColorStop(1, '#1a2a4a');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 256, 120);
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = ['#ff4d5a', '#3be3ff', '#ffffff', '#ffd34d'][i % 4]!;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(Math.random() * 256, 70 + Math.random() * 50, 3, 3);
      }
      ctx.globalAlpha = 1;
      for (const x of [30, 226]) {
        const fl = ctx.createRadialGradient(x, 50, 2, x, 50, 40);
        fl.addColorStop(0, 'rgba(255,255,240,1)');
        fl.addColorStop(1, 'rgba(255,255,240,0)');
        ctx.fillStyle = fl;
        ctx.fillRect(x - 40, 10, 80, 80);
      }
      const field = ctx.createLinearGradient(0, 120, 0, 320);
      field.addColorStop(0, '#1f7a2e');
      field.addColorStop(1, '#2fa845');
      ctx.fillStyle = field;
      ctx.beginPath();
      ctx.moveTo(60, 120);
      ctx.lineTo(196, 120);
      ctx.lineTo(256, 320);
      ctx.lineTo(0, 320);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      for (let k = 0; k <= 6; k++) {
        const y = 120 + Math.pow(k / 6, 1.4) * 200;
        const half = 68 + (y - 120) * 0.3;
        ctx.beginPath();
        ctx.moveTo(128 - half, y);
        ctx.lineTo(128 + half, y);
        ctx.stroke();
      }
      for (const [x, y, c] of [
        [100, 200, '#ff4d5a'],
        [150, 230, '#ff4d5a'],
        [128, 270, '#3be3ff'],
        [80, 250, '#3be3ff'],
      ] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y - 10, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x - 7, y - 3, 14, 16);
      }
      ctx.fillStyle = '#7a3b17';
      ctx.beginPath();
      ctx.ellipse(160, 160, 9, 5, -0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, 320);
      g.addColorStop(0, '#2a0a3a');
      g.addColorStop(0.5, '#ff5ad1');
      g.addColorStop(0.52, '#1a1030');
      g.addColorStop(1, '#0a0618');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 320);
      ctx.fillStyle = '#2b2b3a';
      ctx.beginPath();
      ctx.moveTo(110, 165);
      ctx.lineTo(146, 165);
      ctx.lineTo(256, 320);
      ctx.lineTo(0, 320);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 4;
      ctx.setLineDash([16, 14]);
      ctx.beginPath();
      ctx.moveTo(128, 170);
      ctx.lineTo(128, 320);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#3be3ff';
      ctx.beginPath();
      ctx.moveTo(96, 290);
      ctx.lineTo(160, 290);
      ctx.lineTo(150, 250);
      ctx.lineTo(106, 250);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '800 22px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PRESS PLAY', 128, 30);
  });
  const marquee = canvasTex(512, 128, (ctx) => {
    ctx.fillStyle = '#0a0618';
    ctx.fillRect(0, 0, 512, 128);
    const color = CABINET[game].css;
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.fillStyle = color;
    ctx.font = '900 64px "Playfair Display", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(CABINET[game].name, 256, 66, 480);
  });
  return { screen, marquee };
}

function sweepTexture(): THREE.CanvasTexture {
  return canvasTex(64, 8, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 8);
  });
}

function giantScreenArt(): THREE.CanvasTexture {
  return canvasTex(1600, 800, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 1600, 800);
    g.addColorStop(0, '#2b2547');
    g.addColorStop(1, '#14102a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1600, 800);
    // The Game Night logo: four coloured dots.
    for (const [x, y, c] of [
      [690, 250, '#ef5b4f'],
      [910, 250, '#3b8bea'],
      [690, 430, '#3b8bea'],
      [910, 430, '#f6c343'],
    ] as const) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, 80, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 150px Inter, sans-serif';
    ctx.fillText('GAME NIGHT', 800, 680);
    ctx.font = '700 46px Inter, sans-serif';
    ctx.fillStyle = '#ffd34d';
    ctx.fillText('Walk up and press PLAY', 800, 760);
  });
}

// ---------- Building ----------

export function buildArcadeShell(ctx: WorldCtx): void {
  const { x: X, z: Z, h: H } = ARCADE_SIZE;
  const gridTex = gridFloor();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(X * 2, Z * 2),
    new THREE.MeshStandardMaterial({ map: gridTex, emissiveMap: gridTex, emissive: 0x3b6bff, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.3 }),
  );
  floor.rotation.x = -Math.PI / 2;
  ctx.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0b1030, roughness: 0.8 });
  for (const [wx, wz, ry, len] of [
    [0, -Z, 0, X * 2],
    [0, Z, Math.PI, X * 2],
    [-X, 0, Math.PI / 2, Z * 2],
    [X, 0, -Math.PI / 2, Z * 2],
  ] as const) {
    const g = new THREE.Group();
    g.position.set(wx, 0, wz);
    g.rotation.y = ry;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, H), wallMat);
    wall.position.y = H / 2;
    g.add(wall);
    // Neon strips: one low, one high, alternating cyan and pink.
    for (const [y, c] of [
      [0.25, NEON.cyan],
      [H - 0.4, NEON.pink],
    ] as const) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
      strip.position.set(0, y, 0.05);
      g.add(strip);
    }
    ctx.add(g);
  }
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(X * 2, Z * 2), new THREE.MeshStandardMaterial({ color: 0x05071a, roughness: 0.9 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  ctx.add(ceiling);
  // Light panels in the ceiling.
  const panelMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, toneMapped: false });
  for (const x of [-6, 0, 6]) {
    for (const z of [-6, 0, 6]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.25), panelMat);
      p.rotation.x = Math.PI / 2;
      p.position.set(x, H - 0.02, z);
      ctx.add(p);
    }
  }
  // The way back to the Lounge.
  buildDoorway(ctx, { x: 0, z: Z, facing: -1, to: 'lounge', style: 'neon' });

  // Lights: cool blues and pinks. All of them from the start.
  ctx.add(new THREE.HemisphereLight(0x8fb8ff, 0x0a0820, 0.7));
  for (const [x, z, c] of [
    [-6, -1, NEON.cyan],
    [6, -1, NEON.pink],
    [0, -6, 0xffffff],
    [0, 5, NEON.blue],
  ] as const) {
    const l = new THREE.PointLight(c, 10, 12, 1.6);
    l.position.set(x, 3.4, z);
    ctx.add(l);
  }
}

/** A row of three cabinets for one game, along a side wall. */
export function buildCabinets(ctx: WorldCtx, station: Station): void {
  const game = station.arcade as CabinetGame;
  const color = CABINET[game].color;
  const art = cabinetArt(game);
  const body = new THREE.MeshStandardMaterial({ color: 0x14102a, roughness: 0.35, metalness: 0.2 });
  const trim = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const screenMat = new THREE.MeshBasicMaterial({ map: art.screen, toneMapped: false });
  const marqueeMat = new THREE.MeshBasicMaterial({ map: art.marquee, toneMapped: false });
  const right = new THREE.Vector3(Math.cos(station.yaw), 0, -Math.sin(station.yaw));
  for (const o of [-1.1, 0, 1.1]) {
    const g = new THREE.Group();
    g.position.copy(station.pos).addScaledVector(right, o);
    g.rotation.y = station.yaw;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.9, 0.8), body);
    cab.position.set(0, 0.95, -0.25);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.78), screenMat);
    screen.position.set(0, 1.42, 0.16);
    screen.rotation.x = -0.18;
    const marquee = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.24), marqueeMat);
    marquee.position.set(0, 2.02, 0.16);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.3, 0.5), body);
    hood.position.set(0, 2.02, -0.08);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.12, 0.42), body);
    panel.position.set(0, 0.98, 0.3);
    panel.rotation.x = 0.25;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    stick.position.set(-0.18, 1.1, 0.3);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), new THREE.MeshStandardMaterial({ color: 0xff3b5c, roughness: 0.3 }));
    ball.position.set(-0.18, 1.17, 0.3);
    g.add(cab, screen, marquee, hood, panel, stick, ball);
    for (const [bx, bc] of [
      [0.06, 0x3be3ff],
      [0.16, 0xffd34d],
      [0.26, 0xff5ad1],
    ] as const) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), new THREE.MeshBasicMaterial({ color: bc, toneMapped: false }));
      b.position.set(bx, 1.06, 0.33);
      b.rotation.x = 0.25;
      g.add(b);
    }
    for (const s of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.9, 0.03), trim);
      edge.position.set(s * 0.43, 0.95, 0.16);
      g.add(edge);
    }
    const pool = blobShadow(1.2, 1.3, 0.6);
    g.add(pool);
    ctx.add(g);
    const p = g.position;
    ctx.collide(p.x, p.z, 0.6);
  }
  ctx.blink(trim, 1.2);
  const pick = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 1), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.copy(station.pos).setY(1.1);
  pick.rotation.y = station.yaw;
  ctx.add(pick);
  ctx.pickable(pick, station);
  const sign = makeSign(station.title.toUpperCase(), 'Free play', CABINET[game].light, 0.8, CABINET[game].css, 'rgba(4, 8, 30, 0.9)');
  sign.position.copy(station.pos).setY(3);
  ctx.add(sign);
  ctx.sign(sign, station);
}

/** The giant Game Night screen on the back wall, a stage, and benches with people watching. */
export function buildGiantScreen(ctx: WorldCtx, station: Station): void {
  const { z: Z } = ARCADE_SIZE;
  const screenMat = new THREE.MeshBasicMaterial({ map: giantScreenArt(), toneMapped: false });
  // The picture sits clearly in front of its frame (never on the same plane, which made
  // the two flicker as they fought over which one is drawn).
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(9.4, 4.9, 0.2), new THREE.MeshStandardMaterial({ color: 0x0a0a14, roughness: 0.4, metalness: 0.4 }));
  bezel.position.set(0, 2.6, -Z + 0.1);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), screenMat);
  screen.position.set(0, 2.6, -Z + 0.24);
  // A soft glow on the wall around the screen (behind it, never in front of the picture).
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(13, 7.5), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x6b8cff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.position.set(0, 2.6, -Z + 0.03);
  // A slow band of light sweeping across the screen, like a big display catching the room.
  const shine = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 4.5),
    new THREE.MeshBasicMaterial({ map: sweepTexture(), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  shine.position.set(0, 2.6, -Z + 0.26);
  shine.renderOrder = 2;
  ctx.animate((_, t) => {
    const k = (t * 0.12) % 1.6;
    shine.position.x = -5.5 + k * 7;
    shine.visible = k < 1.6 && Math.abs(shine.position.x) < 4.2;
  });
  // A low stage in front of it.
  const stage = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 2.2), new THREE.MeshStandardMaterial({ color: 0x14102a, roughness: 0.5 }));
  stage.position.set(0, 0.1, -Z + 1.2);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(10, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: NEON.gold, toneMapped: false }));
  edge.position.set(0, 0.2, -Z + 2.3);
  ctx.add(halo, bezel, screen, shine, stage, edge);
  for (let x = -4.8; x <= 4.8; x += 1.2) ctx.collide(x, -Z + 1.2, 0.7);
  // Benches with people watching.
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x1d2a66, roughness: 0.6 });
  for (const [bx, bz] of [
    [-3.2, -3.6],
    [3.2, -3.6],
  ] as const) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.42, 0.6), benchMat);
    bench.position.set(bx, 0.21, bz);
    const pool = blobShadow(2.8, 1.1, 0.5);
    pool.position.set(bx, 0.008, bz);
    ctx.add(bench, pool);
    ctx.collide(bx - 0.7, bz, 0.45);
    ctx.collide(bx + 0.7, bz, 0.45);
    for (const o of [-0.7, 0.7]) {
      const look: Look = randomLook();
      look.extra = Math.random() < 0.5 ? 0 : 1 + Math.floor(Math.random() * (LOOK_OPTIONS.extra.length - 1));
      ctx.sitter(look, new THREE.Vector3(bx + o, -0.02, bz + 0.05), Math.PI, true);
    }
  }
  const pick = new THREE.Mesh(new THREE.BoxGeometry(9.5, 5, 3), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(0, 2.5, -Z + 1);
  ctx.add(pick);
  ctx.pickable(pick, station);
}

// ---------- Decor ----------

/** A classic arcade carpet: near-black with neon squiggles, triangles and rings. */
function cosmicCarpet(): THREE.CanvasTexture {
  const t = canvasTex(
    256,
    256,
    (c) => {
      c.fillStyle = '#0a0620';
      c.fillRect(0, 0, 256, 256);
      let s = 5;
      const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const cols = ['#3be3ff', '#ff5ad1', '#ffd34d', '#6dff7a', '#8a5cff'];
      for (let i = 0; i < 46; i++) {
        c.strokeStyle = cols[i % cols.length]!;
        c.fillStyle = cols[(i + 2) % cols.length]!;
        c.lineWidth = 3;
        const x = rand() * 256;
        const y = rand() * 256;
        const kind = i % 4;
        c.beginPath();
        if (kind === 0) {
          c.moveTo(x, y);
          for (let k = 1; k < 5; k++) c.lineTo(x + k * 7, y + (k % 2 ? 7 : -7));
          c.stroke();
        } else if (kind === 1) {
          c.moveTo(x, y - 7);
          c.lineTo(x + 7, y + 6);
          c.lineTo(x - 7, y + 6);
          c.closePath();
          c.stroke();
        } else if (kind === 2) {
          c.arc(x, y, 6, 0, Math.PI * 2);
          c.stroke();
        } else {
          c.arc(x, y, 2.5, 0, Math.PI * 2);
          c.fill();
        }
      }
    },
    true,
  );
  t.repeat.set(2, 9);
  return t;
}

/** Glowing neon words (or a symbol) on a transparent background. */
function neonSign(lines: string[], color: string, w = 512, h = 192, font = '900 italic 92px Inter, system-ui, sans-serif'): THREE.CanvasTexture {
  return canvasTex(w, h, (c) => {
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = font;
    const step = h / (lines.length + 1);
    lines.forEach((line, i) => {
      const y = step * (i + 1);
      // A wide soft glow, then the bright tube, then a white-hot core.
      for (const [blur, col, width] of [
        [40, color, 10],
        [16, color, 6],
        [4, '#ffffff', 2],
      ] as const) {
        c.shadowColor = color;
        c.shadowBlur = blur;
        c.strokeStyle = col;
        c.lineWidth = width;
        c.strokeText(line, w / 2, y, w - 30);
      }
    });
  });
}

/** The high-score board. */
function scoreBoard(): THREE.CanvasTexture {
  return canvasTex(512, 640, (c) => {
    c.fillStyle = '#060818';
    c.fillRect(0, 0, 512, 640);
    c.strokeStyle = '#3be3ff';
    c.lineWidth = 8;
    c.strokeRect(10, 10, 492, 620);
    c.textAlign = 'center';
    c.shadowColor = '#ffd34d';
    c.shadowBlur = 18;
    c.fillStyle = '#ffd34d';
    c.font = '900 56px Inter, system-ui, sans-serif';
    c.fillText('HIGH SCORES', 256, 82);
    c.shadowBlur = 0;
    const rows: [string, string, string][] = [
      ['1ST', 'ACE', '98,450'],
      ['2ND', 'NEO', '87,120'],
      ['3RD', 'ZIP', '76,300'],
      ['4TH', 'MAX', '64,990'],
      ['5TH', 'JAZ', '52,410'],
      ['6TH', 'KAI', '41,075'],
      ['7TH', 'BO_', '33,600'],
    ];
    c.font = '800 38px "Courier New", monospace';
    rows.forEach(([rank, name, score], i) => {
      const y = 170 + i * 62;
      c.fillStyle = ['#ff5ad1', '#3be3ff', '#6dff7a', '#ffd34d'][i % 4]!;
      c.textAlign = 'left';
      c.fillText(rank, 50, y);
      c.fillText(name, 170, y);
      c.textAlign = 'right';
      c.fillText(score, 462, y);
    });
  });
}

// Shared materials, so the many small toys and lights merge into a few draw calls.
const plushMats = new Map<number, THREE.MeshStandardMaterial>();
const plushMat = (c: number) => {
  let m = plushMats.get(c);
  if (!m) plushMats.set(c, (m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 })));
  return m;
};

/** A claw machine: a lit base, a glass case full of plush toys, a claw, a marquee. */
function clawMachine(color: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const neon = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const body = new THREE.MeshStandardMaterial({ color: 0x1a1240, roughness: 0.4, metalness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8d0e0, roughness: 0.2, metalness: 1 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.95, 1), body);
  base.position.y = 0.475;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.01, 0.08, 1.01), neon);
  stripe.position.y = 0.8;
  const chute = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.02), new THREE.MeshBasicMaterial({ color: 0x05050c }));
  chute.position.set(0.25, 0.35, 0.51);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.96, 1.05, 0.96), new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2, depthWrite: false }));
  glass.position.y = 1.48;
  glass.renderOrder = 1;
  g.add(base, stripe, chute, glass);
  for (const [x, z] of [
    [-0.49, -0.49],
    [0.49, -0.49],
    [-0.49, 0.49],
    [0.49, 0.49],
  ] as const) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.08, 0.04), chrome);
    post.position.set(x, 1.48, z);
    g.add(post);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.3, 1.04), body);
  top.position.y = 2.15;
  const marquee = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 0.02), neon);
  marquee.position.set(0, 2.15, 0.53);
  g.add(top, marquee);
  // Plush toys: round bodies with little ears, in a heap.
  const plushCols = [0xff7aa8, 0x7ad6ff, 0xffe066, 0x9cff8a, 0xc59bff, 0xffa64d];
  let s = seed;
  const rand = () => ((s = (s * 16807 + 7) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const m = plushMat(plushCols[i % plushCols.length]!);
    const r = 0.09 + rand() * 0.04;
    const p = new THREE.Vector3((rand() - 0.5) * 0.7, 0.98 + r + (i > 8 ? 0.14 : 0), (rand() - 0.5) * 0.7);
    const toy = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), m);
    toy.position.copy(p);
    g.add(toy);
    for (const e of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(r * 0.35, 8, 6), m);
      ear.position.copy(p).add(new THREE.Vector3(e * r * 0.6, r * 0.8, 0));
      g.add(ear);
    }
  }
  // The claw, hanging from its gantry.
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.03), chrome);
  rail.position.set(0, 1.95, 0);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.4), chrome);
  cable.position.set(0.1, 1.75, 0);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.07, 12), chrome);
  hub.position.set(0.1, 1.53, 0);
  g.add(rail, cable, hub);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const prong = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.16, 0.015), chrome);
    prong.position.set(0.1 + Math.cos(a) * 0.05, 1.44, Math.sin(a) * 0.05);
    prong.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
    g.add(prong);
  }
  const joy = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: 0xff3b5c, roughness: 0.3 }));
  joy.position.set(-0.2, 1.02, 0.42);
  g.add(joy);
  return g;
}

/** An air-hockey table with glowing rails, a puck and two mallets. */
function airHockey(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x15123a, roughness: 0.4, metalness: 0.3 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.06, 1.25), new THREE.MeshStandardMaterial({ color: 0xe9f2ff, roughness: 0.2 }));
  top.position.y = 0.82;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 1.15), body);
  cab.position.y = 0.52;
  g.add(top, cab);
  for (const [x, z] of [
    [-0.95, -0.45],
    [0.95, -0.45],
    [-0.95, 0.45],
    [0.95, 0.45],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.1), body);
    leg.position.set(x, 0.13, z);
    g.add(leg);
  }
  const railMat = new THREE.MeshBasicMaterial({ color: NEON.cyan, toneMapped: false });
  for (const s of [-1, 1]) {
    const long = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.07, 0.05), railMat);
    long.position.set(0, 0.88, s * 0.63);
    const end = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 1.25), new THREE.MeshBasicMaterial({ color: NEON.pink, toneMapped: false }));
    end.position.set(s * 1.15, 0.88, 0);
    g.add(long, end);
  }
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 1.2), new THREE.MeshBasicMaterial({ color: 0xff3b5c }));
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.852;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.18, 32), new THREE.MeshBasicMaterial({ color: 0x3b6bff }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.852;
  const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 20), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
  puck.position.set(0.3, 0.86, 0.1);
  g.add(line, ring, puck);
  for (const [x, c] of [
    [-0.8, 0xff3b5c],
    [0.85, 0x3be3ff],
  ] as const) {
    const mallet = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.05, 20), new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 }));
    mallet.position.set(x, 0.875, -0.1);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.07, 12), new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 }));
    knob.position.set(x, 0.93, -0.1);
    g.add(mallet, knob);
  }
  return g;
}

/** A prize counter: a lit glass counter, shelves of plush prizes behind it, a neon sign. */
function prizeCounter(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x1a1240, roughness: 0.4, metalness: 0.3 });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.95, 0.7), body);
  counter.position.set(0, 0.475, 0.6);
  const glassTop = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, 0.72), new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.35, roughness: 0.05 }));
  glassTop.position.set(0, 0.97, 0.6);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.5), new THREE.MeshBasicMaterial({ color: NEON.pink, transparent: true, opacity: 0.5, toneMapped: false }));
  glow.position.set(0, 0.6, 0.96);
  g.add(counter, glassTop, glow);
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x2a2060, roughness: 0.5 });
  const plushCols = [0xff7aa8, 0x7ad6ff, 0xffe066, 0x9cff8a, 0xc59bff, 0xffa64d];
  for (const [k, y] of [1.2, 1.75, 2.3].entries()) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, 0.32), shelfMat);
    shelf.position.set(0, y, 0.16);
    g.add(shelf);
    for (let i = 0; i < 9; i++) {
      const m = plushMat(plushCols[(i + k) % plushCols.length]!);
      const r = 0.1 + ((i * 7 + k) % 3) * 0.02;
      const toy = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), m);
      toy.position.set(-1.4 + i * 0.35, y + r + 0.02, 0.16);
      g.add(toy);
      for (const e of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(r * 0.35, 8, 6), m);
        ear.position.set(-1.4 + i * 0.35 + e * r * 0.6, y + r * 1.8 + 0.02, 0.16);
        g.add(ear);
      }
    }
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: neonSign(['PRIZES'], '#ff5ad1'), transparent: true, toneMapped: false, fog: false, depthWrite: false }));
  sign.position.set(0, 3.25, 0.03);
  g.add(sign);
  return g;
}

/** Neon signs, a lighting truss, claw machines, air hockey, a prize counter, stools and palms. */
export function buildArcadeDecor(ctx: WorldCtx): void {
  const { x: X, z: Z, h: H } = ARCADE_SIZE;

  // The cosmic-carpet runner from the door to the stage.
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 19), new THREE.MeshStandardMaterial({ map: cosmicCarpet(), roughness: 0.95 }));
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, 0.006, 1.6);
  const edgeMat = new THREE.MeshBasicMaterial({ color: NEON.blue, toneMapped: false });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 19), edgeMat);
    e.rotation.x = -Math.PI / 2;
    e.position.set(s * 1.72, 0.008, 1.6);
    ctx.add(e);
  }
  ctx.add(carpet);

  // Neon signs on the walls.
  const signAt = (tex: THREE.CanvasTexture, w: number, hgt: number, x: number, y: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, fog: false, depthWrite: false }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    ctx.add(m);
  };
  signAt(neonSign(['GAME ON'], '#ff5ad1'), 3.4, 1.27, -X + 0.04, 3.1, -6.8, Math.PI / 2);
  signAt(neonSign(['INSERT', 'COIN'], '#3be3ff', 512, 256), 2.6, 1.3, -X + 0.04, 3.1, 9.2, Math.PI / 2);
  signAt(neonSign(['LEVEL UP'], '#ffd34d'), 3.4, 1.27, X - 0.04, 3.1, -6.8, -Math.PI / 2);
  signAt(neonSign(['PLAYER 1', 'READY'], '#6dff7a', 512, 256), 2.6, 1.3, X - 0.04, 3.1, 9.2, -Math.PI / 2);
  signAt(neonSign(['★'], '#ff5ad1', 256, 256, '900 200px Inter, system-ui, sans-serif'), 1.1, 1.1, -X + 0.04, 3.2, 2.2, Math.PI / 2);
  signAt(neonSign(['⚡'], '#ffd34d', 256, 256, '900 200px Inter, system-ui, sans-serif'), 1.1, 1.1, X - 0.04, 3.2, 2.2, -Math.PI / 2);

  // The high-score board on the back wall, left of the giant screen.
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.75), new THREE.MeshBasicMaterial({ map: scoreBoard(), toneMapped: false, fog: false }));
  board.position.set(-8.2, 2.4, -Z + 0.04);
  const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(2.36, 2.9, 0.06), new THREE.MeshStandardMaterial({ color: 0x14102a, metalness: 0.5, roughness: 0.4 }));
  boardFrame.position.set(-8.2, 2.4, -Z + 0.01);
  ctx.add(boardFrame, board);

  // The prize counter on the back wall, right of the screen.
  const prizes = prizeCounter();
  prizes.position.set(8.2, 0, -Z + 0.05);
  ctx.add(prizes);
  for (const x of [7, 8.2, 9.4]) ctx.collide(x, -Z + 0.7, 0.5);

  // Claw machines along the right wall, across from Gridiron Blitz.
  for (const [i, z] of [4.3, 5.5, 6.7].entries()) {
    const claw = clawMachine([NEON.pink, NEON.cyan, NEON.gold][i]!, 11 + i * 17);
    claw.position.set(7.6, 0, z);
    claw.rotation.y = -Math.PI / 2;
    ctx.add(claw);
    ctx.collide(7.6, z, 0.55);
  }

  // Air hockey in the open space on the right.
  const hockey = airHockey();
  hockey.position.set(3.9, 0, 2.2);
  hockey.rotation.y = 0.15;
  ctx.add(hockey);
  ctx.collide(3.4, 2.2, 0.6);
  ctx.collide(4.4, 2.2, 0.6);

  // Stools in front of every cabinet.
  const seat = new THREE.MeshStandardMaterial({ color: 0x2a1a5a, roughness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xc8d0e0, metalness: 1, roughness: 0.25 });
  for (const [x, zs, dir] of [
    [-7.2, [-2.1, -1, 0.1], 1],
    [-7.2, [4.1, 5.2, 6.3], 1],
    [7.2, [-2.1, -1, 0.1], -1],
  ] as const) {
    for (const z of zs) {
      const sx = x + dir * 0.95;
      const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.08, 20), seat);
      cushion.position.set(sx, 0.66, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 8), steel);
      pole.position.set(sx, 0.31, z);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.03, 20), steel);
      foot.position.set(sx, 0.015, z);
      const ringFoot = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 20), steel);
      ringFoot.rotation.x = Math.PI / 2;
      ringFoot.position.set(sx, 0.3, z);
      ctx.add(cushion, pole, foot, ringFoot);
    }
  }

  // A lighting truss across the room with coloured spots and soft beams.
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b8, metalness: 1, roughness: 0.3 });
  const beams = new Map<number, THREE.MeshBasicMaterial>();
  const beamMat = (c: number) => {
    let m = beams.get(c);
    if (!m) beams.set(c, (m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })));
    return m;
  };
  const canMat = new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.5 });
  const pools = new Map<number, THREE.MeshBasicMaterial>();
  const poolMat = (c: number) => {
    let m = pools.get(c);
    if (!m) pools.set(c, (m = new THREE.MeshBasicMaterial({ map: glowTexture(), color: c, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    return m;
  };
  const glow = glowTexture();
  for (const tz of [-2.6, 4.6]) {
    for (const dy of [0, 0.3]) {
      for (const dz of [-0.15, 0.15]) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, X * 2 - 1), trussMat);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0, H - 0.75 + dy, tz + dz);
        ctx.add(bar);
      }
    }
    for (let x = -X + 1; x <= X - 1; x += 0.6) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42), trussMat);
      strut.position.set(x, H - 0.6, tz);
      strut.rotation.x = 0.8;
      ctx.add(strut);
    }
    for (const [i, x] of [-7.5, -3.5, 3.5, 7.5].entries()) {
      const c = [NEON.pink, NEON.cyan, NEON.gold, NEON.green][(i + (tz > 0 ? 1 : 0)) % 4]!;
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.3, 14), canMat);
      can.position.set(x, H - 0.98, tz);
      const lens = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      lens.scale.setScalar(0.5);
      lens.position.set(x, H - 1.15, tz);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(1.1, H - 1.1, 24, 1, true), beamMat(c));
      beam.position.set(x, (H - 1.1) / 2, tz);
      // A round pool of light on the floor under it.
      const pool = new THREE.Mesh(new THREE.CircleGeometry(1.0, 32), poolMat(c));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.012, tz);
      ctx.add(can, lens, beam, pool);
    }
  }

  // Palms in the corners and either side of the way in.
  for (const [i, [px, pz]] of ([
    [-X + 0.9, -Z + 0.9],
    [-X + 0.9, Z - 0.9],
    [X - 0.9, Z - 0.9],
    [-2.8, Z - 1.1],
    [2.8, Z - 1.1],
  ] as const).entries()) {
    const plant = pottedPlant('palm', 'black', { height: 0.6, radius: 0.3, size: 1.3, seed: 40 + i });
    plant.position.set(px, 0, pz);
    plant.rotation.y = i * 1.9;
    ctx.add(plant);
    ctx.collide(px, pz, 0.5);
  }
}
