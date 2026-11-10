// Your playing record: rounds played and won, chips won or lost per game, slot spins,
// biggest win. Kept with your profile (and your account when signed in).

import type { AnyState, PublicPlayer } from '../shared/protocol.js';
import { roundNet } from './format.js';
import { store } from './storage.js';

export interface GameStats {
  played: number;
  won: number;
  /** Chips won minus chips lost. */
  net: number;
}

export interface Stats {
  blackjack: GameStats;
  poker: GameStats;
  roulette: GameStats;
  slots: GameStats & { jackpots: number };
  biggestWin: number;
  /** Challenges finished, and how many you won. */
  challenges: { played: number; won: number };
  since: number;
}

const KEY = 'bj:stats';
const blank = (): GameStats => ({ played: 0, won: 0, net: 0 });

export function readStats(): Stats {
  const fresh: Stats = { blackjack: blank(), poker: blank(), roulette: blank(), slots: { ...blank(), jackpots: 0 }, biggestWin: 0, challenges: { played: 0, won: 0 }, since: Date.now() };
  try {
    const saved = JSON.parse(store.local.get(KEY) ?? 'null') as Partial<Stats> | null;
    if (!saved || typeof saved !== 'object') return fresh;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const game = (g: unknown): GameStats => {
      const o = (g ?? {}) as Record<string, unknown>;
      return { played: num(o.played), won: num(o.won), net: num(o.net) };
    };
    return {
      blackjack: game(saved.blackjack),
      poker: game(saved.poker),
      roulette: game(saved.roulette),
      slots: { ...game(saved.slots), jackpots: num((saved.slots as Record<string, unknown> | undefined)?.jackpots) },
      biggestWin: num(saved.biggestWin),
      challenges: { played: num(saved.challenges?.played), won: num(saved.challenges?.won) },
      since: num(saved.since) || Date.now(),
    };
  } catch {
    return fresh;
  }
}

function write(s: Stats): void {
  store.local.set(KEY, JSON.stringify(s));
}

/** Adds one finished round or spin. `net` = chips won (positive) or lost (negative). */
export function recordPlay(game: 'blackjack' | 'poker' | 'roulette' | 'slots', net: number, jackpot = false): void {
  const s = readStats();
  const g = s[game];
  g.played++;
  if (net > 0) g.won++;
  g.net += net;
  if (jackpot) s.slots.jackpots++;
  s.biggestWin = Math.max(s.biggestWin, net);
  write(s);
}

export function recordChallenge(won: boolean): void {
  const s = readStats();
  s.challenges.played++;
  if (won) s.challenges.won++;
  write(s);
}

const counted = new Set<string>();

/** Called with every table update: counts each finished round you played in, once. */
export function trackRound(state: AnyState, me: string | null): void {
  if (state.phase !== 'results' || !me) return;
  const key = `${state.code}:${state.round}`;
  if (counted.has(key)) return;
  if (state.game === 'blackjack') {
    const p = state.players.find((x) => x.id === me) as PublicPlayer | undefined;
    if (!p?.inRound) return;
    const net = roundNet(p);
    if (net === null) return;
    counted.add(key);
    recordPlay('blackjack', net);
  } else if (state.game === 'poker') {
    const p = state.players.find((x) => x.id === me);
    if (!p || !p.holeCount || p.seat === null) return;
    counted.add(key);
    recordPlay('poker', p.won - p.total);
  } else {
    const p = state.players.find((x) => x.id === me);
    if (!p || p.staked <= 0) return;
    counted.add(key);
    recordPlay('roulette', p.won - p.staked);
  }
}
