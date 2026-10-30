import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Card, type Rank, Shoe, seededRng } from '../game/index.js';
import type { TableEvent } from '../shared/protocol.js';
import { Table, type TableTiming } from './table.js';

const c = (...ranks: Rank[]): Card[] => ranks.map((rank) => ({ rank, suit: 'H' }));

const FAST: TableTiming = {
  bettingMs: 1000,
  insuranceMs: 1000,
  turnMs: 1000,
  disconnectedTurnMs: 100,
  resultsMs: 1000,
  cardMs: 10,
  revealMs: 10,
};

function makeTable(opts: { solo?: boolean; top?: Rank[]; timing?: Partial<TableTiming> } = {}) {
  const shoe = new Shoe({ rng: seededRng(7) });
  if (opts.top) shoe.stackForTesting(c(...opts.top));
  const events: TableEvent[] = [];
  const table = new Table({
    code: 'TEST01',
    solo: opts.solo,
    shoe,
    timing: { ...FAST, ...(opts.solo ? { bettingMs: null } : {}), ...opts.timing },
    onUpdate: (e) => events.push(...e),
  });
  return { table, shoe, events };
}

/** Let timers and queued updates run. */
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('solo round', () => {
  it('waits for "Deal" with no countdown, then deals in casino order', async () => {
    // Deal order: player, dealer up, player, dealer hole.
    const { table, events } = makeTable({ solo: true, top: ['10', '9', '7', '8'] });
    const p = table.addPlayer('Ana');
    expect(table.phase).toBe('betting');
    expect(table.deadline).toBeNull();

    expect(table.addBet(p.id, 10)).toBeNull();
    expect(p.balance).toBe(990);
    expect(table.setReady(p.id)).toBeNull();
    expect(table.phase).toBe('dealing');
    await tick(100);
    expect(table.phase).toBe('playing');
    expect(table.turn).toEqual({ playerId: p.id, handIndex: 0 });

    const state = table.publicState();
    expect(state.players[0]!.hands[0]!.label).toBe('17');
    expect(state.dealer.cards).toEqual([{ rank: '9', suit: 'H' }, null]);
    expect(state.dealer.label).toBe('9');
    expect(state.turn?.actions).toEqual(['hit', 'stand', 'double']);
    // The hole card went out face down.
    const dealerDeals = events.filter((e) => e.type === 'deal' && e.to === 'dealer');
    expect(dealerDeals.map((e) => e.type === 'deal' && e.card)).toEqual([{ rank: '9', suit: 'H' }, null]);

    expect(table.act(p.id, 'stand')).toBeNull();
    expect(table.phase).toBe('dealer');
    expect(table.publicState().dealer.cards[1]).toEqual({ rank: '8', suit: 'H' });
    await tick(100);
    expect(table.phase).toBe('results');
    expect(table.publicState().players[0]!.hands[0]!.outcome).toBe('push');
    expect(p.balance).toBe(1000);

    await tick(1000);
    expect(table.phase).toBe('betting');
    expect(table.round).toBe(2);
  });

  it('pays blackjack 3:2 and the dealer does not draw against it', async () => {
    const { table } = makeTable({ solo: true, top: ['A', '9', 'K', '6', '5'] });
    const p = table.addPlayer('Ana');
    table.addBet(p.id, 10);
    table.setReady(p.id);
    await tick(200);
    expect(table.phase).toBe('results');
    expect(table.dealer).toHaveLength(2); // stood on 15 without drawing: no live hand to beat
    expect(p.balance).toBe(1015);
  });

  it('dealer draws to 17 and busts', async () => {
    const { table } = makeTable({ solo: true, top: ['10', '6', '8', '10', 'K'] });
    const p = table.addPlayer('Ana');
    table.addBet(p.id, 20);
    table.setReady(p.id);
    await tick(100);
    table.act(p.id, 'stand');
    await tick(200);
    expect(table.dealer.map((x) => x.rank)).toEqual(['6', '10', 'K']);
    expect(table.publicState().players[0]!.hands[0]!.outcome).toBe('win');
    expect(p.balance).toBe(1020);
  });

  it('rejects actions that are not allowed', async () => {
    const { table } = makeTable({ solo: true, top: ['10', '6', '8', '10'] });
    const p = table.addPlayer('Ana');
    expect(table.act(p.id, 'hit')).toMatch(/turn/);
    expect(table.addBet(p.id, 2000)).toMatch(/Maximum/);
    expect(table.addBet(p.id, -5)).toMatch(/Invalid/);
    expect(table.addBet(p.id, 2.5)).toMatch(/Invalid/);
    table.addBet(p.id, 10);
    table.setReady(p.id);
    expect(table.addBet(p.id, 10)).toMatch(/closed/);
    await tick(100);
    expect(table.act(p.id, 'split')).toMatch(/can't split/);
  });
});

describe('insurance and dealer blackjack', () => {
  it('pays insurance 2:1 when the dealer has blackjack', async () => {
    const { table } = makeTable({ solo: true, top: ['10', 'A', '9', 'K'] });
    const p = table.addPlayer('Ana');
    table.addBet(p.id, 10);
    table.setReady(p.id);
    await tick(100);
    expect(table.phase).toBe('insurance');
    expect(table.publicState().dealer.cards[1]).toBeNull();
    expect(table.takeInsurance(p.id, true)).toBeNull();
    expect(p.balance).toBe(985);
    expect(table.phase).toBe('dealer');
    await tick(50);
    expect(table.phase).toBe('results');
    // Lost 10 on the hand, insurance 5 returned 15: back to even.
    expect(p.balance).toBe(1000);
  });

  it('loses insurance and keeps playing when the dealer has no blackjack', async () => {
    const { table } = makeTable({ solo: true, top: ['10', 'A', '9', '7'] });
    const p = table.addPlayer('Ana');
    table.addBet(p.id, 10);
    table.setReady(p.id);
    await tick(100);
    table.takeInsurance(p.id, true);
    expect(table.phase).toBe('playing');
    table.act(p.id, 'stand'); // 19 vs soft 18
    await tick(200);
    expect(p.balance).toBe(1005); // −5 insurance, +10 win
  });

  it('peeks with a ten up and ends the round on dealer blackjack', async () => {
    const { table, events } = makeTable({ solo: true, top: ['10', 'K', '9', 'A'] });
    const p = table.addPlayer('Ana');
    table.addBet(p.id, 10);
    table.setReady(p.id);
    await tick(100);
    expect(table.phase).toBe('results');
    expect(events).toContainEqual({ type: 'peek', blackjack: true });
    expect(p.balance).toBe(990);
  });

  it('declines insurance automatically when the timer runs out', async () => {
    const { table } = makeTable({ solo: true, top: ['10', 'A', '9', '7'] });
    const p = table.addPlayer('Ana');
    table.addBet(p.id, 10);
    table.setReady(p.id);
    await tick(100);
    expect(table.phase).toBe('insurance');
    await tick(1000);
    expect(table.phase).toBe('playing');
    expect(p.insurance).toBe(0);
  });
});

describe('split and double', () => {
  it('splits into two hands, deals second cards in order, and settles each', async () => {
    // Player 8,8 vs dealer 6 + hole 10. Then: hand 1 gets 3 (→11), doubles and gets K (→21);
    // hand 2 gets 9 (→17), stands. Dealer 16 draws 10 → bust.
    const { table } = makeTable({ solo: true, top: ['8', '6', '8', '10', '3', 'K', '9', '10'] });
    const p = table.addPlayer('Ana');
    table.addBet(p.id, 10);
    table.setReady(p.id);
    await tick(100);
    expect(table.act(p.id, 'split')).toBeNull();
    expect(p.hands).toHaveLength(2);
    expect(p.balance).toBe(980);
    expect(p.hands[0]!.cards.map((x) => x.rank)).toEqual(['8', '3']);
    expect(p.hands[1]!.cards).toHaveLength(1); // gets its card when its turn comes
    expect(table.act(p.id, 'double')).toBeNull();
    expect(p.balance).toBe(970);
    expect(table.turn).toEqual({ playerId: p.id, handIndex: 1 });
    expect(p.hands[1]!.cards.map((x) => x.rank)).toEqual(['8', '9']);
    table.act(p.id, 'stand');
    await tick(200);
    const hands = table.publicState().players[0]!.hands;
    expect(hands.map((h) => h.outcome)).toEqual(['win', 'win']);
    expect(p.balance).toBe(1030); // +20 on the doubled hand, +10 on the other
  });

  it('allows at most 3 hands', async () => {
    const { table } = makeTable({ solo: true, top: ['8', '6', '8', '10', '8', '8', '8'] });
    const p = table.addPlayer('Ana');
    table.addBet(p.id, 10);
    table.setReady(p.id);
    await tick(100);
    expect(table.act(p.id, 'split')).toBeNull();
    expect(table.act(p.id, 'split')).toBeNull();
    expect(p.hands).toHaveLength(3);
    expect(table.act(p.id, 'split')).toMatch(/can't split/);
  });
});

describe('turn timer', () => {
  it('auto-stands when time runs out', async () => {
    const { table } = makeTable({ solo: true, top: ['10', '9', '7', '8'] });
    const p = table.addPlayer('Ana');
    table.addBet(p.id, 10);
    table.setReady(p.id);
    await tick(100);
    expect(table.phase).toBe('playing');
    await tick(table.deadline! - Date.now() - 1);
    expect(table.phase).toBe('playing');
    await tick(2);
    expect(table.phase).not.toBe('playing');
    expect(p.hands[0]!.stood).toBe(true);
  });

  it('auto-stands quickly for a disconnected player', async () => {
    const { table } = makeTable({ solo: true, top: ['10', '9', '7', '8'] });
    const p = table.addPlayer('Ana');
    table.addBet(p.id, 10);
    table.setReady(p.id);
    await tick(100);
    table.setConnected(p.id, false);
    await tick(101);
    expect(p.hands[0]!.stood).toBe(true);
  });
});

describe('multiplayer table', () => {
  it('first player is host; only the host starts rounds', async () => {
    const { table } = makeTable();
    const host = table.addPlayer('Host');
    const guest = table.addPlayer('Guest');
    expect(table.phase).toBe('waiting');
    expect(table.hostStart(guest.id)).toMatch(/host/);
    expect(table.hostStart(host.id)).toBeNull();
    expect(table.phase).toBe('betting');
    expect(table.deadline).not.toBeNull();
  });

  it('deals when the countdown ends; players who did not bet sit out', async () => {
    const { table } = makeTable();
    const a = table.addPlayer('A');
    const b = table.addPlayer('B');
    table.hostStart(a.id);
    table.addBet(a.id, 25);
    await tick(1000);
    expect(table.phase).not.toBe('betting');
    expect(a.inRound).toBe(true);
    expect(b.inRound).toBe(false);
    expect(b.hands).toHaveLength(0);
  });

  it('deals early when everyone pressed Deal', async () => {
    const { table } = makeTable();
    const a = table.addPlayer('A');
    const b = table.addPlayer('B');
    table.hostStart(a.id);
    table.addBet(a.id, 10);
    table.addBet(b.id, 10);
    table.setReady(a.id);
    expect(table.phase).toBe('betting');
    table.setReady(b.id);
    expect(table.phase).toBe('dealing');
  });

  it('goes back to waiting if nobody bets', async () => {
    const { table } = makeTable();
    const a = table.addPlayer('A');
    table.hostStart(a.id);
    await tick(1000);
    expect(table.phase).toBe('waiting');
  });

  it('plays turns in seat order and late joiners wait for the next round', async () => {
    const { table } = makeTable({ top: ['10', '10', '5', '7', '9', '10', '8'] });
    const a = table.addPlayer('A');
    const b = table.addPlayer('B');
    table.hostStart(a.id);
    table.addBet(a.id, 10);
    table.addBet(b.id, 10);
    table.setReady(a.id);
    table.setReady(b.id);
    await tick(200);
    const late = table.addPlayer('Late');
    expect(late.seat).toBe(2);
    expect(late.inRound).toBe(false);
    expect(table.turn?.playerId).toBe(a.id);
    expect(table.act(b.id, 'stand')).toMatch(/turn/);
    table.act(a.id, 'stand');
    expect(table.turn?.playerId).toBe(b.id);
    table.act(b.id, 'stand');
    expect(table.phase).toBe('dealer');
  });

  it('seats up to 5 players, then makes spectators who can sit when a seat frees up', () => {
    const { table } = makeTable();
    const players = ['A', 'B', 'C', 'D', 'E'].map((n) => table.addPlayer(n));
    expect(players.map((p) => p.seat)).toEqual([0, 1, 2, 3, 4]);
    const watcher = table.addPlayer('F');
    expect(watcher.seat).toBeNull();
    expect(table.takeSeat(watcher.id)).toMatch(/full/);
    table.removePlayer(players[2]!.id);
    expect(table.takeSeat(watcher.id)).toBeNull();
    expect(watcher.seat).toBe(2);
  });

  it('host can kick; host passes on when the host leaves', () => {
    const { table } = makeTable();
    const a = table.addPlayer('A');
    const b = table.addPlayer('B');
    const c2 = table.addPlayer('C');
    expect(table.kick(b.id, c2.id)).toMatch(/host/);
    expect(table.kick(a.id, c2.id)).toBeNull();
    expect(table.players.has(c2.id)).toBe(false);
    table.removePlayer(a.id);
    expect(table.hostId).toBe(b.id);
  });

  it('removing the player whose turn it is moves play on', async () => {
    const { table } = makeTable({ top: ['10', '10', '5', '7', '9', '10', '8'] });
    const a = table.addPlayer('A');
    const b = table.addPlayer('B');
    table.hostStart(a.id);
    table.addBet(a.id, 10);
    table.addBet(b.id, 10);
    table.setReady(a.id);
    table.setReady(b.id);
    await tick(200);
    expect(table.turn?.playerId).toBe(a.id);
    table.removePlayer(a.id);
    expect(table.turn?.playerId).toBe(b.id);
  });

  it('chips can be reset outside a round', async () => {
    const { table } = makeTable({ solo: true });
    const p = table.addPlayer('Ana');
    table.addBet(p.id, 500);
    expect(table.resetChips(p.id)).toBeNull();
    expect(p.balance).toBe(1000);
    expect(p.bet).toBe(0);
  });
});

describe('shoe', () => {
  it('reshuffles before the next round once the cut card came out', async () => {
    const { table, shoe, events } = makeTable({ solo: true });
    const p = table.addPlayer('Ana');
    while (!shoe.cutCardReached) shoe.draw();
    table.addBet(p.id, 10);
    table.setReady(p.id);
    await tick(100);
    if (table.phase === 'playing') table.act(p.id, 'stand');
    await tick(100);
    if (table.phase === 'insurance') table.takeInsurance(p.id, false);
    await tick(100);
    if (table.phase === 'playing') table.act(p.id, 'stand');
    await tick(1500);
    expect(table.phase).toBe('betting');
    expect(events).toContainEqual({ type: 'shuffle' });
    expect(shoe.cutCardReached).toBe(false);
  });

  it('never exposes the shoe order or the hole card in public state', async () => {
    const { table } = makeTable({ solo: true, top: ['10', '9', '7', 'Q'] });
    const p = table.addPlayer('Ana');
    table.addBet(p.id, 10);
    table.setReady(p.id);
    await tick(100);
    const json = JSON.stringify(table.publicState());
    expect(json).not.toContain('"Q"');
    expect(json).not.toContain('token');
    expect(Object.keys(table.publicState().shoe)).toEqual(['remaining', 'size', 'cutCardReached']);
  });
});
