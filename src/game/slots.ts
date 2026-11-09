// A classic three-reel slot machine with one payline (the middle row).
//
// Each reel has the same 30 stops. A spin picks one stop per reel at random; the
// symbols on the payline decide the win. The pay table gives back about 96% of what
// is bet over time (tested in slots.test.ts), like a real machine.

import { type Rng, cryptoRng } from './random.js';

export type SlotSymbol = 'cherry' | 'lemon' | 'bell' | 'bar' | 'seven' | 'diamond';

/** How many stops each symbol has on a reel (out of 30): rarer symbols pay more. */
export const SYMBOL_WEIGHTS: Record<SlotSymbol, number> = {
  cherry: 9,
  lemon: 8,
  bell: 6,
  bar: 4,
  seven: 2,
  diamond: 1,
};

/** Three of a kind on the payline pays this many times the bet. */
export const THREE_OF_A_KIND: Record<SlotSymbol, number> = {
  diamond: 100,
  seven: 50,
  bar: 20,
  bell: 12,
  cherry: 10,
  lemon: 8,
};

/** Exactly two cherries anywhere on the payline. */
export const TWO_CHERRIES = 2;

export const SLOT_BETS = [5, 10, 25, 50, 100] as const;

/** The reel strip: symbols spread out so the same one rarely sits next to itself. */
export const REEL: SlotSymbol[] = (() => {
  const counts = { ...SYMBOL_WEIGHTS };
  const strip: SlotSymbol[] = [];
  const order: SlotSymbol[] = ['cherry', 'lemon', 'bell', 'bar', 'cherry', 'lemon', 'bell', 'seven', 'cherry', 'lemon', 'diamond', 'bar'];
  while (strip.length < 30) {
    for (const s of order) {
      if (counts[s] > 0 && strip.length < 30) {
        strip.push(s);
        counts[s]--;
      }
    }
  }
  return strip;
})();

/** What a payline pays, as a multiple of the bet (0 = no win). */
export function payout(line: [SlotSymbol, SlotSymbol, SlotSymbol]): number {
  const [a, b, c] = line;
  if (a === b && b === c) return THREE_OF_A_KIND[a];
  const cherries = line.filter((s) => s === 'cherry').length;
  return cherries === 2 ? TWO_CHERRIES : 0;
}

export interface SpinResult {
  /** The stop index of each reel (the symbol on the payline is REEL[stop]). */
  stops: [number, number, number];
  line: [SlotSymbol, SlotSymbol, SlotSymbol];
  /** Multiple of the bet won (0 = lost). */
  multiplier: number;
}

export function spinReels(rng: Rng = cryptoRng): SpinResult {
  const stops = [0, 1, 2].map(() => Math.floor(rng() * REEL.length)) as [number, number, number];
  const line = stops.map((s) => REEL[s]!) as [SlotSymbol, SlotSymbol, SlotSymbol];
  return { stops, line, multiplier: payout(line) };
}

/** The long-run share of bets paid back, computed exactly over every combination. */
export function returnToPlayer(): number {
  let total = 0;
  const n = REEL.length;
  for (const a of REEL) for (const b of REEL) for (const c of REEL) total += payout([a, b, c]);
  return total / (n * n * n);
}
