// Online tables for the website build (GitHub Pages): no server of our own and no accounts.
//
// The host's page runs the table (PageServer). Pages talk through a free public MQTT
// broker over a secure WebSocket: a simple publish/subscribe relay. Topics per table:
//   <ns>/<CODE>/host       retained: who hosts it (cleared when the host leaves)
//   <ns>/<CODE>/req        guests → host: requests (bet, hit…), and keep-alive pings
//   <ns>/<CODE>/res/<id>   host → one guest: answers
//   <ns>/<CODE>/push       host → everyone: state, chat, "closed"
//   <ns>/<CODE>/hb         host heartbeat
// The host checks every move, as the real server does. Messages pass through a public
// broker, so this is for play-money fun with friends, not for anything private.

import type { PageServer } from '../preview/page-server.js';
import type { GuestLink } from '../preview/sockets.js';

const NS = 'kenzo-blackjack/v1';

/** Public brokers that accept MQTT over secure WebSockets without an account. */
export const BROKERS = relayOverride() ?? ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];

/** For testing: localStorage "bj:relay" = a broker URL to use instead of the public ones. */
function relayOverride(): string[] | null {
  try {
    const url = localStorage.getItem('bj:relay');
    return url ? [url] : null;
  } catch {
    return null;
  }
}

// ---------- A minimal MQTT 3.1.1 client (QoS 0) ----------

const enc = new TextEncoder();
const dec = new TextDecoder();

function str(s: string): Uint8Array {
  const b = enc.encode(s);
  return Uint8Array.from([b.length >> 8, b.length & 255, ...b]);
}

function packet(type: number, flags: number, body: Uint8Array): Uint8Array {
  const len: number[] = [];
  let n = body.length;
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 128;
    len.push(byte);
  } while (n > 0);
  const out = new Uint8Array(1 + len.length + body.length);
  out[0] = (type << 4) | flags;
  out.set(len, 1);
  out.set(body, 1 + len.length);
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export interface Will {
  topic: string;
  payload: string;
  retain: boolean;
}

export class Mqtt {
  private ws: WebSocket | null = null;
  private buffer = new Uint8Array(0);
  private readonly handlers = new Map<string, (payload: string, topic: string) => void>();
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private packetId = 1;
  readonly clientId = `bj-${Math.random().toString(36).slice(2, 12)}`;
  onClose: () => void = () => {};

  /** Connects to the first broker that answers (or the one given). Resolves with its index. */
  /** `will(clientId)`: the message the broker sends for us if this page disappears. */
  static async connect(will?: (clientId: string) => Will, brokerIndex?: number): Promise<{ mqtt: Mqtt; broker: number }> {
    const order = brokerIndex !== undefined ? [brokerIndex] : BROKERS.map((_, i) => i);
    let lastError: unknown = null;
    for (const i of order) {
      const mqtt = new Mqtt();
      try {
        await mqtt.open(BROKERS[i]!, will?.(mqtt.clientId));
        return { mqtt, broker: i };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error('No relay available');
  }

  private open(url: string, will?: Will): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Relay did not answer'));
      }, 6000);
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Relay unreachable'));
      };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        this.onClose();
      };
      ws.onopen = () => {
        let flags = 0x02; // clean session
        const payload = [str(this.clientId)];
        if (will) {
          flags |= 0x04 | (will.retain ? 0x20 : 0);
          payload.push(str(will.topic), str(will.payload));
        }
        const header = concat(str('MQTT'), Uint8Array.from([4, flags, 0, 30])); // level 4, keep-alive 30 s
        ws.send(packet(1, 0, concat(header, ...payload)));
      };
      ws.onmessage = (e) => {
        this.buffer = concat(this.buffer, new Uint8Array(e.data as ArrayBuffer));
        for (;;) {
          const p = this.readPacket();
          if (!p) break;
          if (p.type === 2) {
            // CONNACK
            clearTimeout(timeout);
            if (p.body[1] !== 0) return reject(new Error('Relay refused the connection'));
            this.pingTimer = setInterval(() => this.ws?.readyState === 1 && this.ws.send(Uint8Array.from([0xc0, 0])), 20_000);
            resolve();
          } else if (p.type === 3) {
            // PUBLISH (QoS 0)
            const tlen = (p.body[0]! << 8) | p.body[1]!;
            const topic = dec.decode(p.body.subarray(2, 2 + tlen));
            const message = dec.decode(p.body.subarray(2 + tlen));
            for (const [filter, fn] of this.handlers) if (matches(filter, topic)) fn(message, topic);
          }
        }
      };
    });
  }

  private readPacket(): { type: number; body: Uint8Array } | null {
    const b = this.buffer;
    if (b.length < 2) return null;
    let len = 0;
    let mult = 1;
    let i = 1;
    for (;;) {
      if (i >= b.length) return null;
      const byte = b[i++]!;
      len += (byte & 127) * mult;
      if (!(byte & 128)) break;
      mult *= 128;
    }
    if (b.length < i + len) return null;
    const p = { type: b[0]! >> 4, body: b.slice(i, i + len) };
    this.buffer = b.slice(i + len);
    return p;
  }

  subscribe(filter: string, fn: (payload: string, topic: string) => void): void {
    this.handlers.set(filter, fn);
    const id = this.packetId++;
    this.ws?.send(packet(8, 2, concat(Uint8Array.from([id >> 8, id & 255]), str(filter), Uint8Array.from([0]))));
  }

  publish(topic: string, payload: string, retain = false): void {
    if (this.ws?.readyState !== 1) return;
    this.ws.send(packet(3, retain ? 1 : 0, concat(str(topic), enc.encode(payload))));
  }

  close(): void {
    clearInterval(this.pingTimer);
    if (this.ws?.readyState === 1) this.ws.send(Uint8Array.from([0xe0, 0])); // DISCONNECT
    this.ws?.close();
    this.ws = null;
  }
}

