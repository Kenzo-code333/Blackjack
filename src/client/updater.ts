// Keeps the downloaded game file up to date, so nobody needs to be sent a new file.
//
// The file (dist/blackjack.html) carries its build time in `window.__BJ_FILE__`. While you
// play, it quietly asks GitHub for the latest version (release/version.json in the game's
// public repository). When there's a newer one it downloads it, keeps it in this browser
// (IndexedDB) and offers to restart; from then on, opening the same old file starts the new
// version straight away, even offline. Your chips, account and saves stay where they were
// (the new version runs at the same address as the file, so it sees the same storage).
//
// Only the downloaded file does this: the website is always the latest anyway.

interface Build {
  built: number;
  version: string;
}

declare global {
  interface Window {
    __BJ_FILE__?: Build;
  }
}

/** Where new versions are published, newest wins (the main branch, then the work branch). */
const SOURCES = [
  'https://raw.githubusercontent.com/Kenzo-code333/Blackjack/refs/heads/main/release/',
  'https://raw.githubusercontent.com/Kenzo-code333/Blackjack/refs/heads/claude/youthful-hypatia-9ibn2y/release/',
];

const DB = 'bj-updates';
const STORE = 'files';
const KEY = 'latest';
const UPDATE_NOW = 'bj:update-now';

const running = (): Build | null => (typeof window !== 'undefined' ? (window.__BJ_FILE__ ?? null) : null);

// ---------- A tiny IndexedDB wrapper (the game file is too big for localStorage) ----------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

type Saved = Build & { html: string };

const loadSaved = () => idb<Saved>('readonly', (s) => s.get(KEY)).catch(() => undefined);
const save = (v: Saved) => idb('readwrite', (s) => s.put(v, KEY)).then(() => true, () => false);
const forget = () => idb('readwrite', (s) => s.delete(KEY)).catch(() => undefined);

/** A real game file, not an error page. */
const looksRight = (html: string) => html.length > 100_000 && html.includes('__BJ_FILE__') && html.trimStart().toLowerCase().startsWith('<!doctype html');

/** Replaces this page with another version of the game (before anything has started). */
function run(html: string): void {
  document.open();
  document.write(html);
  document.close();
}

// ---------- At startup ----------

/**
 * Called before the game starts. If a newer version was downloaded earlier, starts that
 * one instead and returns true (the caller then does nothing else).
 */
export async function bootLatest(): Promise<boolean> {
  const me = running();
  if (!me) return false;
  try {
    // "Restart & update" was pressed but the version couldn't be kept in this browser:
    // fetch it again now, before the game starts.
    const wanted = sessionStorage.getItem(UPDATE_NOW);
    if (wanted) sessionStorage.removeItem(UPDATE_NOW);
    const saved = await loadSaved();
    if (saved && saved.built > me.built && looksRight(saved.html)) {
      run(saved.html);
      return true;
    }
    // An older copy than this file (a newer file was opened): no use any more. (An equal one
    // is the version running right now, started from the saved copy: keep it.)
    if (saved && saved.built < me.built) void forget();
    if (wanted) {
      const html = await fetchText(`${wanted}blackjack.html`);
      if (html && looksRight(html)) {
        run(html);
        return true;
      }
    }
  } catch {
    /* start this version */
  }
  return false;
}

// ---------- While playing ----------

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** The newest published version, and where it is. */
async function latest(): Promise<(Build & { base: string }) | null> {
  const found = await Promise.all(
    SOURCES.map(async (base) => {
      const text = await fetchText(`${base}version.json`);
      if (!text) return null;
      try {
        const v = JSON.parse(text) as Build;
        return typeof v.built === 'number' ? { ...v, base } : null;
      } catch {
        return null;
      }
    }),
  );
  return found.reduce<(Build & { base: string }) | null>((best, v) => (v && (!best || v.built > best.built) ? v : best), null);
}

let checking = false;
let offered = false;

async function check(): Promise<void> {
  const me = running();
  if (!me || checking || offered || !navigator.onLine) return;
  checking = true;
  try {
    const v = await latest();
    if (!v || v.built <= me.built) return;
    const saved = await loadSaved();
    let kept = Boolean(saved && saved.built >= v.built);
    if (!kept) {
      const html = await fetchText(`${v.base}blackjack.html`);
      if (!html || !looksRight(html)) return;
      kept = await save({ built: v.built, version: v.version, html });
    }
    offer(kept ? null : v.base);
  } finally {
    checking = false;
  }
}

/** The little bar: "A new version is ready · Restart & update". */
function offer(fetchFrom: string | null): void {
  if (offered) return;
  offered = true;
  const bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = '✨ A new version of the game is ready';
  const go = document.createElement('button');
  go.className = 'btn gold tiny';
  go.textContent = 'Restart & update';
  go.onclick = () => {
    if (fetchFrom) sessionStorage.setItem(UPDATE_NOW, fetchFrom);
    location.reload();
  };
  const later = document.createElement('button');
  later.className = 'btn ghost tiny';
  later.textContent = fetchFrom ? 'Later' : 'Next time';
  later.title = fetchFrom ? '' : 'It starts by itself the next time you open the game';
  later.onclick = () => bar.remove();
  bar.append(text, go, later);
  document.body.append(bar);
}

/** Looks for a new version a little after starting, then every 20 minutes. */
export function watchForUpdates(): void {
  if (!running()) return;
  setTimeout(() => void check(), 8000);
  setInterval(() => void check(), 20 * 60 * 1000);
  window.addEventListener('online', () => void check());
}
