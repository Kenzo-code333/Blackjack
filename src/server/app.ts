// HTTP + Socket.IO server. Serves the built frontend and handles all real-time events.

import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import type { Action } from '../game/index.js';
import type { Ack, ClientToServer, JoinResult, ServerToClient } from '../shared/protocol.js';
import { DEFAULT_ROOM_SETTINGS, RateLimiter, type Room, RoomManager, type RoomSettings, cleanChat, cleanName, normalizeCode } from './rooms.js';

type GameSocket = Socket<ClientToServer, ServerToClient, object, { code?: string; playerId?: string }>;

const ACTIONS: readonly Action[] = ['hit', 'stand', 'double', 'split'];

export interface GameServer {
  http: HttpServer;
  io: Server<ClientToServer, ServerToClient>;
  rooms: RoomManager;
  close(): Promise<void>;
}

export function createGameServer(settings: Partial<RoomSettings> = {}): GameServer {
  const app = express();
  const http = createServer(app);
  const io = new Server<ClientToServer, ServerToClient>(http, {
    // Small messages only; anything bigger is not from our client.
    maxHttpBufferSize: 16_000,
  });

  const rooms = new RoomManager({ ...DEFAULT_ROOM_SETTINGS, ...settings }, (room, events) => {
    io.to(room.code).emit('state', { state: room.table.publicState(), events });
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.rooms.size });
  });

  // Serve the built frontend (created by `npm run build`) from dist/client.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = [path.resolve(here, '../../dist/client'), path.resolve(here, '../client')].find((d) =>
    existsSync(path.join(d, 'index.html')),
  );
  if (clientDir) {
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    // Every page URL (/, /table/ABC123, …) gets the single-page app.
    app.get(/^\/(?!socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  io.on('connection', (socket: GameSocket) => {
    const anyEvent = new RateLimiter(40, 5_000);
    const chatLimit = new RateLimiter(5, 10_000);

    socket.use((_packet, next) => {
      if (anyEvent.allow()) next();
      else next(new Error('Slow down'));
    });
    socket.on('error', () => {
      /* rate-limited packets end up here; nothing to do */
    });

    /** The room and player for this socket, or an error for the ack. */
    const current = (): { room: Room; playerId: string } | null => {
      const { code, playerId } = socket.data;
      const room = code ? rooms.get(code) : undefined;
      if (!room || !playerId || !room.table.players.has(playerId)) return null;
      return { room, playerId };
    };

    /** Wraps a handler: validates the ack callback, finds the room, catches bugs. */
    const handle =
      <P extends unknown[]>(fn: (ctx: { room: Room; playerId: string }, ...args: P) => string | null) =>
      (...args: [...P, Ack]) => {
        const ack = args[args.length - 1] as Ack;
        if (typeof ack !== 'function') return;
        const ctx = current();
        if (!ctx) return ack({ ok: false, error: 'You are not at a table' });
        try {
          const error = fn(ctx, ...(args.slice(0, -1) as P));
          ack(error ? { ok: false, error } : { ok: true });
        } catch (err) {
          console.error(err);
          ack({ ok: false, error: 'Server error' });
        }
      };

    const enter = (room: Room, playerId: string, ack: Ack<JoinResult>) => {
      leaveCurrent();
      const player = room.table.players.get(playerId)!;
      socket.data = { code: room.code, playerId };
      void socket.join(room.code);
      room.attach(playerId, socket.id);
      ack({ ok: true, code: room.code, playerId, token: player.token });
      socket.emit('state', { state: room.table.publicState(), events: [] });
      socket.emit('chat:history', room.chat);
    };

    const leaveCurrent = () => {
      const ctx = current();
      if (!ctx) return;
      void socket.leave(ctx.room.code);
      ctx.room.detach(ctx.playerId, socket.id);
      socket.data = {};
    };

    const wireSystemChat = (room: Room) => {
      room.onSystem ??= (msg) => io.to(room.code).emit('chat', msg);
    };

    socket.on('room:create', (payload, ack) => {
      if (typeof ack !== 'function') return;
      const name = cleanName(payload?.name);
      if (!name) return ack({ ok: false, error: 'Please enter a name' });
      const room = rooms.create(Boolean(payload?.solo));
      wireSystemChat(room);
      const player = room.table.addPlayer(name);
      enter(room, player.id, ack);
    });

    socket.on('room:join', (payload, ack) => {
      if (typeof ack !== 'function') return;
      const room = rooms.get(normalizeCode(payload?.code));
      if (!room) return ack({ ok: false, error: 'Table not found. It may have closed.' });
      wireSystemChat(room);

      // Rejoin with a saved session token: same seat, same chips.
      const token = typeof payload?.token === 'string' ? payload.token : '';
      if (token && room.banned.has(token)) return ack({ ok: false, error: 'You were removed from this table' });
      const existing = token ? room.table.findByToken(token) : undefined;
      // If that player is still connected from another tab, this tab joins as someone new.
      const otherSocket = existing && room.sockets.get(existing.id);
      if (existing && (!otherSocket || !io.sockets.sockets.get(otherSocket))) {
        return enter(room, existing.id, ack);
      }
      if (existing && payload?.rejoin) {
        return ack({ ok: false, error: 'You are already at this table in another tab', code: 'SEAT_IN_USE' });
      }
      if (payload?.rejoin) return ack({ ok: false, error: 'Your seat has expired', code: 'SEAT_EXPIRED' });

      if (room.table.solo) return ack({ ok: false, error: 'That is a private solo table' });
      const name = cleanName(payload?.name);
      if (!name) return ack({ ok: false, error: 'Please enter a name' });
      const player = room.table.addPlayer(name);
      room.system(player.seat === null ? `${name} is watching (table full)` : `${name} sat down`);
      enter(room, player.id, ack);
    });

    socket.on('room:leave', () => {
      const ctx = current();
      if (!ctx) return;
      void socket.leave(ctx.room.code);
      socket.data = {};
      ctx.room.remove(ctx.playerId);
    });

    socket.on('seat:take', handle(({ room, playerId }) => room.table.takeSeat(playerId)));
    socket.on(
      'bet:add',
      handle(({ room, playerId }, p: { amount: number }) => room.table.addBet(playerId, Number(p?.amount))),
    );
    socket.on('bet:clear', handle(({ room, playerId }) => room.table.clearBet(playerId)));
    socket.on('bet:ready', handle(({ room, playerId }) => room.table.setReady(playerId)));
    socket.on(
      'insurance',
      handle(({ room, playerId }, p: { take: boolean }) => room.table.takeInsurance(playerId, p?.take === true)),
    );
    socket.on(
      'action',
      handle(({ room, playerId }, p: { action: Action }) => {
        if (!ACTIONS.includes(p?.action)) return 'Unknown action';
        return room.table.act(playerId, p.action);
      }),
    );
    socket.on('chips:reset', handle(({ room, playerId }) => room.table.resetChips(playerId)));
    socket.on('host:start', handle(({ room, playerId }) => room.table.hostStart(playerId)));
    socket.on(
      'host:kick',
      handle(({ room, playerId }, p: { playerId: string }) => {
        const target = room.table.players.get(String(p?.playerId));
        const error = room.table.kick(playerId, String(p?.playerId));
        if (error || !target) return error;
        room.banned.add(target.token);
        const targetSocketId = room.sockets.get(target.id);
        room.remove(target.id);
        room.system(`${target.name} was removed by the host`);
        const targetSocket = targetSocketId ? io.sockets.sockets.get(targetSocketId) : undefined;
        if (targetSocket) {
          targetSocket.emit('kicked');
          void targetSocket.leave(room.code);
          targetSocket.data = {};
        }
        return null;
      }),
    );
    socket.on(
      'chat:send',
      handle(({ room, playerId }, p: { text: string }) => {
        const text = cleanChat(p?.text);
        if (!text) return 'Empty message';
        if (!chatLimit.allow()) return 'You are sending messages too fast';
        const name = room.table.players.get(playerId)!.name;
        io.to(room.code).emit('chat', room.addChat(playerId, name, text));
        return null;
      }),
    );

    socket.on('disconnect', () => leaveCurrent());
  });

  return {
    http,
    io,
    rooms,
    close: () =>
      new Promise((resolve) => {
        rooms.closeAll();
        void io.close(() => resolve());
      }),
  };
}