function matches(filter: string, topic: string): boolean {
  if (filter === topic) return true;
  if (filter.endsWith('/#')) return topic.startsWith(filter.slice(0, -1));
  return false;
}

const topic = (code: string, leaf: string) => `${NS}/${code.toUpperCase()}/${leaf}`;

// ---------- Finding a table ----------

export interface RelayTable {
  code: string;
  host: string;
  hostId: string;
  broker: number;
}

/** Looks up who hosts a table (the retained "host" message). */
export async function findRelayTable(code: string, brokerIndex?: number, timeoutMs = 7000): Promise<RelayTable | null> {
  const order = brokerIndex !== undefined ? [brokerIndex] : BROKERS.map((_, i) => i);
  for (const b of order) {
    let mqtt: Mqtt;
    try {
      ({ mqtt } = await Mqtt.connect(undefined, b));
    } catch {
      continue;
    }
    const found = await new Promise<RelayTable | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs / order.length);
      mqtt.subscribe(topic(code, 'host'), (payload) => {
        try {
          const h = JSON.parse(payload) as { id: string; name: string };
          if (typeof h.id !== 'string') return;
          clearTimeout(timer);
          resolve({ code: code.toUpperCase(), host: String(h.name ?? 'Someone').slice(0, 20), hostId: h.id, broker: b });
        } catch {
          /* cleared or malformed: keep waiting */
        }
      });
    });
    mqtt.close();
    if (found) return found;
  }
  return null;
}

// ---------- Guest side ----------

export class RelayLink implements GuestLink {
  onPush: (event: string, args: unknown[]) => void = () => {};
  onResponse: (id: number, res: unknown) => void = () => {};
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private hostWatch: ReturnType<typeof setInterval> | undefined;
  private lastHostBeat = Date.now();
  private closed = false;

  private constructor(
    private readonly mqtt: Mqtt,
    private readonly table: RelayTable,
  ) {}

  static async connect(table: RelayTable): Promise<RelayLink> {
    const code = table.code;
    const { mqtt } = await Mqtt.connect(
      // If this page vanishes, the host hears "bye" and frees the seat after the grace period.
      (id) => ({ topic: topic(code, 'req'), payload: JSON.stringify({ from: id, bye: true }), retain: false }),
      table.broker,
    );
    const link = new RelayLink(mqtt, table);
    link.listen();
    return link;
  }

  private listen(): void {
    const me = this.mqtt.clientId;
    this.mqtt.subscribe(topic(this.table.code, 'push'), (payload) => {
      try {
        const m = JSON.parse(payload) as { from: string; to: string | null; event: string; args: unknown[] };
        if (m.from !== this.table.hostId || (m.to && m.to !== me)) return;
        this.onPush(m.event, Array.isArray(m.args) ? m.args : []);
      } catch {
        /* ignore */
      }
    });
    this.mqtt.subscribe(topic(this.table.code, `res/${me}`), (payload) => {
      try {
        const m = JSON.parse(payload) as { from: string; id: number; res: unknown };
        if (m.from === this.table.hostId) this.onResponse(Number(m.id), m.res);
      } catch {
        /* ignore */
      }
    });
    this.mqtt.subscribe(topic(this.table.code, 'hb'), (payload) => {
      if (payload === this.table.hostId) this.lastHostBeat = Date.now();
    });
    // Tell the host we're still here; notice if the host goes quiet.
    this.pingTimer = setInterval(() => this.mqtt.publish(topic(this.table.code, 'req'), JSON.stringify({ from: me, ping: true })), 5000);
    this.hostWatch = setInterval(() => {
      if (Date.now() - this.lastHostBeat > 20_000) this.hostGone();
    }, 3000);
    this.mqtt.onClose = () => this.hostGone('Lost the connection to the table.');
  }

  private hostGone(reason = 'The host left, so the table closed.'): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pingTimer);
    clearInterval(this.hostWatch);
    this.onPush('closed', [{ reason }]);
  }

  async request(id: number, event: string, payload: unknown): Promise<void> {
    this.mqtt.publish(topic(this.table.code, 'req'), JSON.stringify({ from: this.mqtt.clientId, id, event, payload }));
  }

  async leave(): Promise<void> {
    this.closed = true;
    clearInterval(this.pingTimer);
    clearInterval(this.hostWatch);
    this.mqtt.publish(topic(this.table.code, 'req'), JSON.stringify({ from: this.mqtt.clientId, bye: true }));
    this.mqtt.close();
  }
}

