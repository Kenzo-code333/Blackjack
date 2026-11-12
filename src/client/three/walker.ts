// Another player walking around the same room: a standing person with a name tag who
// glides smoothly to wherever their latest position update says, legs and arms swinging.

import * as THREE from 'three';
import type { Look } from '../../shared/protocol.js';
import { Blinker, buildStandingBody, type StandingBody } from './human.js';
import { LabelSprite } from './textures.js';
import { damp } from './tween.js';

export class Walker {
  readonly group = new THREE.Group();
  private body: StandingBody;
  private readonly tag = new LabelSprite(400, 110, 0.11);
  private readonly bubble = new LabelSprite(640, 96, 0.09);
  private readonly target = new THREE.Vector3();
  private targetYaw = 0;
  private phase = Math.random() * 10;
  private speed = 0;
  private bubbleUntil = 0;
  private clock = 0;
  private readonly blinker = new Blinker();
  private lookKey: string;

  constructor(look: Look, name: string, x: number, z: number, yaw: number) {
    this.body = buildStandingBody(look);
    this.lookKey = JSON.stringify(look);
    this.group.add(this.body.group, this.tag, this.bubble);
    this.tag.position.y = this.body.headTop + 0.18;
    this.bubble.position.y = this.body.headTop + 0.36;
    this.bubble.visible = false;
    this.tag.set({ text: name });
    this.group.position.set(x, 0, z);
    this.target.set(x, 0, z);
    this.group.rotation.y = this.targetYaw = yaw;
  }

  setLook(look: Look): void {
    const key = JSON.stringify(look);
    if (key === this.lookKey) return;
    this.lookKey = key;
    this.group.remove(this.body.group);
    this.body = buildStandingBody(look);
    this.group.add(this.body.group);
  }

  setName(name: string): void {
    this.tag.set({ text: name });
  }

  moveTo(x: number, z: number, yaw: number): void {
    this.target.set(x, 0, z);
    this.targetYaw = yaw;
  }

  say(text: string): void {
    this.bubble.set({ text: text.length > 42 ? `${text.slice(0, 40)}…` : text, bg: 'rgba(250, 246, 236, 0.95)', color: '#1d1a16' });
    this.bubble.visible = true;
    this.bubbleUntil = this.clock + 5;
  }

  update(dt: number): void {
    this.clock += dt;
    const p = this.group.position;
    const before = p.clone();
    p.x = damp(p.x, this.target.x, 6, dt);
    p.z = damp(p.z, this.target.z, 6, dt);
    const moved = before.distanceTo(p) / Math.max(dt, 1e-3);
    this.speed = damp(this.speed, Math.min(moved, 3), 8, dt);
    // Face where they're going while walking, or where they look when standing.
    let want = this.targetYaw;
    if (this.speed > 0.3) want = Math.atan2(p.x - before.x, p.z - before.z);
    let d = want - this.group.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.group.rotation.y += d * Math.min(1, dt * 8);
    // Walking: legs and arms swing; standing: a gentle sway.
    this.phase += dt * (2 + this.speed * 3.5);
    const swing = Math.sin(this.phase) * Math.min(0.55, this.speed * 0.35);
    this.body.legs[0].rotation.x = swing;
    this.body.legs[1].rotation.x = -swing;
    this.body.arms[0].rotation.x = -swing * 0.8;
    this.body.arms[1].rotation.x = swing * 0.8;
    this.body.group.position.y = Math.abs(Math.sin(this.phase)) * Math.min(0.03, this.speed * 0.02);
    this.body.head.group.rotation.y = Math.sin(this.clock * 0.4) * 0.15;
    this.blinker.update(dt, this.body.head.lids);
    if (this.bubble.visible && this.clock > this.bubbleUntil) this.bubble.visible = false;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
