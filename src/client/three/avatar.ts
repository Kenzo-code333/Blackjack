// Other players: simple seated figures with a name tag.

import * as THREE from 'three';
import { R_AVATAR, TABLE_Y, onArc } from './layout.js';
import { LabelSprite } from './textures.js';
import { damp } from './tween.js';

const COLORS = [0x2f6fb0, 0xc0782a, 0x7a4ba8, 0x2f8f6b, 0xb03b5a];
const SKIN = [0xe0b48f, 0xa8754f, 0xf1cfb0, 0x7b4e33, 0xd09a74];

export class Avatar {
  readonly group = new THREE.Group();
  readonly tag = new LabelSprite(400, 110, 0.085);
  private readonly body: THREE.Group;
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private phase = Math.random() * 10;
  private leanTarget = 0;
  private lean = 0;

  constructor(seat: number, angle: number) {
    const shirt = new THREE.MeshStandardMaterial({ color: COLORS[seat % COLORS.length], roughness: 0.75 });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN[seat % SKIN.length], roughness: 0.65 });
    const hair = new THREE.MeshStandardMaterial({ color: [0x2b1b10, 0x0f0f0f, 0x8a5a2b, 0x3a2a1a, 0xc9a36b][seat % 5], roughness: 0.8 });
    this.materials.push(shirt, skin, hair);

    this.body = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 6, 14), shirt);
    torso.scale.set(1.1, 1, 0.7);
    torso.position.y = 0.98;
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 16), skin);
    head.position.y = 1.36;
    head.castShadow = true;
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairCap.position.set(0, 1.375, -0.01);
    // Arms resting on the rail.
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.3, 4, 8), shirt);
      arm.position.set(s * 0.17, TABLE_Y + 0.12, 0.17);
      arm.rotation.set(Math.PI / 2.4, 0, -s * 0.35);
      arm.castShadow = true;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), skin);
      hand.position.set(s * 0.09, TABLE_Y + 0.06, 0.32);
      this.body.add(arm, hand);
    }
    // Chair back behind them.
    const chair = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.55, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x3a1a12, roughness: 0.5 }),
    );
    chair.position.set(0, 0.85, -0.2);
    chair.castShadow = true;
    this.body.add(torso, head, hairCap, chair);
    this.group.add(this.body);

    this.tag.position.set(0, 1.55, 0);
    this.group.add(this.tag);

    // The figure is modeled facing +z; turn it to face the table center.
    this.group.position.copy(onArc(angle, R_AVATAR, 0));
    this.group.rotation.y = angle + Math.PI;
  }

  setInfo(info: { name: string; balance: string; isTurn: boolean; away: boolean; host: boolean }): void {
    this.tag.set({
      text: `${info.host ? '👑 ' : ''}${info.name}`,
      sub: info.away ? 'away…' : info.balance,
      bg: info.isTurn ? 'rgba(46, 120, 74, 0.92)' : undefined,
    });
    this.leanTarget = info.isTurn ? 0.12 : 0;
    for (const m of this.materials) {
      m.transparent = info.away;
      m.opacity = info.away ? 0.45 : 1;
    }
  }

  update(dt: number): void {
    this.phase += dt;
    this.lean = damp(this.lean, this.leanTarget, 4, dt);
    this.body.position.y = Math.sin(this.phase * 1.3) * 0.004;
    this.body.rotation.x = this.lean + Math.sin(this.phase * 0.5) * 0.01;
    this.body.rotation.z = Math.sin(this.phase * 0.37) * 0.015;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
