// Stylized people: the dealer, the other players, and your own character in the editor.
// Soft, friendly proportions: painted facial features on a face layer, small eyes set
// into the head with real eyelids, and jointed arms for hand signals. Faces look toward +z.

import * as THREE from 'three';
import { LOOK_OPTIONS, type Look } from '../../shared/protocol.js';

const cache = new Map<string, THREE.Material>();

function mat(color: string | number, roughness = 0.7, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${JSON.stringify(extra)}`;
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    cache.set(key, m);
  }
  return m;
}

const shade = (hex: string, amount: number, sat = 0) => {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, sat, amount);
  return `#${c.getHexString()}`;
};

export const skinColor = (look: Look) => LOOK_OPTIONS.skin[look.skin] ?? LOOK_OPTIONS.skin[1];
export const hairColor = (look: Look) => LOOK_OPTIONS.hairColor[look.hairColor] ?? LOOK_OPTIONS.hairColor[0];
export const outfitColor = (look: Look) => LOOK_OPTIONS.outfit[look.outfit] ?? LOOK_OPTIONS.outfit[0];

/** Skin: a little warmth of its own so faces never go grey in the dim room. */
function skinMat(look: Look): THREE.MeshStandardMaterial {
  const color = skinColor(look);
  return mat(color, 0.5, { emissive: new THREE.Color(color).multiplyScalar(0.12).getHex() });
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadow;
  return m;
}

// ---------- Face layer ----------

// The face layer is a slice of a sphere just outside the skull; the canvas maps onto it.
const FACE = { phiStart: Math.PI / 2 - 0.95, phiLength: 1.9, thetaStart: Math.PI * 0.28, thetaLength: Math.PI * 0.52 };

const faceTextures = new Map<string, THREE.CanvasTexture>();

