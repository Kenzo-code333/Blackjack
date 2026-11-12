// Shared pieces for the walk-around rooms (casino, lounge, arcade): canvas textures,
// glowing signs that face you, and soft painted shadows.

import * as THREE from 'three';

let blobTex: THREE.CanvasTexture | null = null;
const blobMats = new Map<number, THREE.MeshBasicMaterial>();

/** A soft dark pool on the carpet: a cheap stand-in for a real-time shadow. */
export function blobShadow(w: number, d: number, strength: number): THREE.Mesh {
  blobTex ??= canvasTex(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  let mat = blobMats.get(strength);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: strength, depthWrite: false, color: 0x000000 });
    blobMats.set(strength, mat);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.006;
  m.renderOrder = 1;
  return m;
}

export function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** A glowing marquee sign that always faces you. */
/** `frame`: border and bulb colour; `bg`: the panel behind the text. */
export function makeSign(title: string, sub: string, color: string, scale: number, frame = '#d9b45a', bg = 'rgba(14, 8, 6, 0.88)'): THREE.Sprite {
  const tex = canvasTex(1024, 300, (ctx) => {
    const W = 1024;
    const H = 300;
    ctx.fillStyle = bg;
    roundRect(ctx, 12, 12, W - 24, H - 24, 40);
    ctx.fill();
    ctx.strokeStyle = frame;
    ctx.lineWidth = 8;
    ctx.stroke();
    // Bulbs around the edge.
    for (let i = 0; i < 34; i++) {
      const t = i / 34;
      const [x, y] = t < 0.5 ? [40 + t * 2 * (W - 80), 32] : [40 + (t - 0.5) * 2 * (W - 80), H - 32];
      const g = ctx.createRadialGradient(x, y, 0, x, y, 12);
      g.addColorStop(0, '#fff6d8');
      g.addColorStop(1, 'rgba(255, 210, 120, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 30;
    ctx.fillStyle = color;
    ctx.font = '800 96px "Playfair Display", Georgia, serif';
    ctx.fillText(title, W / 2, H * 0.44, W - 120);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(246, 236, 210, 0.9)';
    ctx.font = '600 40px Inter, system-ui, sans-serif';
    ctx.fillText(sub, W / 2, H * 0.74, W - 120);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.set(2.2 * scale, (2.2 * scale * 300) / 1024, 1);
  return s;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

