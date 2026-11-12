// The rooms you walk around: the Lounge (where you arrive: couches, people chatting), the
// Casino (carpet, chandeliers, game tables with dealers, slot machines, the cashier) and the
// Arcade (blue neon, free games). Walk up to something and its card opens; doorways take
// you to the other rooms; on a couch you can sit down.
//
// Controls: WASD / arrow keys to walk, drag to look, click a table to walk to it.
// On touch screens: a stick on the left to walk, drag on the right to look, tap a table.

import * as THREE from 'three';
import { LOOK_OPTIONS, type Look, randomLook } from '../../shared/protocol.js';
import { Avatar } from './avatar.js';
import { Walker } from './walker.js';
import { Dealer } from './dealer.js';
import { addEnvironmentLight, warmUp } from './env-light.js';
import { mergeStatic, simplifyMaterials } from './bake.js';
import { buildEnvironment } from './environment.js';
import { TABLE_Y } from './layout.js';
import { buildPokerTable } from './poker-scene.js';
import { buildRouletteTable, buildWheel } from './roulette-scene.js';
import { carpetTexture, glowTexture, setMaxAnisotropy, woodTexture } from './textures.js';
import { ARCADE_SIZE, ARCADE_SPAWN, ARCADE_STATIONS, buildArcadeShell, buildCabinets, buildGiantScreen } from './arcade-room.js';
import { blobShadow, canvasTex, makeSign } from './decor.js';
import { LOUNGE_SIZE, LOUNGE_SPAWN, LOUNGE_STATIONS, botSeats, buildCorner, buildLoungeDecor, buildLoungeShell } from './lounge-room.js';
import type { Room, Station, StationId, WorldCtx } from './world-types.js';
import { Animator, damp } from './tween.js';

export type { Room, Station, StationId } from './world-types.js';

const ROOM_X = 12;
const ROOM = { x: ROOM_X, z: 12, h: 4.6 };

export const STATIONS: Station[] = [
  { id: 'blackjack-solo', game: 'blackjack', title: 'Blackjack', sub: 'Solo table · you vs the dealer', pos: new THREE.Vector3(-5.2, 0, -0.5), yaw: 0.5, radius: 1.75 },
  { id: 'blackjack', game: 'blackjack', title: 'Blackjack', sub: 'Join the players · bring friends', pos: new THREE.Vector3(-5.6, 0, -6.6), yaw: 0.35, radius: 1.75 },
  { id: 'roulette', game: 'roulette', title: 'Roulette', sub: 'Red, black or green?', pos: new THREE.Vector3(0, 0, -6.2), yaw: 0, radius: 1.9 },
  { id: 'poker', game: 'poker', title: 'Texas Hold’em', sub: 'No limit · blinds 5/10', pos: new THREE.Vector3(5.4, 0, -1.2), yaw: -0.55, radius: 1.75 },
  { id: 'cashier', game: null, kind: 'cashier', title: 'Cashier', sub: 'Cash out your chips', pos: new THREE.Vector3(7.5, 0, -11.4), yaw: 0, radius: 1.3 },
  { id: 'slots-left', game: null, kind: 'slots', title: 'Slot machines', sub: 'Line up three of a kind', pos: new THREE.Vector3(-ROOM_X + 0.55, 0, -5.85), yaw: Math.PI / 2, radius: 0.8, span: 3.3 },
  { id: 'slots-right', game: null, kind: 'slots', title: 'Slot machines', sub: 'Line up three of a kind', pos: new THREE.Vector3(ROOM_X - 0.55, 0, -5.45), yaw: -Math.PI / 2, radius: 0.8, span: 3.3 },
  { id: 'door-lounge', game: null, kind: 'door', to: 'lounge', title: 'The Lounge', sub: 'Back to the couches', pos: new THREE.Vector3(0, 0, 11.6), yaw: Math.PI, radius: 0.8 },
];

/** Each room: its size, where you arrive, what's in it. */
const ROOMS: Record<Room, { size: { x: number; z: number; h: number }; spawn: { pos: THREE.Vector3; yaw: number }; stations: Station[]; bg: number; fog: [number, number] }> = {
  casino: { size: ROOM, spawn: { pos: new THREE.Vector3(0, 0, 9.5), yaw: 0 }, stations: STATIONS, bg: 0x0b0706, fog: [9, 26] },
  lounge: { size: LOUNGE_SIZE, spawn: LOUNGE_SPAWN, stations: LOUNGE_STATIONS, bg: 0x0d0805, fog: [10, 24] },
  arcade: { size: ARCADE_SIZE, spawn: ARCADE_SPAWN, stations: ARCADE_STATIONS, bg: 0x03040f, fog: [10, 28] },
};

export function stationsOf(room: Room): Station[] {
  return ROOMS[room].stations;
}

export interface FloorOptions {
  low: boolean;
  /** Which room (default: the casino). */
  room?: Room;
  /** Start beside this table (coming back from it), or at the entrance. */
  start?: StationId | null;
  /** Called when you walk up to a table, or away from it (null). */
  onNear: (station: Station | null) => void;
  /** Sat down on a couch, or stood up (null). */
  onSit?: (station: Station | null) => void;
  /** Walked through a doorway. */
  onDoor?: (to: Room) => void;
  onAutoLow?: () => void;
}

const EYE = 1.62;
const SPEED = 2.3;
const NEAR = 2.75;

