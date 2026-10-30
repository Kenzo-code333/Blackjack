// Other players: seated people built from their chosen look, with a name tag and
// a speech bubble when they chat.

import * as THREE from 'three';
import type { Look } from '../../shared/protocol.js';
import { Blinker, type Gesture, type SeatedBody, buildSeatedBody, gestureOffset } from './human.js';
import { R_AVATAR, TABLE_Y, onArc } from './layout.js';
import { LabelSprite } from './textures.js';
import { damp } from './tween.js';

export class Avatar {
  readonly group = new THREE.Group();
  readonly tag = new LabelSprite(400, 110, 0.085);
  private readonly bubble = new LabelSprite(640, 96, 0.075);
  private body!: SeatedBody;
  private lookKey = '';
  private readonly blinker = new Blinker();
  private phase = Math.random() * 10;
  private leanTarget = 0;
  private lean = 0;
  private bubbleUntil = 0;
  private clock = 0;
  private gesture: { kind: Gesture; start: number } | null = null;

  constructor(angle: number, look: Look) {
    this.setLook(look);
    this.group.add(this.tag, this.bubble);
    this.bubble.visible = false;
    // The figure is modeled facing +z; turn it to face the table center.
    this.group.position.copy(onArc(angle, R_AVATAR, 0));
    this.group.rotation.y = angle + Math.PI;
  }

  /** Rebuilds the figure when the player's look changes. */
  setLook(look: Look): void {
    const key = JSON.stringify(look);
    if (key === this.lookKey) return;
    this.lookKey = key;
    if (this.body) this.group.remove(this.body.group);
    this.body = buildSeatedBody(look, TABLE_Y);
    this.group.add(this.body.group);
    this.tag.position.set(0, this.body.headTop + 0.1, 0);
    this.bubble.position.set(0, this.body.headTop + 0.22, 0);
  }

  setInfo(info: { name: string; balance: string; isTurn: boolean; away: boolean; host: boolean; bot: boolean }): void {
    this.tag.set({
      text: `${info.host ? '👑 ' : ''}${info.name}${info.bot ? ' · bot' : ''}`,
      sub: info.away ? 'away…' : info.balance,
      bg: info.isTurn ? 'rgba(46, 120, 74, 0.92)' : undefined,
    });
    this.leanTarget = info.isTurn ? 0.14 : 0;
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || o instanceof THREE.Sprite) return;
      // Away players fade a little. Materials are shared, so only toggle when needed.
      o.visible = true;
    });
    this.body.group.visible = true;
    this.body.group.scale.setScalar(info.away ? 0.97 : 1);
  }

  /** Shows a chat line above their head for a few seconds. */
  say(text: string): void {
    const short = text.length > 42 ? `${text.slice(0, 40)}…` : text;
    this.bubble.set({ text: short, bg: 'rgba(250, 246, 236, 0.95)', color: '#1d1a16' });
    this.bubble.visible = true;
    this.bubbleUntil = this.clock + 5;
  }

  /** A casino hand signal: tap the felt to hit, wave to stand, push chips to double or split. */
  signal(kind: Gesture): void {
    this.gesture = { kind, start: this.clock };
  }

  /** Where to look to see this player's face. */
  faceWorld(): THREE.Vector3 {
    return this.body.head.group.getWorldPosition(new THREE.Vector3());
  }

  update(dt: number): void {
    this.clock += dt;
    this.phase += dt;
    this.lean = damp(this.lean, this.leanTarget, 4, dt);
    this.body.torso.rotation.x = this.lean + Math.sin(this.phase * 0.5) * 0.01;
    this.body.torso.rotation.z = Math.sin(this.phase * 0.37) * 0.012;
    this.body.torso.position.y = 0.62 + Math.sin(this.phase * 1.3) * 0.003;
    this.body.head.group.rotation.y = Math.sin(this.phase * 0.23) * 0.25;
    this.body.head.group.rotation.x = 0.12 + Math.sin(this.phase * 0.31) * 0.04; // eyes on the cards
    this.blinker.update(dt, this.body.head.lids);
    // Hands: resting on the rail, or making a signal.
    for (const side of ['left', 'right'] as const) {
      const arm = this.body.arms[side];
      const offset = this.gesture ? gestureOffset(this.gesture.kind, this.clock - this.gesture.start, side) : null;
      const goal = this.body.rest[side].clone().add(offset ?? new THREE.Vector3());
      arm.target.lerp(goal, 1 - Math.exp(-14 * dt));
      arm.solve();
    }
    if (this.gesture && !gestureOffset(this.gesture.kind, this.clock - this.gesture.start, 'right')) this.gesture = null;
    if (this.bubble.visible && this.clock > this.bubbleUntil) this.bubble.visible = false;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
