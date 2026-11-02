// Rooms: a table plus the people connected to it, chat, and lifetime timers.

import { randomInt } from 'node:crypto';
import type { ChatMessage, GameKind, PokerEvent, StateMessage, TableEvent } from '../shared/protocol.js';
import { PokerTable, type PokerTiming } from './poker-table.js';
import { Table, type TableTiming } from './table.js';

/** A blackjack or a poker table: both offer the same seats, bots, host and chat methods. */
export type GameTable = Table | PokerTable;
export type AnyEvent = TableEvent | PokerEvent;

// No 0/O or 1/I/L, so codes are easy to read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export interface RoomSettings {
  /** How long a disconnected player keeps their seat. */
  rejoinGraceMs: number;
  /** How long a room with nobody connected stays open. */
  emptyRoomTtlMs: number;
  timing?: Partial<TableTiming>;
  pokerTiming?: Partial<PokerTiming>;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  rejoinGraceMs: 60_000,
  emptyRoomTtlMs: 5 * 60_000,
};

export class Room {
  readonly table: GameTable;
  readonly chat: ChatMessage[] = [];
  /** playerId → socket id of their current connection. */
  readonly sockets = new Map<string, string>();
  /** Session tokens of kicked players, so they can't rejoin. */
  readonly banned = new Set<string>();
  private readonly removalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private chatId = 0;

  constructor(
    readonly code: string,
    kind: { solo: boolean; autoStart?: boolean; game?: GameKind },
    private readonly settings: RoomSettings,
    onUpdate: (room: Room, events: AnyEvent[]) => void,
    private readonly onClose: (room: Room) => void,
  ) {
    const onBotChat = (playerId: string, text: string) => {
      const name = this.table.players.get(playerId)?.name ?? 'Player';
      this.onChatMessage?.(this.addChat(playerId, name, text));
    };
    this.table =
      kind.game === 'poker'
        ? new PokerTable({ code, autoStart: kind.autoStart, timing: settings.pokerTiming, onUpdate: (events) => onUpdate(this, events), onBotChat })
        : new Table({ code, solo: kind.solo, autoStart: kind.autoStart, timing: settings.timing, onUpdate: (events) => onUpdate(this, events), onBotChat });
    this.scheduleCloseIfEmpty();
  }

  /** The state and events one viewer may see (in poker: only their own hole cards). */
  stateFor(viewerId: string | null, events: AnyEvent[]): StateMessage {
    const t = this.table;
    if (t instanceof PokerTable) return { state: t.publicState(viewerId), events: t.eventsFor(events as PokerEvent[], viewerId) };
    return { state: t.publicState(viewerId), events };
  }

  attach(playerId: string, socketId: string): void {
    this.sockets.set(playerId, socketId);
    const timer = this.removalTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.removalTimers.delete(playerId);
    this.table.setConnected(playerId, true);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  /** Socket dropped: keep the seat for a grace period. */
  detach(playerId: string, socketId: string): void {
    if (this.sockets.get(playerId) !== socketId) return; // an older connection; ignore
    this.sockets.delete(playerId);
    this.table.setConnected(playerId, false);
    this.removalTimers.set(
      playerId,
      setTimeout(() => this.remove(playerId), this.settings.rejoinGraceMs),
    );
    this.scheduleCloseIfEmpty();
  }

  remove(playerId: string): void {
    const timer = this.removalTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.removalTimers.delete(playerId);
    this.sockets.delete(playerId);
    const name = this.table.players.get(playerId)?.name;
    this.table.removePlayer(playerId);
    if (name) this.system(`${name} left the table`);
    this.scheduleCloseIfEmpty();
  }

  addChat(playerId: string | null, name: string, text: string): ChatMessage {
    const msg: ChatMessage = { id: ++this.chatId, playerId, name, text, time: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > 50) this.chat.shift();
    return msg;
  }

  /** System line in the chat ("Alex joined"); the server broadcasts it via onChatMessage. */
  system(text: string): void {
    this.onChatMessage?.(this.addChat(null, 'Table', text));
  }

  /** Set by the network layer: sends a chat line (system or bot) to everyone at the table. */
  onChatMessage?: (msg: ChatMessage) => void;

  private scheduleCloseIfEmpty(): void {
    if (this.table.connectedCount > 0 || this.closeTimer) return;
    this.closeTimer = setTimeout(() => {
      if (this.table.connectedCount === 0) this.close();
      else this.closeTimer = null;
    }, this.settings.emptyRoomTtlMs);
  }

  close(): void {
    for (const t of this.removalTimers.values()) clearTimeout(t);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.table.dispose();
    this.onClose(this);
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  constructor(
    private readonly settings: RoomSettings,
    private readonly onUpdate: (room: Room, events: AnyEvent[]) => void,
  ) {}

  create(solo: boolean, autoStart = false, game: GameKind = 'blackjack'): Room {
    let code: string;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, { solo: solo && game === 'blackjack', autoStart, game }, this.settings, this.onUpdate, (r) => this.rooms.delete(r.code));
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  closeAll(): void {
    for (const room of [...this.rooms.values()]) room.close();
  }
}

export function normalizeCode(code: unknown): string {
  return typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH) : '';
}

/** Trim, drop control characters, collapse spaces, max 20 characters. */
export function cleanName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name
    .replace(/[\p{C}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
}

export function cleanChat(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.replace(/[\p{C}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Allows `limit` hits per `windowMs`. */
export class RateLimiter {
  private hits: number[] = [];
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(now = Date.now()): boolean {
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }
}
