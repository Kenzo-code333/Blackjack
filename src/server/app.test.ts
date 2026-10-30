import type { AddressInfo } from 'node:net';
import { type Socket, io as connect } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ClientToServer, JoinResult, PublicState, ServerToClient } from '../shared/protocol.js';
import { type GameServer, createGameServer } from './app.js';

type Client = Socket<ServerToClient, ClientToServer>;
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

let server: GameServer;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  server = createGameServer({
    rejoinGraceMs: 300,
    emptyRoomTtlMs: 300,
    timing: { bettingMs: 5000, cardMs: 1, revealMs: 1, resultsMs: 200, turnMs: 5000, insuranceMs: 5000 },
  });
  await new Promise<void>((r) => server.http.listen(0, r));
  url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await server.close();
});

async function client(): Promise<Client & { last: () => PublicState | undefined; next: (pred: (s: PublicState) => boolean) => Promise<PublicState> }> {
  const socket: Client = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  let latest: PublicState | undefined;
  const waiters: { pred: (s: PublicState) => boolean; resolve: (s: PublicState) => void }[] = [];
  socket.on('state', ({ state }) => {
    latest = state;
    for (const w of [...waiters]) {
      if (w.pred(state)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(state);
      }
    }
  });
  await new Promise<void>((r) => socket.on('connect', () => r()));
  return Object.assign(socket, {
    last: () => latest,
    next: (pred: (s: PublicState) => boolean) =>
      latest && pred(latest) ? Promise.resolve(latest) : new Promise<PublicState>((resolve) => waiters.push({ pred, resolve })),
  });
}

// Small promise wrappers around acknowledged events.
const call = <T = object>(socket: Client, event: string, payload?: unknown): Promise<Res<T>> =>
  new Promise((resolve) => {
    const emit = socket.emit as (...args: unknown[]) => void;
    if (payload === undefined) emit.call(socket, event, resolve);
    else emit.call(socket, event, payload, resolve);
  });

