// The game server, running inside the page (preview build only).
// Same rooms, tables and validation as src/server/app.ts, but connections are
// in-page objects instead of sockets: the player's own page, and (when hosting an
// online table) friends whose messages arrive through the artifact's live room.

import type { Action } from '../../game/index.js';
import { type ChatMessage, type StateMessage, cleanLook } from '../../shared/protocol.js';
import { DEFAULT_ROOM_SETTINGS, RateLimiter, type Room, RoomManager, cleanChat, cleanName, normalizeCode } from '../../server/rooms.js';

export interface Connection {
  id: string;
  /** Friends' pages are reached through the room; the server batches broadcasts for them. */
  remote: boolean;
  deliver(event: string, ...args: unknown[]): void;
}

type Result = { ok: true; [k: string]: unknown } | { ok: false; error: string; code?: string };

const ACTIONS: readonly Action[] = ['hit', 'stand', 'double', 'split'];

export class PageServer {
  private readonly conns = new Map<string, { conn: Connection; code?: string; playerId?: string; chat: RateLimiter }>();
  readonly rooms = new RoomManager(DEFAULT_ROOM_SETTINGS, (room, events) => {
    this.broadcast(room, 'state', { state: room.table.publicState(), events } satisfies StateMessage);
  });
  /** Called once per broadcast that has remote listeners (the online host sends it to the room). */
  onRemoteBroadcast: ((code: string, event: string, args: unknown[]) => void) | null = null;

  /** Registers a connection; calling it again for the same id keeps its seat. */
  connect(conn: Connection): void {
    if (this.conns.has(conn.id)) return;
    this.conns.set(conn.id, { conn, chat: new RateLimiter(5, 10_000) });
  }

  disconnect(connId: string): void {
    const c = this.conns.get(connId);
    if (c?.code && c.playerId) this.rooms.get(c.code)?.detach(c.playerId, connId);
    this.conns.delete(connId);
  }

  /** Sends to everyone at a table: local pages directly, friends in one room message. */
  broadcast(room: Room, event: string, ...args: unknown[]): void {
    let remote = false;
    for (const { conn, code } of this.conns.values()) {
      if (code !== room.code) continue;
      if (conn.remote) remote = true;
      else conn.deliver(event, ...args);
    }
    if (remote) this.onRemoteBroadcast?.(room.code, event, args);
  }

  /** Closes a table and tells the friends at it (the host's own page already knows). */
  closeRoom(code: string, reason: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    this.onRemoteBroadcast?.(code, 'closed', [{ reason }]);
    for (const c of this.conns.values()) if (c.code === code) c.code = c.playerId = undefined;
    room.close();
  }

  private enter(connId: string, room: Room, playerId: string): Result {
    const c = this.conns.get(connId)!;
    if (c.code && c.playerId && (c.code !== room.code || c.playerId !== playerId)) this.rooms.get(c.code)?.detach(c.playerId, connId);
    c.code = room.code;
    c.playerId = playerId;
    room.onChatMessage ??= (msg) => this.broadcast(room, 'chat', msg);
    room.attach(playerId, connId);
    c.conn.deliver('state', { state: room.table.publicState(), events: [] });
    c.conn.deliver('chat:history', room.chat);
    return { ok: true, code: room.code, playerId, token: room.table.players.get(playerId)!.token };
  }

  private result(error: string | null): Result {
    return error ? { ok: false, error } : { ok: true };
  }

  handle(connId: string, event: string, p: Record<string, unknown>): Result | undefined {
    const c = this.conns.get(connId);
    if (!c) return { ok: false, error: 'Not connected' };

    if (event === 'room:create') {
      if (c.conn.remote) return { ok: false, error: 'Only the host can open tables here' };
      const name = cleanName(p.name);
      if (!name) return { ok: false, error: 'Please enter a name' };
      if (c.code && c.playerId) this.rooms.get(c.code)?.remove(c.playerId);
      const bots = Math.max(0, Math.min(4, Math.floor(Number(p.bots) || 0)));
      const room = this.rooms.create(p.solo === true, bots > 0);
      const player = room.table.addPlayer(name, cleanLook(p.look));
      for (let i = 0; i < bots; i++) room.table.addBot(player.id);
      return this.enter(connId, room, player.id);
    }

    if (event === 'room:join') {
      const room = this.rooms.get(normalizeCode(p.code));
      if (!room) return { ok: false, error: 'Table not found. It may have closed.', code: 'SEAT_EXPIRED' };
      const token = typeof p.token === 'string' ? p.token : '';
      if (token && room.banned.has(token)) return { ok: false, error: 'You were removed from this table' };
      const existing = token ? room.table.findByToken(token) : undefined;
      const holder = existing && room.sockets.get(existing.id);
      if (existing && (!holder || !this.conns.has(holder) || holder === connId)) return this.enter(connId, room, existing.id);
      if (existing && p.rejoin) return { ok: false, error: 'You are already at this table in another tab', code: 'SEAT_IN_USE' };
      if (p.rejoin) return { ok: false, error: 'Your seat has expired', code: 'SEAT_EXPIRED' };
      if (room.table.solo) return { ok: false, error: 'That is a private solo table' };
      const name = cleanName(p.name);
      if (!name) return { ok: false, error: 'Please enter a name' };
      const player = room.table.addPlayer(name, cleanLook(p.look));
      room.system(player.seat === null ? `${name} is watching (table full)` : `${name} sat down`);
      return this.enter(connId, room, player.id);
    }

    const room = c.code ? this.rooms.get(c.code) : undefined;
    const me = c.playerId;
    if (!room || !me || !room.table.players.has(me)) return { ok: false, error: 'You are not at a table' };
    const table = room.table;
    switch (event) {
      case 'room:leave':
        c.code = c.playerId = undefined;
        room.remove(me);
        return undefined;
      case 'seat:take':
        return this.result(table.takeSeat(me));
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
      case 'player:look':
        return this.result(table.setLook(me, cleanLook(p.look)));
      case 'host:start':
        return this.result(table.hostStart(me));
      case 'host:addBot':
        return this.result(table.addBot(me));
      case 'host:kick': {
        const target = table.players.get(String(p.playerId));
        const error = table.kick(me, String(p.playerId));
        if (error || !target) return this.result(error);
        room.banned.add(target.token);
        const targetConn = room.sockets.get(target.id);
        room.remove(target.id);
        room.system(`${target.name} was removed by the host`);
        const tc = targetConn ? this.conns.get(targetConn) : undefined;
        if (tc) {
          tc.conn.deliver('kicked');
          tc.code = tc.playerId = undefined;
        }
        return { ok: true };
      }
      case 'chat:send': {
        const text = cleanChat(p.text);
        if (!text) return { ok: false, error: 'Empty message' };
        if (!c.chat.allow()) return { ok: false, error: 'You are sending messages too fast' };
        const msg: ChatMessage = room.addChat(me, table.players.get(me)!.name, text);
        this.broadcast(room, 'chat', msg);
        table.chatHeard(me, text);
        return { ok: true };
      }
      default:
        return { ok: false, error: 'Unknown request' };
    }
  }
}
