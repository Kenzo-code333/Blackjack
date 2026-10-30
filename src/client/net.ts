// Connection to the game server, plus the saved session so a reload or a dropped
// connection puts you back in your seat.

import { type Socket, io } from 'socket.io-client';
import type { Action } from '../game/index.js';
import type { ChatMessage, ClientToServer, JoinResult, PublicState, ServerToClient, TableEvent } from '../shared/protocol.js';
import { store } from './storage.js';

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

export interface Session {
  code: string;
  token: string;
  playerId: string;
}

// Each tab remembers its own session (sessionStorage) so two tabs in one browser are
// two different players. localStorage is the fallback after the tab was closed.
const sessionKey = (code: string) => `bj:session:${code}`;

export function savedSession(code: string): Session | null {
  const raw = store.session.get(sessionKey(code)) ?? store.local.get(sessionKey(code));
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    return s.code === code && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session): void {
  store.session.set(sessionKey(s.code), JSON.stringify(s));
  store.local.set(sessionKey(s.code), JSON.stringify(s));
}

export function forgetSession(code: string): void {
  store.session.remove(sessionKey(code));
  store.local.remove(sessionKey(code));
}

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export class Net {
  readonly socket: Socket<ServerToClient, ClientToServer>;
  session: Session | null = null;
  state: PublicState | null = null;
  /** Difference between the server clock and ours, for countdowns. */
  clockOffset = 0;
  status: ConnectionStatus = 'connecting';

  onState: (state: PublicState, events: TableEvent[]) => void = () => {};
  onChat: (msg: ChatMessage) => void = () => {};
  onChatHistory: (msgs: ChatMessage[]) => void = () => {};
  onKicked: () => void = () => {};
  onStatus: (status: ConnectionStatus) => void = () => {};
  /** Rejoining after a reconnect failed (e.g. the seat expired). */
  onLost: (error: string) => void = () => {};

  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'] });
    this.socket.on('connect', () => {
      this.setStatus('online');
      // After a dropped connection, take our seat back automatically.
      if (this.session) {
        const { code, token } = this.session;
        void this.request<JoinResult>('room:join', { code, name: '', token, rejoin: true }).then((res) => {
          if (!res.ok) this.onLost(res.error);
        });
      }
    });
    this.socket.on('disconnect', () => this.setStatus('offline'));
    this.socket.io.on('reconnect_attempt', () => this.setStatus('connecting'));
    this.socket.on('state', ({ state, events }) => {
      this.clockOffset = state.serverTime - Date.now();
      this.state = state;
      this.onState(state, events);
    });
    this.socket.on('chat', (m) => this.onChat(m));
    this.socket.on('chat:history', (m) => this.onChatHistory(m));
    this.socket.on('kicked', () => {
      if (this.session) forgetSession(this.session.code);
      this.session = null;
      this.onKicked();
    });
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.onStatus(status);
  }

  get me(): string | null {
    return this.session?.playerId ?? null;
  }

  /** Server time now, in our clock. */
  now(): number {
    return Date.now() + this.clockOffset;
  }

  private request<T = object>(event: string, payload?: unknown): Promise<Res<T>> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ ok: false, error: 'No answer from the server' }), 8000);
      const done = (res: Res<T>) => {
        clearTimeout(timeout);
        resolve(res);
      };
      const emit = this.socket.emit as unknown as (...args: unknown[]) => void;
      if (payload === undefined) emit.call(this.socket, event, done);
      else emit.call(this.socket, event, payload, done);
    });
  }

  private async enter(res: Res<JoinResult>): Promise<Res<JoinResult>> {
    if (res.ok) {
      this.session = { code: res.code, token: res.token, playerId: res.playerId };
      saveSession(this.session);
    }
    return res;
  }

  async create(name: string, solo: boolean) {
    return this.enter(await this.request<JoinResult>('room:create', { name, solo }));
  }

  async join(code: string, name: string) {
    const token = savedSession(code)?.token;
    return this.enter(await this.request<JoinResult>('room:join', { code, name, token }));
  }

  /** Take back a saved seat without creating a new player. */
  async rejoin(code: string) {
    const token = savedSession(code)?.token;
    if (!token) return { ok: false as const, error: 'No saved seat', code: 'SEAT_EXPIRED' };
    return this.enter(await this.request<JoinResult>('room:join', { code, name: '', token, rejoin: true }));
  }

  leave(): void {
    if (this.session) forgetSession(this.session.code);
    this.session = null;
    this.state = null;
    this.socket.emit('room:leave');
  }

  bet = (amount: number) => this.request('bet:add', { amount });
  clearBet = () => this.request('bet:clear');
  ready = () => this.request('bet:ready');
  insurance = (take: boolean) => this.request('insurance', { take });
  act = (action: Action) => this.request('action', { action });
  resetChips = () => this.request('chips:reset');
  hostStart = () => this.request('host:start');
  kick = (playerId: string) => this.request('host:kick', { playerId });
  takeSeat = () => this.request('seat:take');
  chat = (text: string) => this.request('chat:send', { text });
}
