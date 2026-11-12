// Everyone who plays, and talking to them: like WhatsApp, inside the casino.
//
//  - People: every player who has been online, with who is online now and which room
//    they're in. Add them as friends (they accept or decline).
//  - Chats: a global chat with all players, private messages (DMs) and group chats.
//    DMs and groups are end-to-end encrypted: each player has a key pair (ECDH P-256,
//    kept in their profile, so it follows their account); two players' keys make a shared
//    AES-256 key only they can work out. A group has its own key, handed to each member
//    encrypted with their DM key. The message board only ever sees scrambled text.
//    The global chat is public by nature.
//  - Rooms: where everyone is standing or sitting, so you see each other walk around.
//
// It all goes through the "bus" (the game server, or the public relays; see bus.ts).
// Retained messages on the bus are the chat history, so it's there on every device.

import { type Look, cleanLook } from '../../shared/protocol.js';
import { prefs, store } from '../storage.js';
import type { CasinoFloor3D } from '../three/casino-floor.js';
import type { Room } from '../three/world-types.js';
import { type Bus, NS } from './bus.js';

export interface Person {
  uid: string;
  name: string;
  look: Look;
  /** Last time they were seen online (ms). */
  at: number;
  room: Room | null;
  pub: JsonWebKey | null;
}

export interface Message {
  id: string;
  /** "global", "dm:<uid>" or "grp:<gid>". */
  conv: string;
  from: string;
  name: string;
  text: string;
  at: number;
}

export interface Group {
  gid: string;
  name: string;
  members: string[];
  owner: string;
  /** The group's AES key (base64). */
  key: string;
}

export interface Conversation {
  id: string;
  kind: 'global' | 'dm' | 'group';
  title: string;
  look: Look | null;
  last: Message | null;
  unread: number;
}

interface Notice {
  id: string;
  type: 'friend' | 'friend-ok' | 'dm' | 'group';
  from: string;
  name: string;
  at: number;
  gid?: string;
  group?: { name: string; members: string[]; owner: string };
  /** For a group invite: the group key, encrypted for you. */
  key?: { iv: string; ct: string };
}

