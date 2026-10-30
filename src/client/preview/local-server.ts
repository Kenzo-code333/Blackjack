// Offline preview: runs the real table and room code inside the page, behind a fake
// socket with the same events as the Socket.IO server. Solo play only, since there is
// no shared server for other browsers to connect to.
//
// Importing this module installs the fake socket on `globalThis.__bjLocalSocket`,
// which main.ts picks up. It must be imported before main.ts.

import type { Action } from '../../game/index.js';
import type { ChatMessage, StateMessage } from '../../shared/protocol.js';
import { DEFAULT_ROOM_SETTINGS, RateLimiter, type Room, RoomManager, cleanChat, cleanName, normalizeCode } from '../../server/rooms.js';

type Ack = (res: unknown) => void;
type Handler = (...args: never[]) => void;

const ACTIONS: readonly Action[] = ['hit', 'stand', 'double', 'split'];

class LocalSocket {
  private readonly handlers = new Map<string, Handler[]>();
  /** Socket.IO's manager object; the client only listens for reconnect attempts on it. */
  readonly io = { on: () => {} };
  connected = false;
  private room: Room | null = null;
  private playerId: string | null = null;
  private readonly chatLimit = new RateLimiter(5, 10_000);
  private readonly rooms = new RoomManager(DEFAULT_ROOM_SETTINGS, (room, events) => {
    if (room === this.room) this.deliver('state', { state: room.table.publicState(), events } satisfies StateMessage);
  });

  constructor() {
    setTimeout(() => {
      this.connected = true;
      this.deliver('connect');
    }, 0);
  }

  on(event: string, fn: Handler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return this;
  }

  /** Messages "to the server". Answers arrive asynchronously, like over a network. */
  emit(event: string, ...args: unknown[]): this {
    const ack = typeof args[args.length - 1] === 'function' ? (args.pop() as Ack) : null;
    const payload = (args[0] ?? {}) as Record<string, unknown>;
    setTimeout(() => {
      let res: unknown;
      try {
        res = this.handle(event, payload);
      } catch (err) {
        console.error(err);
        res = { ok: false, error: 'Something went wrong' };
      }
      if (ack && res !== undefined) ack(res);
    }, 0);
    return this;
  }

  private deliver(event: string, ...args: unknown[]): void {
    setTimeout(() => {
      for (const fn of this.handlers.get(event) ?? []) (fn as (...a: unknown[]) => void)(...args);
    }, 0);
  }

  private enter(room: Room, playerId: string) {
    this.room = room;
    this.playerId = playerId;
    room.onSystem ??= (msg) => this.deliver('chat', msg);
    room.attach(playerId, 'local');
    this.deliver('state', { state: room.table.publicState(), events: [] });
    this.deliver('chat:history', room.chat);
    return { ok: true, code: room.code, playerId, token: room.table.players.get(playerId)!.token };
  }

  private result(error: string | null) {
    return error ? { ok: false, error } : { ok: true };
  }

  private handle(event: string, p: Record<string, unknown>): unknown {
    if (event === 'room:create') {
      const name = cleanName(p.name);
      if (!name) return { ok: false, error: 'Please enter a name' };
      if (this.room && this.playerId) this.room.remove(this.playerId);
      const room = this.rooms.create(true);
      return this.enter(room, room.table.addPlayer(name).id);
    }
    if (event === 'room:join') {
      const room = this.rooms.get(normalizeCode(p.code));
      const player = room && typeof p.token === 'string' ? room.table.findByToken(p.token) : undefined;
      if (!room || !player) {
        return {
          ok: false,
          error: 'This preview runs only in your browser, so tables cannot be joined. Start a new solo game.',
          code: 'SEAT_EXPIRED',
        };
      }
      return this.enter(room, player.id);
    }

    const room = this.room;
    const me = this.playerId;
    if (!room || !me || !room.table.players.has(me)) return { ok: false, error: 'You are not at a table' };
    const table = room.table;
    switch (event) {
      case 'room:leave':
        room.remove(me);
        room.close();
        this.room = null;
        this.playerId = null;
        return undefined;
      case 'bet:add':
        return this.result(table.addBet(me, Number(p.amount)));
      case 'bet:clear':
        return this.result(table.clearBet(me));
      case 'bet:ready':
        return this.result(table.setReady(me));
      case 'insurance':
        return this.result(table.takeInsurance(me, p.take === true));
      case 'action':
        if (!ACTIONS.includes(p.action as Action)) return { ok: false, error: 'Unknown action' };
        return this.result(table.act(me, p.action as Action));
      case 'chips:reset':
        return this.result(table.resetChips(me));
      case 'host:start':
        return this.result(table.hostStart(me));
      case 'seat:take':
        return this.result(table.takeSeat(me));
      case 'host:kick':
        return { ok: false, error: 'Nobody else is at this table' };
      case 'chat:send': {
        const text = cleanChat(p.text);
        if (!text) return { ok: false, error: 'Empty message' };
        if (!this.chatLimit.allow()) return { ok: false, error: 'You are sending messages too fast' };
        const msg: ChatMessage = room.addChat(me, table.players.get(me)!.name, text);
        this.deliver('chat', msg);
        return { ok: true };
      }
      default:
        return { ok: false, error: 'Unknown request' };
    }
  }
}

(globalThis as { __bjLocalSocket?: unknown }).__bjLocalSocket = new LocalSocket();
