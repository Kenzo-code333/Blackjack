// Basic strategy for this table's rules (6 decks, dealer stands on soft 17,
// double after split allowed, no surrender). Bots play with it.

import { type Card, rankValue } from './cards.js';
import { evaluateHand } from './hand.js';
import type { Action } from './rules.js';

/** Dealer up card as 2–11 (ace = 11). */
function upValue(card: Card): number {
  return card.rank === 'A' ? 11 : rankValue(card.rank);
}

const between = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

/** The basic-strategy move, picked from the actions that are legal right now. */
export function basicStrategy(cards: readonly Card[], dealerUp: Card, legal: readonly Action[]): Action {
  const up = upValue(dealerUp);
  const can = (a: Action) => legal.includes(a);
  const doubleOr = (fallback: Action): Action => (can('double') ? 'double' : fallback);
  const pick = (a: Action): Action => (can(a) ? a : can('stand') ? 'stand' : legal[0]!);

  // Pairs.
  if (cards.length === 2 && can('split') && rankValue(cards[0]!.rank) === rankValue(cards[1]!.rank)) {
    const v = cards[0]!.rank === 'A' ? 11 : rankValue(cards[0]!.rank);
    const split =
      v === 11 ||
      v === 8 ||
      ((v === 2 || v === 3 || v === 7) && between(up, 2, 7)) ||
      (v === 4 && between(up, 5, 6)) ||
      (v === 6 && between(up, 2, 6)) ||
      (v === 9 && (between(up, 2, 6) || between(up, 8, 9)));
    if (split) return 'split';
  }

  const { total, soft } = evaluateHand(cards);

  if (soft) {
    if (total >= 20) return pick('stand');
    if (total === 19) return up === 6 ? doubleOr('stand') : pick('stand');
    if (total === 18) {
      if (between(up, 2, 6)) return doubleOr('stand');
      return between(up, 7, 8) ? pick('stand') : pick('hit');
    }
    if (total === 17) return between(up, 3, 6) ? doubleOr('hit') : pick('hit');
    if (total >= 15) return between(up, 4, 6) ? doubleOr('hit') : pick('hit');
    return between(up, 5, 6) ? doubleOr('hit') : pick('hit');
  }

  if (total >= 17) return pick('stand');
  if (total >= 13) return between(up, 2, 6) ? pick('stand') : pick('hit');
  if (total === 12) return between(up, 4, 6) ? pick('stand') : pick('hit');
  if (total === 11) return up <= 10 ? doubleOr('hit') : pick('hit');
  if (total === 10) return up <= 9 ? doubleOr('hit') : pick('hit');
  if (total === 9) return between(up, 3, 6) ? doubleOr('hit') : pick('hit');
  return pick('hit');
}
