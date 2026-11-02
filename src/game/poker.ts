// Texas Hold'em hand evaluation: the best 5-card hand out of up to 7 cards.

import type { Card, Rank } from './cards.js';

export const CATEGORIES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
] as const;

export interface PokerHand {
  /** 0 = high card … 8 = straight flush. */
  category: number;
  /** Tie-breakers, most important first (card values 2–14). */
  values: number[];
  /** The five cards that make the hand. */
  best: Card[];
  /** Plain words: "Pair of kings", "Flush, ace high", "Royal flush". */
  name: string;
}

const VALUE: Record<Rank, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
const NAMES: Record<number, [one: string, many: string]> = {
  2: ['two', 'twos'],
  3: ['three', 'threes'],
  4: ['four', 'fours'],
  5: ['five', 'fives'],
  6: ['six', 'sixes'],
  7: ['seven', 'sevens'],
  8: ['eight', 'eights'],
  9: ['nine', 'nines'],
  10: ['ten', 'tens'],
  11: ['jack', 'jacks'],
  12: ['queen', 'queens'],
  13: ['king', 'kings'],
  14: ['ace', 'aces'],
};

export const pokerValue = (card: Card): number => VALUE[card.rank];

/** Evaluates exactly five cards. */
export function evaluateFive(cards: Card[]): PokerHand {
  const vals = cards.map(pokerValue).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0]!.suit);
  const unique = [...new Set(vals)];
  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0]! - unique[4]! === 4) straightHigh = unique[0]!;
    else if (unique.join() === '14,5,4,3,2') straightHigh = 5; // the wheel: A-2-3-4-5
  }
  // Group by value: biggest groups first, then higher values first.
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map(([v]) => v);
  const shape = groups.map(([, n]) => n).join('');

  let category: number;
  let values: number[];
  if (straightHigh && flush) [category, values] = [8, [straightHigh]];
  else if (shape === '41') [category, values] = [7, byGroup];
  else if (shape === '32') [category, values] = [6, byGroup];
  else if (flush) [category, values] = [5, vals];
  else if (straightHigh) [category, values] = [4, [straightHigh]];
  else if (shape === '311') [category, values] = [3, byGroup];
  else if (shape === '221') [category, values] = [2, byGroup];
  else if (shape === '2111') [category, values] = [1, byGroup];
  else [category, values] = [0, vals];

  return { category, values, best: [...cards], name: describe(category, values) };
}

function describe(category: number, v: number[]): string {
  const one = (n: number) => NAMES[n]![0];
  const many = (n: number) => NAMES[n]![1];
  switch (category) {
    case 8:
      return v[0] === 14 ? 'Royal flush' : `Straight flush, ${one(v[0]!)} high`;
    case 7:
      return `Four ${many(v[0]!)}`;
    case 6:
      return `Full house, ${many(v[0]!)} full of ${many(v[1]!)}`;
    case 5:
      return `Flush, ${one(v[0]!)} high`;
    case 4:
      return `Straight, ${one(v[0]!)} high`;
    case 3:
      return `Three ${many(v[0]!)}`;
    case 2:
      return `Two pair, ${many(v[0]!)} and ${many(v[1]!)}`;
    case 1:
      return `Pair of ${many(v[0]!)}`;
    default:
      return `${one(v[0]!)[0]!.toUpperCase()}${one(v[0]!).slice(1)} high`;
  }
}

/** Positive if `a` beats `b`, negative if `b` wins, 0 for a tie. */
export function compareHands(a: PokerHand, b: PokerHand): number {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.values.length, b.values.length); i++) {
    const d = (a.values[i] ?? 0) - (b.values[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The best five-card hand from 5–7 cards. */
export function bestHand(cards: Card[]): PokerHand {
  if (cards.length < 5) throw new Error('Need at least five cards');
  let best: PokerHand | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const h = evaluateFive([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (!best || compareHands(h, best) > 0) best = h;
          }
  return best!;
}

// ---------- Pots ----------

export interface Contribution {
  id: string;
  /** Chips put in during the whole hand. */
  total: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Players who can win it (they didn't fold and put in at least this level). */
  eligible: string[];
}

/**
 * Splits the money into a main pot and side pots. When someone is all-in for less,
 * they can only win what everyone matched up to their amount.
 */
export function buildPots(contributions: Contribution[]): Pot[] {
  const levels = [...new Set(contributions.filter((c) => !c.folded && c.total > 0).map((c) => c.total))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contributions) amount += Math.max(0, Math.min(c.total, level) - Math.min(c.total, prev));
    const eligible = contributions.filter((c) => !c.folded && c.total >= level).map((c) => c.id);
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  // Chips above the highest live player's level (from players who folded) join the last pot.
  let extra = 0;
  for (const c of contributions) extra += Math.max(0, c.total - prev);
  if (extra > 0 && pots.length) pots[pots.length - 1]!.amount += extra;
  return pots;
}

// ---------- Starting-hand strength (for bots) ----------

/** A rough 0–1 score for two hole cards (pairs, high cards, suited, connected). */
export function preflopStrength(hole: Card[]): number {
  const [a, b] = hole.map(pokerValue).sort((x, y) => y - x) as [number, number];
  const suited = hole[0]!.suit === hole[1]!.suit;
  let score: number;
  if (a === b) score = 0.5 + (a - 2) * 0.04; // 22 = 0.5 … AA = 0.98
  else {
    score = (a + b - 4) / 48; // high cards
    if (suited) score += 0.06;
    const gap = a - b;
    if (gap === 1) score += 0.05;
    else if (gap === 2) score += 0.02;
    else if (gap > 4) score -= 0.05;
    if (a === 14) score += 0.08;
  }
  return Math.max(0, Math.min(1, score));
}
