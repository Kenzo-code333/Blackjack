// The room: floor, dim background, overhead lamp, the table itself, shoe, chip rack, discard tray.

import * as THREE from 'three';
import {
  CARD_H,
  CARD_W,
  CENTER,
  CHIP_R,
  DISCARD_POS,
  RACK_POS,
  SHOE_POS,
  TABLE_RADIUS,
  TABLE_Y,
} from './layout.js';
import { CHIP_COLORS, cardBackMaterial, carpetTexture, chipSideTexture, feltTexture, feltUV, glowTexture, woodTexture } from './textures.js';

export interface Environment {
  group: THREE.Group;
  lamp: THREE.SpotLight;
  /** Decorations hidden in low-graphics mode. */
  extras: THREE.Object3D[];
  discardStack: THREE.Mesh;
  shoeStack: THREE.Mesh;
  setDiscardHeight(fraction: number): void;
  setShoeFill(fraction: number): void;
}

/** Outline of the felt: a flat edge on the dealer side and an arc toward the players. */
function tableShape(radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  // Shape coordinates are (x, -z) because the shape is laid flat afterwards.
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / steps;
    const x = CENTER.x + Math.sin(a) * radius;
    const z = CENTER.z + Math.cos(a) * radius;
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  }
  shape.closePath();
  return shape;
}

