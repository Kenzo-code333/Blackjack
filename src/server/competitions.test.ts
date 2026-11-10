import { describe, expect, it } from 'vitest';
import { ChallengeStore } from './competitions.js';

describe('challenges', () => {
  it('friends join with a code, report chips, and the board ranks them; late scores are ignored', () => {
    let now = 1_000_000;
    const store = new ChallengeStore(null, () => now);
    const created = store.create({ minutes: 10, player: { name: 'Ana' } });
    if (!created.ok) throw new Error(created.error);
    expect(created.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(created.info).toMatchObject({ name: 'Ana’s challenge', startChips: 1000, endsAt: now + 600_000 });
    const bo = store.join(created.code.toLowerCase(), { name: 'Bo' });
    if (!bo.ok) throw new Error(bo.error);
    expect(store.join('NOPE00', { name: 'Cy' }).ok).toBe(false);
    // Only the player (with their secret) can send their count.
    expect(store.report(created.code, bo.playerId, 'wrong', 9999)).toMatch(/Not in/);
    expect(store.report(created.code, bo.playerId, bo.secret, 2400)).toBeNull();
    expect(store.report(created.code, created.playerId, created.secret, 1500)).toBeNull();
    expect(store.board(created.code)!.players.map((p) => [p.name, p.chips])).toEqual([
      ['Bo', 2400],
      ['Ana', 1500],
    ]);
    // Time's up.
    now += 700_000;
    expect(store.report(created.code, created.playerId, created.secret, 50_000)).toMatch(/over/);
    expect(store.board(created.code)!.players[0]!.name).toBe('Bo');
    expect(store.join(created.code, { name: 'Late' }).ok).toBe(false);
  });

  it('lasts as long as the host chooses, from 1 minute to 7 days', () => {
    const now = 5_000_000;
    const store = new ChallengeStore(null, () => now);
    const length = (minutes: unknown) => {
      const c = store.create({ minutes, player: { name: 'Ana' } });
      if (!c.ok) throw new Error(c.error);
      return (c.info.endsAt - now) / 60_000;
    };
    expect(length(1)).toBe(1);
    expect(length(45)).toBe(45);
    expect(length(2 * 24 * 60 + 90)).toBe(2970); // 2 days 1 h 30 min
    expect(length(7 * 24 * 60)).toBe(10_080);
    expect(length(0)).toBe(30); // out of range: the default
    expect(length(8 * 24 * 60)).toBe(30);
    expect(length('abc')).toBe(30);
  });
});
