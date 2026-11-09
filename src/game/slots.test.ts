import { describe, expect, it } from 'vitest';
import { REEL, SYMBOL_WEIGHTS, payout, returnToPlayer, spinReels } from './slots.js';
import { seededRng } from './random.js';

describe('slot machine', () => {
  it('has 30 stops with the right number of each symbol', () => {
    expect(REEL).toHaveLength(30);
    for (const [s, w] of Object.entries(SYMBOL_WEIGHTS)) expect(REEL.filter((x) => x === s)).toHaveLength(w);
  });

  it('pays the table', () => {
    expect(payout(['diamond', 'diamond', 'diamond'])).toBe(100);
    expect(payout(['seven', 'seven', 'seven'])).toBe(50);
    expect(payout(['cherry', 'cherry', 'lemon'])).toBe(2);
    expect(payout(['lemon', 'cherry', 'cherry'])).toBe(2);
    expect(payout(['cherry', 'lemon', 'bell'])).toBe(0);
    expect(payout(['bar', 'bar', 'bell'])).toBe(0);
  });

  it('gives back about 96% over time, like a real machine', () => {
    const rtp = returnToPlayer();
    expect(rtp).toBeGreaterThan(0.93);
    expect(rtp).toBeLessThan(0.98);
  });

  it('spins land on real stops and are scored', () => {
    const rng = seededRng(4);
    for (let i = 0; i < 200; i++) {
      const r = spinReels(rng);
      expect(r.line).toEqual(r.stops.map((s) => REEL[s]));
      expect(r.multiplier).toBe(payout(r.line));
    }
  });
});
