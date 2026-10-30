// Minimal tweening: `await anim.tween(0.3, (k) => ...)` animates k from 0 to 1.

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
} satisfies Record<string, Ease>;

interface Tween {
  elapsed: number;
  duration: number;
  update: (k: number) => void;
  easing: Ease;
  resolve: () => void;
}

export class Animator {
  /** >1 plays everything faster (used to catch up when many events queue up). */
  timeScale = 1;
  private readonly tweens = new Set<Tween>();

  tween(duration: number, update: (k: number) => void, easing: Ease = ease.inOutCubic): Promise<void> {
    return new Promise((resolve) => {
      if (duration <= 0) {
        update(1);
        resolve();
        return;
      }
      this.tweens.add({ elapsed: 0, duration, update, easing, resolve });
    });
  }

  wait(duration: number): Promise<void> {
    return this.tween(duration, () => {});
  }

  tick(dt: number): void {
    for (const t of [...this.tweens]) {
      t.elapsed += dt * this.timeScale;
      const k = Math.min(1, t.elapsed / t.duration);
      t.update(t.easing(k));
      if (k >= 1) {
        this.tweens.delete(t);
        t.resolve();
      }
    }
  }

  /** Jump every running animation to its end (e.g. when the tab was hidden). */
  finishAll(): void {
    for (const t of [...this.tweens]) {
      t.update(1);
      this.tweens.delete(t);
      t.resolve();
    }
  }

  get busy(): boolean {
    return this.tweens.size > 0;
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Frame-rate independent smoothing toward a target. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));