/** Brows, nose shading, cheeks and a gentle smile, painted on a transparent canvas. */
function faceTexture(look: Look): THREE.CanvasTexture {
  const key = `${look.skin}|${look.hairColor}`;
  const cached = faceTextures.get(key);
  if (cached) return cached;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const skin = new THREE.Color(skinColor(look));
  const dark = skin.getHSL({ h: 0, s: 0, l: 0 }).l < 0.45;

  // Canvas x follows the angle around the head; y goes from forehead (top) to chin (bottom).
  const xAt = (offset: number) => S / 2 + (offset / FACE.phiLength) * S;
  const yAt = (theta: number) => ((theta - FACE.thetaStart) / FACE.thetaLength) * S;
  const eyeY = yAt(Math.PI * 0.45);

  // Cheeks.
  for (const s of [-1, 1]) {
    const g = ctx.createRadialGradient(xAt(s * 0.42), eyeY + 42, 2, xAt(s * 0.42), eyeY + 42, 26);
    g.addColorStop(0, dark ? 'rgba(150, 60, 50, 0.18)' : 'rgba(230, 110, 100, 0.22)');
    g.addColorStop(1, 'rgba(230, 110, 100, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }

  // Eyebrows: soft, slightly arched strokes in the hair colour.
  ctx.strokeStyle = hairColor(look);
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(xAt(s * 0.17), eyeY - 21);
    ctx.quadraticCurveTo(xAt(s * 0.33), eyeY - 29, xAt(s * 0.5), eyeY - 20);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Soft shadows that shape the eyes and the nose.
  const shadow = dark ? 'rgba(20, 8, 4, 0.25)' : 'rgba(90, 40, 20, 0.16)';
  for (const s of [-1, 1]) {
    const g = ctx.createRadialGradient(xAt(s * 0.33), eyeY - 2, 4, xAt(s * 0.33), eyeY - 2, 20);
    g.addColorStop(0, shadow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  // Nostrils.
  ctx.fillStyle = dark ? 'rgba(25, 10, 5, 0.45)' : 'rgba(100, 45, 30, 0.35)';
  const noseY = yAt(Math.PI * 0.53);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(xAt(s * 0.06), noseY, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Lips with a small, friendly smile.
  const mouthY = yAt(Math.PI * 0.6);
  const lip = `#${skin.clone().offsetHSL(-0.02, 0.12, -0.16).getHexString()}`;
  ctx.fillStyle = lip;
  ctx.beginPath();
  ctx.moveTo(xAt(-0.2), mouthY - 2);
  ctx.quadraticCurveTo(xAt(0), mouthY - 8, xAt(0.2), mouthY - 2);
  ctx.quadraticCurveTo(xAt(0), mouthY + 12, xAt(-0.2), mouthY - 2);
  ctx.fill();
  ctx.strokeStyle = dark ? 'rgba(20, 6, 4, 0.6)' : 'rgba(110, 40, 35, 0.55)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(xAt(-0.21), mouthY - 3);
  ctx.quadraticCurveTo(xAt(0), mouthY + 6, xAt(0.21), mouthY - 3);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  faceTextures.set(key, tex);
  return tex;
}

export interface Head {
  group: THREE.Group;
  /** Eyelids: scale on y from 0.15 (open) to 1 (closed). */
  lids: THREE.Object3D[];
}

const R = 0.1; // head radius

/** Shapes a sphere into a head: slightly taller, narrowing toward the chin, a flatter back. */
function shapeHead(geo: THREE.BufferGeometry, inflate = 1): THREE.BufferGeometry {
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const ny = y / (R * inflate);
    x *= 0.88;
    y *= 1.1;
    z *= z < 0 ? 0.92 : 0.98;
    if (ny < 0) {
      // Taper the lower face into a soft chin.
      const taper = 1 - 0.22 * ny * ny;
      x *= taper;
      z = z > 0 ? z * (1 - 0.06 * ny * ny) : z * taper;
    }
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A head about 23 cm tall, centered on the origin. */
export function buildHead(look: Look): Head {
  const group = new THREE.Group();
  const skin = skinMat(look);
  const hair = mat(hairColor(look), 0.62, { metalness: 0.05 });

  const skull = mesh(shapeHead(new THREE.SphereGeometry(R, 40, 30)), skin);
  group.add(skull);

  // Painted features on a thin layer just above the skin, shaped exactly like the head.
  const faceGeo = shapeHead(new THREE.SphereGeometry(R * 1.003, 40, 24, FACE.phiStart, FACE.phiLength, FACE.thetaStart, FACE.thetaLength), 1.003);
  const face = mesh(faceGeo, new THREE.MeshStandardMaterial({ map: faceTexture(look), transparent: true, roughness: 0.6, depthWrite: false }), false);
  face.renderOrder = 1;
  group.add(face);

  // Ears.
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.02, 12, 10), skin);
    ear.scale.set(0.45, 1, 0.7);
    ear.position.set(s * 0.087, -0.002, -0.004);
    group.add(ear);
  }

  // Nose: small and soft.
  const nose = mesh(new THREE.SphereGeometry(0.0125, 14, 10), skin, false);
  nose.scale.set(0.85, 1.15, 1.05);
  nose.position.set(0, -0.01, 0.1);
  group.add(nose);

  // Eyes: set into the head, mostly iris, with a catch-light and an upper lid that blinks.
  const lids: THREE.Object3D[] = [];
  const white = mat('#f4efe6', 0.25);
  const iris = mat(['#4a2f19', '#2e5675', '#3e5f35', '#2a1d14', '#5a4630', '#3a2a1d'][look.skin % 6]!, 0.25);
  const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    const ball = mesh(new THREE.SphereGeometry(0.013, 16, 12), white, false);
    ball.scale.set(1.25, 0.8, 0.55);
    const ir = mesh(new THREE.CircleGeometry(0.0072, 18), iris, false);
    ir.position.z = 0.0072;
    const pupil = mesh(new THREE.CircleGeometry(0.0032, 12), mat('#0b0908', 0.2), false);
    pupil.position.z = 0.0074;
    const shine = mesh(new THREE.CircleGeometry(0.0016, 8), glint, false);
    shine.position.set(0.002, 0.0025, 0.0076);
    // Upper lid: a skin-coloured half-shell over the eye, pivoting at its top edge.
    const lid = mesh(new THREE.SphereGeometry(0.0142, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin, false);
    lid.scale.set(1.2, 0.15, 0.62);
    lid.position.y = 0.0005;
    eye.add(ball, ir, pupil, shine, lid);
    eye.position.set(s * 0.031, 0.013, 0.087);
    group.add(eye);
    lids.push(lid);
  }

  const extra = LOOK_OPTIONS.extra[look.extra] ?? 'None';
  addHair(group, look, hair, extra === 'Cap' || extra === 'Beanie');
  addAccessory(group, look);
  return { group, lids };
}

/** With a hat on, only the hair that shows below it is built (sides, back, ponytail). */
function addHair(group: THREE.Group, look: Look, hair: THREE.Material, hatted: boolean): void {
  const style = LOOK_OPTIONS.hair[look.hair] ?? 'Short';
  if (hatted) {
    if (style === 'Bald' || style === 'Buzz cut') return;
    // A band of hair at the back of the neck, under the hat.
    const nape = mesh(new THREE.SphereGeometry(R * 1.02, 24, 10, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.45, Math.PI * 0.2), hair);
    nape.rotation.y = Math.PI;
    nape.scale.set(0.93, 1.08, 1.02);
    group.add(nape);
    if (style === 'Long') {
      const back = mesh(new THREE.CapsuleGeometry(0.08, 0.15, 6, 16), hair);
      back.scale.set(1.08, 1, 0.5);
      back.position.set(0, -0.075, -0.05);
      group.add(back);
    } else if (style === 'Ponytail') {
      const tail = mesh(new THREE.CapsuleGeometry(0.021, 0.11, 4, 10), hair);
      tail.position.set(0, -0.025, -0.11);
      tail.rotation.x = 0.35;
      group.add(tail);
    }
    return;
  }
  // A dome tilted back, framing the forehead and covering the back of the head.
  const cap = (scale = 1.06, thetaLength = Math.PI * 0.5, tilt = -0.55) => {
    const m = mesh(new THREE.SphereGeometry(R * scale, 28, 16, 0, Math.PI * 2, 0, thetaLength), hair);
    m.scale.set(0.93, 1.08, 1.02);
    m.position.set(0, 0.008, -0.008);
    m.rotation.x = tilt;
    return m;
  };
  switch (style) {
    case 'Short': {
      group.add(cap(1.06, Math.PI * 0.5, -0.72));
      // A side-swept fringe.
      const fringe = mesh(new THREE.SphereGeometry(R * 0.55, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), hair);
      fringe.scale.set(1.35, 0.32, 0.75);
      fringe.position.set(0.014, 0.08, 0.04);
      fringe.rotation.set(0.35, 0, -0.25);
      group.add(fringe);
      break;
    }
    case 'Buzz cut':
      group.add(cap(1.012, Math.PI * 0.47));
      break;
    case 'Long': {
      group.add(cap(1.08, Math.PI * 0.52));
      const back = mesh(new THREE.CapsuleGeometry(0.08, 0.15, 6, 16), hair);
      back.scale.set(1.08, 1, 0.5);
      back.position.set(0, -0.075, -0.05);
      group.add(back);
      for (const s of [-1, 1]) {
        const side = mesh(new THREE.CapsuleGeometry(0.022, 0.12, 4, 10), hair);
        side.position.set(s * 0.08, -0.05, 0.0);
        group.add(side);
      }
      break;
    }
    case 'Bun': {
      group.add(cap(1.05));
      const bun = mesh(new THREE.SphereGeometry(0.038, 16, 12), hair);
      bun.position.set(0, 0.1, -0.06);
      group.add(bun);
      break;
    }
    case 'Ponytail': {
      group.add(cap(1.05));
      const tail = mesh(new THREE.CapsuleGeometry(0.021, 0.11, 4, 10), hair);
      tail.position.set(0, -0.025, -0.11);
      tail.rotation.x = 0.35;
      group.add(tail);
      break;
    }
    case 'Curly': {
      group.add(cap(1.04));
      const geo = new THREE.SphereGeometry(0.024, 10, 8);
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2;
        const ring = i % 3;
        const r = 0.088 - ring * 0.022;
        const curl = mesh(geo, hair);
        curl.position.set(Math.cos(a) * r * 0.95, 0.06 + ring * 0.028, Math.sin(a) * r - 0.018);
        group.add(curl);
      }
      break;
    }
    // Bald: nothing.
  }
}

function addAccessory(group: THREE.Group, look: Look): void {
  const extra = LOOK_OPTIONS.extra[look.extra] ?? 'None';
  if (extra === 'Glasses' || extra === 'Sunglasses') {
    const frame = mat('#2a2522', 0.35, { metalness: 0.4 });
    for (const s of [-1, 1]) {
      if (extra === 'Sunglasses') {
        const lens = mesh(new THREE.CircleGeometry(0.018, 20), mat('#121418', 0.08, { metalness: 0.7 }), false);
        lens.position.set(s * 0.032, 0.012, 0.094);
        group.add(lens);
      }
      const ring = mesh(new THREE.TorusGeometry(0.018, 0.0018, 6, 24), frame, false);
      ring.position.set(s * 0.032, 0.012, 0.093);
      group.add(ring);
      const arm = mesh(new THREE.BoxGeometry(0.002, 0.002, 0.09), frame, false);
      arm.position.set(s * 0.083, 0.014, 0.05);
      group.add(arm);
    }
    const bridge = mesh(new THREE.BoxGeometry(0.028, 0.0022, 0.0022), frame, false);
    bridge.position.set(0, 0.016, 0.095);
    group.add(bridge);
  } else if (extra === 'Cap') {
    const c = mat(outfitColor(look), 0.6);
    const dome = mesh(new THREE.SphereGeometry(0.104, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), c);
    dome.position.set(0, 0.045, -0.006);
    dome.scale.set(0.93, 0.82, 1);
    dome.rotation.x = -0.12;
    const brim = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.006, 24, 1, false, -Math.PI / 2, Math.PI), mat(shade(outfitColor(look), -0.12), 0.6));
    brim.position.set(0, 0.05, 0.075);
    brim.scale.set(0.95, 1, 1);
    brim.rotation.x = 0.18;
    group.add(dome, brim);
  } else if (extra === 'Beanie') {
    // A snug knitted beanie: ribbed crown, a turned-up cuff just above the brows, a pom-pom.
    const knit = new THREE.MeshStandardMaterial({ map: knitTexture(outfitColor(look)), roughness: 1 });
    const crown = mesh(new THREE.SphereGeometry(R * 1.09, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), knit);
    crown.scale.set(0.93, 1.12, 1.0);
    crown.position.set(0, 0.03, -0.01);
    crown.rotation.x = -0.32;
    const cuffMat = new THREE.MeshStandardMaterial({ map: knitTexture(shade(outfitColor(look), -0.06), 2), roughness: 1 });
    const cuff = mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.05, 0.032, 32, 1, true), cuffMat);
    cuff.scale.set(0.93, 1, 1.0);
    cuff.position.set(0, 0.07, -0.018);
    cuff.rotation.x = -0.32;
    const pom = mesh(new THREE.IcosahedronGeometry(0.024, 2), new THREE.MeshStandardMaterial({ color: shade(outfitColor(look), 0.12), roughness: 1, flatShading: true }));
    pom.position.set(0, 0.14, -0.06);
    group.add(crown, cuff, pom);
  }
}

