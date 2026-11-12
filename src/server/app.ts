// HTTP + Socket.IO server. Serves the built frontend and handles all real-time events.

import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import type { Action } from '../game/index.js';
import { type Ack, type ClientToServer, type JoinResult, type PokerAction, type ServerToClient, cleanChips, cleanLook } from '../shared/protocol.js';
import { AccountStore } from './accounts.js';
import { Bus } from './bus.js';
import { ChallengeStore } from './competitions.js';
import { PokerTable } from './poker-table.js';
import { RouletteTable } from './roulette-table.js';
import { Table } from './table.js';
import { DEFAULT_ROOM_SETTINGS, RateLimiter, type Room, RoomManager, type RoomSettings, cleanChat, cleanName, normalizeCode } from './rooms.js';

type GameSocket = Socket<ClientToServer, ServerToClient, object, { code?: string; playerId?: string }>;

const ACTIONS: readonly Action[] = ['hit', 'stand', 'double', 'split'];
const POKER_ACTIONS: readonly PokerAction[] = ['fold', 'check', 'call', 'raise', 'allin'];

export interface GameServer {
  http: HttpServer;
  io: Server<ClientToServer, ServerToClient>;
  rooms: RoomManager;
  close(): Promise<void>;
}

export function createGameServer(settings: Partial<RoomSettings> = {}, accounts = new AccountStore(), challenges = new ChallengeStore(), bus = new Bus()): GameServer {
  const app = express();
  app.disable('x-powered-by');
  const http = createServer(app);
  const io = new Server<ClientToServer, ServerToClient>(http, {
    // Small messages only; anything bigger is not from our client.
    maxHttpBufferSize: 16_000,
  });

  // Everyone at the table gets their own view (in poker, only their own hole cards).
  const rooms = new RoomManager({ ...DEFAULT_ROOM_SETTINGS, ...settings }, (room, events) => {
    for (const [playerId, socketId] of room.sockets) io.sockets.sockets.get(socketId)?.emit('state', room.stateFor(playerId, events));
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.rooms.size });
  });

  // ---------- Accounts: sign up / sign in with an email, save your progress ----------
  const json = express.json({ limit: '512kb' });
  const attempts = new Map<string, RateLimiter>();
  const limited = (ip: string | undefined) => {
    const key = ip ?? '?';
    let r = attempts.get(key);
    if (!r) {
      if (attempts.size > 5000) attempts.clear();
      r = new RateLimiter(10, 60_000); // 10 sign-in attempts a minute per address
      attempts.set(key, r);
    }
    return !r.allow();
  };
  const bearer = (req: express.Request) => req.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  app.post('/api/signup', json, async (req, res) => {
    if (limited(req.ip)) return res.status(429).json({ ok: false, error: 'Too many tries. Wait a minute and try again.' });
    res.json(await accounts.signUp(req.body?.email, req.body?.password, req.body?.data));
  });
  app.post('/api/login', json, async (req, res) => {
    if (limited(req.ip)) return res.status(429).json({ ok: false, error: 'Too many tries. Wait a minute and try again.' });
    res.json(await accounts.logIn(req.body?.email, req.body?.password));
  });
  app.get('/api/me', (req, res) => {
    const a = accounts.byTokenOf(bearer(req));
    if (!a) return res.status(401).json({ ok: false, error: 'Please sign in again' });
    res.json({ ok: true, email: a.email, data: a.data });
  });
  app.put('/api/me', json, (req, res) => {
    const error = accounts.save(bearer(req), req.body?.data);
    if (error) return res.status(error.startsWith('Please') ? 401 : 400).json({ ok: false, error });
    res.json({ ok: true });
  });
  // ---------- Challenges ----------
  const challengeLimit = new Map<string, RateLimiter>();
  const tooMany = (ip: string | undefined) => {
    const key = ip ?? '?';
    let r = challengeLimit.get(key);
    if (!r) {
      if (challengeLimit.size > 5000) challengeLimit.clear();
      r = new RateLimiter(60, 60_000);
      challengeLimit.set(key, r);
    }
    return !r.allow();
  };
  app.post('/api/challenge', json, (req, res) => {
    if (tooMany(req.ip)) return res.status(429).json({ ok: false, error: 'Slow down a little' });
    res.json(challenges.create(req.body ?? {}));
  });
  app.post('/api/challenge/:code/join', json, (req, res) => {
    if (tooMany(req.ip)) return res.status(429).json({ ok: false, error: 'Slow down a little' });
    res.json(challenges.join(req.params.code, req.body?.player ?? {}));
  });
  app.post('/api/challenge/:code/score', json, (req, res) => {
    if (tooMany(req.ip)) return res.status(429).json({ ok: false, error: 'Slow down a little' });
    const error = challenges.report(req.params.code, req.body?.playerId, req.body?.secret, req.body?.chips);
    res.json(error ? { ok: false, error } : { ok: true });
  });
  app.get('/api/challenge/:code', (req, res) => {
    const board = challenges.board(req.params.code);
    if (!board) return res.status(404).json({ ok: false, error: 'No challenge with that code' });
    res.json({ ok: true, board });
  });

  app.post('/api/logout', (req, res) => {
    accounts.logOut(bearer(req));
    res.json({ ok: true });
  });

  // Serve the built frontend (created by `npm run build`) from dist/client.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = [path.resolve(here, '../../dist/client'), path.resolve(here, '../client')].find((d) =>
    existsSync(path.join(d, 'index.html')),
  );
  if (clientDir) {
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    // Every page URL (/, /table/ABC123, …) gets the single-page app.
    app.get(/^\/(?!socket\.io|api\/).*/, (_req, res) => {
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
      socket.emit('state', room.stateFor(playerId, []));
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
      room.onChatMessage ??= (msg) => io.to(room.code).emit('chat', msg);
    };

    socket.on('room:create', (payload, ack) => {
      if (typeof ack !== 'function') return;
      const name = cleanName(payload?.name);
      if (!name) return ack({ ok: false, error: 'Please enter a name' });
      const game = payload?.game === 'poker' || payload?.game === 'roulette' ? payload.game : 'blackjack';
      const bots = Math.max(0, Math.min(game === 'blackjack' ? 4 : 5, Math.floor(Number(payload?.bots) || 0)));
      const room = rooms.create(Boolean(payload?.solo), bots > 0, game);
      wireSystemChat(room);
      const player = room.table.addPlayer(name, cleanLook(payload?.look), null, cleanChips(payload?.chips));
      for (let i = 0; i < bots; i++) room.table.addBot(player.id);
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
      const player = room.table.addPlayer(name, cleanLook(payload?.look), null, cleanChips(payload?.chips));
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

    /** Blackjack-only moves; a poker table answers with an error. */
    const onBj = (room: Room, fn: (t: Table) => string | null) => (room.table instanceof Table ? fn(room.table) : 'Not a blackjack table');
    socket.on('seat:take', handle(({ room, playerId }) => room.table.takeSeat(playerId)));
    socket.on(
      'bet:add',
      handle(({ room, playerId }, p: { amount: number }) => onBj(room, (t) => t.addBet(playerId, Number(p?.amount)))),
    );
    socket.on('bet:clear', handle(({ room, playerId }) => onBj(room, (t) => t.clearBet(playerId))));
    socket.on('bet:ready', handle(({ room, playerId }) => onBj(room, (t) => t.setReady(playerId))));
    socket.on(
      'insurance',
      handle(({ room, playerId }, p: { take: boolean }) => onBj(room, (t) => t.takeInsurance(playerId, p?.take === true))),
    );
    socket.on(
      'action',
      handle(({ room, playerId }, p: { action: Action }) => {
        if (!ACTIONS.includes(p?.action)) return 'Unknown action';
        return onBj(room, (t) => t.act(playerId, p.action));
      }),
    );
    socket.on(
      'poker:act',
      handle(({ room, playerId }, p: { action: PokerAction; amount?: number }) => {
        if (!(room.table instanceof PokerTable)) return 'Not a poker table';
        if (!POKER_ACTIONS.includes(p?.action)) return 'Unknown action';
        return room.table.act(playerId, p.action, Number(p?.amount) || 0);
      }),
    );
    /** Roulette-only moves. */
    const onRl = (room: Room, fn: (t: RouletteTable) => string | null) => (room.table instanceof RouletteTable ? fn(room.table) : 'Not a roulette table');
    socket.on(
      'roulette:bet',
      handle(({ room, playerId }, p: { spot: string; amount: number }) => onRl(room, (t) => t.placeBet(playerId, p?.spot, p?.amount))),
    );
    socket.on('roulette:clear', handle(({ room, playerId }) => onRl(room, (t) => t.clearBets(playerId))));
    socket.on('roulette:rebet', handle(({ room, playerId }) => onRl(room, (t) => t.rebet(playerId))));
    socket.on('roulette:ready', handle(({ room, playerId }) => onRl(room, (t) => t.setReady(playerId))));
    socket.on(
      'player:look',
      handle(({ room, playerId }, p: { look: unknown }) => room.table.setLook(playerId, cleanLook(p?.look))),
    );
    socket.on('host:addBot', handle(({ room, playerId }) => room.table.addBot(playerId)));
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
        room.table.chatHeard(playerId, text);
        return null;
      }),
    );

    // ---------- The social message board ----------
    const busLimit = new RateLimiter(60, 5_000);
    bus.connect(socket.id, (topic, payload) => socket.emit('bus:msg', { topic, payload }));
    socket.on('bus:sub', (p) => void bus.subscribe(socket.id, p?.filter));
    socket.on('bus:unsub', (p) => bus.unsubscribe(socket.id, p?.filter));
    socket.on('bus:pub', (p) => {
      if (!busLimit.allow()) return;
      bus.publish(p?.topic, p?.payload, p?.retain === true);
    });

    socket.on('disconnect', () => {
      bus.disconnect(socket.id);
      leaveCurrent();
    });
  });

  return {
    http,
    io,
    rooms,
    close: () =>
      new Promise((resolve) => {
        rooms.closeAll();
        accounts.flush();
        challenges.flush();
        bus.flush();
        void io.close(() => resolve());
      }),
  };
}
