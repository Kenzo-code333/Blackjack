// Hand evaluation: totals, soft/hard, blackjack, bust.

import { type Card, rankValue } from './cards.js';

export interface HandValue {
  /** Best total: one ace counts as 11 if that doesn't bust the hand. */
  total: number;
  /** True when an ace is currently counted as 11 ("soft 17"). */
  soft: boolean;
  bust: boolean;
}

export function evaluateHand(cards: readonly Card[]): HandValue {
  let hardTotal = 0;
  let hasAce = false;
  for (const card of cards) {
    hardTotal += rankValue(card.rank);
    if (card.rank === 'A') hasAce = true;
  }
  // At most one ace can ever count as 11 (two would be 22).
  const soft = hasAce && hardTotal + 10 <= 21;
  const total = soft ? hardTotal + 10 : hardTotal;
  return { total, soft, bust: total > 21 };
}

/**
 * A "natural": exactly two cards totalling 21. A 21 made on a split hand is not a
 * blackjack, so callers pass `fromSplit` for split hands.
 */
export function isBlackjack(cards: readonly Card[], fromSplit = false): boolean {
  return !fromSplit && cards.length === 2 && evaluateHand(cards).total === 21;
}

/** Text shown next to a hand, e.g. "soft 17", "12", "Blackjack", "Bust (24)". */
export function describeHand(cards: readonly Card[], fromSplit = false): string {
  if (cards.length === 0) return '';
  if (isBlackjack(cards, fromSplit)) return 'Blackjack';
  const { total, soft, bust } = evaluateHand(cards);
  if (bust) return `Bust (${total})`;
  if (soft && total !== 21) return `soft ${total}`;
  return String(total);
}
