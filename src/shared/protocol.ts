// Everything the browser and the server say to each other.
// The server is authoritative: clients only send *intentions* (bet, hit, stand…);
// the server validates them and broadcasts the resulting public state.

import type { Action, Card, Outcome } from '../game/index.js';

export type Phase = 'waiting' | 'betting' | 'dealing' | 'insurance' | 'playing' | 'dealer' | 'results';

export const MAX_SEATS = 5;

/** How a player's character looks. Each field is an index into the option lists below. */
export interface Look {
  skin: number;
  hair: number;
  hairColor: number;
  outfit: number;
  extra: number;
}

/** The choices in the character editor (labels in the same order as the indexes). */
export const LOOK_OPTIONS = {
  skin: ['#f6d7c3', '#e8b896', '#d29a72', '#b07650', '#8a5636', '#5e3a24'],
  hair: ['Short', 'Long', 'Bun', 'Curly', 'Buzz cut', 'Bald', 'Ponytail'],
  hairColor: ['#1d1510', '#3b2414', '#6b4423', '#a26a32', '#d9b06a', '#8f8f8f', '#9c2f2f'],
  outfit: ['#2f6fb0', '#b03b5a', '#2f8f6b', '#7a4ba8', '#c0782a', '#2b2b2b', '#e4e0d6', '#1f5f6e'],
  extra: ['None', 'Glasses', 'Sunglasses', 'Cap', 'Beanie'],
} as const;

export function randomLook(rand: () => number = Math.random): Look {
  const pick = (n: number) => Math.floor(rand() * n);
  return {
    skin: pick(LOOK_OPTIONS.skin.length),
    hair: pick(LOOK_OPTIONS.hair.length),
    hairColor: pick(LOOK_OPTIONS.hairColor.length),
    outfit: pick(LOOK_OPTIONS.outfit.length),
    extra: rand() < 0.55 ? 0 : 1 + pick(LOOK_OPTIONS.extra.length - 1),
  };
}

/** Accepts only valid option indexes; anything else becomes a random look. */
export function cleanLook(raw: unknown): Look {
  const r = (raw ?? {}) as Record<string, unknown>;
  const fallback = randomLook();
  const field = (key: keyof Look) => {
    const v = r[key];
    const max = LOOK_OPTIONS[key].length;
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max ? v : fallback[key];
  };
  return { skin: field('skin'), hair: field('hair'), hairColor: field('hairColor'), outfit: field('outfit'), extra: field('extra') };
}
export const CHIP_VALUES = [5, 25, 100, 500] as const;

export interface PublicHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  fromSplit: boolean;
  /** "soft 17", "Blackjack", "Bust (24)"… */
  label: string;
  done: boolean;
  outcome: Outcome | null;
  payout: number | null;
}

export interface PublicPlayer {
  id: string;
  name: string;
  seat: number | null; // null = spectator
  /** A computer-controlled player. */
  bot: boolean;
  look: Look;
  balance: number;
  /** Chips in the betting circle (main bet, before any double/split). */
  bet: number;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  /** Has hands in the current round. */
  inRound: boolean;
  hands: PublicHand[];
  /** null = not decided yet, 0 = declined. */
  insurance: number | null;
  insurancePayout: number | null;
}

export interface PublicState {
  code: string;
  solo: boolean;
  phase: Phase;
  round: number;
  /** When the current countdown ends (server clock, ms). */
  deadline: number | null;
  /** Full length of the current countdown (ms), for drawing a progress bar. */
  timerMs: number | null;
  /** Server clock when this state was sent, to correct for clock differences. */
  serverTime: number;
  hostId: string | null;
  /** The hole card is `null` until the dealer reveals it. */
  dealer: { cards: (Card | null)[]; label: string; revealed: boolean };
  shoe: { remaining: number; size: number; cutCardReached: boolean };
  players: PublicPlayer[];
  turn: { playerId: string; handIndex: number; actions: Action[] } | null;
  limits: { minBet: number; maxBet: number; startingBalance: number };
}

/** One-off things that happened, so the 3D view can animate them in order. */
export type TableEvent =
  | { type: 'shuffle' }
  | { type: 'deal'; to: 'dealer' | string; handIndex: number; card: Card | null }
  | { type: 'reveal'; card: Card }
  | { type: 'peek'; blackjack: boolean }
  | { type: 'split'; playerId: string; handIndex: number }
  | { type: 'double'; playerId: string; handIndex: number }
  | { type: 'bet'; playerId: string; amount: number }
  | { type: 'settle' }
  | { type: 'clear' };

export interface StateMessage {
  state: PublicState;
  events: TableEvent[];
}

export interface ChatMessage {
  id: number;
  playerId: string | null; // null = system message
  name: string;
  text: string;
  time: number;
}

/** `code` lets the client react to specific errors, e.g. 'SEAT_IN_USE'. */
export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string; code?: string }) => void;

export interface JoinResult {
  code: string;
  playerId: string;
  token: string;
}

export interface ClientToServer {
  /** `bots`: how many computer players to seat with you (0–4). */
  'room:create': (p: { name: string; solo?: boolean; bots?: number; look?: Look }, ack: Ack<JoinResult>) => void;
  /** `rejoin`: automatic reconnect with a saved token; fails instead of creating a new player. */
  'room:join': (p: { code: string; name: string; token?: string; rejoin?: boolean; look?: Look }, ack: Ack<JoinResult>) => void;
  'player:look': (p: { look: Look }, ack: Ack) => void;
  'host:addBot': (ack: Ack) => void;
  'room:leave': () => void;
  'seat:take': (ack: Ack) => void;
  'bet:add': (p: { amount: number }, ack: Ack) => void;
  'bet:clear': (ack: Ack) => void;
  'bet:ready': (ack: Ack) => void;
  'insurance': (p: { take: boolean }, ack: Ack) => void;
  'action': (p: { action: Action }, ack: Ack) => void;
  'chips:reset': (ack: Ack) => void;
  'host:start': (ack: Ack) => void;
  'host:kick': (p: { playerId: string }, ack: Ack) => void;
  'chat:send': (p: { text: string }, ack: Ack) => void;
}

export interface ServerToClient {
  state: (msg: StateMessage) => void;
  chat: (msg: ChatMessage) => void;
  'chat:history': (msgs: ChatMessage[]) => void;
  kicked: () => void;
  /** The table is gone (e.g. the host of an online preview table left). */
  closed: (p: { reason: string }) => void;
}
