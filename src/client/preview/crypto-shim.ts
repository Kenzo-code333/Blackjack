// Browser stand-in for the two `node:crypto` functions the server code uses.
// Only the offline preview build uses this (see vite.preview.config.ts).

export function randomBytes(n: number): { toString(encoding: 'base64url'): string } {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return {
    toString: () => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  };
}

export function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0]! % max;
}
