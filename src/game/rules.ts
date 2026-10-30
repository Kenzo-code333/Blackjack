// Table rules, player actions, the dealer's play and payouts.
//
// Money model: when a player bets, the chips leave their balance straight away.
// Settlement then returns the total amount to give back (stake + winnings):
//   lose → 0, push → bet, win → 2 × bet, blackjack → 2.5 × bet.
// Amounts are always multiples of 0.5, which JavaScript numbers store exactly.

import type { Card } from './cards.js';
import { evaluateHand, isBlackjack } from './hand.js';

export interface Rules {
  decks: number;
  penetration: number;
  /** false = "dealer stands on soft 17" (S17). */
  dealerHitsSoft17: boolean;
  /** 1.5 = blackjack pays 3 to 2. */
  blackjackPayout: number;
  /** Maximum hands one player can hold after splitting. */
  maxHands: number;
  doubleAfterSplit: boolean;
  /** Split aces get one card each and can't be hit. */
  oneCardOnSplitAces: boolean;
  resplitAces: boolean;
  minBet: number;
  maxBet: number;
  startingBalance: number;
}

export const DEFAULT_RULES: Rules = {
  decks: 6,
  penetration: 0.75,
  dealerHitsSoft17: false,
  blackjackPayout: 1.5,
  maxHands: 3,
  doubleAfterSplit: true,
  oneCardOnSplitAces: true,
  resplitAces: false,
  minBet: 5,
  maxBet: 500,
  startingBalance: 1000,
};

export interface PlayerHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  fromSplit: boolean;
  /** This hand came from splitting a pair of aces. */
  splitAces: boolean;
  stood: boolean;
}

export function newHand(bet: number, cards: Card[] = []): PlayerHand {
  return { cards, bet, doubled: false, fromSplit: false, splitAces: false, stood: false };
}

// ---------- Is the hand finished? ----------

/** A hand needs no more decisions: stood, bust, 21, doubled, or split aces with their one card. */
export function isHandDone(hand: PlayerHand, rules: Rules = DEFAULT_RULES): boolean {
  if (hand.stood) return true;
  const { total } = evaluateHand(hand.cards);
  if (total >= 21) return true;
  if (hand.doubled) return hand.cards.length >= 3;
  if (hand.splitAces && rules.oneCardOnSplitAces && hand.cards.length >= 2) {
    // Unless a pair of aces came up again and re-splitting is allowed.
    return !(rules.resplitAces && hand.cards[1]?.rank === 'A');
  }
  return false;
}

// ---------- Which actions are allowed? ----------

export interface ActionContext {
  hand: PlayerHand;
  /** How many hands this player currently holds (for the split limit). */
  handCount: number;
  /** Chips the player has left to put on the table. */
  balance: number;
  rules?: Rules;
}

export function canHit({ hand, rules = DEFAULT_RULES }: ActionContext): boolean {
  if (hand.cards.length < 2) return false;
  if (isHandDone(hand, rules)) return false;
  return !(hand.splitAces && rules.oneCardOnSplitAces);
}

export function canStand({ hand, rules = DEFAULT_RULES }: ActionContext): boolean {
  return hand.cards.length >= 2 && !isHandDone(hand, rules);
}

export function canDouble({ hand, balance, rules = DEFAULT_RULES }: ActionContext): boolean {
  if (hand.cards.length !== 2 || isHandDone(hand, rules)) return false;
  if (hand.fromSplit && !rules.doubleAfterSplit) return false;
  if (hand.splitAces && rules.oneCardOnSplitAces) return false;
  return balance >= hand.bet;
}

export function canSplit({ hand, handCount, balance, rules = DEFAULT_RULES }: ActionContext): boolean {
  if (hand.cards.length !== 2 || isHandDone(hand, rules)) return false;
  if (handCount >= rules.maxHands) return false;
  if (balance < hand.bet) return false;
  const [a, b] = hand.cards as [Card, Card];
  // Any two 10-value cards (e.g. K + Q) count as a pair.
  if (evaluateHand([a]).total !== evaluateHand([b]).total) return false;
  if (hand.splitAces && !rules.resplitAces) return false;
  return true;
}

export type Action = 'hit' | 'stand' | 'double' | 'split';

export function legalActions(ctx: ActionContext): Action[] {
  const actions: Action[] = [];
  if (canHit(ctx)) actions.push('hit');
  if (canStand(ctx)) actions.push('stand');
  if (canDouble(ctx)) actions.push('double');
  if (canSplit(ctx)) actions.push('split');
  return actions;
}