describe('socket server', () => {
  it('two players create and join a table, play a round, and both see the same state', async () => {
    const alice = await client();
    const bob = await client();

    const created = await call<JoinResult>(alice, 'room:create', { name: 'Alice' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.code).toMatch(/^[A-Z2-9]{6}$/);

    const joined = await call<JoinResult>(bob, 'room:join', { code: created.code.toLowerCase(), name: '  Bob  ' });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const both = await alice.next((s) => s.players.length === 2);
    expect(both.players.map((p) => [p.name, p.seat, p.isHost])).toEqual([
      ['Alice', 0, true],
      ['Bob', 1, false],
    ]);

    expect((await call(bob, 'host:start')).ok).toBe(false);
    expect((await call(alice, 'host:start')).ok).toBe(true);
    await bob.next((s) => s.phase === 'betting');

    expect((await call(alice, 'bet:add', { amount: 25 })).ok).toBe(true);
    expect((await call(bob, 'bet:add', { amount: 100 })).ok).toBe(true);
    expect(await call(bob, 'bet:add', { amount: 'lots' })).toEqual({ ok: false, error: 'Invalid amount' });
    await call(alice, 'bet:ready');
    await call(bob, 'bet:ready');

    // Play until the round finishes, standing whenever it's our turn.
    const done = Promise.all([alice.next((s) => s.phase === 'results'), bob.next((s) => s.phase === 'results')]);
    const autoStand = (who: typeof alice, id: string) =>
      who.on('state', ({ state }) => {
        if (state.phase === 'insurance' && state.players.find((p) => p.id === id)?.insurance === null)
          void call(who, 'insurance', { take: false });
        if (state.turn?.playerId === id) void call(who, 'action', { action: 'stand' });
      });
    autoStand(alice, created.playerId);
    autoStand(bob, joined.playerId);
    const [a, b] = await done;
    expect(a.dealer.revealed).toBe(true);
    expect(a.players.map((p) => p.hands[0]?.outcome)).toEqual(b.players.map((p) => p.hands[0]?.outcome));
  });

  it('never sends the hole card before it is revealed', async () => {
    const alice = await client();
    const created = await call<JoinResult>(alice, 'room:create', { name: 'Alice', solo: true });
    if (!created.ok) throw new Error('create failed');
    const raw: string[] = [];
    alice.onAny((_event, ...args) => raw.push(JSON.stringify(args)));
    await call(alice, 'bet:add', { amount: 10 });
    await call(alice, 'bet:ready');
    const state = await alice.next((s) => s.phase !== 'betting' && s.phase !== 'dealing');
    if (state.dealer.revealed) return; // dealer blackjack: nothing to check this time
    const hole = server.rooms.get(created.code)!.table.dealer[1]!;
    expect(state.dealer.cards[1]).toBeNull();
    // Nothing sent so far mentions the hole card in a dealer deal event.
    for (const msg of raw) {
      const parsed = JSON.parse(msg)[0];
      for (const e of parsed?.events ?? []) {
        if (e.type === 'deal' && e.to === 'dealer' && e.card) expect(e.card).not.toEqual(hole);
        expect(e.type).not.toBe('reveal');
      }
    }
  });

  it('a player who disconnects can rejoin with their token and keep their chips', async () => {
    const alice = await client();
    const created = await call<JoinResult>(alice, 'room:create', { name: 'Alice' });
    if (!created.ok) throw new Error('create failed');
    await call(alice, 'host:start');
    await call(alice, 'bet:add', { amount: 100 });
    alice.disconnect();

    const again = await client();
    const rejoined = await call<JoinResult>(again, 'room:join', { code: created.code, name: 'ignored', token: created.token });
    expect(rejoined.ok && rejoined.playerId).toBe(created.playerId);
    const state = await again.next((s) => s.players[0]?.connected === true);
    expect(state.players[0]!.balance).toBe(900);
    expect(state.players[0]!.bet).toBe(100);
    expect(state.players).toHaveLength(1);
  });

  it('the seat is released after the grace period, and empty rooms close', async () => {
    const alice = await client();
    const bob = await client();
    const created = await call<JoinResult>(alice, 'room:create', { name: 'Alice' });
    if (!created.ok) throw new Error('create failed');
    await call(bob, 'room:join', { code: created.code, name: 'Bob' });
    bob.disconnect();
    await alice.next((s) => s.players.length === 1);
    alice.disconnect();
    await new Promise((r) => setTimeout(r, 800));
    expect(server.rooms.get(created.code)).toBeUndefined();
  });

  it('host can kick a player, who cannot come back', async () => {
    const alice = await client();
    const bob = await client();
    const created = await call<JoinResult>(alice, 'room:create', { name: 'Alice' });
    if (!created.ok) throw new Error('create failed');
    const joined = await call<JoinResult>(bob, 'room:join', { code: created.code, name: 'Bob' });
    if (!joined.ok) throw new Error('join failed');
    const kicked = new Promise<void>((r) => bob.on('kicked', () => r()));
    expect((await call(alice, 'host:kick', { playerId: joined.playerId })).ok).toBe(true);
    await kicked;
    const retry = await call(bob, 'room:join', { code: created.code, name: 'Bob', token: joined.token });
    expect(retry).toEqual({ ok: false, error: 'You were removed from this table' });
  });

  it('chat is broadcast, cleaned up and rate limited', async () => {
    const alice = await client();
    const bob = await client();
    const created = await call<JoinResult>(alice, 'room:create', { name: 'Alice' });
    if (!created.ok) throw new Error('create failed');
    await call(bob, 'room:join', { code: created.code, name: 'Bob' });
    const got = new Promise<ChatMessage>((r) => bob.on('chat', (m) => m.playerId && r(m)));
    await call(alice, 'chat:send', { text: '  hello\n\nthere  ' });
    expect((await got).text).toBe('hello there');
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await call(alice, 'chat:send', { text: `spam ${i}` })).ok);
    expect(results).toEqual([true, true, true, true, false, false]);
  });

  it('a 6th player becomes a spectator; unknown codes are rejected', async () => {
    const host = await client();
    const created = await call<JoinResult>(host, 'room:create', { name: 'P1' });
    if (!created.ok) throw new Error('create failed');
    for (let i = 2; i <= 6; i++) await call(await client(), 'room:join', { code: created.code, name: `P${i}` });
    const state = await host.next((s) => s.players.length === 6);
    expect(state.players.map((p) => p.seat)).toEqual([0, 1, 2, 3, 4, null]);
    expect(await call(host, 'room:join', { code: 'NOPE99', name: 'x' })).toMatchObject({ ok: false });
  });
});
