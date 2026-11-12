// A small turntable view of your character, used on the home screen and in the editor.

import * as THREE from 'three';
import type { Look } from '../../shared/protocol.js';
import { Blinker, type SeatedBody, buildSeatedBody } from './human.js';

export class CharacterPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
  private body: SeatedBody | null = null;
  private readonly blinker = new Blinker();
  private frame = 0;
  private last = performance.now();
  private t = 0;
  private readonly observer: ResizeObserver;

  /** A wave in progress (seconds since it started), or -1. */
  private waveT = -1;
  private readonly waveTarget = new THREE.Vector3();

  constructor(
    private readonly container: HTMLElement,
    /** Show more of the body (room for a raised hand). */
    wide = false,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a1a12, 1.4));
    const key = new THREE.DirectionalLight(0xffe0b8, 2.4);
    key.position.set(1.2, 2, 2);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.2);
    rim.position.set(-1.5, 1.5, -1.5);
    this.scene.add(key, rim);
    // Head and shoulders.
    if (wide) {
      this.camera.position.set(0, 1.2, 1.7);
      this.camera.lookAt(0, 1.08, 0);
    } else {
      this.camera.position.set(0, 1.22, 1.25);
      this.camera.lookAt(0, 1.1, 0);
    }
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.frame = requestAnimationFrame(this.loop);
  }

  setLook(look: Look): void {
    if (this.body) this.scene.remove(this.body.group);
    // A rail height below the frame keeps the arms out of the way.
    this.body = buildSeatedBody(look, 0.62);
    this.scene.add(this.body.group);
  }

  /** A happy little hop and a wave (someone sent a message). */
  wave(): void {
    // A new message during a wave keeps it going instead of restarting from the bottom.
    this.waveT = this.waveT > 0.35 && this.waveT < 2 ? 0.35 : 0;
  }

  /** A small nod (you sent a message). */
  nod(): void {
    if (this.waveT < 0) this.waveT = 100;
  }

  private animateReaction(dt: number): void {
    const b = this.body;
    if (!b || this.waveT < 0) return;
    this.waveT += dt;
    const t = this.waveT;
    const arm = b.arms.right;
    if (t >= 100) {
      // The nod: head dips and comes back.
      const k = t - 100;
      b.head.group.rotation.x = Math.sin(Math.min(1, k / 0.6) * Math.PI) * 0.22;
      if (k > 0.6) {
        b.head.group.rotation.x = 0;
        this.waveT = -1;
      }
      return;
    }
    const DUR = 2.4;
    // Raise (0-0.35 s), wave (to DUR-0.4), lower (last 0.4 s).
    const up = t < 0.35 ? t / 0.35 : t > DUR - 0.4 ? Math.max(0, (DUR - t) / 0.4) : 1;
    const e = up * up * (3 - 2 * up);
    const sway = Math.sin(t * 11) * 0.07 * e;
    this.waveTarget.set(0.2 + sway, 0.8, 0.16);
    arm.target.copy(b.rest.right).lerp(this.waveTarget, e);
    arm.hand.quaternion.identity();
    arm.solve();
    // The hand turns palm-forward while it's up.
    arm.hand.rotateX(-1.2 * e);
    arm.hand.rotateZ(sway * 2);
    // A happy hop, a lean to the side and a head tilt.
    const hop = Math.max(0, Math.sin(Math.min(1, t / 0.5) * Math.PI)) * 0.05;
    b.group.position.y = hop;
    b.torso.rotation.z = -0.07 * e;
    b.head.group.rotation.z = 0.12 * e + Math.sin(t * 5.5) * 0.03 * e;
    if (t > DUR) {
      arm.target.copy(b.rest.right);
      arm.solve();
      b.group.position.y = 0;
      b.torso.rotation.z = 0;
      b.head.group.rotation.z = 0;
      this.waveT = -1;
    }
  }

  private resize(): void {
    const w = this.container.clientWidth || 200;
    const h = this.container.clientHeight || 200;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private loop = (now: number) => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    if (this.body) {
      // Turns to face you while waving.
      const facing = this.waveT >= 0 && this.waveT < 100 ? 0.15 : 1;
      this.body.group.rotation.y += (Math.sin(this.t * 0.6) * 0.55 * facing - this.body.group.rotation.y) * Math.min(1, dt * 6);
      this.animateReaction(dt);
      this.blinker.update(dt, this.body.head.lids);
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
