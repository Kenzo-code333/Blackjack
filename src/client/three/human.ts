// Stylized people: the dealer, the other players, and your own character in the editor.
// Built from simple shapes so it stays light on phones. Faces look toward +z.

import * as THREE from 'three';
import { LOOK_OPTIONS, type Look } from '../../shared/protocol.js';

const cache = new Map<string, THREE.MeshStandardMaterial>();

function mat(color: string | number, roughness = 0.7, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${JSON.stringify(extra)}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    cache.set(key, m);
  }
  return m;
}

const shade = (hex: string, amount: number) => {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amount);
  return `#${c.getHexString()}`;
};

export const skinColor = (look: Look) => LOOK_OPTIONS.skin[look.skin] ?? LOOK_OPTIONS.skin[1];
export const hairColor = (look: Look) => LOOK_OPTIONS.hairColor[look.hairColor] ?? LOOK_OPTIONS.hairColor[0];
export const outfitColor = (look: Look) => LOOK_OPTIONS.outfit[look.outfit] ?? LOOK_OPTIONS.outfit[0];

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadow;
  return m;
}

export interface Head {
  group: THREE.Group;
  /** Scale these on y to blink. */
  eyes: THREE.Object3D[];
}

/** A head about 23 cm tall, centered on the origin. */
export function buildHead(look: Look): Head {
  const group = new THREE.Group();
  const skin = mat(skinColor(look), 0.62);
  const skinShade = mat(shade(skinColor(look), -0.06), 0.65);
  const hair = mat(hairColor(look), 0.85);

  const skull = mesh(new THREE.SphereGeometry(0.1, 28, 22), skin);
  skull.scale.set(0.9, 1.08, 0.98);
  const jaw = mesh(new THREE.SphereGeometry(0.075, 20, 14), skin);
  jaw.scale.set(1, 0.75, 1);
  jaw.position.set(0, -0.045, 0.018);
  group.add(skull, jaw);

  // Ears.
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.022, 12, 10), skinShade);
    ear.scale.set(0.45, 1, 0.7);
    ear.position.set(s * 0.09, 0.0, 0);
    group.add(ear);
  }

  // Eyes: white, iris, pupil and a brow above each.
  const eyes: THREE.Object3D[] = [];
  const white = mat('#f7f3ec', 0.3);
  const iris = mat(['#5b3a1e', '#2f5d8a', '#3f6b3a', '#2a1d14'][look.skin % 4]!, 0.3);
  const pupil = mat('#0c0a09', 0.2);
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    const ball = mesh(new THREE.SphereGeometry(0.016, 14, 10), white, false);
    ball.scale.set(1.15, 0.75, 0.6);
    const ir = mesh(new THREE.SphereGeometry(0.0085, 12, 8), iris, false);
    ir.position.z = 0.008;
    ir.scale.z = 0.4;
    const pu = mesh(new THREE.SphereGeometry(0.0042, 8, 6), pupil, false);
    pu.position.z = 0.0105;
    pu.scale.z = 0.4;
    eye.add(ball, ir, pu);
    eye.position.set(s * 0.034, 0.018, 0.084);
    eyes.push(eye);
    const brow = mesh(new THREE.BoxGeometry(0.032, 0.0055, 0.006), hair, false);
    brow.position.set(s * 0.035, 0.042, 0.092);
    brow.rotation.z = s * -0.12;
    group.add(eye, brow);
  }

  // Nose, lips, a little cheek colour.
  const nose = mesh(new THREE.SphereGeometry(0.014, 12, 10), skinShade, false);
  nose.scale.set(0.85, 1.2, 1.1);
  nose.position.set(0, -0.005, 0.097);
  const lips = mesh(new THREE.TorusGeometry(0.016, 0.0045, 6, 16, Math.PI), mat(shade(skinColor(look), -0.2), 0.5), false);
  lips.rotation.z = Math.PI;
  lips.position.set(0, -0.04, 0.088);
  lips.scale.set(1, 0.55, 1);
  group.add(nose, lips);

  // Hair.
  const style = LOOK_OPTIONS.hair[look.hair] ?? 'Short';
  // A hair cap: a dome tilted back, so it frames the forehead and covers the back of the head.
  const cap = (scale = 1.06, thetaLength = Math.PI * 0.5) => {
    const m = mesh(new THREE.SphereGeometry(0.1 * scale, 26, 16, 0, Math.PI * 2, 0, thetaLength), hair);
    m.scale.set(0.93, 1.08, 1.02);
    m.position.set(0, 0.008, -0.008);
    m.rotation.x = -0.55;
    return m;
  };
  switch (style) {
    case 'Short':
      group.add(cap());
      break;
    case 'Buzz cut':
      group.add(cap(1.015, Math.PI * 0.46));
      break;
    case 'Long': {
      group.add(cap(1.08, Math.PI * 0.52));
      const back = mesh(new THREE.CapsuleGeometry(0.085, 0.14, 6, 14), hair);
      back.scale.set(1.05, 1, 0.55);
      back.position.set(0, -0.07, -0.045);
      group.add(back);
      break;
    }
    case 'Bun': {
      group.add(cap(1.05));
      const bun = mesh(new THREE.SphereGeometry(0.04, 14, 12), hair);
      bun.position.set(0, 0.1, -0.06);
      group.add(bun);
      break;
    }
    case 'Ponytail': {
      group.add(cap(1.05));
      const tail = mesh(new THREE.CapsuleGeometry(0.022, 0.1, 4, 10), hair);
      tail.position.set(0, -0.02, -0.11);
      tail.rotation.x = 0.35;
      group.add(tail);
      break;
    }
    case 'Curly': {
      group.add(cap(1.04));
      const geo = new THREE.SphereGeometry(0.026, 10, 8);
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        const ring = i % 2;
        const curl = mesh(geo, hair);
        const r = 0.085 - ring * 0.025;
        curl.position.set(Math.cos(a) * r * 0.95, 0.07 + ring * 0.035, Math.sin(a) * r - 0.01);
        group.add(curl);
      }
      break;
    }
    // Bald: nothing.
  }

  // Accessories.
  const extra = LOOK_OPTIONS.extra[look.extra] ?? 'None';
  if (extra === 'Glasses' || extra === 'Sunglasses') {
    const frame = mat('#1a1a1a', 0.3, { metalness: 0.3 });
    for (const s of [-1, 1]) {
      if (extra === 'Sunglasses') {
        const lens = mesh(new THREE.CircleGeometry(0.019, 18), mat('#0d0f12', 0.1, { metalness: 0.6 }), false);
        lens.position.set(s * 0.035, 0.018, 0.1);
        group.add(lens);
      }
      const ring = mesh(new THREE.TorusGeometry(0.019, 0.0025, 6, 20), frame, false);
      ring.position.set(s * 0.035, 0.018, 0.099);
      group.add(ring);
    }
    const bridge = mesh(new THREE.BoxGeometry(0.03, 0.003, 0.003), frame, false);
    bridge.position.set(0, 0.022, 0.1);
    group.add(bridge);
  } else if (extra === 'Cap') {
    const c = mat(outfitColor(look), 0.6);
    const dome = mesh(new THREE.SphereGeometry(0.104, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), c);
    dome.position.y = 0.03;
    dome.scale.set(0.95, 0.85, 1);
    const brim = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.006, 20, 1, false, -Math.PI / 2, Math.PI), c);
    brim.position.set(0, 0.035, 0.07);
    brim.scale.set(1, 1, 0.9);
    group.add(dome, brim);
  } else if (extra === 'Beanie') {
    const c = mat(shade(outfitColor(look), -0.08), 0.95);
    const dome = mesh(new THREE.SphereGeometry(0.108, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), c);
    dome.position.y = 0.02;
    dome.scale.set(0.95, 1.05, 1);
    const fold = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 24, 1, true), c);
    fold.position.y = 0.02;
    fold.scale.set(0.95, 1, 1);
    group.add(dome, fold);
  }

  return { group, eyes };
}

