// The dealer: a person in a white shirt, burgundy vest and bow tie.
// Arms use two-bone IK: animations just move each hand to a target and the elbows follow.

import * as THREE from 'three';
import { DEALER_POS, TABLE_Y } from './layout.js';
import type { Look } from '../../shared/protocol.js';
import { buildHead, skinColor } from './human.js';
import { type Animator, damp, ease } from './tween.js';

/** The house dealer's look: dark short hair, medium skin. */
const DEALER_LOOK: Look = { skin: 2, hair: 0, hairColor: 1, outfit: 5, extra: 0 };

export type Side = 'left' | 'right'; // the dealer's own left (+x) and right (−x)

const UPPER = 0.31;
const LOWER = 0.31;
const UP = new THREE.Vector3(0, 1, 0);

class Arm {
  readonly upper: THREE.Mesh;
  readonly lower: THREE.Mesh;
  readonly hand: THREE.Mesh;
  readonly shoulder = new THREE.Vector3();
  /** Where the hand is now / wants to be (world space). */
  readonly current = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  readonly rest = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();

  constructor(
    readonly side: Side,
    sleeve: THREE.Material,
    glove: THREE.Material,
    parent: THREE.Object3D,
  ) {
    this.upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, UPPER - 0.07, 4, 10), sleeve);
    this.lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, LOWER - 0.06, 4, 10), sleeve);
    this.hand = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 10), glove);
    this.hand.scale.set(1, 0.6, 1.25);
    for (const m of [this.upper, this.lower, this.hand]) {
      m.castShadow = true;
      parent.add(m);
    }
  }

  solve(pole: THREE.Vector3): void {
    const S = this.shoulder;
    const toTarget = this.current.clone().sub(S);
    const d = THREE.MathUtils.clamp(toTarget.length(), 0.08, UPPER + LOWER - 0.002);
    const dir = toTarget.normalize();
    const hand = S.clone().addScaledVector(dir, d);
    // Law of cosines: where along the shoulder→hand line the elbow sits, and how far off it.
    const x = (UPPER * UPPER - LOWER * LOWER + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, UPPER * UPPER - x * x));
    const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    this.elbow.copy(S).addScaledVector(dir, x).addScaledVector(perp, h);
    place(this.upper, S, this.elbow);
    place(this.lower, this.elbow, hand);
    this.hand.position.copy(hand);
    this.hand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hand.clone().sub(this.elbow).setY(0).normalize());
  }
}

/** Puts a Y-axis capsule between two points. */
function place(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
}

export class Dealer {
  readonly group = new THREE.Group();
  /** Arm meshes live in world space (not in `group`) so IK is easy. */
  readonly limbs = new THREE.Group();
  private readonly torso: THREE.Group;
  private readonly head: THREE.Group;
  private readonly eyes: THREE.Object3D[] = [];
  readonly arms: Record<Side, Arm>;
  private readonly lookTarget = new THREE.Vector3(0, 1.2, 1.5);
  private readonly lookCurrent = new THREE.Vector3(0, 1.2, 1.5);
  private lean = 0;
  private leanTarget = 0;
  private blinkTimer = 2;
  private time = 0;