const ONLINE_MS = 75_000;
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const readJson = <T>(key: string, fallback: T): T => {
  try {
    return (JSON.parse(store.local.get(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
};

interface FriendState {
  friends: string[];
  /** Requests waiting for your answer. */
  incoming: { uid: string; name: string; at: number; notice: string }[];
  /** Requests you sent. */
  outgoing: string[];
}

class Social {
  bus: Bus | null = null;
  uid = '';
  readonly people = new Map<string, Person>();
  private readonly messages = new Map<string, Message[]>();
  private readonly seen = new Set<string>();
  private readonly dmKeys = new Map<string, Promise<CryptoKey | null>>();
  private readonly groupKeys = new Map<string, Promise<CryptoKey>>();
  private keys: { pub: JsonWebKey; priv: CryptoKey } | null = null;
  private stops: (() => void)[] = [];
  private listeners = new Set<() => void>();
  private messageListeners = new Set<(m: Message) => void>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private world: { floor: CasinoFloor3D; room: Room; stop: () => void } | null = null;
  private dirty = false;
  private started = 0;

  // ---------- Saved state (part of your profile, so it follows your account) ----------

  get friends(): FriendState {
    return readJson<FriendState>('bj:friends', { friends: [], incoming: [], outgoing: [] });
  }
  private set friends(v: FriendState) {
    store.local.set('bj:friends', JSON.stringify(v));
  }
  get groups(): Group[] {
    return readJson<Group[]>('bj:groups', []);
  }
  private set groups(v: Group[]) {
    store.local.set('bj:groups', JSON.stringify(v));
  }
  /** Conversations you're in, and how far you've read each one. */
  private get chats(): { dms: string[]; read: Record<string, number> } {
    return readJson('bj:chats', { dms: [] as string[], read: {} as Record<string, number> });
  }
  private set chats(v: { dms: string[]; read: Record<string, number> }) {
    store.local.set('bj:chats', JSON.stringify(v));
  }

  get available(): boolean {
    return this.bus !== null && Boolean(globalThis.crypto?.subtle);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onMessage(fn: (m: Message) => void): () => void {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  private changed(): void {
    if (this.dirty) return;
    this.dirty = true;
    queueMicrotask(() => {
      this.dirty = false;
      for (const fn of this.listeners) fn();
    });
  }

  // ---------- Starting up ----------

  /** Connects (once) and signs in as this profile's player. */
  async init(bus: Bus | null): Promise<void> {
    this.bus ??= bus;
    await this.restart();
  }

  /** After signing in or out: become the new profile's player. */
  async restart(): Promise<void> {
    for (const stop of this.stops.splice(0)) stop();
    clearInterval(this.heartbeat);
    this.people.clear();
    this.messages.clear();
    this.seen.clear();
    this.dmKeys.clear();
    this.groupKeys.clear();
    this.keys = null;
    if (!this.available || !prefs.name) return this.changed();
    this.started = Date.now();
    this.uid = store.local.get('bj:uid') ?? '';
    if (!/^[a-z0-9]{12,32}$/.test(this.uid)) {
      this.uid = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
      store.local.set('bj:uid', this.uid);
    }
    await this.loadKeys();
    const bus = this.bus!;
    const sub = (filter: string, fn: (p: string, t: string) => void) => this.stops.push(bus.subscribe(NS + filter, fn));
    sub('u/#', (p) => this.onProfile(p));
    sub(`inbox/${this.uid}/#`, (p, t) => void this.onNotice(p, t));
    for (const d of [day(Date.now() - 86_400_000), day()]) sub(`g/${d}/#`, (p) => this.onGlobal(p));
    for (const other of new Set([...this.chats.dms, ...this.friends.friends])) this.watchDm(other);
    for (const g of this.groups) this.watchGroup(g);
    this.announce();
    this.heartbeat = setInterval(() => this.announce(), 30_000);
    this.changed();
  }

  private async loadKeys(): Promise<void> {
    const saved = readJson<{ pub: JsonWebKey; priv: JsonWebKey } | null>('bj:keys', null);
    try {
      if (saved?.pub && saved.priv) {
        const priv = await crypto.subtle.importKey('jwk', saved.priv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
        this.keys = { pub: saved.pub, priv };
        return;
      }
    } catch {
      /* make new keys */
    }
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
    store.local.set('bj:keys', JSON.stringify({ pub, priv }));
    this.keys = { pub, priv: pair.privateKey };
  }

  /** Tells everyone you're here (your public profile, kept on the board). */
  announce(): void {
    if (!this.bus || !this.keys) return;
    const pub = { kty: this.keys.pub.kty, crv: this.keys.pub.crv, x: this.keys.pub.x, y: this.keys.pub.y };
    const me: Person = { uid: this.uid, name: prefs.name || 'Player', look: prefs.look, at: Date.now(), room: this.world?.room ?? null, pub };
    this.bus.publish(`${NS}u/${this.uid}`, JSON.stringify(me), true);
    this.people.set(this.uid, me);
  }

  private onProfile(payload: string): void {
    try {
      const p = JSON.parse(payload) as Person;
      if (typeof p.uid !== 'string' || !/^[a-z0-9]{12,32}$/.test(p.uid)) return;
      const had = this.people.get(p.uid);
      if (had && had.at > p.at) return;
      this.people.set(p.uid, { uid: p.uid, name: String(p.name ?? 'Player').slice(0, 20), look: cleanLook(p.look), at: Number(p.at) || 0, room: p.room ?? null, pub: p.pub ?? null });
      if (had?.pub?.x !== p.pub?.x) this.dmKeys.delete(p.uid);
      this.changed();
    } catch {
      /* ignore */
    }
  }

  isOnline(uid: string): boolean {
    const p = this.people.get(uid);
    return Boolean(p && Date.now() - p.at < ONLINE_MS);
  }

  // ---------- Encryption ----------

  private dmKey(uid: string): Promise<CryptoKey | null> {
    let k = this.dmKeys.get(uid);
    if (!k) {
      k = (async () => {
        const pub = this.people.get(uid)?.pub;
        if (!pub || !this.keys) return null;
        try {
          const theirs = await crypto.subtle.importKey('jwk', pub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
          return await crypto.subtle.deriveKey({ name: 'ECDH', public: theirs }, this.keys.priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        } catch {
          return null;
        }
      })();
      this.dmKeys.set(uid, k);
      void k.then((v) => v === null && this.dmKeys.delete(uid));
    }
    return k;
  }

  private groupKey(g: Group): Promise<CryptoKey> {
    let k = this.groupKeys.get(g.gid);
    if (!k) {
      k = crypto.subtle.importKey('raw', unb64(g.key), 'AES-GCM', false, ['encrypt', 'decrypt']);
      this.groupKeys.set(g.gid, k);
    }
    return k;
  }

  private async seal(key: CryptoKey, data: unknown): Promise<{ iv: string; ct: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
    return { iv: b64(iv), ct: b64(ct) };
  }

  private async open<T>(key: CryptoKey, box: { iv: string; ct: string }): Promise<T | null> {
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
      return JSON.parse(new TextDecoder().decode(plain)) as T;
    } catch {
      return null;
    }
  }

  // ---------- Messages ----------

  private add(m: Message): void {
    if (this.seen.has(`${m.conv}:${m.id}`)) return;
    this.seen.add(`${m.conv}:${m.id}`);
    const list = this.messages.get(m.conv) ?? [];
    list.push(m);
    list.sort((a, b) => a.at - b.at);
    if (list.length > 300) list.splice(0, list.length - 300);
    this.messages.set(m.conv, list);
    // Live messages (not history arriving when we connect) are announced.
    if (m.at > this.started - 2000) for (const fn of this.messageListeners) fn(m);
    this.changed();
  }

  messagesOf(conv: string): Message[] {
    return this.messages.get(conv) ?? [];
  }

  private onGlobal(payload: string): void {
    try {
      const m = JSON.parse(payload) as Message;
      if (typeof m.text !== 'string' || typeof m.from !== 'string') return;
      this.add({ id: String(m.id), conv: 'global', from: m.from, name: String(m.name ?? 'Player').slice(0, 20), text: m.text.slice(0, 500), at: Number(m.at) || 0 });
    } catch {
      /* ignore */
    }
  }

  private dmTopic(other: string): string {
    return `dm/${[this.uid, other].sort().join('-')}`;
  }

  private readonly watchingDms = new Set<string>();
  private watchDm(other: string): void {
    if (!this.bus || this.watchingDms.has(other) || other === this.uid) return;
    this.watchingDms.add(other);
    const stop = this.bus.subscribe(`${NS}${this.dmTopic(other)}/#`, (p) => void this.onDm(other, p));
    this.stops.push(() => {
      stop();
      this.watchingDms.delete(other);
    });
  }

  private async onDm(other: string, payload: string): Promise<void> {
    try {
      const box = JSON.parse(payload) as { id: string; from: string; at: number; iv: string; ct: string };
      if (box.from !== other && box.from !== this.uid) return;
      // Our key with them may not be known yet (their profile arrives): retry a few times.
      let key = await this.dmKey(other);
      for (let i = 0; !key && i < 10; i++) {
        await new Promise((r) => setTimeout(r, 500));
        key = await this.dmKey(other);
      }
      if (!key) return;
      const body = await this.open<{ text: string; name: string }>(key, box);
      if (!body) return;
      this.add({ id: box.id, conv: `dm:${other}`, from: box.from, name: body.name, text: body.text, at: box.at });
    } catch {
      /* ignore */
    }
  }

  private readonly watchingGroups = new Set<string>();
  private watchGroup(g: Group): void {
    if (!this.bus || this.watchingGroups.has(g.gid)) return;
    this.watchingGroups.add(g.gid);
    const stopMsgs = this.bus.subscribe(`${NS}grp/${g.gid}/m/#`, (p) => void this.onGroupMessage(g.gid, p));
    const stopMeta = this.bus.subscribe(`${NS}grp/${g.gid}/meta`, (p) => this.onGroupMeta(g.gid, p));
    this.stops.push(() => {
      stopMsgs();
      stopMeta();
      this.watchingGroups.delete(g.gid);
    });
  }

  private onGroupMeta(gid: string, payload: string): void {
    try {
      const meta = JSON.parse(payload) as { name: string; members: string[]; owner: string };
      if (!Array.isArray(meta.members)) return;
      this.groups = this.groups.map((g) => (g.gid === gid ? { ...g, name: String(meta.name).slice(0, 40), members: meta.members.slice(0, 100), owner: meta.owner } : g));
      this.changed();
    } catch {
      /* ignore */
    }
  }

  private async onGroupMessage(gid: string, payload: string): Promise<void> {
    const g = this.groups.find((x) => x.gid === gid);
    if (!g) return;
    try {
      const box = JSON.parse(payload) as { id: string; from: string; at: number; iv: string; ct: string };
      const body = await this.open<{ text: string; name: string }>(await this.groupKey(g), box);
      if (!body) return;
      this.add({ id: box.id, conv: `grp:${gid}`, from: box.from, name: body.name, text: body.text, at: box.at });
    } catch {
      /* ignore */
    }
  }

  /** Sends a message to a conversation. */
  async send(conv: string, raw: string): Promise<string | null> {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!text) return 'Type a message first';
    if (!this.bus) return 'Chat isn’t available here';
    const id = newId();
    const at = Date.now();
    const name = prefs.name || 'Player';
    if (conv === 'global') {
      this.bus.publish(`${NS}g/${day(at)}/${id}`, JSON.stringify({ id, from: this.uid, name, text, at }), true);
      this.add({ id, conv, from: this.uid, name, text, at });
      return null;
    }
    if (conv.startsWith('dm:')) {
      const other = conv.slice(3);
      const key = await this.dmKey(other);
      if (!key) return 'Can’t reach this player yet: they need to come online once';
      const box = await this.seal(key, { text, name });
      this.bus.publish(`${NS}${this.dmTopic(other)}/${id}`, JSON.stringify({ id, from: this.uid, at, ...box }), true);
      // Let them know there's a conversation (the first time).
      if (!this.messagesOf(conv).length) this.notify(other, { type: 'dm' });
      this.rememberDm(other);
      this.add({ id, conv, from: this.uid, name, text, at });
      return null;
    }
    const g = this.groups.find((x) => `grp:${x.gid}` === conv);
    if (!g) return 'Group not found';
    const box = await this.seal(await this.groupKey(g), { text, name });
    this.bus.publish(`${NS}grp/${g.gid}/m/${id}`, JSON.stringify({ id, from: this.uid, at, ...box }), true);
    this.add({ id, conv, from: this.uid, name, text, at });
    return null;
  }

  private rememberDm(other: string): void {
    const c = this.chats;
    if (!c.dms.includes(other)) this.chats = { ...c, dms: [...c.dms, other] };
    this.watchDm(other);
  }

  /** Opens (or starts) a private chat with someone. */
  startDm(other: string): string {
    this.rememberDm(other);
    this.changed();
    return `dm:${other}`;
  }

  markRead(conv: string): void {
    const last = this.messagesOf(conv).at(-1);
    if (!last) return;
    const c = this.chats;
    if ((c.read[conv] ?? 0) >= last.at) return;
    this.chats = { ...c, read: { ...c.read, [conv]: last.at } };
    this.changed();
  }

  /** The chat list, most recent first (the global chat always on top). */
  conversations(): Conversation[] {
    const read = this.chats.read;
    const unread = (conv: string) => this.messagesOf(conv).filter((m) => m.from !== this.uid && m.at > (read[conv] ?? 0)).length;
    const list: Conversation[] = [];
    for (const other of new Set(this.chats.dms)) {
      const p = this.people.get(other);
      const conv = `dm:${other}`;
      list.push({ id: conv, kind: 'dm', title: p?.name ?? 'Player', look: p?.look ?? null, last: this.messagesOf(conv).at(-1) ?? null, unread: unread(conv) });
    }
    for (const g of this.groups) {
      const conv = `grp:${g.gid}`;
      list.push({ id: conv, kind: 'group', title: g.name, look: null, last: this.messagesOf(conv).at(-1) ?? null, unread: unread(conv) });
    }
    list.sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
    const global: Conversation = { id: 'global', kind: 'global', title: 'Everyone (global chat)', look: null, last: this.messagesOf('global').at(-1) ?? null, unread: unread('global') };
    return [global, ...list];
  }

  get unreadTotal(): number {
    return this.conversations()
      .filter((c) => c.kind !== 'global')
      .reduce((s, c) => s + c.unread, 0);
  }

  // ---------- Friends ----------

  private notify(to: string, n: Partial<Notice>): void {
    if (!this.bus) return;
    const notice: Notice = { id: newId(), type: 'friend', from: this.uid, name: prefs.name || 'Player', at: Date.now(), ...n } as Notice;
    this.bus.publish(`${NS}inbox/${to}/${notice.id}`, JSON.stringify(notice), true);
  }

  private clearNotice(topic: string): void {
    this.bus?.publish(topic, '', true);
  }

  private async onNotice(payload: string, topic: string): Promise<void> {
    if (!payload) return;
    let n: Notice;
    try {
      n = JSON.parse(payload) as Notice;
    } catch {
      return;
    }
    if (typeof n.from !== 'string' || n.from === this.uid) return;
    const f = this.friends;
    if (n.type === 'friend') {
      if (f.friends.includes(n.from)) {
        this.clearNotice(topic);
        return;
      }
      // They asked us while we'd asked them: that's a yes from both sides.
      if (f.outgoing.includes(n.from)) {
        this.friends = { ...f, friends: [...f.friends, n.from], outgoing: f.outgoing.filter((x) => x !== n.from) };
        this.notify(n.from, { type: 'friend-ok' });
        this.clearNotice(topic);
        this.watchDm(n.from);
      } else if (!f.incoming.some((r) => r.uid === n.from)) {
        this.friends = { ...f, incoming: [...f.incoming, { uid: n.from, name: n.name, at: n.at, notice: topic }] };
      }
    } else if (n.type === 'friend-ok') {
      if (!f.friends.includes(n.from)) this.friends = { ...f, friends: [...f.friends, n.from], outgoing: f.outgoing.filter((x) => x !== n.from) };
      this.watchDm(n.from);
      this.clearNotice(topic);
    } else if (n.type === 'dm') {
      this.rememberDm(n.from);
      this.clearNotice(topic);
    } else if (n.type === 'group' && n.gid && n.group && n.key) {
      const dm = await this.dmKey(n.from);
      const raw = dm ? await this.open<string>(dm, n.key) : null;
      if (raw && !this.groups.some((g) => g.gid === n.gid)) {
        const g: Group = { gid: n.gid, name: String(n.group.name).slice(0, 40), members: n.group.members.slice(0, 100), owner: n.group.owner, key: raw };
        this.groups = [...this.groups, g];
        this.watchGroup(g);
      }
      if (raw) this.clearNotice(topic);
    }
    this.changed();
  }

  addFriend(uid: string): void {
    const f = this.friends;
    if (uid === this.uid || f.friends.includes(uid) || f.outgoing.includes(uid)) return;
    const incoming = f.incoming.find((r) => r.uid === uid);
    if (incoming) return this.answer(uid, true);
    this.friends = { ...f, outgoing: [...f.outgoing, uid] };
    this.notify(uid, { type: 'friend' });
    this.changed();
  }

  answer(uid: string, yes: boolean): void {
    const f = this.friends;
    const req = f.incoming.find((r) => r.uid === uid);
    this.friends = { ...f, friends: yes && !f.friends.includes(uid) ? [...f.friends, uid] : f.friends, incoming: f.incoming.filter((r) => r.uid !== uid) };
    if (req) this.clearNotice(req.notice);
    if (yes) {
      this.notify(uid, { type: 'friend-ok' });
      this.watchDm(uid);
    }
    this.changed();
  }

  removeFriend(uid: string): void {
    const f = this.friends;
    this.friends = { ...f, friends: f.friends.filter((x) => x !== uid), outgoing: f.outgoing.filter((x) => x !== uid) };
    this.changed();
  }

  friendState(uid: string): 'me' | 'friend' | 'sent' | 'asked-you' | 'none' {
    if (uid === this.uid) return 'me';
    const f = this.friends;
    if (f.friends.includes(uid)) return 'friend';
    if (f.outgoing.includes(uid)) return 'sent';
    if (f.incoming.some((r) => r.uid === uid)) return 'asked-you';
    return 'none';
  }

  // ---------- Groups ----------

  /** Creates a group with some people and sends each of them the group's key, encrypted for them. */
  async createGroup(name: string, members: string[]): Promise<string | null> {
    if (!this.bus) return 'Chat isn’t available here';
    const clean = name.trim().slice(0, 40);
    if (!clean) return 'Give the group a name';
    if (!members.length) return 'Pick at least one person';
    const gid = newId();
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const g: Group = { gid, name: clean, members: [this.uid, ...members], owner: this.uid, key: b64(raw) };
    this.groups = [...this.groups, g];
    this.watchGroup(g);
    const meta = { name: g.name, members: g.members, owner: g.owner };
    this.bus.publish(`${NS}grp/${gid}/meta`, JSON.stringify(meta), true);
    for (const m of members) await this.inviteToGroup(g, m);
    this.changed();
    return null;
  }

  private async inviteToGroup(g: Group, uid: string): Promise<boolean> {
    const dm = await this.dmKey(uid);
    if (!dm) return false;
    const key = await this.seal(dm, g.key);
    this.notify(uid, { type: 'group', gid: g.gid, group: { name: g.name, members: g.members, owner: g.owner }, key });
    return true;
  }

  async addToGroup(gid: string, uids: string[]): Promise<void> {
    const g = this.groups.find((x) => x.gid === gid);
    if (!g || !this.bus) return;
    const members = [...new Set([...g.members, ...uids])];
    const updated = { ...g, members };
    this.groups = this.groups.map((x) => (x.gid === gid ? updated : x));
    this.bus.publish(`${NS}grp/${gid}/meta`, JSON.stringify({ name: g.name, members, owner: g.owner }), true);
    for (const u of uids) await this.inviteToGroup(updated, u);
    this.changed();
  }

  leaveGroup(gid: string): void {
    const g = this.groups.find((x) => x.gid === gid);
    if (!g) return;
    this.groups = this.groups.filter((x) => x.gid !== gid);
    this.bus?.publish(`${NS}grp/${gid}/meta`, JSON.stringify({ name: g.name, members: g.members.filter((m) => m !== this.uid), owner: g.owner }), true);
    this.changed();
  }

  // ---------- Rooms: seeing each other walk around ----------

  private readonly poses = new Map<string, { x: number; z: number; yaw: number; seat: string | null; at: number }>();

  /** The room you're walking around in, if any. */
  get room(): Room | null {
    return this.world?.room ?? null;
  }

  /** The room on screen right now (or null when leaving it). */
  attachWorld(floor: CasinoFloor3D | null, room: Room): void {
    this.world?.stop();
    this.world = null;
    this.poses.clear();
    if (!floor || !this.bus || !this.uid) return this.announce();
    const bus = this.bus;
    const topic = `${NS}pos/${room}/${this.uid}`;
    const stopSub = bus.subscribe(`${NS}pos/${room}/#`, (payload, t) => {
      const uid = t.slice(`${NS}pos/${room}/`.length);
      if (uid === this.uid) return;
      try {
        const p = JSON.parse(payload) as { x: number; z: number; yaw: number; seat: string | null; gone?: boolean };
        if (p.gone) this.poses.delete(uid);
        else this.poses.set(uid, { x: +p.x || 0, z: +p.z || 0, yaw: +p.yaw || 0, seat: typeof p.seat === 'string' ? p.seat : null, at: Date.now() });
      } catch {
        /* ignore */
      }
    });
    let last = '';
    let lastSent = 0;
    const tick = setInterval(() => {
      const pose = floor.pose();
      const text = JSON.stringify(pose);
      const now = Date.now();
      // Moving: up to 4 updates a second; standing still: one every 2 seconds.
      if ((text !== last && now - lastSent > 240) || now - lastSent > 2000) {
        last = text;
        lastSent = now;
        bus.publish(topic, text);
      }
      const people = [...this.poses]
        .filter(([uid, p]) => now - p.at < 7000 && this.people.has(uid))
        .map(([uid, p]) => ({ id: uid, name: this.people.get(uid)!.name, look: this.people.get(uid)!.look, ...p }));
      floor.setPeople(people);
    }, 120);
    // What people say in the global chat shows above their heads (private messages never do).
    const offMsg = this.onMessage((m) => {
      if (m.conv === 'global' && m.from !== this.uid && this.poses.has(m.from)) floor.say(m.from, m.text);
    });
    this.world = {
      floor,
      room,
      stop: () => {
        clearInterval(tick);
        stopSub();
        offMsg();
        bus.publish(topic, JSON.stringify({ gone: true }));
      },
    };
    this.announce();
  }

  /** Who is in a room right now (from their profiles). */
  inRoom(room: Room): Person[] {
    return [...this.people.values()].filter((p) => p.uid !== this.uid && p.room === room && this.isOnline(p.uid));
  }
}

export const social = new Social();
