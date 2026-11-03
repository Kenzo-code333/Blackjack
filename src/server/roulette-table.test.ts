import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouletteEvent } from '../shared/protocol.js';
import { RouletteTable, type RouletteTiming } from './roulette-table.js';

const FAST: RouletteTiming = { bettingMs: 1000, readyMs: 10, noMoreMs: 10, spinMs: 50, resultsMs: 100, botMs: 5 };
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

function table(numbers: number[], o: { solo?: boolean; autoStart?: boolean } = {}) {
  const events: RouletteEvent[] = [];
  let i = 0;
  const t = new RouletteTable({ code: 'WHEEL1', timing: FAST, ...o, nextNumber: () => numbers[i++ % numbers.length]!, onUpdate: (e) => events.push(...e) });
  return { t, events };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('roulette table', () => {
  it('solo: bet, spin, get paid, and the layout clears for the next round', async () => {
    const { t, events } = table([17], { solo: true });
    const me = t.addPlayer('Ana');
    expect(t.phase).toBe('betting');
    expect(t.placeBet(me.id, 'n:17', 10)).toBeNull();
    expect(t.placeBet(me.id, 'red', 20)).toBeNull(); // 17 is black
    expect(me.balance).toBe(970);
    expect(t.setReady(me.id)).toBeNull();
    await tick(15);
    expect(t.phase).toBe('spinning');
    await tick(70);
    expect(t.phase).toBe('results');
    expect(t.result).toBe(17);
    expect(me.balance).toBe(970 + 360);
    expect(t.publicState().players[0]!.won).toBe(360);
    expect(events.some((e) => e.type === 'spin' && e.number === 17)).toBe(true);
    await tick(110);
    expect(t.phase).toBe('betting');
    expect(me.bets.size).toBe(0);
    expect(t.history).toEqual([17]);
    // Repeat the same bets.
    expect(t.rebet(me.id)).toBeNull();
    expect(me.bets.get('n:17')).toBe(10);
    t.dispose();
  });

  it('checks limits and chips', () => {
    const { t } = table([0], { solo: true });
    const me = t.addPlayer('Ana');
    expect(t.placeBet(me.id, 'n:40', 10)).toMatch(/Unknown/);
    expect(t.placeBet(me.id, 'red', 7)).toMatch(/chips of 5/);
    expect(t.placeBet(me.id, 'red', 2000)).toMatch(/Not enough/);
    expect(t.placeBet(me.id, 'red', 500)).toBeNull();
    expect(t.placeBet(me.id, 'red', 5)).toMatch(/At most 500/);
    expect(t.clearBets(me.id)).toBeNull();
    expect(me.balance).toBe(1000);
    t.dispose();
  });

  it('the ball spins when the betting time runs out; zero takes outside bets', async () => {
    const { t } = table([0], { solo: true });
    const me = t.addPlayer('Ana');
    t.placeBet(me.id, 'black', 50);
    t.placeBet(me.id, 'n:0', 5);
    await tick(1001);
    expect(t.phase).toBe('spinning');
    expect(t.placeBet(me.id, 'red', 5)).toMatch(/No more bets/);
    await tick(70);
    expect(me.balance).toBe(1000 - 55 + 180);
    t.dispose();
  });

  it('with friends, the host starts; bots bet on their own; the host can leave and the table goes on', async () => {
    const { t } = table([5, 12, 30]);
    const host = t.addPlayer('Host');
    const friend = t.addPlayer('Friend');
    t.addBot(host.id);
    expect(t.phase).toBe('waiting');
    expect(t.setReady(friend.id)).toMatch(/host/);
    expect(t.hostStart(host.id)).toBeNull();
    expect(t.phase).toBe('betting');
    await tick(200);
    const bot = [...t.players.values()].find((p) => p.bot)!;
    expect(bot.bets.size).toBeGreaterThan(0);
    t.removePlayer(host.id);
    expect(t.hostId).toBe(friend.id);
    t.placeBet(friend.id, 'odd', 10);
    t.setReady(friend.id);
    await tick(100);
    expect(t.result).toBe(5);
    expect(friend.balance).toBe(1010);
    t.dispose();
  });
});
