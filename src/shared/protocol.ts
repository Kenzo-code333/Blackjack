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

/** Everyone walks in with this many chips, and can refill to it any time. */
export const STARTING_CHIPS = 1000;

/** The chips a player brings to a table (their wallet). Play money, so any sane amount is fine. */
export function cleanChips(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return STARTING_CHIPS;
  return Math.min(n, 10_000_000);
}

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

export type GameKind = 'blackjack' | 'poker' | 'roulette';

export interface PublicState {
  game: 'blackjack';
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
  /** After a shuffle the dealer burns (discards face down) the top card. */
  | { type: 'burn' }
  /** A player made a move: the table shows their hand signal (tap = hit, wave = stand…). */
  | { type: 'act'; playerId: string; handIndex: number; action: Action }
  | { type: 'deal'; to: 'dealer' | string; handIndex: number; card: Card | null }
  | { type: 'reveal'; card: Card }
  | { type: 'peek'; blackjack: boolean }
  | { type: 'split'; playerId: string; handIndex: number }
  | { type: 'double'; playerId: string; handIndex: number }
  | { type: 'bet'; playerId: string; amount: number }
  | { type: 'settle' }
  | { type: 'clear' };

// ---------- Texas Hold'em ----------

export const POKER_SEATS = 6;
export type PokerPhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'results';
export type PokerAction = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface PokerPlayer {
  id: string;
  name: string;
  seat: number | null;
  bot: boolean;
  look: Look;
  /** Chips in front of the player (their stack). */
  balance: number;
  /** Chips put in during this betting round. */
  bet: number;
  /** Chips put in during the whole hand. */
  total: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  connected: boolean;
  isHost: boolean;
  /** "Check", "Call 20", "Raise to 60", "Fold", "All in". */
  lastAction: string | null;
  /** Your own cards always; other players' only at the showdown. */
  hole: Card[] | null;
  holeCount: number;
  /** At the showdown: their best hand, and what they won. */
  handName: string | null;
  won: number;
}

export interface PokerState {
  game: 'poker';
  code: string;
  solo: false;
  phase: PokerPhase;
  /** Hand number. */
  round: number;
  deadline: number | null;
  timerMs: number | null;
  serverTime: number;
  hostId: string | null;
  board: Card[];
  /** All chips in the middle (pots plus this round's bets). */
  pot: number;
  blinds: { small: number; big: number };
  buttonSeat: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  currentBet: number;
  players: PokerPlayer[];
  /** Whose move it is, with what they're allowed to do. */
  turn: { playerId: string; toCall: number; canCheck: boolean; minRaiseTo: number; maxRaiseTo: number } | null;
  /** Hands keep coming one after another (the host pressed Start, or a bot table). */
  running: boolean;
  /** Winners of the last hand, for the results banner. */
  winners: { playerId: string; amount: number; handName: string | null }[];
  limits: { startingBalance: number };
}

export type PokerEvent =
  | { type: 'shuffle' }
  | { type: 'blinds'; small: string; big: string }
  /** A hole card dealt; `card` is null for everyone except its owner. */
  | { type: 'hole'; to: string; card: Card | null }
  | { type: 'board'; cards: Card[]; street: 'flop' | 'turn' | 'river' }
  | { type: 'pact'; playerId: string; action: PokerAction; amount: number }
  /** End of a betting round: bets slide into the pot. */
  | { type: 'collect' }
  | { type: 'showdown' }
  | { type: 'win'; playerId: string; amount: number }
  | { type: 'clear' };

// ---------- Roulette ----------

export const ROULETTE_SEATS = 6;
export type RoulettePhase = 'waiting' | 'betting' | 'spinning' | 'results';

export interface RouletteBet {
  /** "n:17", "red", "dozen:2"… (see src/game/roulette.ts). */
  spot: string;
  amount: number;
}

export interface RoulettePlayer {
  id: string;
  name: string;
  seat: number | null;
  bot: boolean;
  look: Look;
  balance: number;
  bets: RouletteBet[];
  /** Pressed "Spin": done betting this round. */
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  /** Last round: total returned (stake + winnings) and what was staked. */
  won: number;
  staked: number;
  /** Has bets from the last round to repeat. */
  canRebet: boolean;
}

export interface RouletteState {
  game: 'roulette';
  code: string;
  solo: boolean;
  phase: RoulettePhase;
  round: number;
  deadline: number | null;
  timerMs: number | null;
  serverTime: number;
  hostId: string | null;
  players: RoulettePlayer[];
  /** The winning number of the last spin (shown during results). */
  result: number | null;
  /** Latest first. */
  history: number[];
  /** While spinning: the number the ball will land on, and how long the spin lasts. */
  spin: { number: number; durationMs: number; endsAt: number } | null;
  running: boolean;
  limits: { minBet: number; maxSpot: number; maxTotal: number; startingBalance: number };
}

export type RouletteEvent =
  | { type: 'rbet'; playerId: string; spot: string; amount: number }
  | { type: 'rclear'; playerId: string }
  /** The dealer waves a hand over the layout: "No more bets". */
  | { type: 'nomore' }
  | { type: 'spin'; number: number; durationMs: number }
  | { type: 'result'; number: number; winners: { playerId: string; amount: number }[] }
  | { type: 'clear' };

export type AnyState = PublicState | PokerState | RouletteState;
export type AnyEvent = TableEvent | PokerEvent | RouletteEvent;

export interface StateMessage {
  state: AnyState;
  events: AnyEvent[];
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
  'room:create': (p: { name: string; solo?: boolean; bots?: number; look?: Look; game?: GameKind; chips?: number }, ack: Ack<JoinResult>) => void;
  /** `rejoin`: automatic reconnect with a saved token; fails instead of creating a new player. */
  'room:join': (p: { code: string; name: string; token?: string; rejoin?: boolean; look?: Look; chips?: number }, ack: Ack<JoinResult>) => void;
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
  'roulette:bet': (p: { spot: string; amount: number }, ack: Ack) => void;
  'roulette:clear': (ack: Ack) => void;
  'roulette:rebet': (ack: Ack) => void;
  'roulette:ready': (ack: Ack) => void;
  'chat:send': (p: { text: string }, ack: Ack) => void;
  /** Poker: fold, check, call, raise to `amount`, or go all in. */
  'poker:act': (p: { action: PokerAction; amount?: number }, ack: Ack) => void;
}

export interface ServerToClient {
  state: (msg: StateMessage) => void;
  chat: (msg: ChatMessage) => void;
  'chat:history': (msgs: ChatMessage[]) => void;
  kicked: () => void;
  /** The table is gone (e.g. the host of an online preview table left). */
  closed: (p: { reason: string }) => void;
}
