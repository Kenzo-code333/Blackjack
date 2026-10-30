// Celebration effects: a burst of gold sparkles and confetti over a hand that hits 21
// or a blackjack, with a short warm flash of light.

import * as THREE from 'three';
import { glowTexture } from './textures.js';

let sparkleTexture: THREE.Texture | null = null;

interface Burst {
  points: THREE.Points;
  confetti: THREE.InstancedMesh | null;
  light: THREE.PointLight;
  velocities: Float32Array;
  spins: Float32Array;
  confettiVel: THREE.Vector3[];
  confettiPos: THREE.Vector3[];
  confettiRot: THREE.Euler[];
  age: number;
  life: number;
}

const CONFETTI_COLORS = [0xf2c94c, 0xe2574c, 0x5bc0eb, 0x9bc53d, 0xffffff, 0xc77dff];

export class Celebrations {
  private readonly bursts: Burst[] = [];
  private readonly dummy = new THREE.Object3D();

  constructor(private readonly scene: THREE.Scene) {}

  /** `big` = blackjack (more sparkles, confetti); otherwise a 21. `low` = low graphics. */
  burst(at: THREE.Vector3, big: boolean, low: boolean): void {
    sparkleTexture ??= glowTexture();
    const n = low ? (big ? 60 : 30) : big ? 160 : 70;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const velocities = new Float32Array(n * 3);
    const gold = new THREE.Color(0xffd36b);
    const warm = new THREE.Color(0xfff2c4);
    for (let i = 0; i < n; i++) {
      positions.set([at.x, at.y + 0.02, at.z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const speed = 0.25 + Math.random() * (big ? 0.75 : 0.45);
      const up = 0.6 + Math.random() * (big ? 1.3 : 0.8);
      velocities.set([Math.cos(a) * speed, up, Math.sin(a) * speed], i * 3);
      const c = gold.clone().lerp(warm, Math.random());
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: big ? 0.035 : 0.028,
        map: sparkleTexture,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(points);

    // Confetti for a blackjack: small paper squares that flutter down.
    let confetti: THREE.InstancedMesh | null = null;
    const confettiVel: THREE.Vector3[] = [];
    const confettiPos: THREE.Vector3[] = [];
    const confettiRot: THREE.Euler[] = [];
    if (big) {
      const count = low ? 30 : 70;
      confetti = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.014, 0.022),
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true }),
        count,
      );
      for (let i = 0; i < count; i++) {
        confetti.setColorAt(i, new THREE.Color(CONFETTI_COLORS[i % CONFETTI_COLORS.length]!));
        const a = Math.random() * Math.PI * 2;
        confettiVel.push(new THREE.Vector3(Math.cos(a) * 0.4 * Math.random(), 1 + Math.random() * 1.1, Math.sin(a) * 0.4 * Math.random()));
        confettiPos.push(at.clone().add(new THREE.Vector3(0, 0.03, 0)));
        confettiRot.push(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      }
      this.scene.add(confetti);
    }

    const light = new THREE.PointLight(0xffd27a, big ? 6 : 3, 1.6, 2);
    light.position.copy(at).add(new THREE.Vector3(0, 0.15, 0));
    this.scene.add(light);

    this.bursts.push({
      points,
      confetti,
      light,
      velocities,
      spins: new Float32Array(0),
      confettiVel,
      confettiPos,
      confettiRot,
      age: 0,
      life: big ? 2.6 : 1.6,
    });
  }

  update(dt: number): void {
    for (const b of [...this.bursts]) {
      b.age += dt;
      const k = b.age / b.life;
      const pos = b.points.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        b.velocities[i * 3 + 1]! -= 2.2 * dt; // gravity
        b.velocities[i * 3]! *= 0.985;
        b.velocities[i * 3 + 2]! *= 0.985;
        pos.setXYZ(
          i,
          pos.getX(i) + b.velocities[i * 3]! * dt,
          Math.max(0.79, pos.getY(i) + b.velocities[i * 3 + 1]! * dt),
          pos.getZ(i) + b.velocities[i * 3 + 2]! * dt,
        );
      }
      pos.needsUpdate = true;
      const mat = b.points.material as THREE.PointsMaterial;
      mat.opacity = Math.max(0, 1 - k ** 2);
      b.light.intensity *= Math.exp(-4 * dt);

      if (b.confetti) {
        for (let i = 0; i < b.confettiPos.length; i++) {
          const v = b.confettiVel[i]!;
          v.y = Math.max(v.y - 2.4 * dt, -0.35); // paper falls slowly
          v.x += Math.sin(b.age * 6 + i) * 0.02;
          const p = b.confettiPos[i]!.addScaledVector(v, dt);
          if (p.y < 0.785) p.y = 0.785;
          const r = b.confettiRot[i]!;
          r.x += dt * (4 + (i % 5));
          r.y += dt * (3 + (i % 3));
          this.dummy.position.copy(p);
          this.dummy.rotation.copy(r);
          this.dummy.updateMatrix();
          b.confetti.setMatrixAt(i, this.dummy.matrix);
        }
        b.confetti.instanceMatrix.needsUpdate = true;
        (b.confetti.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4);
      }

      if (b.age >= b.life) {
        b.points.removeFromParent();
        b.points.geometry.dispose();
        b.confetti?.removeFromParent();
        b.light.removeFromParent();
        this.bursts.splice(this.bursts.indexOf(b), 1);
      }
    }
  }
}
