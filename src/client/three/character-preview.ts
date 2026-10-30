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

  constructor(private readonly container: HTMLElement) {
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
    this.camera.position.set(0, 1.22, 1.25);
    this.camera.lookAt(0, 1.1, 0);
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
      this.body.group.rotation.y = Math.sin(this.t * 0.6) * 0.55;
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
