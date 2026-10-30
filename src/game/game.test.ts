import { describe, expect, it } from 'vitest';
import {
  type Card,
  type Rank,
  DEFAULT_RULES,
  Shoe,
  canDouble,
  canHit,
  canSplit,
  cardLabel,
  dealerShouldHit,
  dealerShouldPeek,
  describeHand,
  double,
  evaluateHand,
  hit,
  insuranceOffered,
  isBlackjack,
  isHandDone,
  legalActions,
  makeDeck,
  newHand,
  playDealer,
  seededRng,
  settleHand,
  settleInsurance,
  split,
  validateBet,
} from './index.js';

/** Build cards from ranks, e.g. c('A', 'K'). Suits don't matter for the rules. */
const c = (...ranks: Rank[]): Card[] => ranks.map((rank) => ({ rank, suit: 'S' }));

describe('cards', () => {
  it('a deck has 52 unique cards', () => {
    const deck = makeDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardLabel)).size).toBe(52);
  });
});

describe('hand evaluation', () => {
  it('counts hard totals', () => {
    expect(evaluateHand(c('10', '7'))).toEqual({ total: 17, soft: false, bust: false });
    expect(evaluateHand(c('K', 'Q', '5'))).toEqual({ total: 25, soft: false, bust: true });
  });

  it('counts an ace as 11 when it fits (soft)', () => {
    expect(evaluateHand(c('A', '6'))).toEqual({ total: 17, soft: true, bust: false });
    expect(evaluateHand(c('A', 'A'))).toEqual({ total: 12, soft: true, bust: false });
    expect(evaluateHand(c('A', 'A', '9'))).toEqual({ total: 21, soft: true, bust: false });
  });

  it('drops the ace to 1 when 11 would bust (hard)', () => {
    expect(evaluateHand(c('A', '6', '10'))).toEqual({ total: 17, soft: false, bust: false });
    expect(evaluateHand(c('A', 'A', 'A', 'A', 'K', '7'))).toEqual({ total: 21, soft: false, bust: false });
  });

  it('detects blackjack, but not on split hands or 3-card 21', () => {
    expect(isBlackjack(c('A', 'K'))).toBe(true);
    expect(isBlackjack(c('10', 'A'))).toBe(true);
    expect(isBlackjack(c('A', 'K'), true)).toBe(false);
    expect(isBlackjack(c('7', '7', '7'))).toBe(false);
  });

  it('describes hands for display', () => {
    expect(describeHand(c('A', '6'))).toBe('soft 17');
    expect(describeHand(c('10', '7'))).toBe('17');
    expect(describeHand(c('A', 'K'))).toBe('Blackjack');
    expect(describeHand(c('A', 'K'), true)).toBe('21');
    expect(describeHand(c('A', '5', '5'))).toBe('21');
    expect(describeHand(c('K', 'Q', '4'))).toBe('Bust (24)');
    expect(describeHand([])).toBe('');
  });
});