const knitTextures = new Map<string, THREE.CanvasTexture>();

/** Vertical ribs with a little stitch texture, for knitted things. */
function knitTexture(color: string, repeat = 1): THREE.CanvasTexture {
  const key = `${color}|${repeat}`;
  const cached = knitTextures.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 64);
  for (let x = 0; x < 256; x += 8) {
    const g = ctx.createLinearGradient(x, 0, x + 8, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.28)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 8, 64);
  }
  // Stitches: small offset dashes.
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < 64; y += 4) for (let x = (y / 4) % 2 ? 4 : 0; x < 256; x += 8) ctx.fillRect(x + 2, y, 4, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2 * repeat, 1);
  knitTextures.set(key, tex);
  return tex;
}

// ---------- Arms ----------

const UP = new THREE.Vector3(0, 1, 0);

/** A capsule from a to b. */
export function limb(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const m = mesh(new THREE.CapsuleGeometry(radius, 1, 4, 12), material);
  placeLimb(m, a, b, radius);
  return m;
}

function placeLimb(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number): void {
  const len = Math.max(0.001, a.distanceTo(b));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  // The capsule's straight part is 1 m long; stretch it to the bone length.
  m.scale.set(1, Math.max(0.01, (len - radius * 2) / 1 + (radius * 2) / 1), 1);
  m.scale.y = len / (1 + radius * 2);
}

