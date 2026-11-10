// Challenges without a server: each challenge is a few retained messages on the public
// relays (every one that answers, so a single relay going down doesn't lose it):
//   <ns>/challenge/<CODE>/info        the challenge: name, host, starting chips, end time
//   <ns>/challenge/<CODE>/p/<player>  each player's name, look and latest chip count
// Watching the leaderboard = subscribing to <ns>/challenge/<CODE>/#.

import type { ChallengeBoard, ChallengeInfo, ChallengePlayer } from '../../shared/protocol.js';
import { cleanChallengeMinutes, cleanLook } from '../../shared/protocol.js';
import type { ChallengeBackend } from '../challenge-api.js';
import { BROKERS, Mqtt } from './relay.js';

const NS = 'kenzo-blackjack/v1/challenge';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GRACE_MS = 5000;

const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join('');
const randomId = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, n * 2);

/** Connections to every relay that answers, opened once and shared. */
let links: Promise<Mqtt[]> | null = null;
function connectAll(): Promise<Mqtt[]> {
  links ??= Promise.all(BROKERS.map((_, i) => Mqtt.connect(undefined, i).then((r) => r.mqtt).catch(() => null))).then((list) => {
    const ok = list.filter((m): m is Mqtt => m !== null);
    for (const m of ok) m.onClose = () => (links = null); // reconnect next time
    if (!ok.length) links = null;
    return ok;
  });
  return links;
}

async function publish(topic: string, payload: string): Promise<number> {
  const all = await connectAll();
  for (const m of all) m.publish(topic, payload, true);
  return all.length;
}

/** Collects what the relays hold under `code` for a moment (retained messages arrive right away). */
async function snapshot(code: string, ms = 2500): Promise<ChallengeBoard | null> {
  return new Promise((resolve) => {
    let board: ChallengeBoard | null = null;
    const stop = watchRaw(code, (b) => (board = b));
    setTimeout(() => {
      stop();
      resolve(board);
    }, ms);
  });
}

function parse<T>(text: string): T | null {
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

function watchRaw(code: string, fn: (board: ChallengeBoard | null) => void): () => void {
  let info: ChallengeInfo | null = null;
  const players = new Map<string, ChallengePlayer>();
  const emit = () => {
    if (!info) return;
    const end = info.endsAt + GRACE_MS;
    const list = [...players.values()].filter((p) => p.at <= end).sort((a, b) => b.chips - a.chips || a.at - b.at);
    fn({ info, players: list });
  };
  const filter = `${NS}/${code}/#`;
  const handler = (payload: string, topic: string) => {
    const leaf = topic.slice(`${NS}/${code}/`.length);
    if (leaf === 'info') {
      const i = parse<ChallengeInfo>(payload);
      if (i && typeof i.endsAt === 'number' && i.code === code) info = i;
    } else if (leaf.startsWith('p/')) {
      const p = parse<ChallengePlayer>(payload);
      if (!p || typeof p.chips !== 'number' || typeof p.at !== 'number') return;
      const id = leaf.slice(2);
      const had = players.get(id);
      // Several relays may hold copies: keep the newest.
      if (!had || p.at >= had.at) players.set(id, { id, name: String(p.name ?? 'Player').slice(0, 20), look: cleanLook(p.look), chips: Math.max(0, Math.floor(p.chips)), at: p.at });
    }
    emit();
  };
  let stopped = false;
  void connectAll().then((all) => {
    if (stopped) return;
    if (!all.length) fn(null);
    for (const m of all) m.subscribe(filter, handler);
  });
  return () => {
    stopped = true;
    void connectAll().then((all) => all.forEach((m) => m.unsubscribe(filter)));
  };
}

export const relayChallenges: ChallengeBackend = {
  async create(o) {
    let code = randomCode();
    // Make sure nobody else is using this code.
    for (let tries = 0; tries < 3 && (await snapshot(code, 1500)); tries++) code = randomCode();
    const now = Date.now();
    const minutes = cleanChallengeMinutes(o.minutes);
    const info: ChallengeInfo = { code, name: o.name.slice(0, 40) || `${o.player.name}’s challenge`, host: o.player.name, startChips: o.startChips === 5000 ? 5000 : 1000, createdAt: now, endsAt: now + minutes * 60_000 };
    if (!(await publish(`${NS}/${code}/info`, JSON.stringify(info)))) return { ok: false, error: 'Couldn’t reach the online service. Check your internet connection.' };
    const playerId = randomId(6);
    await publish(`${NS}/${code}/p/${playerId}`, JSON.stringify({ name: o.player.name, look: o.player.look, chips: info.startChips, at: now }));
    return { ok: true, code, playerId, secret: '', info };
  },
  async join(raw, player) {
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const board = await snapshot(code);
    if (!board) return { ok: false, error: 'No challenge with that code (or it couldn’t be reached). Check the code and your connection.' };
    if (Date.now() >= board.info.endsAt) return { ok: false, error: 'That challenge is already over' };
    const playerId = randomId(6);
    await publish(`${NS}/${code}/p/${playerId}`, JSON.stringify({ name: player.name, look: player.look, chips: board.info.startChips, at: Date.now() }));
    return { ok: true, playerId, secret: '', info: board.info };
  },
  async report(code, me, chips) {
    await publish(`${NS}/${code}/p/${me.playerId}`, JSON.stringify({ name: me.name, look: me.look, chips, at: Date.now() }));
  },
  watch: (code, fn) => watchRaw(code, fn),
};