// ---------- Applying actions ----------
// These mutate the hand. They assume the move was already checked with canX(); the
// server always checks before calling them.

export function hit(hand: PlayerHand, card: Card): void {
  hand.cards.push(card);
}

export function stand(hand: PlayerHand): void {
  hand.stood = true;
}

/** Doubles the bet and takes exactly one card. The caller deducts `hand.bet` (the original bet) from the balance first. */
export function double(hand: PlayerHand, card: Card): void {
  hand.bet *= 2;
  hand.doubled = true;
  hand.cards.push(card);
}

/**
 * Splits a pair into two hands with one card each. The caller deducts one more
 * bet from the balance, then deals a second card to each hand when it is played.
 */
export function split(hand: PlayerHand): [PlayerHand, PlayerHand] {
  const [a, b] = hand.cards as [Card, Card];
  const aces = a.rank === 'A';
  const make = (card: Card): PlayerHand => ({
    cards: [card],
    bet: hand.bet,
    doubled: false,
    fromSplit: true,
    splitAces: aces,
    stood: false,
  });
  return [make(a), make(b)];
}

// ---------- Dealer ----------

export function dealerShouldHit(cards: readonly Card[], rules: Rules = DEFAULT_RULES): boolean {
  const { total, soft } = evaluateHand(cards);
  if (total < 17) return true;
  return total === 17 && soft && rules.dealerHitsSoft17;
}

/** Draws cards for the dealer until the rules say stop. Mutates and returns `cards`. */
export function playDealer(cards: Card[], draw: () => Card, rules: Rules = DEFAULT_RULES): Card[] {
  while (dealerShouldHit(cards, rules)) cards.push(draw());
  return cards;
}

/** Insurance is offered when the dealer's up card is an ace. */
export function insuranceOffered(dealerUpCard: Card): boolean {
  return dealerUpCard.rank === 'A';
}

/** With an ace or ten-value card showing, the dealer peeks at the hole card for blackjack. */
export function dealerShouldPeek(dealerUpCard: Card): boolean {
  return evaluateHand([dealerUpCard]).total >= 10 || dealerUpCard.rank === 'A';
}

export function insuranceCost(hand: PlayerHand): number {
  return hand.bet / 2;
}

// ---------- Settlement ----------

export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

export interface Settlement {
  outcome: Outcome;
  /** Total returned to the player: stake + winnings (0 if lost). */
  payout: number;
  /** Net change compared with before the bet: payout − bet. */
  net: number;
}

export function settleHand(hand: PlayerHand, dealerCards: readonly Card[], rules: Rules = DEFAULT_RULES): Settlement {
  const player = evaluateHand(hand.cards);
  const dealer = evaluateHand(dealerCards);
  const playerBJ = isBlackjack(hand.cards, hand.fromSplit);
  const dealerBJ = isBlackjack(dealerCards);

  let outcome: Outcome;
  let payout: number;
  if (player.bust) {
    outcome = 'bust';
    payout = 0;
  } else if (playerBJ && dealerBJ) {
    outcome = 'push';
    payout = hand.bet;
  } else if (playerBJ) {
    outcome = 'blackjack';
    payout = hand.bet * (1 + rules.blackjackPayout);
  } else if (dealerBJ) {
    outcome = 'lose';
    payout = 0;
  } else if (dealer.bust || player.total > dealer.total) {
    outcome = 'win';
    payout = hand.bet * 2;
  } else if (player.total === dealer.total) {
    outcome = 'push';
    payout = hand.bet;
  } else {
    outcome = 'lose';
    payout = 0;
  }
  return { outcome, payout, net: payout - hand.bet };
}

/** Insurance pays 2 to 1: returns stake + 2× stake if the dealer has blackjack, else 0. */
export function settleInsurance(insuranceBet: number, dealerCards: readonly Card[]): number {
  return isBlackjack(dealerCards) ? insuranceBet * 3 : 0;
}

/** Checks a bet amount against table limits and the player's balance. Returns an error message or null. */
export function validateBet(amount: number, balance: number, rules: Rules = DEFAULT_RULES): string | null {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) return 'Bet must be a whole number of chips';
  if (amount < rules.minBet) return `Minimum bet is ${rules.minBet}`;
  if (amount > rules.maxBet) return `Maximum bet is ${rules.maxBet}`;
  if (amount > balance) return 'Not enough chips';
  return null;
}