export class CasinoFloor3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(66, 1, 0.05, 80);
  private readonly anim = new Animator();
  private readonly observer: ResizeObserver;
  private readonly dealers: Dealer[] = [];
  private readonly guests: Avatar[] = [];
  private readonly wheels: ReturnType<typeof buildWheel>[] = [];
  private readonly blinkers: { mat: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial; phase: number; speed: number }[] = [];
  private readonly pickables: { mesh: THREE.Object3D; station: Station }[] = [];
  private readonly signs: { sign: THREE.Sprite; station: Station }[] = [];
  private readonly extras: THREE.Object3D[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly keys = new Set<string>();
  private readonly pos = new THREE.Vector3(0, 0, 9.5);
  readonly room: Room;
  private readonly stations: Station[];
  private readonly size: { x: number; z: number; h: number };
  private readonly animations: ((dt: number, t: number) => void)[] = [];
  /** Sitting on a couch: where, and which seat. */
  private seat: { station: Station; index: number; pos: THREE.Vector3; yaw: number } | null = null;
  /** Seats bots or other people are on ("couchId:index"). */
  private readonly takenSeats = botSeats();
  private yaw = 0; // 0 = looking toward -z
  private pitch = -0.08;
  private walkTo: { point: THREE.Vector3; face: THREE.Vector3; pitch: number } | null = null;
  private stick = { x: 0, y: 0 };
  private near: Station | null = null;
  private low: boolean;
  private disposed = false;
  /** Where builders put things: the scene, or a holder that is prepared before it joins the scene. */
  private target: THREE.Object3D = this.scene;
  private paused = false;
  /** Resolves when the shaders are compiled and the first frame is on its way. */
  readonly ready: Promise<void>;
  private frame = 0;
  private last = performance.now();
  private prevMove = performance.now();
  private clock = 0;
  private bob = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private slow = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: FloorOptions,
  ) {
    this.low = opts.low;
    this.room = opts.room ?? 'casino';
    const cfg = ROOMS[this.room];
    this.stations = cfg.stations;
    this.size = cfg.size;
    // Arrive at a slightly different spot each time, so people don't stand inside each other.
    this.pos.copy(cfg.spawn.pos).add(new THREE.Vector3((Math.random() - 0.5) * 2.4, 0, (Math.random() - 0.5) * 0.8));
    this.yaw = cfg.spawn.yaw;
    if (this.room !== 'lounge') this.takenSeats.clear();
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.low, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // No real-time shadows here: soft painted shadows under everything look the same from
    // walking height, and keep the floor quick to open and smooth to walk around.
    this.renderer.shadowMap.enabled = false;
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(cfg.bg);
    this.scene.fog = new THREE.Fog(cfg.bg, cfg.fog[0], cfg.fog[1]);
    addEnvironmentLight(this.renderer, this.scene, 0.25);

    // First just the room (quick to prepare), so the doors open right away. The tables,
    // machines and decorations arrive over the next moments, nearest first (see buildRest).
    if (this.room === 'casino') this.buildRoom();
    else if (this.room === 'lounge') buildLoungeShell(this.ctx);
    else buildArcadeShell(this.ctx);
    simplifyMaterials(this.scene);
    mergeStatic(this.scene);

    // Start at the entrance, or beside the table you just left.
    const back = opts.start ? this.stations.find((s) => s.id === opts.start) : undefined;
    if (back?.kind === 'door') {
      // Coming through a doorway: a few steps into the room, facing into it.
      this.pos.copy(this.approachPoint(back, 3.4)).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, 0));
      this.faceToward(this.pos.clone().addScaledVector(new THREE.Vector3(Math.sin(back.yaw), 0, Math.cos(back.yaw)), 5));
    } else if (back) {
      const front = this.approachPoint(back, this.approachDistance(back));
      this.pos.copy(front);
      this.faceToward(back.pos);
      if (!back.game) this.pitch = 0.04;
    }

    this.applyQuality();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.wireInput();
    this.ready = warmUp(this.renderer, this.scene, this.camera).then(() => {
      if (this.disposed) return;
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.loop);
      void this.buildRest();
    });
  }

  /**
   * Adds the tables, slot machines and decorations one at a time, nearest first. Each is
   * prepared off-screen (simpler materials, merged into a few meshes, shaders compiled in
   * the background) and only then joins the scene, so walking stays smooth.
   */
  private async buildRest(): Promise<void> {
    const steps: { at: THREE.Vector3; build: () => void }[] =
      this.room === 'casino'
        ? [
            ...STATIONS.filter((st) => st.game).map((st) => ({ at: st.pos, build: () => this.buildStation(st) })),
            { at: new THREE.Vector3(-ROOM.x, 0, -6), build: () => this.buildSlots() },
            { at: new THREE.Vector3(0, 0, 8), build: () => this.buildDecor() },
          ]
        : this.room === 'lounge'
          ? [
              { at: new THREE.Vector3(-3.6, 0, -2.2), build: () => buildCorner(this.ctx, 0, this.stations) },
              { at: new THREE.Vector3(3.6, 0, -2.2), build: () => buildCorner(this.ctx, 1, this.stations) },
              { at: new THREE.Vector3(0, 0, 6), build: () => buildLoungeDecor(this.ctx) },
            ]
          : [
              ...this.stations.filter((st) => st.kind === 'arcade').map((st) => ({ at: st.pos, build: () => buildCabinets(this.ctx, st) })),
              { at: new THREE.Vector3(0, 0, -8), build: () => buildGiantScreen(this.ctx, this.stations.find((st) => st.kind === 'screen')!) },
            ];
    steps.sort((a, b) => a.at.distanceTo(this.pos) - b.at.distanceTo(this.pos));
    for (const step of steps) {
      if (this.disposed) return;
      const holder = new THREE.Group();
      this.target = holder;
      const d0 = this.dealers.length;
      const g0 = this.guests.length;
      step.build();
      this.target = this.scene;
      // People on the floor hold their pose: they become part of the scenery (one mesh per
      // material), which is much cheaper than animating dozens of body parts each.
      const people = [...this.dealers.splice(d0), ...this.guests.splice(g0)];
      for (let i = 0; i < 6; i++) for (const p of people) p.update(0.05);
      simplifyMaterials(holder);
      mergeStatic(holder, this.wheels.flatMap((w) => [w.rotor, w.ball]));
      try {
        await this.renderer.compileAsync(holder, this.camera, this.scene);
      } catch {
        /* drawn as it is */
      }
      if (this.disposed) return;
      this.scene.add(holder);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  /** What the room builders use to add things (see world-types.ts). */
  private readonly ctx: WorldCtx = {
    get low() {
      return false;
    },
    add: (...o) => this.target.add(...o),
    collide: (x, z, r) => this.colliders.push({ x, z, r }),
    pickable: (mesh, station) => this.pickables.push({ mesh, station }),
    sign: (sprite, station) => this.signs.push({ sign: sprite, station }),
    blink: (mat, speed = 1) => {
      if (!this.blinkers.some((b) => b.mat === mat)) this.blinkers.push({ mat: mat as THREE.MeshBasicMaterial, phase: Math.random() * 10, speed });
    },
    sitter: (look, at, yaw, couch) => {
      const a = new Avatar(0, look, { position: at.clone().setY(at.y - 0.06), rotationY: yaw, couch });
      a.tag.visible = false;
      this.target.add(a.group);
      this.guests.push(a);
    },
    animate: (fn) => this.animations.push(fn),
  };

  // ---------- Building the room ----------

  private buildRoom(): void {
    const { x: X, z: Z, h: H } = ROOM;
    // Carpet: the classic busy casino pattern, plus a red runner up the middle.
    const carpet = carpetTexture().clone();
    carpet.repeat.set(26, 26);
    carpet.needsUpdate = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(X * 2, Z * 2), new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.96 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(2.2, Z * 1.6), new THREE.MeshStandardMaterial({ map: runnerTexture(), roughness: 0.95 }));
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(0, 0.004, 2.5);
    runner.receiveShadow = true;
    this.scene.add(floor, runner);

    // Walls: damask wallpaper over dark wood paneling with a gold rail.
    const paper = damaskTexture();
    const wallMat = new THREE.MeshStandardMaterial({ map: paper, roughness: 0.85 });
    const panelMat = new THREE.MeshPhysicalMaterial({ map: woodTexture(), color: 0x6b3420, roughness: 0.4, clearcoat: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4af5a, metalness: 1, roughness: 0.3 });
    const walls: [number, number, number, number][] = [
      [0, -Z, 0, X * 2],
      [0, Z, Math.PI, X * 2],
      [-X, 0, Math.PI / 2, Z * 2],
      [X, 0, -Math.PI / 2, Z * 2],
    ];
    for (const [wx, wz, ry, len] of walls) {
      const g = new THREE.Group();
      g.position.set(wx, 0, wz);
      g.rotation.y = ry;
      const tex = paper.clone();
      tex.repeat.set(len / 2.2, 1.6);
      tex.needsUpdate = true;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, H), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
      wall.position.y = H / 2;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(len, 1.1, 0.06), panelMat);
      panel.position.set(0, 0.55, 0.03);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.08), gold);
      rail.position.set(0, 1.12, 0.04);
      const crown = new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.14), panelMat);
      crown.position.set(0, H - 0.09, 0.07);
      wall.receiveShadow = panel.receiveShadow = true;
      g.add(wall, panel, rail, crown);
      this.scene.add(g);
    }
    void wallMat;

    // Ceiling: dark coffers.
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(X * 2, Z * 2), new THREE.MeshStandardMaterial({ map: cofferTexture(), roughness: 0.8 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = H;
    this.scene.add(ceiling);

    // Columns with gold bands.
    const colMat = new THREE.MeshPhysicalMaterial({ color: 0x2a0d12, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
    for (const [cx, cz] of [
      [-2.6, 2.2],
      [2.6, 2.2],
      [-2.6, -3.4],
      [2.6, -3.4],
      [-8.8, 3.5],
      [8.8, 3.5],
    ] as const) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, H, 28), colMat);
      col.position.set(cx, H / 2, cz);
      col.castShadow = col.receiveShadow = true;
      this.scene.add(col);
      for (const y of [0.12, 1.12, H - 0.25]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, y < 0.5 ? 0.24 : 0.1, 28), gold);
        band.position.set(cx, y, cz);
        this.scene.add(band);
      }
      const pool = blobShadow(1.4, 1.4, 0.6);
      pool.position.set(cx, 0, cz);
      this.scene.add(pool);
      this.colliders.push({ x: cx, z: cz, r: 0.55 });
    }

    // Light: warm and low, like a real casino.
    this.scene.add(new THREE.HemisphereLight(0xffe2bd, 0x2a0e0b, 0.55));
    const glow = glowTexture();
    for (const [lx, lz] of [
      [0, 3.5],
      [0, -1.5],
      [-6, 3.5],
      [6, 3.5],
    ] as const) this.chandelier(lx, lz, glow, lz === 3.5 && lx !== 0 ? false : true);
    // A lamp over every table, set up now: adding lights later would make every material
    // be prepared again, which is what causes stutters.
    for (const st of STATIONS) {
      if (!st.game) continue;
      const lamp = new THREE.SpotLight(0xffdcae, 14, 7, 0.75, 0.6, 1.3);
      lamp.position.copy(st.pos).setY(3.2);
      lamp.target.position.copy(st.pos).setY(TABLE_Y);
      this.scene.add(lamp, lamp.target);
    }
    // The entrance: a lit archway behind the start point.
    const arch = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.2), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    arch.position.set(0, 1.6, Z - 0.02);
    arch.rotation.y = Math.PI;
    this.scene.add(arch);
    const sign = makeSign('THE VELVET ACE', 'Casino · Play money only', '#e7c56c', 1.4);
    sign.position.set(0, 3.6, Z - 0.3);
    this.scene.add(sign);
  }

  private chandelier(x: number, z: number, glow: THREE.Texture, withLight: boolean): void {
    const g = new THREE.Group();
    g.position.set(x, ROOM.h - 0.9, z);
    const brass = new THREE.MeshStandardMaterial({ color: 0xd8b25e, metalness: 1, roughness: 0.25 });
    const crystal = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.6, emissive: 0xffe9c4, emissiveIntensity: 0.35 });
    const bulbs: number[] = [];
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9), brass);
    rod.position.y = 0.45;
    g.add(rod);
    for (const [r, y, n] of [
      [0.55, 0, 14],
      [0.38, -0.18, 10],
      [0.2, -0.34, 6],
    ] as const) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 8, 48), brass);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      g.add(ring);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const drop = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), crystal);
        drop.scale.y = 1.8;
        drop.position.set(Math.cos(a) * r, y - 0.08, Math.sin(a) * r);
        g.add(drop);
        if (i % 2 === 0) bulbs.push(Math.cos(a) * r, y + 0.04, Math.sin(a) * r);
      }
    }
    // The bulbs' glow: one point cloud per chandelier (a single draw call).
    const bulbGeo = new THREE.BufferGeometry();
    bulbGeo.setAttribute('position', new THREE.Float32BufferAttribute(bulbs, 3));
    g.add(new THREE.Points(bulbGeo, new THREE.PointsMaterial({ map: glow, color: 0xffd9a0, size: 0.22, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffcf8a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(2.4);
    halo.position.y = -0.15;
    g.add(halo);
    if (withLight) {
      const light = new THREE.PointLight(0xffd6a0, 11, 13, 1.6);
      light.position.y = -0.3;
      g.add(light);
    }
    this.scene.add(g);
  }

  private readonly colliders: { x: number; z: number; r: number }[] = [];

  /** A game table with its dealer, a lamp above it and a sign. */
  private buildStation(s: Station): void {
    const g = new THREE.Group();
    g.position.copy(s.pos);
    g.rotation.y = s.yaw;
    const anim = this.anim;
    let dealerAt = new THREE.Vector3(0, 0, -0.78);
    if (s.game === 'blackjack') {
      const env = buildEnvironment(false);
      g.add(env.group);
      // The blackjack table is built around its arc center; move it so the table sits on the station point.
      env.group.position.z = 0.35;
      dealerAt = new THREE.Vector3(0, 0, -0.43);
    } else if (s.game === 'poker') {
      g.add(buildPokerTable());
      dealerAt = new THREE.Vector3(0, 0, -1.06);
    } else {
      const table = buildRouletteTable();
      const wheel = buildWheel(this.low);
      table.group.add(wheel.group);
      table.group.position.x = 0.18;
      g.add(table.group);
      this.wheels.push(wheel);
      dealerAt = new THREE.Vector3(-0.2, 0, -0.66);
    }
    const dealer = new Dealer(anim, dealerAt);
    // Arms live in the table's coordinates, like the dealer.
    g.add(dealer.group, dealer.limbs);
    this.dealers.push(dealer);

    // A few other guests already playing.
    const guestSpots: [number, number, number][] =
      s.game === 'poker'
        ? [
            [-1.3, 0.55, 2.2],
            [1.35, 0.5, -2.2],
            [0, 1.18, Math.PI],
          ]
        : s.game === 'roulette'
          ? [
              [0.9, 0.95, Math.PI],
              [0.45, -0.95, 0],
            ]
          : s.id === 'blackjack'
            ? [
                [-1.05, 0.9, Math.PI + 0.9],
                [1.05, 0.9, Math.PI - 0.9],
                [0.4, 1.3, Math.PI - 0.3],
              ]
            : [];
    const count = this.low ? Math.min(1, guestSpots.length) : guestSpots.length;
    for (const [gx, gz, gyaw] of guestSpots.slice(0, count)) {
      const look: Look = randomLook();
      look.extra = Math.random() < 0.5 ? 0 : 1 + Math.floor(Math.random() * (LOOK_OPTIONS.extra.length - 1));
      const local = new THREE.Vector3(gx, 0, gz);
      const world = local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw).add(s.pos);
      const a = new Avatar(0, look, { position: world, rotationY: gyaw + s.yaw });
      a.tag.visible = false;
      this.target.add(a.group);
      this.guests.push(a);
    }

    // A soft shadow pooled under the table.
    const pool = blobShadow(s.game === 'roulette' ? 3.4 : 3, s.game === 'roulette' ? 1.9 : 2.3, 0.75);
    g.add(pool);

    // Invisible pick target: tap anywhere on the table to walk to it.
    const pick = new THREE.Mesh(new THREE.CylinderGeometry(s.radius, s.radius, 1.6, 20), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.y = 0.8;
    g.add(pick);
    this.pickables.push({ mesh: pick, station: s });

    this.target.add(g);
    const sign = makeSign(s.title.toUpperCase(), s.sub, s.game === 'roulette' ? '#ff6b6b' : s.game === 'poker' ? '#7fb6ff' : '#7ee0a5', 1);
    sign.position.copy(s.pos).add(new THREE.Vector3(0, 2.65, 0));
    this.target.add(sign);
    this.signs.push({ sign, station: s });
    this.colliders.push({ x: s.pos.x, z: s.pos.z, r: s.radius });
  }

  /** Banks of slot machines along the side walls, screens flashing. */
  private buildSlots(): void {
    const cabinet = new THREE.MeshPhysicalMaterial({ color: 0x1a1a22, roughness: 0.25, clearcoat: 1, metalness: 0.3 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdadde2, metalness: 1, roughness: 0.2 });
    const seatMat = new THREE.MeshPhysicalMaterial({ color: 0x7a1020, roughness: 0.5, clearcoat: 0.4 });
    let n = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const g = new THREE.Group();
        const z = -9 + i * 1.05 + (side > 0 ? 0.4 : 0);
        g.position.set(side * (ROOM.x - 0.55), 0, z);
        g.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.45, 0.62), cabinet);
        body.position.y = 0.725;
        const topper = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.36, 0.5), cabinet);
        topper.position.set(0, 1.65, -0.04);
        const screenMat = slotMaterial('screen', n++ % 6);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.46), screenMat);
        screen.position.set(0, 1.08, 0.315);
        screen.rotation.x = -0.12;
        const glowMat = slotMaterial('topper', n % 4);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.3), glowMat);
        sign.position.set(0, 1.65, 0.215);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.28), chrome);
        deck.position.set(0, 0.76, 0.36);
        deck.rotation.x = 0.25;
        const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35), chrome);
        lever.position.set(0.4, 1.15, 0.05);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.3 }));
        knob.position.set(0.4, 1.33, 0.05);
        const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 20), seatMat);
        stool.position.set(0, 0.68, 0.75);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.66, 10), chrome);
        post.position.set(0, 0.33, 0.75);
        body.castShadow = true;
        const pool = blobShadow(1.1, 1.3, 0.6);
        pool.position.z = 0.2;
        g.add(body, topper, screen, sign, deck, lever, knob, stool, post, pool);
        this.target.add(g);
        for (const [m, speed] of [[glowMat, 1.5 + Math.random() * 2], [screenMat, 0.6 + Math.random()]] as const) {
          if (!this.blinkers.some((bl) => bl.mat === m)) this.blinkers.push({ mat: m, phase: Math.random() * 10, speed });
        }
      }
      this.colliders.push(...Array.from({ length: 12 }, (_, k) => ({ x: side * (ROOM.x - 0.6), z: -9.5 + k * 0.85, r: 0.9 })));
      // Tap any machine in the row to walk up to it.
      const station = STATIONS.find((st) => st.id === (side < 0 ? 'slots-left' : 'slots-right'))!;
      const pick = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2, 7.2), new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.set(station.pos.x, 1, station.pos.z);
      this.target.add(pick);
      this.pickables.push({ mesh: pick, station });
    }
  }

  /** Velvet ropes, potted palms and a cashier's cage for atmosphere. */
  private buildDecor(): void {
    const brass = new THREE.MeshStandardMaterial({ color: 0xd8b25e, metalness: 1, roughness: 0.25 });
    const velvet = new THREE.MeshStandardMaterial({ color: 0x8a0f24, roughness: 0.7 });
    // Ropes lining the entrance runner.
    for (const side of [-1, 1]) {
      const posts: THREE.Vector3[] = [];
      for (let i = 0; i < 4; i++) {
        const p = new THREE.Vector3(side * 1.4, 0, 9 - i * 1.6);
        posts.push(p);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.95, 12), brass);
        post.position.copy(p).setY(0.475);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.04, 20), brass);
        base.position.copy(p).setY(0.02);
        const top = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), brass);
        top.position.copy(p).setY(0.97);
        this.target.add(post, base, top);
        this.colliders.push({ x: p.x, z: p.z, r: 0.25 });
      }
      for (let i = 0; i < posts.length - 1; i++) {
        const a = posts[i]!.clone().setY(0.88);
        const b = posts[i + 1]!.clone().setY(0.88);
        const mid = a.clone().lerp(b, 0.5).setY(0.66);
        const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 20, 0.022, 8), velvet);
        this.target.add(rope);
      }
    }
    // Palms in big pots.
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5d2c, roughness: 0.7, side: THREE.DoubleSide });
    const potMat = new THREE.MeshPhysicalMaterial({ color: 0x1b1b1b, roughness: 0.3, clearcoat: 1 });
    for (const [px, pz] of [
      [-10.6, 10.6],
      [10.6, 10.6],
      [-10.6, -10.6],
      [10.6, -10.6],
      [-3.4, 10.4],
      [3.4, 10.4],
    ] as const) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.26, 0.7, 20), potMat);
      pot.position.set(px, 0.35, pz);
      this.target.add(pot);
      for (let i = 0; i < 9; i++) {
        const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 1.1), leafMat);
        const a = (i / 9) * Math.PI * 2;
        leaf.position.set(px + Math.cos(a) * 0.35, 1.3, pz + Math.sin(a) * 0.35);
        leaf.rotation.set(0.9, -a + Math.PI / 2, 0);
        this.target.add(leaf);
      }
      this.colliders.push({ x: px, z: pz, r: 0.6 });
    }
    // The cashier's cage at the back wall.
    const cage = new THREE.Group();
    cage.position.set(7.5, 0, -ROOM.z + 0.6);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 0.7), new THREE.MeshPhysicalMaterial({ map: woodTexture(), color: 0x7a3a1f, roughness: 0.35, clearcoat: 0.8 }));
    counter.position.y = 0.55;
    cage.add(counter);
    for (let i = 0; i <= 12; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.2), brass);
      bar.position.set(-1.55 + i * (3.1 / 12), 1.7, 0.2);
      cage.add(bar);
    }
    const cashier = makeSign('CASHIER', 'Cash out your chips here', '#e7c56c', 0.7);
    cashier.position.set(0, 2.6, 0.2);
    cage.add(cashier);
    // The cashier behind the counter, and a glowing window.
    const clerk = new Avatar(0, { skin: 3, hair: 2, hairColor: 0, outfit: 5, extra: 1 }, { position: new THREE.Vector3(7.5, 0.28, -ROOM.z + 0.05), rotationY: 0 });
    clerk.tag.visible = false;
    this.target.add(clerk.group);
    this.guests.push(clerk);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2), new THREE.MeshBasicMaterial({ color: 0x3a2a12, transparent: true, opacity: 0.35 }));
    glass.position.set(0, 1.75, 0.21);
    cage.add(glass);
    const pick = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 1.2), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.y = 1.2;
    cage.add(pick);
    this.pickables.push({ mesh: pick, station: STATIONS.find((x) => x.id === 'cashier')! });
    this.target.add(cage);
    this.colliders.push({ x: 6.5, z: -ROOM.z + 0.6, r: 0.75 }, { x: 7.5, z: -ROOM.z + 0.6, r: 0.75 }, { x: 8.5, z: -ROOM.z + 0.6, r: 0.75 });
  }

  // ---------- Input ----------

  private wireInput(): void {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    let look: { id: number; x: number; y: number; moved: number } | null = null;
    let stickTouch: { id: number; x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      const r = el.getBoundingClientRect();
      const left = e.clientX - r.left < r.width * 0.42;
      if (e.pointerType !== 'mouse' && left && !stickTouch) {
        stickTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
        this.onStick?.(true, e.clientX - r.left, e.clientY - r.top, 0, 0);
      } else look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (stickTouch && e.pointerId === stickTouch.id) {
        const dx = e.clientX - stickTouch.x;
        const dy = e.clientY - stickTouch.y;
        const len = Math.hypot(dx, dy);
        const max = 55;
        const k = len > max ? max / len : 1;
        this.stick = { x: (dx * k) / max, y: (dy * k) / max };
        this.walkTo = null;
        const r = el.getBoundingClientRect();
        this.onStick?.(true, stickTouch.x - r.left, stickTouch.y - r.top, dx * k, dy * k);
        return;
      }
      if (look && e.pointerId === look.id) {
        const dx = e.clientX - look.x;
        const dy = e.clientY - look.y;
        look.moved += Math.abs(dx) + Math.abs(dy);
        const h = Math.max(1, el.clientHeight);
        this.yaw -= (dx * 2.4) / h;
        this.pitch = THREE.MathUtils.clamp(this.pitch - (dy * 2.0) / h, -0.7, 0.5);
        look.x = e.clientX;
        look.y = e.clientY;
      }
    });
    const end = (e: PointerEvent) => {
      if (stickTouch && e.pointerId === stickTouch.id) {
        stickTouch = null;
        this.stick = { x: 0, y: 0 };
        this.onStick?.(false, 0, 0, 0, 0);
      }
      if (look && e.pointerId === look.id) {
        if (look.moved < 8) this.tap(e);
        look = null;
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** The touch stick's position, for drawing it: (active, center x, y, knob dx, dy). */
  onStick?: (active: boolean, x: number, y: number, dx: number, dy: number) => void;

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.paused || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(k)) {
      this.keys.add(k);
      this.walkTo = null;
      e.preventDefault();
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private onBlur = () => this.keys.clear();

  private tap(e: PointerEvent): void {
    const el = this.renderer.domElement;
    const r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables.map((p) => p.mesh), false);
    const hit = hits[0] && this.pickables.find((p) => p.mesh === hits[0]!.object);
    if (hit) this.goTo(hit.station.id);
  }

  /** Walk up to a table (from a tap, or the list of tables in the overlay). */
  /** How far from a thing you stop when walking up to it. */
  private approachDistance(s: Station): number {
    switch (s.kind) {
      case 'slots':
        return 2.7;
      case 'cashier':
        return 3.3;
      case 'couch':
        return 1.4;
      case 'door':
        return 1.6;
      case 'arcade':
        return 1.9;
      case 'screen':
        return 2.2;
      default:
        return s.game === 'roulette' ? 2.3 : 2.6;
    }
  }

  goTo(id: StationId): void {
    const s = this.stations.find((x) => x.id === id);
    if (!s) return;
    this.standUp();
    const dist = this.approachDistance(s);
    // At a row of machines, walk to the nearest machine rather than the middle of the row.
    const point = this.approachPoint(s, dist);
    if (s.span) {
      const along = THREE.MathUtils.clamp((this.pos.x - s.pos.x) * Math.cos(s.yaw) - (this.pos.z - s.pos.z) * Math.sin(s.yaw), -s.span + 0.4, s.span - 0.4);
      point.x += along * Math.cos(s.yaw);
      point.z -= along * Math.sin(s.yaw);
    }
    const face = point.clone().addScaledVector(new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw)), -dist);
    this.walkTo = { point, face, pitch: s.kind === 'slots' ? -0.06 : s.game ? -0.12 : s.kind === 'screen' ? 0.12 : s.kind === 'couch' ? -0.15 : 0.04 };
  }

  /** Distance from you to a table's center, or to the nearest point of a row of machines. */
  private distanceTo(s: Station): number {
    const dx = this.pos.x - s.pos.x;
    const dz = this.pos.z - s.pos.z;
    if (!s.span) return Math.hypot(dx, dz);
    const along = THREE.MathUtils.clamp(dx * Math.cos(s.yaw) - dz * Math.sin(s.yaw), -s.span, s.span);
    return Math.hypot(dx - along * Math.cos(s.yaw), dz + along * Math.sin(s.yaw));
  }

  /** Stops walking and drawing while something covers the floor (the slot machine). */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.keys.clear();
    this.stick = { x: 0, y: 0 };
    this.walkTo = null;
  }

  // ---------- Couches ----------

  /** Sit on a couch (the nearest free seat). Returns false if it's full. */
  sit(id: StationId): boolean {
    const st = this.stations.find((x) => x.id === id);
    if (!st?.seats) return false;
    let best = -1;
    let bestD = Infinity;
    st.seats.forEach((p, i) => {
      if (this.takenSeats.has(`${st.id}:${i}`)) return;
      const d = p.distanceTo(this.pos);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return false;
    this.walkTo = null;
    this.seat = { station: st, index: best, pos: st.seats[best]!.clone(), yaw: st.yaw };
    this.takenSeats.add(`${st.id}:${best}`);
    // Look the way the couch faces.
    this.yaw = st.yaw + Math.PI;
    this.pitch = -0.1;
    this.opts.onSit?.(st);
    return true;
  }

  standUp(): void {
    if (!this.seat) return;
    const s = this.seat;
    this.seat = null;
    this.takenSeats.delete(`${s.station.id}:${s.index}`);
    this.pos.copy(s.pos).addScaledVector(new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw)), 0.85);
    this.opts.onSit?.(null);
  }

  get sitting(): Station | null {
    return this.seat?.station ?? null;
  }

  /** Where you are, for the other players: position, facing, and the seat you're on. */
  pose(): { x: number; z: number; yaw: number; seat: string | null } {
    const p = this.seat ? this.seat.pos : this.pos;
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +(this.yaw + Math.PI).toFixed(2), seat: this.seat ? `${this.seat.station.id}:${this.seat.index}` : null };
  }

  // ---------- Other players in the room ----------

  private readonly people = new Map<string, { walker: Walker | null; sitter: Avatar | null; seat: string | null; look: string }>();

  /** The other players in this room, as last heard: shown walking around or seated. */
  setPeople(list: { id: string; name: string; look: Look; x: number; z: number; yaw: number; seat: string | null }[]): void {
    const seen = new Set<string>();
    for (const p of list) {
      seen.add(p.id);
      let v = this.people.get(p.id);
      const lookKey = JSON.stringify(p.look);
      if (v && (v.seat !== p.seat || v.look !== lookKey)) {
        this.removePerson(p.id);
        v = undefined;
      }
      if (!v) {
        v = { walker: null, sitter: null, seat: p.seat, look: lookKey };
        const st = p.seat ? this.stations.find((s) => s.id === p.seat!.split(':')[0]) : undefined;
        const seatPos = st?.seats?.[Number(p.seat!.split(':')[1])];
        if (st && seatPos) {
          const a = new Avatar(0, p.look, { position: seatPos.clone().setY(-0.06), rotationY: st.yaw, couch: true });
          a.setInfo({ name: p.name, balance: 'chatting', isTurn: false, away: false, host: false, bot: false });
          this.scene.add(a.group);
          v.sitter = a;
          this.takenSeats.add(p.seat!);
        } else {
          v.walker = new Walker(p.look, p.name, p.x, p.z, p.yaw);
          this.scene.add(v.walker.group);
        }
        this.people.set(p.id, v);
      }
      v.walker?.moveTo(p.x, p.z, p.yaw);
      v.walker?.setName(p.name);
    }
    for (const id of [...this.people.keys()]) if (!seen.has(id)) this.removePerson(id);
  }

  /** A chat line above someone's head. */
  say(id: string, text: string): void {
    const v = this.people.get(id);
    v?.walker?.say(text);
    v?.sitter?.say(text);
  }

  private removePerson(id: string): void {
    const v = this.people.get(id);
    if (!v) return;
    v.walker?.dispose();
    v.sitter?.dispose();
    if (v.seat) this.takenSeats.delete(v.seat);
    this.people.delete(id);
  }

  /** A spot in front of a table, on its players' side. */
  private approachPoint(s: Station, dist: number): THREE.Vector3 {
    const dir = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    return s.pos.clone().addScaledVector(dir, dist);
  }

  private faceToward(p: THREE.Vector3): void {
    const d = p.clone().sub(this.pos);
    this.yaw = Math.atan2(-d.x, -d.z);
  }

  setLowGraphics(low: boolean): void {
    this.low = low;
    this.applyQuality();
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.people.keys()]) this.removePerson(id);
    cancelAnimationFrame(this.frame);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.observer.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- Frame loop ----------

  private move(dt: number): void {
    const k = this.keys;
    if (this.seat) {
      // Any walking input gets you up off the couch.
      const wants = ['w', 's', 'a', 'd', 'arrowup', 'arrowdown'].some((x) => k.has(x)) || Math.hypot(this.stick.x, this.stick.y) > 0.3;
      if (!wants) return;
      this.standUp();
    }
    let fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) - this.stick.y;
    let side = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0) + this.stick.x;
    const turn = (k.has('arrowleft') || k.has('q') ? 1 : 0) - (k.has('arrowright') || k.has('e') ? 1 : 0);
    this.yaw += turn * 1.9 * dt;
    if (this.walkTo) {
      const to = this.walkTo.point.clone().sub(this.pos).setY(0);
      const dist = to.length();
      if (dist < 0.08) {
        this.walkTo = null;
      } else {
        // Turn toward the walking direction, then toward the table at the end.
        const targetYaw = dist > 0.6 ? Math.atan2(-to.x, -to.z) : Math.atan2(-(this.walkTo.face.x - this.pos.x), -(this.walkTo.face.z - this.pos.z));
        let d = targetYaw - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * 4);
        this.pitch = damp(this.pitch, this.walkTo.pitch, 3, dt);
        const step = Math.min(dist, SPEED * dt * Math.min(1, dist * 1.5 + 0.3));
        this.pos.addScaledVector(to.normalize(), step);
        fwd = side = 0;
        this.bob += step * 6;
      }
    }
    const len = Math.hypot(fwd, side);
    if (len > 0.01) {
      const f = Math.min(1, len);
      fwd /= len;
      side /= len;
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const step = SPEED * f * dt;
      this.pos.addScaledVector(forward, fwd * step).addScaledVector(right, side * step);
      this.bob += step * 6;
    }
    // Stay inside the room and out of the furniture.
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -this.size.x + 0.5, this.size.x - 0.5);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -this.size.z + 0.5, this.size.z - 0.5);
    for (const c of this.colliders) {
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 0.3;
      if (d < min && d > 1e-4) {
        this.pos.x = c.x + (dx / d) * min;
        this.pos.z = c.z + (dz / d) * min;
      }
    }
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    if (this.paused) {
      this.last = this.prevMove = now;
      return;
    }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    this.anim.tick(dt);
    // Walking uses the real elapsed time (up to a quarter second), so slow devices still get there.
    this.move(Math.min(0.25, (now - this.prevMove) / 1000));
    this.prevMove = now;
    for (const d of this.dealers) d.update(dt);
    for (const a of this.guests) a.update(dt);
    for (const fn of this.animations) fn(dt, this.clock);
    for (const v of this.people.values()) {
      v.walker?.update(dt);
      v.sitter?.update(dt);
    }
    // Roulette wheels keep turning; a ball goes round and round.
    for (const w of this.wheels) {
      w.rotor.rotation.y += dt * 0.5;
      const a = -this.clock * 2.4;
      w.ball.position.set(Math.sin(a) * 0.384, 0.083, Math.cos(a) * 0.384);
    }
    for (const b of this.blinkers) {
      const v = 0.75 + 0.25 * Math.sin(this.clock * b.speed + b.phase);
      (b.mat as THREE.MeshBasicMaterial).color.setScalar(v);
    }
    // Which table are we next to?
    let near: Station | null = null;
    let best = Infinity;
    for (const s of this.stations) {
      const d = this.distanceTo(s) - s.radius;
      if (d < NEAR - s.radius * 0.4 && d < best) {
        best = d;
        near = s;
      }
    }
    if (near !== this.near) {
      this.near = near;
      this.opts.onNear(near);
    }
    // Walking right into a doorway takes you through it.
    if (near?.kind === 'door' && near.to && !this.walkTo && this.distanceTo(near) < near.radius + 0.25) {
      const to = near.to;
      this.near = null;
      this.pos.addScaledVector(new THREE.Vector3(Math.sin(near.yaw), 0, Math.cos(near.yaw)), 1.2);
      this.opts.onDoor?.(to);
    }
    // Signs fade as you come close, so they don't block the view.
    this.signs.forEach(({ sign, station: s }) => {
      const d = Math.hypot(this.pos.x - s.pos.x, this.pos.z - s.pos.z);
      (sign.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.clamp((d - 3.2) / 2.5, 0, 1);
    });

    const bobY = Math.sin(this.bob) * 0.02;
    if (this.seat) this.camera.position.set(this.seat.pos.x, 1.12, this.seat.pos.z);
    else this.camera.position.set(this.pos.x, EYE + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.renderer.render(this.scene, this.camera);

    if (!this.low && !document.hidden) {
      this.fpsFrames++;
      this.fpsTime += dt;
      if (this.fpsTime > 3) {
        this.slow = this.fpsFrames / this.fpsTime < 26 ? this.slow + 1 : 0;
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
    this.camera.fov = this.camera.aspect < 0.85 ? 80 : 66;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private applyQuality(): void {
    const low = this.low;
    this.renderer.setPixelRatio(low ? Math.min(window.devicePixelRatio, 1) : Math.min(window.devicePixelRatio, 1.5));

    for (const o of this.extras) o.visible = !low;
    this.resize();
  }
}

// ---------- Textures and signs ----------

function damaskTexture(): THREE.CanvasTexture {
  return canvasTex(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#3d0e16';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(214, 170, 90, 0.22)';
      ctx.fillStyle = 'rgba(214, 170, 90, 0.1)';
      ctx.lineWidth = 2;
      for (const [cx, cy] of [
        [128, 128],
        [0, 0],
        [256, 0],
        [0, 256],
        [256, 256],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 70);
        ctx.bezierCurveTo(cx + 50, cy - 40, cx + 50, cy + 40, cx, cy + 70);
        ctx.bezierCurveTo(cx - 50, cy + 40, cx - 50, cy - 40, cx, cy - 70);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 14, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
    true,
  );
}

function cofferTexture(): THREE.CanvasTexture {
  const t = canvasTex(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#1a0d0a';
      ctx.fillRect(0, 0, 256, 256);
      const g = ctx.createLinearGradient(0, 0, 256, 256);
      g.addColorStop(0, '#2b1610');
      g.addColorStop(1, '#120806');
      ctx.fillStyle = g;
      ctx.fillRect(24, 24, 208, 208);
      ctx.strokeStyle = 'rgba(214, 170, 90, 0.5)';
      ctx.lineWidth = 4;
      ctx.strokeRect(24, 24, 208, 208);
    },
    true,
  );
  t.repeat.set(8, 8);
  return t;
}

function runnerTexture(): THREE.CanvasTexture {
  const t = canvasTex(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#7c0f1f';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#d4af5a';
      ctx.fillRect(10, 0, 8, 256);
      ctx.fillRect(238, 0, 8, 256);
      ctx.strokeStyle = 'rgba(212, 175, 90, 0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(128, 40);
      ctx.lineTo(190, 128);
      ctx.lineTo(128, 216);
      ctx.lineTo(66, 128);
      ctx.closePath();
      ctx.stroke();
    },
    true,
  );
  t.repeat.set(1, 8);
  return t;
}

const slotMats = new Map<string, THREE.MeshBasicMaterial>();

/** Slot screens and toppers come in a few designs, shared so each design is one draw call. */
function slotMaterial(kind: 'screen' | 'topper', variant: number): THREE.MeshBasicMaterial {
  const key = `${kind}${variant}`;
  let m = slotMats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: kind === 'screen' ? slotScreen(variant) : slotTopper(variant), toneMapped: false });
    slotMats.set(key, m);
  }
  return m;
}