describe('shoe', () => {
  it('holds 6 decks = 312 cards with the right composition', () => {
    const shoe = new Shoe({ decks: 6, rng: seededRng(1) });
    expect(shoe.size).toBe(312);
    const counts = new Map<string, number>();
    for (let i = 0; i < 312; i++) {
      const label = cardLabel(shoe.draw());
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    expect(counts.size).toBe(52);
    for (const n of counts.values()) expect(n).toBe(6);
  });

  it('is shuffled (not in factory order) and repeatable with the same seed', () => {
    const a = new Shoe({ rng: seededRng(42) });
    const b = new Shoe({ rng: seededRng(42) });
    const first = Array.from({ length: 20 }, () => cardLabel(a.draw()));
    const second = Array.from({ length: 20 }, () => cardLabel(b.draw()));
    expect(first).toEqual(second);
    const ordered = makeDeck().slice(0, 20).map(cardLabel);
    expect(first).not.toEqual(ordered);
  });

  it('flags the cut card at roughly 75% penetration', () => {
    for (let seed = 0; seed < 50; seed++) {
      const shoe = new Shoe({ rng: seededRng(seed) });
      let drawn = 0;
      while (!shoe.cutCardReached) {
        shoe.draw();
        drawn++;
      }
      expect(drawn / 312).toBeGreaterThanOrEqual(0.7);
      expect(drawn / 312).toBeLessThanOrEqual(0.8);
    }
  });

  it('reshuffling resets the shoe', () => {
    const shoe = new Shoe({ rng: seededRng(3) });
    for (let i = 0; i < 250; i++) shoe.draw();
    expect(shoe.cutCardReached).toBe(true);
    shoe.shuffle();
    expect(shoe.cutCardReached).toBe(false);
    expect(shoe.remaining).toBe(312);
    expect(shoe.shuffleCount).toBe(2);
  });

  it('never runs dry: drawing past the end reshuffles', () => {
    const shoe = new Shoe({ decks: 1, rng: seededRng(5) });
    for (let i = 0; i < 60; i++) expect(shoe.draw()).toBeDefined();
    expect(shoe.shuffleCount).toBe(2);
  });

  it('can be stacked for tests', () => {
    const shoe = new Shoe({ rng: seededRng(9) });
    shoe.stackForTesting(c('A', 'K'));
    expect(shoe.draw().rank).toBe('A');
    expect(shoe.draw().rank).toBe('K');
  });
});

describe('player actions', () => {
  const ctx = (cards: Card[], extra: Partial<Parameters<typeof canSplit>[0]> = {}) => ({
    hand: newHand(10, cards),
    handCount: 1,
    balance: 1000,
    ...extra,
  });

  it('allows hit/stand/double on a fresh hand', () => {
    expect(legalActions(ctx(c('9', '2')))).toEqual(['hit', 'stand', 'double']);
  });

  it('allows split on pairs, including mixed ten-value cards', () => {
    expect(canSplit(ctx(c('8', '8')))).toBe(true);
    expect(canSplit(ctx(c('K', 'Q')))).toBe(true);
    expect(canSplit(ctx(c('8', '9')))).toBe(false);
  });

  it('limits splitting to 3 hands', () => {
    expect(canSplit(ctx(c('8', '8'), { handCount: 2 }))).toBe(true);
    expect(canSplit(ctx(c('8', '8'), { handCount: 3 }))).toBe(false);
  });

  it('needs enough chips to double or split', () => {
    expect(canDouble(ctx(c('6', '5'), { balance: 9 }))).toBe(false);
    expect(canDouble(ctx(c('6', '5'), { balance: 10 }))).toBe(true);
    expect(canSplit(ctx(c('8', '8'), { balance: 9 }))).toBe(false);
  });

  it('only doubles on the first two cards', () => {
    expect(canDouble(ctx(c('2', '3', '6')))).toBe(false);
  });

  it('auto-finishes a hand at 21 or bust', () => {
    expect(isHandDone(newHand(10, c('A', 'K')))).toBe(true);
    expect(isHandDone(newHand(10, c('7', '7', '7')))).toBe(true);
    expect(isHandDone(newHand(10, c('K', 'Q', '2')))).toBe(true);
    expect(legalActions(ctx(c('K', 'Q', '2')))).toEqual([]);
  });

  it('doubling doubles the bet and takes exactly one card', () => {
    const hand = newHand(10, c('6', '5'));
    double(hand, c('3')[0]!);
    expect(hand.bet).toBe(20);
    expect(hand.cards).toHaveLength(3);
    expect(isHandDone(hand)).toBe(true);
  });

  it('splitting makes two one-card hands with the same bet', () => {
    const [a, b] = split(newHand(10, c('8', '8')));
    expect(a.cards).toEqual(c('8'));
    expect(b.cards).toEqual(c('8'));
    expect(a.bet).toBe(10);
    expect(a.fromSplit && b.fromSplit).toBe(true);
    // A one-card hand waits for its second card before any decision.
    expect(canHit({ hand: a, handCount: 2, balance: 1000 })).toBe(false);
    hit(a, c('3')[0]!);
    expect(legalActions({ hand: a, handCount: 2, balance: 1000 })).toEqual(['hit', 'stand', 'double']);
  });

  it('split aces get one card each and no further action', () => {
    const [a] = split(newHand(10, c('A', 'A')));
    expect(a.splitAces).toBe(true);
    hit(a, c('5')[0]!);
    expect(isHandDone(a)).toBe(true);
    expect(legalActions({ hand: a, handCount: 2, balance: 1000 })).toEqual([]);
  });

  it('split aces drawing another ace cannot re-split by default', () => {
    const [a] = split(newHand(10, c('A', 'A')));
    hit(a, c('A')[0]!);
    expect(canSplit({ hand: a, handCount: 2, balance: 1000 })).toBe(false);
  });

  it('can re-split ordinary pairs', () => {
    const [a] = split(newHand(10, c('8', '8')));
    hit(a, c('8')[0]!);
    expect(canSplit({ hand: a, handCount: 2, balance: 1000 })).toBe(true);
  });
});

describe('dealer', () => {
  it('stands on soft 17 by default', () => {
    expect(dealerShouldHit(c('A', '6'))).toBe(false);
    expect(dealerShouldHit(c('A', '6'), { ...DEFAULT_RULES, dealerHitsSoft17: true })).toBe(true);
  });

  it('hits 16 and below, stands on hard 17+', () => {
    expect(dealerShouldHit(c('10', '6'))).toBe(true);
    expect(dealerShouldHit(c('10', '7'))).toBe(false);
    expect(dealerShouldHit(c('A', '5'))).toBe(true); // soft 16
  });

  it('plays out a hand from the shoe', () => {
    const queue = c('5', '2', 'K');
    // Soft 16 → draws a 5 → soft 21 → stands.
    const cards = playDealer(c('A', '5'), () => queue.shift()!);
    expect(cards).toEqual(c('A', '5', '5'));
    expect(evaluateHand(cards).total).toBe(21);
  });

  it('keeps drawing through soft hands that turn hard', () => {
    const queue = c('6', 'K', '3');
    // Soft 16 → +6 = hard 12 → +K = 22, bust.
    const cards = playDealer(c('A', '5'), () => queue.shift()!);
    expect(cards).toEqual(c('A', '5', '6', 'K'));
    expect(evaluateHand(cards).bust).toBe(true);
  });

  it('offers insurance only on an ace, and peeks on ace or ten', () => {
    expect(insuranceOffered(c('A')[0]!)).toBe(true);
    expect(insuranceOffered(c('K')[0]!)).toBe(false);
    expect(dealerShouldPeek(c('A')[0]!)).toBe(true);
    expect(dealerShouldPeek(c('10')[0]!)).toBe(true);
    expect(dealerShouldPeek(c('9')[0]!)).toBe(false);
  });
});

describe('settlement', () => {
  const settle = (player: Rank[], dealer: Rank[], bet = 10, fromSplit = false) =>
    settleHand({ ...newHand(bet, c(...player)), fromSplit }, c(...dealer));

  it('blackjack pays 3:2', () => {
    expect(settle(['A', 'K'], ['10', '7'])).toEqual({ outcome: 'blackjack', payout: 25, net: 15 });
    // Odd bets pay half chips.
    expect(settle(['A', 'K'], ['10', '7'], 5)).toEqual({ outcome: 'blackjack', payout: 12.5, net: 7.5 });
  });

  it('blackjack vs dealer blackjack is a push', () => {
    expect(settle(['A', 'K'], ['A', 'Q']).outcome).toBe('push');
  });

  it('dealer blackjack beats a regular 21', () => {
    expect(settle(['7', '7', '7'], ['A', 'Q']).outcome).toBe('lose');
  });

  it('21 on a split hand is not blackjack', () => {
    expect(settle(['A', 'K'], ['10', '7'], 10, true)).toEqual({ outcome: 'win', payout: 20, net: 10 });
  });

  it('wins, pushes and losses', () => {
    expect(settle(['10', '9'], ['10', '8'])).toEqual({ outcome: 'win', payout: 20, net: 10 });
    expect(settle(['10', '8'], ['10', '8'])).toEqual({ outcome: 'push', payout: 10, net: 0 });
    expect(settle(['10', '7'], ['10', '8'])).toEqual({ outcome: 'lose', payout: 0, net: -10 });
  });

  it('dealer bust pays every live hand', () => {
    expect(settle(['10', '2'], ['10', '6', '9']).outcome).toBe('win');
  });

  it('player bust loses even if the dealer also busts', () => {
    expect(settle(['10', '6', '9'], ['10', '6', '8'])).toEqual({ outcome: 'bust', payout: 0, net: -10 });
  });

  it('doubled hands pay on the doubled bet', () => {
    const hand = newHand(10, c('6', '5'));
    double(hand, c('K')[0]!);
    expect(settleHand(hand, c('10', '8'))).toEqual({ outcome: 'win', payout: 40, net: 20 });
  });

  it('insurance pays 2:1 when the dealer has blackjack', () => {
    expect(settleInsurance(5, c('A', 'K'))).toBe(15);
    expect(settleInsurance(5, c('A', '9'))).toBe(0);
  });
});

describe('bet validation', () => {
  it('enforces limits and balance', () => {
    expect(validateBet(10, 1000)).toBeNull();
    expect(validateBet(1, 1000)).toMatch(/Minimum/);
    expect(validateBet(10000, 100000)).toMatch(/Maximum/);
    expect(validateBet(100, 50)).toMatch(/Not enough/);
    expect(validateBet(10.5, 1000)).toMatch(/whole/);
    expect(validateBet(Number.NaN, 1000)).toMatch(/whole/);
  });
});

describe('long-run simulation', () => {
  it('a "mimic the dealer" player loses roughly 5–6% over 200k hands', () => {
    // Known result: never busting first is what gives the house its edge.
    // If payouts or dealer rules were wrong, this number would be far off.
    const shoe = new Shoe({ rng: seededRng(2024) });
    let net = 0;
    const hands = 200_000;
    for (let i = 0; i < hands; i++) {
      if (shoe.cutCardReached) shoe.shuffle();
      const hand = newHand(1, [shoe.draw(), shoe.draw()]);
      const dealer = [shoe.draw(), shoe.draw()];
      if (!isBlackjack(dealer)) {
        while (dealerShouldHit(hand.cards)) hit(hand, shoe.draw());
        if (!evaluateHand(hand.cards).bust) playDealer(dealer, () => shoe.draw());
      }
      net += settleHand(hand, dealer).net;
    }
    const edge = net / hands;
    expect(edge).toBeLessThan(-0.04);
    expect(edge).toBeGreaterThan(-0.07);
  });
});
