// The Arcade: the casino's look in electric blue. A dark room with a glowing grid floor
// and neon strips; rows of cabinets for Orbit Hop and PolyRush; and a giant screen for
// Game Night with a stage and benches in front of it. Everything here is free to play.

import * as THREE from 'three';
import { LOOK_OPTIONS, type Look, randomLook } from '../../shared/protocol.js';
import { blobShadow, canvasTex, makeSign } from './decor.js';
import { glowTexture } from './textures.js';
import type { Station, WorldCtx } from './world-types.js';
import { buildDoorway } from './doorway.js';

export const ARCADE_SIZE = { x: 12, z: 12, h: 5 };
export const ARCADE_SPAWN = { pos: new THREE.Vector3(0, 0, 9.6), yaw: 0 };

const NEON = { cyan: 0x3be3ff, pink: 0xff5ad1, gold: 0xffd34d, blue: 0x3b6bff };

export const ARCADE_STATIONS: Station[] = [
  { id: 'arcade-orbit-hop', game: null, kind: 'arcade', arcade: 'orbit-hop', title: 'Orbit Hop', sub: 'Free play', pos: new THREE.Vector3(-7.2, 0, -1), yaw: Math.PI / 2, radius: 0.7, span: 1.6 },
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
function cabinetArt(game: 'orbit-hop' | 'polyrush'): { screen: THREE.CanvasTexture; marquee: THREE.CanvasTexture } {
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
    const color = game === 'orbit-hop' ? '#3be3ff' : '#ff5ad1';
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.fillStyle = color;
    ctx.font = '900 64px "Playfair Display", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(game === 'orbit-hop' ? 'ORBIT HOP' : 'POLYRUSH', 256, 66);
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
  const game = station.arcade as 'orbit-hop' | 'polyrush';
  const color = game === 'orbit-hop' ? NEON.cyan : NEON.pink;
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
  const sign = makeSign(station.title.toUpperCase(), 'Free play', game === 'orbit-hop' ? '#7fe3ff' : '#ff9ae6', 0.8, game === 'orbit-hop' ? '#3be3ff' : '#ff5ad1', 'rgba(4, 8, 30, 0.9)');
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
