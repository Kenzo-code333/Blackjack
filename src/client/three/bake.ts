// Merges every mesh that never moves into one mesh per material. A room built from
// hundreds of small parts (columns, rails, slot machines, chandelier crystals…) then
// costs a handful of draw calls instead of hundreds, which is what keeps it smooth on
// ordinary laptops and phones.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const KEEP_ATTRIBUTES = ['position', 'normal', 'uv'];

function shownInChain(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/**
 * Merges the meshes under `root` that don't move relative to it, in `root`'s own
 * coordinates (so `root` itself can still move: a head, a torso, a whole room).
 * `keep`: objects (and everything under them) that move and must stay separate.
 * Returns the draw calls saved.
 */
export function mergeStatic(root: THREE.Object3D, keep: THREE.Object3D[] = []): number {
  root.updateWorldMatrix(true, true);
  const toRoot = root.matrixWorld.clone().invert();
  const skip = new Set<THREE.Object3D>();
  for (const k of keep) k.traverse((o) => skip.add(o));
  const groups = new Map<string, { material: THREE.Material; renderOrder: number; shadow: boolean; receive: boolean; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (skip.has(o) || !m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (Array.isArray(m.material) || !m.material.visible || m.children.length || !shownInChain(m)) return;
    const local = toRoot.clone().multiply(m.matrixWorld);
    const mirrored = local.determinant() < 0;
    const g = m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!KEEP_ATTRIBUTES.includes(name)) g.deleteAttribute(name);
    g.morphAttributes = {};
    g.applyMatrix4(local);
    if (!g.attributes.normal) g.computeVertexNormals();
    const count = g.attributes.position!.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    if (!g.index) g.setIndex(Array.from({ length: count }, (_, i) => i));
    if (mirrored) {
      // A mirrored part: flip each triangle's winding so it isn't drawn inside out.
      const idx = g.index!;
      for (let i = 0; i + 2 < idx.count; i += 3) {
        const b = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, b);
      }
    }
    g.clearGroups();
    const key = `${m.material.uuid}|${m.renderOrder}|${m.castShadow}|${m.receiveShadow}`;
    let grp = groups.get(key);
    if (!grp) {
      grp = { material: m.material, renderOrder: m.renderOrder, shadow: m.castShadow, receive: m.receiveShadow, geos: [], meshes: [] };
      groups.set(key, grp);
    }
    grp.geos.push(g);
    grp.meshes.push(m);
  });
  let saved = 0;
  for (const grp of groups.values()) {
    if (grp.meshes.length < 2) continue;
    const geo = mergeGeometries(grp.geos, false);
    if (!geo) continue;
    for (const m of grp.meshes) m.removeFromParent();
    const merged = new THREE.Mesh(geo, grp.material);
    merged.renderOrder = grp.renderOrder;
    merged.castShadow = grp.shadow;
    merged.receiveShadow = grp.receive;
    root.add(merged);
    saved += grp.meshes.length - 1;
  }
  return saved;
}

const simpler = new WeakMap<THREE.Material, THREE.Material>();

function simplify(mat: THREE.Material): THREE.Material {
  const p = mat as THREE.MeshPhysicalMaterial;
  if (!p.isMeshPhysicalMaterial) return mat;
  let s = simpler.get(mat);
  if (!s) {
    s = new THREE.MeshStandardMaterial({
      color: p.color,
      map: p.map,
      bumpMap: p.bumpMap,
      bumpScale: p.bumpScale,
      // Without a clear coat, a little less roughness keeps the shine.
      roughness: p.clearcoat > 0 ? Math.min(p.roughness, 0.3) * 0.8 : p.roughness,
      metalness: p.metalness,
      emissive: p.emissive,
      emissiveIntensity: p.emissiveIntensity,
      transparent: p.transparent,
      opacity: p.opacity,
      side: p.side,
      depthWrite: p.depthWrite,
    });
    simpler.set(mat, s);
  }
  return s;
}

/**
 * Swaps the costly "physical" materials (clear coat, sheen…) for standard ones on
 * everything under `root`. Used where things are seen from a distance (the casino
 * floor): it looks nearly the same and is much quicker to prepare and to draw.
 */
export function simplifyMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material) ? m.material.map(simplify) : simplify(m.material);
  });
}