const SLOT_SYMBOLS = ['7', '🍒', 'BAR', '🔔', '♦', '★'];

function slotScreen(seed: number): THREE.CanvasTexture {
  return canvasTex(256, 210, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 210);
    g.addColorStop(0, '#2a1a5e');
    g.addColorStop(1, '#0c0820');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 210);
    for (let r = 0; r < 3; r++) {
      ctx.fillStyle = '#fbf6ea';
      ctx.fillRect(14 + r * 80, 40, 68, 130);
      ctx.fillStyle = r % 2 ? '#c8102e' : '#1f3c99';
      ctx.font = '800 40px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(SLOT_SYMBOLS[(seed + r * 2) % SLOT_SYMBOLS.length]!, 48 + r * 80, 105);
    }
    ctx.fillStyle = '#f2c94c';
    ctx.font = '700 22px Inter, sans-serif';
    ctx.fillText('JACKPOT 7,777', 128, 22);
  });
}

function slotTopper(seed: number): THREE.CanvasTexture {
  const colors = ['#ff3d6e', '#ffb02e', '#2ee6ff', '#9b5cff'];
  return canvasTex(256, 120, (ctx) => {
    ctx.fillStyle = '#120a14';
    ctx.fillRect(0, 0, 256, 120);
    ctx.shadowColor = colors[seed % colors.length]!;
    ctx.shadowBlur = 18;
    ctx.fillStyle = colors[seed % colors.length]!;
    ctx.font = '800 44px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(['LUCKY 7', 'GOLD RUSH', 'DIAMONDS', 'STARS'][seed % 4]!, 128, 62);
  });
}
