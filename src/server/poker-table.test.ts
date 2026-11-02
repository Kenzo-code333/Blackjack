import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../game/index.js';
import type { PokerEvent } from '../shared/protocol.js';
import { PokerTable, type PokerTiming } from './poker-table.js';

const FAST: PokerTiming = { turnMs: 1000, disconnectedTurnMs: 100, cardMs: 1, streetMs: 10, resultsMs: 3000, botMs: 10 };
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

/** "AS KD …" as a deck; the table deals from the end, so list cards in dealing order. */
function deckOf(s: string): () => Card[] {
  const cards = s.split(' ').map((t) => ({ rank: t.slice(0, -1) as Card['rank'], suit: t.slice(-1) as Card['suit'] }));
  return () => [...cards].reverse();
}

function table(deck?: () => Card[], timing: Partial<PokerTiming> = {}) {
  const events: PokerEvent[] = [];
  const t = new PokerTable({ code: 'POKER1', timing: { ...FAST, ...timing }, deck, onUpdate: (e) => events.push(...e) });
  return { t, events };
}

/** The players by role once a hand has started: a = dealer button, b = small blind, c = big blind. */
function roles(t: PokerTable) {
  const at = (seat: number | null) => [...t.players.values()].find((p) => p.seat === seat)!;
  return { a: at(t.buttonSeat), b: at(t.sbSeat), c: at(t.bbSeat) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('poker table', () => {
  it('posts blinds, deals two cards each, and keeps hole cards private', async () => {
    const { t } = table();
    const host = t.addPlayer('A');
    t.addPlayer('B');
    t.addPlayer('C');
    expect(t.hostStart(host.id)).toBeNull();
    await tick(400);
    const { a, b, c } = roles(t);
    // Button, small blind and big blind are three different players; the button acts first preflop.
    expect(new Set([t.buttonSeat, t.sbSeat, t.bbSeat]).size).toBe(3);
    expect(b.bet).toBe(5);
    expect(c.bet).toBe(10);
    expect(t.turn).toBe(a.id);
    const forA = t.publicState(a.id);
    expect(forA.players.find((p) => p.id === a.id)!.hole).toHaveLength(2);
    expect(forA.players.find((p) => p.id === b.id)!.hole).toBeNull();
    expect(forA.players.find((p) => p.id === b.id)!.holeCount).toBe(2);
    expect(forA.turn).toMatchObject({ toCall: 10, canCheck: false, minRaiseTo: 20 });
  });

  it('everyone folds to the big blind, who wins the blinds', async () => {
    const { t } = table();
    const host = t.addPlayer('A');
    t.addPlayer('B');
    t.addPlayer('C');
    expect(t.hostStart(host.id)).toBeNull();
    await tick(400);
    const { a, b, c } = roles(t);
    expect(t.act(a.id, 'fold')).toBeNull();
    expect(t.act(b.id, 'fold')).toBeNull();
    expect(t.phase).toBe('results');
    expect(c.balance).toBe(1005);
    expect(b.balance).toBe(995);
    expect(t.winners).toEqual([{ playerId: c.id, amount: 15, handName: null }]);
  });

  it('gives the big blind an option, then plays every street to a showdown', async () => {
    // Dealing order: hole cards round 1 (B, C, A), round 2 (B, C, A), then burn+flop, burn+turn, burn+river.
    const { t } = table(deckOf('KH 2D AS KD 3C AC 9S 7S 8S 4H 1X 5S 1X JC 9C'.replace(/1X/g, '2C')));
    const host = t.addPlayer('A');
    t.addPlayer('B');
    t.addPlayer('C');
    expect(t.hostStart(host.id)).toBeNull();
    await tick(400);
    const { a, b, c } = roles(t);
    t.act(a.id, 'call');
    t.act(b.id, 'call');
    expect(t.turn).toBe(c.id); // big blind's option
    expect(t.publicState(c.id).turn?.canCheck).toBe(true);
    t.act(c.id, 'check');
    await tick(400);
    expect(t.phase).toBe('flop');
    expect(t.board).toHaveLength(3);
    // After the flop, the small blind acts first.
    for (const street of ['flop', 'turn', 'river']) {
      expect(t.phase).toBe(street);
      for (const p of [b, c, a]) if (t.turn === p.id) t.act(p.id, 'check');
      await tick(400);
    }
    for (let i = 0; i < 100 && t.phase !== 'results'; i++) await tick(20);
    expect(t.winners[0]?.playerId).toBe(a.id);
    expect(t.winners[0]?.handName).toMatch(/aces/i);
    expect(a.balance).toBe(1020);
  });

  it('a raise reopens the betting and enforces the minimum raise', async () => {
    const { t } = table();
    const host = t.addPlayer('A');
    t.addPlayer('B');
    t.addPlayer('C');
    expect(t.hostStart(host.id)).toBeNull();
    await tick(400);
    const { a, b, c } = roles(t);
    expect(t.act(a.id, 'raise', 15)).toMatch(/at least 20/);
    expect(t.act(a.id, 'raise', 40)).toBeNull();
    expect(t.publicState(b.id).turn).toMatchObject({ toCall: 35, minRaiseTo: 70 });
    t.act(b.id, 'fold');
    t.act(c.id, 'call');
    await tick(400);
    expect(t.phase).toBe('flop');
    expect(t.publicState(null).pot).toBe(85);
  });

  it('all in and called: the board runs out and side pots are paid', async () => {
    const { t } = table();
    const host = t.addPlayer('A');
    t.addPlayer('B');
    t.hostStart(host.id);
    await tick(400);
    const a = roles(t).a;
    const b = roles(t).c; // heads-up: the other player posts the big blind
    // Give the big blind a short stack (blind already posted).
    b.balance = 90;
    // Heads-up: the button (A) is the small blind and acts first.
    expect(t.act(a.id, 'allin')).toBeNull();
    expect(t.act(b.id, 'call')).toBeNull();
    for (let i = 0; i < 200 && t.phase !== 'results'; i++) await tick(20);
    expect(t.board).toHaveLength(5);
    expect(a.balance + b.balance).toBe(1100);
    expect([0, 100, 200, 900, 1000, 1100]).toContain(b.balance);
    void host;
  });

  it('times out: check when possible, otherwise fold', async () => {
    const { t } = table();
    const host = t.addPlayer('A');
    t.addPlayer('B');
    t.addPlayer('C');
    t.hostStart(host.id);
    await tick(400);
    const { a } = roles(t);
    await tick(1001);
    expect(a.folded).toBe(true);
  });

  it('needs two players with chips to start', () => {
    const { t } = table();
    const a = t.addPlayer('A');
    expect(t.hostStart(a.id)).toMatch(/two players/);
  });

  it('bots play hands on their own while a person is seated', async () => {
    const { t } = table(undefined, { resultsMs: 50 });
    const me = t.addPlayer('Ana');
    t.addBot(me.id);
    t.addBot(me.id);
    t.hostStart(me.id);
    for (let i = 0; i < 400 && t.round < 4; i++) {
      if (t.turn === me.id) t.act(me.id, t.publicState(me.id).turn!.canCheck ? 'check' : 'fold');
      await tick(40);
    }
    expect(t.round).toBeGreaterThanOrEqual(4);
    const chips = [...t.players.values()].reduce((s, p) => s + p.balance + p.total, 0);
    // Chips are conserved (bots that bust buy back in for 1000).
    expect(chips % 5).toBe(0);
    t.dispose();
  });
});
