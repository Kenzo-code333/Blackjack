// Soft image-based lighting: a blurred "room" reflected in lacquered wood, chrome and
// glossy chips, which makes materials look real instead of plastic.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function addEnvironmentLight(renderer: THREE.WebGLRenderer, scene: THREE.Scene, intensity = 0.3): void {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = env;
    scene.environmentIntensity = intensity;
  } catch (err) {
    console.warn('No environment lighting', err);
  }
}

/**
 * Compiles every shader the scene needs before the first frame. Where the browser can
 * compile in the background (most desktop and phone browsers), the page stays responsive
 * meanwhile instead of freezing on the first frame.
 */
export async function warmUp(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
  try {
    await renderer.compileAsync(scene, camera);
  } catch (err) {
    console.warn('Shader warm-up skipped', err);
  }
}