  constructor(private readonly anim: Animator) {
    const shirt = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.7 });
    const vest = new THREE.MeshStandardMaterial({ color: 0x5b1420, roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.35, metalness: 0.4 });
    const skin = new THREE.MeshStandardMaterial({ color: skinColor(DEALER_LOOK), roughness: 0.62 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd2a94a, metalness: 0.8, roughness: 0.3 });

    this.group.position.copy(DEALER_POS);
    this.group.scale.setScalar(0.93);

    // Hips and legs (mostly hidden by the table).
    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.25, 16), dark);
    hips.position.y = 0.8;
    this.group.add(hips);

    // Torso pivots at the waist so the dealer can lean over the table.
    this.torso = new THREE.Group();
    this.torso.position.y = 0.9;
    this.group.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.22, 6, 18), shirt);
    chest.scale.set(1.05, 1, 0.68);
    chest.position.y = 0.24;
    chest.castShadow = true;
    const vestMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.175, 0.19, 6, 18), vest);
    vestMesh.scale.set(1.07, 0.95, 0.7);
    vestMesh.position.set(0, 0.21, -0.004);
    vestMesh.castShadow = true;
    // Shirt "V" at the front: a thin light wedge over the vest.
    const vee = new THREE.Mesh(new THREE.CircleGeometry(0.09, 3), shirt);
    vee.rotation.z = -Math.PI / 2;
    vee.scale.set(1.5, 0.6, 1);
    vee.position.set(0, 0.4, 0.124);
    const bow = new THREE.Group();
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 4), dark);
      wing.rotation.z = (s * Math.PI) / 2;
      wing.position.x = s * 0.03;
      bow.add(wing);
    }
    bow.position.set(0, 0.46, 0.118);
    const nameBadge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.018, 0.005), gold);
    nameBadge.position.set(0.08, 0.32, 0.122);
    const buttons = [0.27, 0.2, 0.13].map((y) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), gold);
      b.position.set(0, y, 0.122);
      return b;
    });
    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.3, 4, 10), vest);
    shoulders.rotation.z = Math.PI / 2;
    shoulders.position.y = 0.43;
    this.torso.add(chest, vestMesh, vee, bow, nameBadge, shoulders, ...buttons);

    // Neck and head: a person, with a neat side part and a friendly face.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.09, 12), skin);
    neck.position.y = 0.52;
    this.torso.add(neck);
    this.head = new THREE.Group();
    this.head.position.y = 0.66;
    this.torso.add(this.head);
    const face = buildHead(DEALER_LOOK);
    face.group.scale.setScalar(1.08);
    this.head.add(face.group);
    this.eyes.push(...face.eyes);

    this.arms = {
      left: new Arm('left', shirt, skin, this.limbs),
      right: new Arm('right', shirt, skin, this.limbs),
    };
    this.arms.left.rest.set(0.17, TABLE_Y + 0.04, DEALER_POS.z + 0.36);
    this.arms.right.rest.set(-0.17, TABLE_Y + 0.04, DEALER_POS.z + 0.36);
    for (const arm of Object.values(this.arms)) {
      arm.current.copy(arm.rest);
      arm.target.copy(arm.rest);
    }
  }

  /** Moves a hand to `point` over `duration` seconds. */
  async reach(side: Side, point: THREE.Vector3, duration = 0.2): Promise<void> {
    const arm = this.arms[side];
    const from = arm.target.clone();
    const to = point.clone();
    // Lean in toward far targets.
    this.leanTarget = THREE.MathUtils.clamp((to.z - (DEALER_POS.z + 0.35)) * 0.55, 0, 0.35);
    await this.anim.tween(duration, (k) => arm.target.lerpVectors(from, to, k), ease.inOutCubic);
  }

  /** Hand follows a moving point (e.g. while sliding a card) until `release()` is called. */
  follow(side: Side, point: THREE.Vector3): void {
    this.arms[side].target.copy(point);
    this.leanTarget = THREE.MathUtils.clamp((point.z - (DEALER_POS.z + 0.35)) * 0.55, 0, 0.35);
  }

  rest(side: Side, duration = 0.3): Promise<void> {
    const p = this.reach(side, this.arms[side].rest, duration);
    if (side === 'left' || this.arms.left.target.distanceTo(this.arms.left.rest) < 0.01) this.leanTarget = 0;
    return p;
  }

  lookAt(point: THREE.Vector3): void {
    this.lookTarget.copy(point);
  }

  /** The shuffle: hands come together and riffle a few times. */
  async shuffle(): Promise<void> {
    const center = new THREE.Vector3(0, TABLE_Y + 0.06, DEALER_POS.z + 0.42);
    this.lookAt(center);
    await Promise.all([
      this.reach('left', center.clone().add(new THREE.Vector3(0.1, 0, 0)), 0.3),
      this.reach('right', center.clone().add(new THREE.Vector3(-0.1, 0, 0)), 0.3),
    ]);
    for (let i = 0; i < 3; i++) {
      await Promise.all([
        this.reach('left', center.clone().add(new THREE.Vector3(0.03, 0.04, 0)), 0.18),
        this.reach('right', center.clone().add(new THREE.Vector3(-0.03, 0.04, 0)), 0.18),
      ]);
      await Promise.all([
        this.reach('left', center.clone().add(new THREE.Vector3(0.12, 0, 0)), 0.18),
        this.reach('right', center.clone().add(new THREE.Vector3(-0.12, 0, 0)), 0.18),
      ]);
    }
    await Promise.all([this.rest('left'), this.rest('right')]);
  }

  update(dt: number): void {
    this.time += dt;
    // Idle: breathing and a slight sway.
    this.lean = damp(this.lean, this.leanTarget, 6, dt);
    this.torso.rotation.x = this.lean + Math.sin(this.time * 1.4) * 0.008;
    this.torso.rotation.z = Math.sin(this.time * 0.6) * 0.01;
    this.torso.scale.setScalar(1 + Math.sin(this.time * 1.4) * 0.006);

    // Head turns smoothly toward what it's looking at.
    this.lookCurrent.x = damp(this.lookCurrent.x, this.lookTarget.x, 5, dt);
    this.lookCurrent.y = damp(this.lookCurrent.y, this.lookTarget.y, 5, dt);
    this.lookCurrent.z = damp(this.lookCurrent.z, this.lookTarget.z, 5, dt);
    const headWorld = this.head.getWorldPosition(new THREE.Vector3());
    const d = this.lookCurrent.clone().sub(headWorld);
    this.head.rotation.y = THREE.MathUtils.clamp(Math.atan2(d.x, d.z), -0.9, 0.9);
    this.head.rotation.x = THREE.MathUtils.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.5, 0.4) - this.lean;

    // Blink every few seconds.
    this.blinkTimer -= dt;
    const blink = this.blinkTimer < 0.12 ? 0.1 : 1;
    if (this.blinkTimer < 0) this.blinkTimer = 2 + Math.random() * 3.5;
    for (const e of this.eyes) e.scale.y = blink;

    // Arms: hands ease toward targets; shoulders move with the torso.
    this.torso.updateMatrixWorld();
    for (const arm of Object.values(this.arms)) {
      const sx = arm.side === 'left' ? 0.2 : -0.2;
      arm.shoulder.set(sx, 0.43, 0).applyMatrix4(this.torso.matrixWorld);
      arm.current.x = damp(arm.current.x, arm.target.x, 18, dt);
      arm.current.y = damp(arm.current.y, arm.target.y, 18, dt);
      arm.current.z = damp(arm.current.z, arm.target.z, 18, dt);
      // Elbows point down and out.
      arm.solve(new THREE.Vector3(arm.side === 'left' ? 0.7 : -0.7, -1, -0.3).normalize());
    }
  }
}
