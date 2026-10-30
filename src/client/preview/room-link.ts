// Online tables in the preview, carried by the artifact's live `room` capability.
//
// The host's page runs the table (PageServer). Everyone at a table joins a named
// room "bj-<code>". Guests send requests on `bjreq`; the host answers on `bjres`
// (addressed to one peer) and broadcasts state and chat on `bjpush`. Anything over
// the 4 KB message limit is split into `bjchunk` pieces. Open tables are listed in
// the lobby through each host's presence.

import type { PageServer } from './page-server.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type RoomApi = any;
type NamedRoom = any;
type Msg = { peer: string; isMe: boolean; sameTab: boolean; data?: any };

export interface OpenTable {
  code: string;
  host: string;
  players: number;
  seats: number;
  peer: string;
}

let roomPromise: Promise<RoomApi | null> | null = null;

/** The room capability, or null when this view can't use it (outside claude.ai, signed out…). */
export function getRoom(): Promise<RoomApi | null> {
  roomPromise ??= (async () => {
    const claude = (globalThis as any).claude;
    if (!claude?.use) return null;
    try {
      return (await claude.use('room')) ?? null;
    } catch {
      return null;
    }
  })();
  return roomPromise;
}

const roomName = (code: string) => `bj-${code.toLowerCase()}`;

// ---------- Sending with chunking ----------

const MAX_BYTES = 3500;
const CHUNK_BYTES = 2400;
let chunkSeq = 0;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function send(named: NamedRoom, topic: string, data: unknown): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (bytes.length <= MAX_BYTES) return named.emit(topic, data);
  const id = `${Date.now().toString(36)}${++chunkSeq}`;
  const n = Math.ceil(bytes.length / CHUNK_BYTES);
  for (let i = 0; i < n; i++) {
    await named.emit('bjchunk', { id, topic, i, n, part: toBase64(bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)) });
  }
}

/** Reassembles chunked messages; calls `deliver(topic, msgWithFullData)` when complete. */
function chunkCollector(deliver: (topic: string, msg: Msg) => void) {
  const parts = new Map<string, { parts: Uint8Array[]; got: number; n: number; topic: string }>();
  return (msg: Msg) => {
    const d = msg.data;
    if (!d || typeof d.id !== 'string' || typeof d.part !== 'string') return;
    const key = `${msg.peer}:${d.id}`;
    let entry = parts.get(key);
    if (!entry) {
      entry = { parts: [], got: 0, n: Number(d.n), topic: String(d.topic) };
      parts.set(key, entry);
      setTimeout(() => parts.delete(key), 15_000);
    }
    if (entry.parts[d.i]) return;
    entry.parts[d.i] = fromBase64(d.part);
    entry.got++;
    if (entry.got < entry.n) return;
    parts.delete(key);
    const total = entry.parts.reduce((s, p) => s + p.length, 0);
    const all = new Uint8Array(total);
    let at = 0;
    for (const p of entry.parts) {
      all.set(p, at);
      at += p.length;
    }
    try {
      deliver(entry.topic, { ...msg, data: JSON.parse(new TextDecoder().decode(all)) });
    } catch {
      /* corrupt message: ignore */
    }
  };
}

// ---------- Lobby ----------

export function watchOpenTables(room: RoomApi, onChange: (tables: OpenTable[]) => void): () => void {
  const read = () => {
    const tables: OpenTable[] = [];
    for (const peer of room.peers() as { peer: string; sameTab: boolean; presence: any }[]) {
      const t = peer.presence?.bj;
      if (peer.sameTab || !t || typeof t.code !== 'string') continue;
      tables.push({
        code: String(t.code).slice(0, 6),
        host: String(t.host ?? 'Someone').slice(0, 20),
        players: Number(t.players) || 0,
        seats: Number(t.seats) || 5,
        peer: peer.peer,
      });
    }
    onChange(tables);
  };
  const off = room.onPeers(read);
  read();
  return off;
}

// ---------- Guest side ----------

export class RoomLink {
  onPush: (event: string, args: unknown[]) => void = () => {};
  onResponse: (id: number, res: unknown) => void = () => {};
  private readonly offs: (() => void)[] = [];

  private constructor(
    private readonly named: NamedRoom,
    private readonly hostPeer: string,
  ) {}

