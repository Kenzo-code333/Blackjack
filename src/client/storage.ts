import { type Look, cleanLook, randomLook } from '../shared/protocol.js';

// localStorage / sessionStorage that never throws (private mode, blocked cookies…).

function wrap(get: () => Storage) {
  return {
    get(key: string): string | null {
      try {
        return get().getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string): void {
      try {
        get().setItem(key, value);
      } catch {
        /* storage unavailable: settings just won't be remembered */
      }
    },
    remove(key: string): void {
      try {
        get().removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export const store = {
  local: wrap(() => localStorage),
  session: wrap(() => sessionStorage),
};

function readJson<T>(key: string): T | null {
  try {
    const raw = store.local.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Remembered user preferences. */
export const prefs = {
  /** Your character. Created at random the first time, then kept. */
  get look(): Look {
    const saved = readJson<Look>('bj:look');
    if (saved) return cleanLook(saved);
    const look = randomLook();
    store.local.set('bj:look', JSON.stringify(look));
    return look;
  },
  set look(v: Look) {
    store.local.set('bj:look', JSON.stringify(cleanLook(v)));
  },
  /** 0–1 volumes. */
  get musicVolume(): number {
    const v = Number(store.local.get('bj:music') ?? '0.5');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
  },
  set musicVolume(v: number) {
    store.local.set('bj:music', String(v));
  },
  get sfxVolume(): number {
    const v = Number(store.local.get('bj:sfx') ?? '0.8');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
  },
  set sfxVolume(v: number) {
    store.local.set('bj:sfx', String(v));
  },
  get name(): string {
    return store.local.get('bj:name') ?? '';
  },
  set name(v: string) {
    store.local.set('bj:name', v);
  },
  get muted(): boolean {
    return store.local.get('bj:muted') === '1';
  },
  set muted(v: boolean) {
    store.local.set('bj:muted', v ? '1' : '0');
  },
  /** null = not chosen yet (auto-detect). */
  get lowGraphics(): boolean | null {
    const v = store.local.get('bj:low');
    return v === null ? null : v === '1';
  },
  set lowGraphics(v: boolean) {
    store.local.set('bj:low', v ? '1' : '0');
  },
};