/** A mitten hand with a thumb: reads as a hand from across the table. */
function buildHand(skin: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const palm = mesh(new THREE.SphereGeometry(0.028, 14, 10), skin);
  palm.scale.set(0.95, 0.45, 1.3);
  const thumb = mesh(new THREE.CapsuleGeometry(0.008, 0.02, 4, 8), skin);
  thumb.position.set(0.024, 0, 0.004);
  thumb.rotation.z = -1.1;
  g.add(palm, thumb);
  return g;
}

/**
 * A two-bone arm in some parent's local space. Move `target` (where the hand should
 * be) and call `solve()`: the elbow is placed with the law of cosines.
 */
export class JointedArm {
  readonly upper: THREE.Mesh;
  readonly lower: THREE.Mesh;
  readonly hand: THREE.Group;
  readonly target = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();

  constructor(
    readonly shoulder: THREE.Vector3,
    readonly upperLen: number,
    readonly lowerLen: number,
    private readonly radius: number,
    sleeve: THREE.Material,
    skin: THREE.Material,
    parent: THREE.Object3D,
    private readonly pole: THREE.Vector3,
  ) {
    this.upper = mesh(new THREE.CapsuleGeometry(radius, 1, 4, 12), sleeve);
    this.lower = mesh(new THREE.CapsuleGeometry(radius * 0.86, 1, 4, 12), sleeve);
    this.hand = buildHand(skin);
    if (shoulder.x < 0) this.hand.scale.x = -1; // mirror the thumb for the left hand
    parent.add(this.upper, this.lower, this.hand);
  }

