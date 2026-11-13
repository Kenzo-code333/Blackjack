// Keeps the downloaded game file up to date by itself, so nobody needs to be sent a new file
// and nobody has to press anything.
//
// The file (dist/blackjack.html) carries its build time in `window.__BJ_FILE__`. Each time it
// opens it asks GitHub (release/version.json in the game's public repository) whether there
// is a newer version, waiting only a moment; if there is, it downloads it and starts it
// straight away. While you play it asks again every few minutes and whenever you come back to
// the game; a new version is downloaded in the background and the game restarts into it at
// the first moment that interrupts nothing (never at a table, in an arcade game, at a slot
// machine, in the chats or while typing). Downloaded versions are kept in this browser
// (IndexedDB), so the old file starts the newest version even offline. Chips, account and
// saves stay where they were: the new version runs at the same address as the file.
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

const JUST_UPDATED = 'bj:just-updated';

/** Resolves to null if `p` takes longer than `ms`. */
const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** A small full-screen "Updating…" card while a new version downloads at startup. */
function splash(): () => void {
  const el = document.createElement('div');
  el.className = 'update-splash';
  el.innerHTML = '<div class="update-card"><div class="update-spin"></div><b>Updating the game…</b><small>Getting the newest version. This only takes a moment.</small></div>';
  document.body.append(el);
  return () => el.remove();
}

/**
 * Called before the game starts. Checks (briefly) whether a newer version has been
 * published; if so downloads it and starts it right away. Otherwise starts the newest
 * version downloaded earlier, if any. Returns true when another version took over.
 */
export async function bootLatest(): Promise<boolean> {
  const me = running();
  if (!me) return false;
  try {
    // The version that just took over doesn't need to ask again.
    if (sessionStorage.getItem(JUST_UPDATED) === String(me.built)) {
      sessionStorage.removeItem(JUST_UPDATED);
      return false;
    }
    const saved = await loadSaved();
    // An older copy than this file (a newer file was opened): no use any more. (An equal one
    // is the version running right now, started from the saved copy: keep it.)
    if (saved && saved.built < me.built) void forget();
    const best = saved && saved.built > me.built && looksRight(saved.html) ? saved : null;
    // Is there something newer still? Only wait a moment: offline or slow, just play.
    const online = navigator.onLine ? await within(latest(), 2500) : null;
    if (online && online.built > Math.max(me.built, best?.built ?? 0)) {
      const done = splash();
      const html = await within(fetchText(`${online.base}blackjack.html`), 25000);
      if (html && looksRight(html)) {
        await save({ built: online.built, version: online.version, html });
        sessionStorage.setItem(JUST_UPDATED, String(online.built));
        run(html);
        return true;
      }
      done();
    }
    if (best) {
      sessionStorage.setItem(JUST_UPDATED, String(best.built));
      run(best.html);
      return true;
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
let ready = false;

async function check(): Promise<void> {
  const me = running();
  if (!me || checking || ready || !navigator.onLine) return;
  checking = true;
  try {
    const v = await latest();
    if (!v || v.built <= me.built) return;
    const saved = await loadSaved();
    if (!(saved && saved.built >= v.built)) {
      const html = await fetchText(`${v.base}blackjack.html`);
      if (!html || !looksRight(html)) return;
      // If it can't be kept in this browser, the restart downloads it again (bootLatest).
      await save({ built: v.built, version: v.version, html });
    }
    ready = true;
    applyWhenSafe();
  } finally {
    checking = false;
  }
}

/**
 * Not in the middle of something: at a game table, in an arcade game, at a slot machine,
 * in the chats, signing in, in a dialog or typing.
 */
function safeMoment(): boolean {
  if (document.querySelector('.table-view, .arcade-overlay, .slot-cabinet, .chat-overlay:not([hidden]), .login-screen, dialog[open], .modal, .update-splash')) return false;
  const a = document.activeElement;
  return !(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'));
}

/** Restarts into the new version as soon as it won't interrupt anything. */
function applyWhenSafe(): void {
  const tryNow = () => {
    if (!safeMoment()) return false;
    clearInterval(timer);
    const note = document.createElement('div');
    note.className = 'update-bar';
    note.setAttribute('role', 'status');
    note.textContent = '✨ Updating to the newest version…';
    document.body.append(note);
    // Come back to the same room afterwards (main.ts), then restart after a moment to read
    // the note (saves go out as the page closes).
    window.dispatchEvent(new Event('bj:before-update'));
    setTimeout(() => location.reload(), 1200);
    return true;
  };
  if (tryNow()) return;
  const timer = setInterval(tryNow, 2000);
}

/** Looks for a new version right after starting, every 5 minutes, and on coming back. */
export function watchForUpdates(): void {
  if (!running()) return;
  setTimeout(() => void check(), 3000);
  setInterval(() => void check(), 5 * 60 * 1000);
  window.addEventListener('online', () => void check());
  document.addEventListener('visibilitychange', () => !document.hidden && void check());
}
