import { type Look, REFILL_LIMIT, STARTING_CHIPS, cleanChips, cleanLook, randomLook } from '../shared/protocol.js';

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
  /** The dealer speaks out loud. On unless turned off. */
  get dealerVoice(): boolean {
    return store.local.get('bj:voice') !== '0';
  },
  set dealerVoice(v: boolean) {
    store.local.set('bj:voice', v ? '1' : '0');
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
  /** Your chips: you walk in with 1,000 and take them from table to table. */
  get chips(): number {
    const v = store.local.get('bj:chips');
    return v === null ? STARTING_CHIPS : cleanChips(v);
  },
  set chips(v: number) {
    store.local.set('bj:chips', String(cleanChips(v)));
  },
  /** Chips you cashed out at the cashier: safe from the tables. */
  get vault(): number {
    return cleanChips(store.local.get('bj:vault') ?? 0);
  },
  set vault(v: number) {
    store.local.set('bj:vault', String(cleanChips(v)));
  },
  /** Your biggest cash-out ever. */
  get bestCashOut(): number {
    return cleanChips(store.local.get('bj:best') ?? 0);
  },
  set bestCashOut(v: number) {
    store.local.set('bj:best', String(cleanChips(v)));
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

/** Free refills are only for players who are down to REFILL_LIMIT chips (pocket and vault together). */
export function canRefill(pocket: number = prefs.chips): boolean {
  if (inChallenge()) return false; // everyone plays with the same stack
  return pocket + prefs.vault <= REFILL_LIMIT;
}

/** In a challenge (see challenge.ts): refills and the vault are closed meanwhile. */
export function inChallenge(): boolean {
  return store.local.get('bj:challenge') !== null;
}