  solve(): void {
    const S = this.shoulder;
    const a = this.upperLen;
    const b = this.lowerLen;
    const to = this.target.clone().sub(S);
    const d = THREE.MathUtils.clamp(to.length(), 0.05, a + b - 0.001);
    const dir = to.normalize();
    const hand = S.clone().addScaledVector(dir, d);
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const perp = this.pole.clone().sub(dir.clone().multiplyScalar(this.pole.dot(dir))).normalize();
    this.elbow.copy(S).addScaledVector(dir, x).addScaledVector(perp, h);
    placeLimb(this.upper, S, this.elbow, this.radius);
    placeLimb(this.lower, this.elbow, hand, this.radius * 0.86);
    this.hand.position.copy(hand);
    const fwd = hand.clone().sub(this.elbow).setY(0);
    if (fwd.lengthSq() > 1e-6) this.hand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fwd.normalize());
  }
}

// ---------- Seated players ----------

export type Gesture = 'hit' | 'stand' | 'double' | 'split';

export interface SeatedBody {
  group: THREE.Group;
  /** The upper body (leans and breathes); the head is inside it. */
  torso: THREE.Group;
  head: Head;
  /** Where the head sits, for name tags and speech bubbles. */
  headTop: number;
  arms: { left: JointedArm; right: JointedArm };
  /** Where each hand rests on the table, in torso space. */
  rest: { left: THREE.Vector3; right: THREE.Vector3 };
}

