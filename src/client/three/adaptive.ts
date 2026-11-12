// Keeps the frame rate smooth by adjusting the rendering resolution: when frames start to
// take too long the picture is drawn at a slightly lower resolution (hardly visible, and
// the browser smooths it), and when there's room to spare it goes back up. Only when even
// the lowest resolution can't keep up does `onStruggling` fire (the scene then switches to
// low graphics).

import * as THREE from 'three';

export class AdaptiveResolution {
  private scale = 1;
  private frames: number[] = [];
  private lastChange = 0;
  private struggling = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    /** The best pixel ratio wanted (e.g. 1.5 on a high-density screen). */
    private maxRatio: () => number,
    private readonly onStruggling?: () => void,
    private readonly minScale = 0.55,
  ) {
    this.apply();
  }

  /** Call once per frame with the time since the last frame (ms). */
  frame(ms: number, now: number): void {
    if (document.hidden || ms > 250) return; // a stall (tab switch, alert…), not slowness
    this.frames.push(ms);
    if (this.frames.length < 45) return;
    const sorted = [...this.frames].sort((a, b) => a - b);
    this.frames = [];
    // The 80th percentile: what the eye notices as "stutter".
    const p80 = sorted[Math.floor(sorted.length * 0.8)]!;
    if (now - this.lastChange < 1200) return;
    if (p80 > 21 && this.scale > this.minScale) {
      this.scale = Math.max(this.minScale, this.scale - (p80 > 32 ? 0.2 : 0.1));
      this.lastChange = now;
      this.apply();
    } else if (p80 > 24 && this.scale <= this.minScale) {
      if (++this.struggling >= 3) {
        this.struggling = 0;
        this.onStruggling?.();
      }
    } else if (p80 < 13.5 && this.scale < 1 && now - this.lastChange > 4000) {
      this.scale = Math.min(1, this.scale + 0.1);
      this.lastChange = now;
      this.apply();
    } else this.struggling = 0;
  }

  /** After a quality change (or a resize). */
  apply(): void {
    const ratio = Math.max(0.5, this.maxRatio() * this.scale);
    if (Math.abs(this.renderer.getPixelRatio() - ratio) > 0.01) {
      const size = this.renderer.getSize(new THREE.Vector2());
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(size.x, size.y, false);
    }
  }
}