export interface SeatedBody {
  group: THREE.Group;
  /** The upper body (leans and breathes); the head is inside it. */
  torso: THREE.Group;
  head: Head;
  /** Where the head sits, for name tags and speech bubbles. */
  headTop: number;
}

/** A seated player, hips at the origin, arms resting forward on the table rail. */
export function buildSeatedBody(look: Look, railHeight: number): SeatedBody {
  const group = new THREE.Group();
  const shirt = mat(outfitColor(look), 0.75);
  const skin = mat(skinColor(look), 0.62);
  const pants = mat('#1c1d22', 0.8);

  const hips = mesh(new THREE.CapsuleGeometry(0.13, 0.12, 4, 12), pants);
  hips.rotation.z = Math.PI / 2;
  hips.position.y = 0.55;
  group.add(hips);

  const torso = new THREE.Group();
  torso.position.y = 0.62;
  group.add(torso);
  const chest = mesh(new THREE.CapsuleGeometry(0.155, 0.22, 6, 16), shirt);
  chest.scale.set(1.1, 1, 0.68);
  chest.position.y = 0.21;
  const collar = mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 16), mat(shade(outfitColor(look), -0.1), 0.7), false);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.43;
  const neck = mesh(new THREE.CylinderGeometry(0.04, 0.046, 0.08, 12), skin);
  neck.position.y = 0.45;
  torso.add(chest, collar, neck);

  const head = buildHead(look);
  head.group.position.y = 0.6;
  torso.add(head.group);

  // Arms: shoulder → elbow on the rail → hands together in front.
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Vector3(s * 0.17, 0.39, 0);
    const elbow = new THREE.Vector3(s * 0.2, railHeight - 0.62 + 0.04, 0.2);
    const hand = new THREE.Vector3(s * 0.07, railHeight - 0.62 + 0.05, 0.36);
    const upper = limb(shoulder, elbow, 0.036, shirt);
    const lower = limb(elbow, hand, 0.031, shirt);
    const h = mesh(new THREE.SphereGeometry(0.03, 12, 10), skin);
    h.scale.set(0.9, 0.65, 1.2);
    h.position.copy(hand);
    torso.add(upper, lower, h);
  }
  return { group, torso, head, headTop: 0.62 + 0.6 + 0.12 };
}

/** A capsule from a to b. */
export function limb(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, len - radius * 2), 4, 10), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/** Shared blink timing: call every frame. */
export class Blinker {
  private t = 1 + Math.random() * 3;
  update(dt: number, eyes: THREE.Object3D[]): void {
    this.t -= dt;
    const closed = this.t < 0.11;
    if (this.t < 0) this.t = 2 + Math.random() * 4;
    for (const e of eyes) e.scale.y = closed ? 0.1 : 1;
  }
}
