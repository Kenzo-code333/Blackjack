import { describe, expect, it } from 'vitest';
import { type Card, bestHand, buildPots, compareHands, evaluateFive, preflopStrength } from './index.js';

/** "AS KD 10H" → cards. */
const cards = (s: string): Card[] =>
  s.split(' ').map((t) => ({ rank: t.slice(0, -1) as Card['rank'], suit: t.slice(-1) as Card['suit'] }));

describe('poker hands', () => {
  const name = (s: string) => evaluateFive(cards(s)).name;

  it('names every category', () => {
    expect(name('AS KS QS JS 10S')).toBe('Royal flush');
    expect(name('9H 8H 7H 6H 5H')).toBe('Straight flush, nine high');
    expect(name('7C 7D 7H 7S 2C')).toBe('Four sevens');
    expect(name('KC KD KH 4S 4C')).toBe('Full house, kings full of fours');
    expect(name('AD 9D 7D 4D 2D')).toBe('Flush, ace high');
    expect(name('10C 9D 8H 7S 6C')).toBe('Straight, ten high');
    expect(name('AC 2D 3H 4S 5C')).toBe('Straight, five high');
    expect(name('QC QD QH 9S 2C')).toBe('Three queens');
    expect(name('JC JD 5H 5S 2C')).toBe('Two pair, jacks and fives');
    expect(name('AC AD 9H 5S 2C')).toBe('Pair of aces');
    expect(name('KC JD 9H 5S 2C')).toBe('King high');
  });

  it('ranks hands correctly, with kickers', () => {
    const cmp = (a: string, b: string) => Math.sign(compareHands(evaluateFive(cards(a)), evaluateFive(cards(b))));
    expect(cmp('2C 3D 4H 5S 6C', 'AC 2D 3H 4S 5C')).toBe(1); // six-high straight beats the wheel
    expect(cmp('AC AD KH 5S 2C', 'AH AS QH 5D 2D')).toBe(1); // king kicker
    expect(cmp('AC AD KH 5S 2C', 'AH AS KD 5D 2D')).toBe(0); // exact tie
    expect(cmp('2C 2D 2H 3S 3C', 'AD KD 9D 4D 2D')).toBe(1); // full house beats a flush
  });

  it('finds the best five of seven', () => {
    const h = bestHand(cards('AH KH QH JH 2C 3D 10H'));
    expect(h.name).toBe('Royal flush');
    expect(bestHand(cards('2C 2D 9H 9S 9C KD KH')).name).toBe('Full house, nines full of kings');
    expect(bestHand(cards('AC 5D 4H 3S 2C KD QH')).name).toBe('Straight, five high');
  });

  it('starting hands: big pairs beat junk', () => {
    expect(preflopStrength(cards('AS AH'))).toBeGreaterThan(0.9);
    expect(preflopStrength(cards('AS KS'))).toBeGreaterThan(preflopStrength(cards('7D 2C')));
    expect(preflopStrength(cards('7D 2C'))).toBeLessThan(0.2);
  });
});

describe('pots', () => {
  it('one pot when everyone matched', () => {
    expect(buildPots([{ id: 'a', total: 100, folded: false }, { id: 'b', total: 100, folded: false }, { id: 'c', total: 20, folded: true }])).toEqual([
      { amount: 220, eligible: ['a', 'b'] },
    ]);
  });

  it('a short all-in creates a side pot', () => {
    const pots = buildPots([
      { id: 'short', total: 50, folded: false },
      { id: 'b', total: 200, folded: false },
      { id: 'c', total: 200, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 150, eligible: ['short', 'b', 'c'] },
      { amount: 300, eligible: ['b', 'c'] },
    ]);
  });

  it('chips from a player who folded after betting more go to the top pot', () => {
    const pots = buildPots([
      { id: 'a', total: 40, folded: false },
      { id: 'b', total: 100, folded: true },
    ]);
    expect(pots).toEqual([{ amount: 140, eligible: ['a'] }]);
  });
});
