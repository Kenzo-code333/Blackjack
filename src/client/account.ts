// Signing in with an email keeps everything about you: nickname, character, chips,
// vault, stats and settings.
//
//  - With the game server (the Render deploy), accounts live on the server, so you can
//    sign in from any device.
//  - In the single-page builds (the downloaded file, the website, the preview) there is
//    no server: accounts are kept in this browser, protected by your password.
//
// Your profile is the set of saved settings below. While you're signed in, any change to
// them is saved to your account within a few seconds (and when you leave the page).

import { ARCADE_SAVE_PREFIXES } from './arcade/catalog.js';
import { store } from './storage.js';

/** Everything that makes up your profile. */
const PROFILE_KEYS = ['bj:name', 'bj:look', 'bj:chips', 'bj:vault', 'bj:best', 'bj:stats', 'bj:music', 'bj:sfx', 'bj:voice', 'bj:muted', 'bj:gfx', 'bj:challenge', 'bj:uid', 'bj:keys', 'bj:friends', 'bj:chats', 'bj:groups'];
/** Saves of the arcade games (best scores, tracks, settings…) are part of your profile too. */
const PROFILE_PREFIXES = ARCADE_SAVE_PREFIXES;

/** Every saved name in this browser that belongs to your profile. */
function profileKeys(): string[] {
  const keys = new Set(PROFILE_KEYS);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && PROFILE_PREFIXES.some((p) => k.startsWith(p))) keys.add(k);
    }
  } catch {
    /* storage unavailable */
  }
  return [...keys];
}
const SESSION_KEY = 'bj:account';
const GUEST_KEY = 'bj:guest';

export type Profile = Record<string, string>;
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export function snapshot(): Profile {
  const out: Profile = {};
  for (const k of profileKeys()) {
    const v = store.local.get(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

function apply(data: Record<string, unknown>): void {
  // Clear what belongs to the previous profile on this device, then load this one.
  for (const k of profileKeys()) if (typeof data[k] !== 'string') store.local.remove(k);
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && (PROFILE_KEYS.includes(k) || PROFILE_PREFIXES.some((p) => k.startsWith(p)))) store.local.set(k, v);
  }
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const cleanEmail = (e: string) => e.trim().toLowerCase();

function check(email: string, password: string): string | null {
  if (!EMAIL.test(cleanEmail(email))) return 'Please enter a valid email address';
  if (password.length < 6) return 'Your password needs at least 6 characters';
  return null;
}

export type Where = 'server' | 'cloud' | 'device';

interface Backend {
  readonly where: Where;
  signUp(email: string, password: string, data: Profile): Promise<Res<{ token: string; data: Profile }>>;
  logIn(email: string, password: string): Promise<Res<{ token: string; data: Profile }>>;
  load(email: string, token: string): Promise<Profile | null>;
  save(email: string, token: string, data: Profile, leaving?: boolean): Promise<void>;
  logOut(token: string): void;
}

// ---------- On the game server ----------

const serverBackend: Backend = {
  where: 'server',
  async signUp(email, password, data) {
    return post('/api/signup', { email, password, data });
  },
  async logIn(email, password) {
    return post('/api/login', { email, password });
  },
  async load(_email, token) {
    try {
      const r = await fetch('/api/me', { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) return null;
      const j = (await r.json()) as { data?: Profile };
      return j.data ?? {};
    } catch {
      return null;
    }
  },
  async save(_email, token, data, leaving) {
    try {
      await fetch('/api/me', {
        method: 'PUT',
        keepalive: Boolean(leaving),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ data }),
      });
    } catch {
      /* offline: saved next time */
    }
  },
  logOut(token) {
    void fetch('/api/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
  },
};

async function post<T>(url: string, body: unknown): Promise<Res<T>> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return (await r.json()) as Res<T>;
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  }
}

// ---------- In this browser ----------

interface DeviceAccount {
  salt: string;
  hash: string;
  data: Profile;
  created: number;
}

function deviceAccounts(): Record<string, DeviceAccount> {
  try {
    return JSON.parse(store.local.get('bj:accounts') ?? '{}') as Record<string, DeviceAccount>;
  } catch {
    return {};
  }
}

const toHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** A slow, salted hash of the password (PBKDF2), so it isn't kept in plain text. */
async function hashPassword(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const key = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    return toHex(await subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120_000, hash: 'SHA-256' }, key, 256));
  }
  // Very old browsers: a simple mixing hash (still not plain text).
  let h = 2166136261;
  for (const ch of `${saltHex}:${password}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
}

const deviceBackend: Backend = {
  where: 'device',
  async signUp(email, password, data) {
    const all = deviceAccounts();
    if (all[email]) return { ok: false, error: 'There is already an account with this email on this device. Sign in instead.' };
    const salt = toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    all[email] = { salt, hash: await hashPassword(password, salt), data, created: Date.now() };
    store.local.set('bj:accounts', JSON.stringify(all));
    return { ok: true, token: 'device', data };
  },
  async logIn(email, password) {
    const a = deviceAccounts()[email];
    if (!a || (await hashPassword(password, a.salt)) !== a.hash) return { ok: false, error: 'Wrong email or password' };
    return { ok: true, token: 'device', data: a.data };
  },
  async load(email) {
    return deviceAccounts()[email]?.data ?? null;
  },
  async save(email, _token, data) {
    const all = deviceAccounts();
    if (!all[email]) return;
    all[email]!.data = data;
    store.local.set('bj:accounts', JSON.stringify(all));
  },
  logOut() {},
};

// ---------- Online saves without a server (file and website builds) ----------
//
// Your email and password together make two secrets (PBKDF2, 150,000 rounds): the name of
// your save on the public relays, and the AES-256 key that encrypts it. Nobody without
// your password can find your save, read it or overwrite it. Each save is written to every
// relay that answers and kept in this browser too; the newest copy wins when you sign in.

export interface CloudApi {
  get(id: string): Promise<string[]>;
  put(id: string, payload: string): Promise<number>;
}

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function cloudSecrets(email: string, password: string): Promise<{ id: string; key: string }> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(`velvet-ace-cloud-v1:${email}`), iterations: 150_000, hash: 'SHA-256' }, base, 512));
  return { id: toHex(bits.slice(0, 20)), key: toHex(bits.slice(32)) };
}

async function aesKey(hex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromHex(hex), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function seal(keyHex: string, save: { savedAt: number; data: Profile }): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyHex), new TextEncoder().encode(JSON.stringify(save))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return `v1:${toB64(out)}`;
}

async function open(keyHex: string, payload: string): Promise<{ savedAt: number; data: Profile } | null> {
  try {
    if (!payload.startsWith('v1:')) return null;
    const raw = fromB64(payload.slice(3));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await aesKey(keyHex), raw.slice(12));
    const save = JSON.parse(new TextDecoder().decode(plain)) as { savedAt: number; data: Profile };
    return typeof save.savedAt === 'number' && save.data && typeof save.data === 'object' ? save : null;
  } catch {
    return null; // wrong key (wrong password), or not ours
  }
}

/** The newest save that opens with this key, from the relays and this browser. */
async function newest(cloud: CloudApi, id: string, key: string): Promise<{ savedAt: number; data: Profile } | null> {
  const remote = await cloud.get(id).catch(() => [] as string[]);
  const local = store.local.get(`bj:cloud:${id}`);
  let best: { savedAt: number; data: Profile } | null = null;
  for (const p of [...remote, ...(local ? [local] : [])]) {
    const s = await open(key, p);
    if (s && (!best || s.savedAt > best.savedAt)) best = s;
  }
  return best;
}

function cloudBackend(cloud: CloudApi): Backend {
  const parse = (token: string) => JSON.parse(token) as { id: string; key: string };
  return {
    where: 'cloud',
    async signUp(email, password, data) {
      const { id, key } = await cloudSecrets(email, password);
      if (await newest(cloud, id, key)) return { ok: false, error: 'You already have an account with this email and password. Sign in instead.' };
      const payload = await seal(key, { savedAt: Date.now(), data });
      const stored = await cloud.put(id, payload);
      if (!stored) return { ok: false, error: 'Couldn’t reach the online save service. Check your internet connection and try again.' };
      store.local.set(`bj:cloud:${id}`, payload);
      return { ok: true, token: JSON.stringify({ id, key }), data };
    },
    async logIn(email, password) {
      const { id, key } = await cloudSecrets(email, password);
      const save = await newest(cloud, id, key);
      if (!save) return { ok: false, error: 'Wrong email or password. New here? Choose “Create account”.' };
      return { ok: true, token: JSON.stringify({ id, key }), data: save.data };
    },
    async load(_email, token) {
      try {
        const { id, key } = parse(token);
        return (await newest(cloud, id, key))?.data ?? null;
      } catch {
        return null;
      }
    },
    async save(_email, token, data) {
      try {
        const { id, key } = parse(token);
        const payload = await seal(key, { savedAt: Date.now(), data });
        store.local.set(`bj:cloud:${id}`, payload);
        await cloud.put(id, payload);
      } catch {
        /* saved next time */
      }
    },
    logOut(token) {
      try {
        // Leave nothing of this account behind on a shared computer.
        store.local.remove(`bj:cloud:${parse(token).id}`);
      } catch {
        /* ignore */
      }
    },
  };
}

// ---------- The signed-in player ----------

let backend: Backend = deviceBackend;
let session: { email: string; token: string } | null = null;
let lastSaved = '';
let timer: ReturnType<typeof setInterval> | undefined;

export const account = {
  /** Where accounts are kept in this version of the game. */
  get where(): Where {
    return backend.where;
  },
  get email(): string | null {
    return session?.email ?? null;
  },
  /** Chose to play without an account (on this device). */
  get guest(): boolean {
    return !session && store.local.get(GUEST_KEY) === '1';
  },
  playAsGuest(): void {
    store.local.set(GUEST_KEY, '1');
  },

  /**
   * Picks where accounts live (the game server; online saves through the relays; or this
   * browser) and signs back in from the saved session.
   */
  async init(o: { server: boolean; cloud?: CloudApi | null }): Promise<void> {
    backend = o.server ? serverBackend : o.cloud && globalThis.crypto?.subtle ? cloudBackend(o.cloud) : deviceBackend;
    try {
      const saved = JSON.parse(store.local.get(SESSION_KEY) ?? 'null') as { email: string; token: string; where: string } | null;
      if (saved?.email && saved.where === backend.where) {
        session = { email: saved.email, token: saved.token };
        const data = await backend.load(saved.email, saved.token);
        if (data === null && backend.where !== 'device') {
          // The server forgot the session (or can't be reached): keep playing with what's here.
          if (!navigator.onLine) startSync();
          else session = null;
        } else {
          if (data && Object.keys(data).length) apply(data);
          startSync();
        }
      }
    } catch {
      session = null;
    }
    if (!session) store.local.remove(SESSION_KEY);
  },

  async signUp(email: string, password: string): Promise<Res> {
    const problem = check(email, password);
    if (problem) return { ok: false, error: problem };
    // Your progress so far comes with you into the new account.
    const res = await backend.signUp(cleanEmail(email), password, snapshot());
    if (!res.ok) return res;
    begin(cleanEmail(email), res.token, res.data);
    return { ok: true };
  },

  async logIn(email: string, password: string): Promise<Res> {
    if (!EMAIL.test(cleanEmail(email))) return { ok: false, error: 'Please enter a valid email address' };
    const res = await backend.logIn(cleanEmail(email), password);
    if (!res.ok) return res;
    begin(cleanEmail(email), res.token, res.data);
    return { ok: true };
  },

  /** Saves now, then signs out and clears this device's copy of the profile. */
  async logOut(): Promise<void> {
    if (!session) return;
    await saveNow();
    backend.logOut(session.token);
    session = null;
    clearInterval(timer);
    store.local.remove(SESSION_KEY);
    store.local.remove(GUEST_KEY);
    apply({});
  },

  saveNow: () => saveNow(),
};

function begin(email: string, token: string, data: Profile): void {
  session = { email, token };
  store.local.set(SESSION_KEY, JSON.stringify({ email, token, where: backend.where }));
  store.local.remove(GUEST_KEY);
  if (Object.keys(data).length) apply(data);
  startSync();
}

async function saveNow(leaving = false): Promise<void> {
  if (!session) return;
  const data = snapshot();
  const text = JSON.stringify(data);
  if (text === lastSaved) return;
  lastSaved = text;
  await backend.save(session.email, session.token, data, leaving);
}

function startSync(): void {
  lastSaved = JSON.stringify(snapshot());
  clearInterval(timer);
  // Online saves go to several relays, so they're spaced out a little more.
  timer = setInterval(() => void saveNow(), backend.where === 'cloud' ? 8000 : 3000);
  window.addEventListener('pagehide', () => void saveNow(true));
  document.addEventListener('visibilitychange', () => document.hidden && void saveNow(true));
}