/** A seated player, hips at the origin, forearms resting on the table rail. */
export function buildSeatedBody(look: Look, railHeight: number): SeatedBody {
  const group = new THREE.Group();
  const shirt = mat(outfitColor(look), 0.78);
  const skin = skinMat(look);
  const pants = mat('#1f2026', 0.85);

  const hips = mesh(new THREE.CapsuleGeometry(0.12, 0.12, 4, 12), pants);
  hips.rotation.z = Math.PI / 2;
  hips.position.y = 0.55;
  group.add(hips);

  const torso = new THREE.Group();
  torso.position.y = 0.62;
  group.add(torso);
  const chest = mesh(new THREE.CapsuleGeometry(0.14, 0.2, 8, 20), shirt);
  chest.scale.set(1.12, 1, 0.66);
  chest.position.y = 0.2;
  const shoulders = mesh(new THREE.CapsuleGeometry(0.065, 0.24, 6, 14), shirt);
  shoulders.rotation.z = Math.PI / 2;
  shoulders.scale.set(1, 1, 0.8);
  shoulders.position.y = 0.37;
  const neck = mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.08, 14), skin);
  neck.position.y = 0.435;
  torso.add(chest, shoulders, neck);

  const head = buildHead(look);
  head.group.position.y = 0.565;
  torso.add(head.group);

  const railY = railHeight - 0.62 + 0.06;
  const rest = { left: new THREE.Vector3(-0.08, railY, 0.36), right: new THREE.Vector3(0.08, railY, 0.36) };
  const arms = {
    left: new JointedArm(new THREE.Vector3(-0.175, 0.37, 0), 0.27, 0.26, 0.034, shirt, skin, torso, new THREE.Vector3(-0.8, -0.6, -0.2).normalize()),
    right: new JointedArm(new THREE.Vector3(0.175, 0.37, 0), 0.27, 0.26, 0.034, shirt, skin, torso, new THREE.Vector3(0.8, -0.6, -0.2).normalize()),
  };
  arms.left.target.copy(rest.left);
  arms.right.target.copy(rest.right);
  arms.left.solve();
  arms.right.solve();
  return { group, torso, head, headTop: 0.62 + 0.6 + 0.12, arms, rest };
}

/** Hand offsets over time for each casino hand signal (t in seconds since it started). */
export function gestureOffset(g: Gesture, t: number, side: 'left' | 'right'): THREE.Vector3 | null {
  const v = new THREE.Vector3();
  switch (g) {
    case 'hit': {
      // Tap the felt twice with the right hand.
      if (side === 'left' || t > 0.8) return t > 0.8 ? null : v;
      const phase = (t / 0.4) * Math.PI * 2;
      v.set(0.02, Math.max(0, Math.sin(phase)) * 0.06, 0.1);
      return v;
    }
    case 'stand': {
      // Wave the right hand flat over the cards.
      if (t > 0.9) return null;
      if (side === 'left') return v;
      const lift = Math.sin(Math.min(1, t / 0.15) * Math.PI * 0.5) * Math.sin(Math.min(1, (0.9 - t) / 0.15) * Math.PI * 0.5);
      v.set(Math.sin(t * Math.PI * 2 * 2.2) * 0.05, 0.05 * lift, 0.13 * lift);
      return v;
    }
    case 'double':
    case 'split': {
      // Push chips forward next to the bet.
      if (t > 1) return null;
      const k = Math.sin(Math.min(1, t) * Math.PI);
      if (side === 'left' && g === 'double') return v;
      v.set(side === 'left' ? -0.02 : 0.02, 0.02 * k, 0.16 * k);
      return v;
    }
  }
}

/** Shared blink timing: call every frame. */
export class Blinker {
  private t = 1 + Math.random() * 3;
  update(dt: number, lids: THREE.Object3D[]): void {
    this.t -= dt;
    const closed = this.t < 0.12;
    if (this.t < 0) this.t = 2.5 + Math.random() * 4;
    for (const l of lids) l.scale.y = closed ? 1 : 0.15;
  }
}