export function buildEnvironment(): Environment {
  const group = new THREE.Group();
  const extras: THREE.Object3D[] = [];

  // --- Floor ---
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // --- Dim background: a dark cylinder "wall" with warm, blurry lights (other tables, slot machines). ---
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 14, 7, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x120b08, side: THREE.BackSide }),
  );
  wall.position.y = 3.5;
  group.add(wall);

  const glow = glowTexture();
  const bokehColors = [0xffb347, 0xff6a3d, 0xffd27a, 0xd94f6b, 0x8fd1ff, 0xffe9b0];
  for (let i = 0; i < 46; i++) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: bokehColors[i % bokehColors.length],
        transparent: true,
        opacity: 0.25 + Math.random() * 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    const a = Math.random() * Math.PI * 2;
    const r = 7 + Math.random() * 6;
    s.position.set(Math.sin(a) * r, 0.6 + Math.random() * 2.6, Math.cos(a) * r);
    const size = 0.3 + Math.random() * 1.1;
    s.scale.set(size, size, 1);
    group.add(s);
    extras.push(s);
  }
  // Distant tables: dark green ovals catching a little light.
  for (const [x, z, rot] of [
    [-5.5, -3, 0.6],
    [5.8, -2.5, -0.5],
    [-6, 4, 2.4],
    [6.2, 4.5, -2.2],
    [0, -7, 0],
  ] as const) {
    const t = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 0.08, 24, 1),
      new THREE.MeshStandardMaterial({ color: 0x0d3b26, roughness: 0.9 }),
    );
    t.scale.set(1, 1, 0.55);
    t.position.set(x, 0.78, z);
    t.rotation.y = rot;
    group.add(t);
    const lamp = new THREE.PointLight(0xffc27a, 2.2, 4.5, 2);
    lamp.position.set(x, 2.2, z);
    group.add(lamp);
    extras.push(t, lamp);
  }

  // --- Overhead lamp: the main light, with soft shadows ---
  const lamp = new THREE.SpotLight(0xffd9a8, 15, 6, 0.8, 0.7, 1.4);
  lamp.position.set(0, 2.55, -0.05);
  lamp.target.position.set(0, TABLE_Y, -0.05);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.bias = -0.0004;
  lamp.shadow.normalBias = 0.01;
  lamp.shadow.radius = 4;
  lamp.shadow.camera.near = 0.5;
  lamp.shadow.camera.far = 4;
  group.add(lamp, lamp.target);

  const shadeMat = new THREE.MeshStandardMaterial({ color: 0x1b3a2a, roughness: 0.4, metalness: 0.4, side: THREE.DoubleSide });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.62, 0.32, 40, 1, true), shadeMat);
  shade.position.set(0, 2.7, -0.05);
  const bulbGlow = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 40),
    new THREE.MeshBasicMaterial({ color: 0xffe6b8, transparent: true, opacity: 0.85 }),
  );
  bulbGlow.rotation.x = Math.PI / 2;
  bulbGlow.position.set(0, 2.55, -0.05);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 3), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  cord.position.set(0, 4.3, -0.05);
  group.add(shade, bulbGlow, cord);

  // Soft fill so faces and cards aren't pitch black on the far side.
  group.add(new THREE.HemisphereLight(0xffe7c4, 0x1a0c08, 0.45));
  const fill = new THREE.PointLight(0xffd7a0, 3, 5, 2);
  fill.position.set(0, 1.9, 1.6);
  group.add(fill);

  // --- Table ---
  const shape = tableShape(TABLE_RADIUS);
  const feltGeo = new THREE.ShapeGeometry(shape, 64);
  feltGeo.rotateX(-Math.PI / 2);
  const pos = feltGeo.attributes.position!;
  const uv = feltGeo.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    const [u, v] = feltUV(pos.getX(i), pos.getZ(i));
    uv.setXY(i, u, v);
  }
  const felt = new THREE.Mesh(feltGeo, new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.92 }));
  felt.position.y = TABLE_Y;
  felt.receiveShadow = true;
  group.add(felt);

  const wood = woodTexture();
  const woodMat = new THREE.MeshStandardMaterial({ map: wood, color: 0xd9a77a, roughness: 0.45, metalness: 0.05 });

  // Table body under the felt.
  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(tableShape(TABLE_RADIUS + 0.06), { depth: 0.12, bevelEnabled: false, curveSegments: 48 }),
    woodMat,
  );
  body.rotation.x = -Math.PI / 2;
  body.position.y = TABLE_Y - 0.121;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Padded leather rail along the arc.
  const arc = new THREE.CurvePath<THREE.Vector3>();
  const railPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 64;
    railPts.push(new THREE.Vector3(CENTER.x + Math.sin(a) * (TABLE_RADIUS + 0.02), TABLE_Y + 0.03, CENTER.z + Math.cos(a) * (TABLE_RADIUS + 0.02)));
  }
  arc.add(new THREE.CatmullRomCurve3(railPts));
  const rail = new THREE.Mesh(
    new THREE.TubeGeometry(arc.curves[0]!, 96, 0.055, 16, false),
    new THREE.MeshStandardMaterial({ color: 0x2a1610, roughness: 0.38, metalness: 0.1 }),
  );
  rail.castShadow = true;
  rail.receiveShadow = true;
  group.add(rail);

  // Wooden edge on the dealer side.
  const edge = new THREE.Mesh(new THREE.BoxGeometry(TABLE_RADIUS * 2 + 0.12, 0.05, 0.06), woodMat);
  edge.position.set(CENTER.x, TABLE_Y + 0.005, CENTER.z - 0.03);
  edge.castShadow = true;
  group.add(edge);

  // Pedestal.
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, TABLE_Y - 0.12, 20), woodMat);
  pedestal.position.set(0, (TABLE_Y - 0.12) / 2, -0.1);
  group.add(pedestal);

  // --- Shoe (dealer's left) ---
  const shoe = new THREE.Group();
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x3b1014, roughness: 0.5 });
  const shoeBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.2), shoeMat);
  shoeBody.position.y = 0.045;
  shoeBody.castShadow = true;
  const shoeLip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.05), new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.7, roughness: 0.3 }));
  shoeLip.position.set(0, 0.006, 0.12);
  const shoeStack = new THREE.Mesh(new THREE.BoxGeometry(CARD_W * 0.95, 0.06, 0.004), [
    new THREE.MeshStandardMaterial({ color: 0xf3eedf }),
    new THREE.MeshStandardMaterial({ color: 0xf3eedf }),
    new THREE.MeshStandardMaterial({ color: 0xf3eedf }),
    new THREE.MeshStandardMaterial({ color: 0xf3eedf }),
    cardBackMaterial(),
    cardBackMaterial(),
  ]);
  shoeStack.position.set(0, 0.075, 0.1);
  shoeStack.rotation.x = -0.55;
  shoe.add(shoeBody, shoeLip, shoeStack);
  shoe.position.copy(SHOE_POS);
  shoe.rotation.y = -0.45;
  shoe.scale.setScalar(0.85);
  group.add(shoe);

  // --- Discard tray (dealer's right) ---
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(CARD_W + 0.02, 0.07, CARD_H + 0.02),
    new THREE.MeshPhysicalMaterial({ color: 0xc8e6ff, transparent: true, opacity: 0.25, roughness: 0.1, transmission: 0 }),
  );
  tray.position.copy(DISCARD_POS).add(new THREE.Vector3(0, 0.035, 0));
  group.add(tray);
  const discardStack = new THREE.Mesh(
    new THREE.BoxGeometry(CARD_W, 1, CARD_H),
    [
      new THREE.MeshStandardMaterial({ color: 0xf3eedf }),
      new THREE.MeshStandardMaterial({ color: 0xf3eedf }),
      cardBackMaterial(),
      cardBackMaterial(),
      new THREE.MeshStandardMaterial({ color: 0xf3eedf }),
      new THREE.MeshStandardMaterial({ color: 0xf3eedf }),
    ],
  );
  discardStack.position.copy(DISCARD_POS);
  discardStack.castShadow = true;
  group.add(discardStack);

  // --- Dealer's chip rack ---
  const rack = new THREE.Group();
  const rackBase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.13), new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 0.3, metalness: 0.2 }));
  rackBase.position.y = 0.015;
  rackBase.castShadow = true;
  rack.add(rackBase);
  const values = [1000, 500, 500, 100, 100, 25, 25, 5, 5, 1];
  values.forEach((v, i) => {
    const side = chipSideTexture(v);
    side.wrapS = THREE.RepeatWrapping;
    side.repeat.set(1, 1);
    const tubeMat = new THREE.MeshStandardMaterial({ color: CHIP_COLORS[v], roughness: 0.5 });
    // A row of chips lying on edge, seen as one cylinder with striped sides.
    const row = new THREE.Mesh(new THREE.CylinderGeometry(CHIP_R, CHIP_R, 0.115, 20), [
      new THREE.MeshStandardMaterial({ map: side, roughness: 0.5 }),
      tubeMat,
      tubeMat,
    ]);
    row.rotation.x = Math.PI / 2;
    row.position.set(-0.18 + i * 0.04, 0.03 + CHIP_R * 0.6, 0);
    row.castShadow = true;
    rack.add(row);
  });
  rack.position.copy(RACK_POS);
  group.add(rack);

  const env: Environment = {
    group,
    lamp,
    extras,
    discardStack,
    shoeStack,
    setDiscardHeight(fraction: number) {
      const h = Math.max(0.0005, Math.min(0.06, fraction * 0.06));
      discardStack.scale.y = h;
      discardStack.position.y = TABLE_Y + h / 2;
      discardStack.visible = fraction > 0.001;
    },
    setShoeFill(fraction: number) {
      shoeStack.scale.y = Math.max(0.05, fraction);
    },
  };
  env.setDiscardHeight(0);
  return env;
}