// ---------- Host side ----------

export class RelayHost {
  private mqtt: Mqtt | null = null;
  private beat: ReturnType<typeof setInterval> | undefined;
  private sweep: ReturnType<typeof setInterval> | undefined;
  private readonly lastSeen = new Map<string, number>();
  broker = 0;

  constructor(
    private readonly server: PageServer,
    readonly code: string,
    private readonly hostName: string,
  ) {}

  async start(): Promise<void> {
    const code = this.code;
    // If this page disappears, the broker clears the "host" record so nobody joins a dead table.
    const { mqtt, broker } = await Mqtt.connect(() => ({ topic: topic(code, 'host'), payload: '', retain: true }));
    this.mqtt = mqtt;
    this.broker = broker;
    const hostId = mqtt.clientId;
    const connId = (peer: string) => `relay:${peer}`;

    mqtt.subscribe(topic(code, 'req'), (payload) => {
      let m: { from?: string; id?: number; event?: string; payload?: unknown; ping?: boolean; bye?: boolean };
      try {
        m = JSON.parse(payload);
      } catch {
        return;
      }
      const from = typeof m.from === 'string' ? m.from.slice(0, 40) : '';
      if (!from || from === hostId) return;
      if (m.bye) {
        this.lastSeen.delete(from);
        this.server.disconnect(connId(from));
        return;
      }
      this.lastSeen.set(from, Date.now());
      if (m.ping || typeof m.event !== 'string') return;
      this.server.connect({
        id: connId(from),
        remote: true,
        deliver: (event, ...args) => mqtt.publish(topic(code, 'push'), JSON.stringify({ from: hostId, to: from, event, args })),
      });
      let res: unknown;
      try {
        res = this.server.handle(connId(from), m.event, (m.payload ?? {}) as Record<string, unknown>);
      } catch (err) {
        console.error(err);
        res = { ok: false, error: 'Something went wrong' };
      }
      if (res !== undefined) mqtt.publish(topic(code, `res/${from}`), JSON.stringify({ from: hostId, id: m.id, res }));
    });
    this.server.onRemoteBroadcast = (c, event, args) => {
      if (c === code) mqtt.publish(topic(code, 'push'), JSON.stringify({ from: hostId, to: null, event, args }));
    };
    mqtt.publish(topic(code, 'host'), JSON.stringify({ id: hostId, name: this.hostName }), true);
    this.beat = setInterval(() => mqtt.publish(topic(code, 'hb'), hostId), 5000);
    // Guests who stopped pinging have closed their tab: free their seat (with the usual grace period).
    this.sweep = setInterval(() => {
      const now = Date.now();
      for (const [peer, seen] of this.lastSeen) {
        if (now - seen > 20_000) {
          this.lastSeen.delete(peer);
          this.server.disconnect(connId(peer));
        }
      }
    }, 5000);
  }

  async stop(): Promise<void> {
    clearInterval(this.beat);
    clearInterval(this.sweep);
    this.server.closeRoom(this.code, 'The host closed the table.');
    this.server.onRemoteBroadcast = null;
    this.mqtt?.publish(topic(this.code, 'host'), '', true);
    this.mqtt?.close();
  }
}

// ---------- Cloud saves (accounts for the file and website builds) ----------
//
// An account's save is one retained message on each public broker, under a topic that
// only someone with the right email AND password can work out, holding data encrypted
// with a key from that same password. Brokers only ever see scrambled bytes.

const saveTopic = (id: string) => `${NS}/acct/${id}`;

/** Reads the saves kept under `id` on every broker that answers (one per broker). */
export async function cloudGet(id: string, timeoutMs = 4500): Promise<string[]> {
  const found = await Promise.all(
    BROKERS.map(async (_, i) => {
      let mqtt: Mqtt;
      try {
        ({ mqtt } = await Mqtt.connect(undefined, i));
      } catch {
        return null;
      }
      const payload = await new Promise<string | null>((resolve) => {
        // A retained message arrives right after subscribing; nothing means no save there.
        const timer = setTimeout(() => resolve(null), Math.min(timeoutMs, 2500));
        mqtt.subscribe(saveTopic(id), (p) => {
          if (!p) return;
          clearTimeout(timer);
          resolve(p);
        });
      });
      mqtt.close();
      return payload;
    }),
  );
  return found.filter((p): p is string => Boolean(p));
}

/** Writes a save under `id` on every broker it can reach. Returns how many took it. */
export async function cloudPut(id: string, payload: string): Promise<number> {
  const results = await Promise.all(
    BROKERS.map(async (_, i) => {
      try {
        const { mqtt } = await Mqtt.connect(undefined, i);
        mqtt.publish(saveTopic(id), payload, true);
        // Give the message a moment to leave before saying goodbye.
        await new Promise((r) => setTimeout(r, 150));
        mqtt.close();
        return 1;
      } catch {
        return 0;
      }
    }),
  );
  return results.reduce((a: number, b) => a + b, 0);
}
