// Everything the browser and the server say to each other.
// The server is authoritative: clients only send *intentions* (bet, hit, stand…);
// the server validates them and broadcasts the resulting public state.

import type { Action, Card, Outcome } from '../game/index.js';

export type Phase = 'waiting' | 'betting' | 'dealing' | 'insurance' | 'playing' | 'dealer' | 'results';

export const MAX_SEATS = 5;
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

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface JoinResult {
  code: string;
  playerId: string;
  token: string;
}

export interface ClientToServer {
  'room:create': (p: { name: string; solo?: boolean }, ack: Ack<JoinResult>) => void;
  'room:join': (p: { code: string; name: string; token?: string }, ack: Ack<JoinResult>) => void;
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
}
