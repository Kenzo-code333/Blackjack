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

/** Remembered user preferences. */
export const prefs = {
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