/** The table limits placard, standing on the felt by the discard tray. */
export function buildLimitsSign(): THREE.Group {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 160);
  g.addColorStop(0, '#1b1410');
  g.addColorStop(1, '#0d0a08');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = '#c9a54a';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 148);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e3bc5f';
  ctx.font = '700 26px "Playfair Display", Georgia, serif';
  ctx.fillText('BLACKJACK', 128, 48);
  ctx.fillStyle = '#f3eedf';
  ctx.font = '600 22px Inter, system-ui, sans-serif';
  ctx.fillText('MIN 5 · MAX 500', 128, 92);
  ctx.font = '500 16px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(243, 238, 223, 0.7)';
  ctx.fillText('6 decks · S17 · 3:2', 128, 126);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Group();
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.075, 0.006),
    [
      new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.7, roughness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.7, roughness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.7, roughness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.7, roughness: 0.3 }),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ color: 0x15100c }),
    ],
  );
  face.position.y = 0.05;
  face.rotation.x = -0.25;
  face.castShadow = true;
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.008, 0.04), new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.7, roughness: 0.3 }));
  foot.position.y = 0.004;
  sign.add(face, foot);
  sign.position.set(-0.5, TABLE_Y, -0.36);
  sign.rotation.y = 0.35;
  return sign;
}
