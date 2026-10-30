import { describe, expect, it } from 'vitest';
import { type Card, type Rank, type Action, basicStrategy } from './index.js';

const c = (...ranks: Rank[]): Card[] => ranks.map((rank) => ({ rank, suit: 'C' }));
const ALL: Action[] = ['hit', 'stand', 'double', 'split'];
const NO_DOUBLE: Action[] = ['hit', 'stand'];
const play = (hand: Rank[], up: Rank, legal = ALL) => basicStrategy(c(...hand), c(up)[0]!, legal);

describe('basic strategy', () => {
  it('always splits aces and eights, never tens or fives', () => {
    expect(play(['A', 'A'], 'K')).toBe('split');
    expect(play(['8', '8'], 'A')).toBe('split');
    expect(play(['K', 'Q'], '6')).toBe('stand');
    expect(play(['5', '5'], '6')).toBe('double');
  });

  it('splits nines except against 7, 10 and ace', () => {
    expect(play(['9', '9'], '8')).toBe('split');
    expect(play(['9', '9'], '7')).toBe('stand');
  });

  it('hard totals', () => {
    expect(play(['10', '6'], '6')).toBe('stand');
    expect(play(['10', '6'], '7')).toBe('hit');
    expect(play(['10', '2'], '3')).toBe('hit');
    expect(play(['10', '2'], '4')).toBe('stand');
    expect(play(['6', '5'], '10')).toBe('double');
    expect(play(['6', '5'], 'A')).toBe('hit');
    expect(play(['10', '7'], 'A')).toBe('stand');
  });

  it('soft totals', () => {
    expect(play(['A', '7'], '5')).toBe('double');
    expect(play(['A', '7'], '5', NO_DOUBLE)).toBe('stand');
    expect(play(['A', '7'], '9')).toBe('hit');
    expect(play(['A', '6'], '2')).toBe('hit');
    expect(play(['A', '8'], '6')).toBe('double');
    expect(play(['A', '2', '2'], '5', NO_DOUBLE)).toBe('hit'); // soft 15 with 3 cards: no double available
  });

  it('only returns a legal action', () => {
    expect(play(['10', '9', '2'], '5', [])).toBeUndefined();
    expect(play(['6', '5'], '6', ['hit', 'stand'])).toBe('hit');
  });
});
