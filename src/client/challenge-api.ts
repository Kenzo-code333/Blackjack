// Where challenges are kept: on the game server (fetch), or on the public relays (file
// and website builds; see web/challenge-relay.ts). Both look the same to the game.

import type { ChallengeBoard, ChallengeInfo, Look } from '../shared/protocol.js';

export type Res<T> = ({ ok: true } & T) | { ok: false; error: string };
export interface Joined {
  playerId: string;
  secret: string;
  info: ChallengeInfo;
}

export interface ChallengeBackend {
  create(o: { name: string; minutes: number; startChips: number; player: { name: string; look: Look } }): Promise<Res<Joined & { code: string }>>;
  join(code: string, player: { name: string; look: Look }): Promise<Res<Joined>>;
  /** Your latest chip count. */
  report(code: string, me: { playerId: string; secret: string; name: string; look: Look }, chips: number): Promise<void>;
  /** Calls `fn` with the leaderboard now and whenever it changes. Returns a stop function. */
  watch(code: string, fn: (board: ChallengeBoard | null) => void): () => void;
}

async function call<T>(url: string, body?: unknown): Promise<Res<T>> {
  try {
    const r = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return (await r.json()) as Res<T>;
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  }
}

export const serverChallenges: ChallengeBackend = {
  create: (o) => call('/api/challenge', o),
  join: (code, player) => call(`/api/challenge/${encodeURIComponent(code)}/join`, { player }),
  async report(code, me, chips) {
    await call(`/api/challenge/${encodeURIComponent(code)}/score`, { playerId: me.playerId, secret: me.secret, chips });
  },
  watch(code, fn) {
    let stopped = false;
    const tick = async () => {
      const r = await call<{ board: ChallengeBoard }>(`/api/challenge/${encodeURIComponent(code)}`);
      if (!stopped) fn(r.ok ? r.board : null);
    };
    void tick();
    const timer = setInterval(() => void tick(), 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  },
};