  static async connect(room: RoomApi, table: OpenTable): Promise<RoomLink> {
    const named = await room.join(roomName(table.code));
    const link = new RoomLink(named, table.peer);
    link.listen();
    return link;
  }

  private myPeer(): string | undefined {
    return (this.named.peers() as { peer: string; sameTab: boolean }[]).find((p) => p.sameTab)?.peer;
  }

  private handle = (topic: string, msg: Msg) => {
    if (msg.peer !== this.hostPeer) return; // only the host speaks for the table
    const d = msg.data ?? {};
    const forMe = d.to === null || d.to === undefined || d.to === this.myPeer();
    if (!forMe) return;
    if (topic === 'bjres') this.onResponse(Number(d.id), d.res);
    else if (topic === 'bjpush' && typeof d.event === 'string') this.onPush(d.event, Array.isArray(d.args) ? d.args : []);
  };

  private listen(): void {
    this.offs.push(
      this.named.on('bjres', (m: Msg) => this.handle('bjres', m)),
      this.named.on('bjpush', (m: Msg) => this.handle('bjpush', m)),
      this.named.on('bjchunk', chunkCollector(this.handle)),
      this.named.onPeers((change: { left: { peer: string }[] }) => {
        if (change.left.some((p) => p.peer === this.hostPeer)) {
          this.onPush('closed', [{ reason: 'The host left, so the table closed.' }]);
        }
      }),
    );
  }

  request(id: number, event: string, payload: unknown): Promise<void> {
    return send(this.named, 'bjreq', { id, event, payload });
  }

  async leave(): Promise<void> {
    for (const off of this.offs) off();
    await this.named.leave().catch(() => {});
  }
}

// ---------- Host side ----------

export class OnlineHost {
  private named: NamedRoom | null = null;
  private readonly offs: (() => void)[] = [];
  private presenceTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly room: RoomApi,
    private readonly server: PageServer,
    readonly code: string,
    private readonly hostName: string,
  ) {}

  async start(): Promise<void> {
    const named = await this.room.join(roomName(this.code));
    this.named = named;
    const connId = (peer: string) => `peer:${peer}`;

    const onRequest = (_topic: string, msg: Msg) => {
      if (msg.sameTab) return;
      const d = msg.data ?? {};
      if (typeof d.event !== 'string') return;
      const id = connId(msg.peer);
      this.server.connect({
        id,
        remote: true,
        deliver: (event, ...args) => void send(named, 'bjpush', { to: msg.peer, event, args }).catch(() => {}),
      });
      let res: unknown;
      try {
        res = this.server.handle(id, d.event, (d.payload ?? {}) as Record<string, unknown>);
      } catch (err) {
        console.error(err);
        res = { ok: false, error: 'Something went wrong' };
      }
      if (res !== undefined) void send(named, 'bjres', { to: msg.peer, id: d.id, res }).catch(() => {});
    };
    const collect = chunkCollector((topic, m) => topic === 'bjreq' && onRequest(topic, m));
    this.offs.push(
      named.on('bjreq', (m: Msg) => onRequest('bjreq', m)),
      named.on('bjchunk', collect),
      named.onPeers((change: { left: { peer: string }[] }) => {
        for (const p of change.left) this.server.disconnect(connId(p.peer));
      }),
    );
    this.server.onRemoteBroadcast = (code, event, args) => {
      if (code === this.code) void send(named, 'bjpush', { to: null, event, args }).catch(() => {});
    };
    this.advertise();
    this.presenceTimer = setInterval(() => this.advertise(), 4000);
  }

  /** Shows the table in everyone's lobby list. */
  private advertise(): void {
    const table = this.server.rooms.get(this.code)?.table;
    if (!table) return;
    const players = [...table.players.values()].filter((p) => p.seat !== null).length;
    void this.room.presence({ bj: { code: this.code, host: this.hostName, players, seats: 5 } }).catch(() => {});
  }

  async stop(): Promise<void> {
    clearInterval(this.presenceTimer);
    this.server.closeRoom(this.code, 'The host closed the table.');
    this.server.onRemoteBroadcast = null;
    for (const off of this.offs) off();
    void this.room.presence({ bj: null }).catch(() => {});
    await this.named?.leave().catch(() => {});
  }
}
