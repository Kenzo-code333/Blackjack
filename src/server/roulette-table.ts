// One European roulette table (play money).
//
//   waiting → betting (countdown) → "no more bets" → spinning → results → betting…
//
// Like the other tables it knows nothing about sockets: it calls `onUpdate` with events,
// and `publicState()` describes the table. The winning number is drawn with the
// cryptographic random generator the moment the ball is launched.

import { randomBytes } from 'node:crypto';
import { betReturn, cryptoRng, isValidSpot, spotLabel } from '../game/index.js';
import {
  type Look,
  ROULETTE_SEATS,
  type RouletteBet,
  type RouletteEvent,
  type RoulettePhase,
  type RoulettePlayer,
  type RouletteState,
  REFILL_LIMIT,
  REFILL_MESSAGE,
  cleanLook,
} from '../shared/protocol.js';
import { type BotPersonality, botLine, newBot, replyKind } from './bots.js';

export interface RouletteTiming {
  /** Betting time each round. */
  bettingMs: number;
  /** Once everyone pressed Spin: a short pause before the ball goes. */
  readyMs: number;
  /** "No more bets" before the wheel result is known. */
  noMoreMs: number;
  /** How long the ball spins. */
  spinMs: number;
  resultsMs: number;
  botMs: number;
}

export const DEFAULT_ROULETTE_TIMING: RouletteTiming = {
  bettingMs: 25_000,
  readyMs: 1_200,
  noMoreMs: 1_400,
  spinMs: 8_500,
  resultsMs: 6_000,
  botMs: 1_500,
};

export interface RouletteSeat {
  id: string;
  token: string;
  name: string;
  seat: number | null;
  look: Look;
  bot: BotPersonality | null;
  connected: boolean;
  joinedAt: number;
  balance: number;
  bets: Map<string, number>;
  lastBets: [string, number][];
  ready: boolean;
  won: number;
  staked: number;
}

export interface RouletteTableOptions {
  code: string;
  solo?: boolean;
  autoStart?: boolean;
  startingBalance?: number;
  timing?: Partial<RouletteTiming>;
  onUpdate?: (events: RouletteEvent[]) => void;
  onBotChat?: (playerId: string, text: string) => void;
  /** Fixed results for tests. */
  nextNumber?: () => number;
}

const newId = (bytes: number) => randomBytes(bytes).toString('base64url');
export const ROULETTE_LIMITS = { minBet: 5, maxSpot: 500, maxTotal: 2000 };

export class RouletteTable {
  readonly game = 'roulette' as const;
  readonly code: string;
  readonly solo: boolean;
  readonly autoStart: boolean;
  readonly players = new Map<string, RouletteSeat>();
  readonly timing: RouletteTiming;
  readonly startingBalance: number;
  hostId: string | null = null;
  phase: RoulettePhase = 'waiting';
  round = 0;
  deadline: number | null = null;
  timerMs: number | null = null;
  result: number | null = null;
  history: number[] = [];
  spin: { number: number; durationMs: number; endsAt: number } | null = null;
  running = false;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly botTimers = new Set<ReturnType<typeof setTimeout>>();
  private pending: RouletteEvent[] = [];
  private queued = false;
  private readonly onUpdate: (events: RouletteEvent[]) => void;
  private readonly onBotChat: (playerId: string, text: string) => void;
  private readonly nextNumber: () => number;

  constructor(o: RouletteTableOptions) {
    this.code = o.code;
    this.solo = o.solo ?? false;
    this.autoStart = o.autoStart ?? this.solo;
    this.startingBalance = o.startingBalance ?? 1000;
    this.timing = { ...DEFAULT_ROULETTE_TIMING, ...o.timing };
    this.onUpdate = o.onUpdate ?? (() => {});
    this.onBotChat = o.onBotChat ?? (() => {});
    this.nextNumber = o.nextNumber ?? (() => Math.floor(cryptoRng() * 37));
  }

  // ---------- Seats ----------

  get seated(): RouletteSeat[] {
    return [...this.players.values()].filter((p) => p.seat !== null).sort((a, b) => a.seat! - b.seat!);
  }

  get connectedCount(): number {
    return [...this.players.values()].filter((p) => p.connected && !p.bot).length;
  }

  /** People get the middle places along the layout first; bots take the ends. */
  private freeSeat(bot = false): number | null {
    const taken = new Set(this.seated.map((p) => p.seat));
    const order = bot ? [0, 5, 1, 4, 2, 3] : [2, 3, 1, 4, 0, 5];
    return order.find((s) => s < ROULETTE_SEATS && !taken.has(s)) ?? null;
  }

  addPlayer(name: string, look?: Look, bot: BotPersonality | null = null, chips?: number): RouletteSeat {
    const p: RouletteSeat = {
      id: newId(6),
      token: newId(18),
      name,
      seat: this.freeSeat(bot !== null),
      look: cleanLook(look),
      bot,
      connected: true,
      joinedAt: Date.now(),
      balance: chips ?? this.startingBalance,
      bets: new Map(),
      lastBets: [],
      ready: false,
      won: 0,
      staked: 0,
    };
    this.players.set(p.id, p);
    if (!this.hostId && !bot) this.hostId = p.id;
    this.changed();
    this.maybeStart();
    if (bot && this.phase === 'betting') this.botBets(p);
    return p;
  }

  addBot(byId: string | null): string | null {
    if (byId !== null && byId !== this.hostId) return 'Only the host can do that';
    if (this.solo) return 'This is a private solo table';
    if (this.freeSeat() === null) return 'Table is full';
    const bot = newBot(new Set([...this.players.values()].map((p) => p.name)));
    this.addPlayer(bot.name, bot.look, bot.personality);
    return null;
  }

  findByToken(token: string): RouletteSeat | undefined {
    for (const p of this.players.values()) if (p.token === token) return p;
    return undefined;
  }

  takeSeat(id: string): string | null {
    const p = this.players.get(id);
    if (!p) return 'Not at this table';
    if (p.seat !== null) return 'Already seated';
    const seat = this.freeSeat();
    if (seat === null) return 'Table is full';
    p.seat = seat;
    this.changed();
    this.maybeStart();
    return null;
  }

  setLook(id: string, look: Look): string | null {
    const p = this.players.get(id);
    if (!p) return 'Not at this table';
    p.look = cleanLook(look);
    this.changed();
    return null;
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    if (!connected && this.hostId === id) this.pickHost();
    this.changed();
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    // Bets already on the layout stay in play only while the ball is moving; otherwise they come back.
    this.players.delete(id);
    if (this.hostId === id) this.pickHost();
    this.changed();
    this.checkAllReady();
  }

  private pickHost(): void {
    const next = [...this.players.values()].filter((p) => !p.bot && p.connected && p.id !== this.hostId).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) this.hostId = next.id;
    else if (!this.hostId || !this.players.has(this.hostId)) this.hostId = [...this.players.values()].find((p) => !p.bot)?.id ?? null;
  }

  kick(byId: string, targetId: string): string | null {
    if (byId !== this.hostId) return 'Only the host can do that';
    if (byId === targetId) return "You can't kick yourself";
    if (!this.players.has(targetId)) return 'Player not found';
    this.removePlayer(targetId);
    return null;
  }

  resetChips(id: string): string | null {
    const p = this.players.get(id);
    if (!p) return 'Not at this table';
    if (this.phase === 'spinning') return 'Wait until the ball stops';
    if (p.balance + this.totalBets(p) > REFILL_LIMIT) return REFILL_MESSAGE;
    p.bets.clear();
    p.balance = this.startingBalance;
    this.changed();
    return null;
  }

  hostStart(byId: string): string | null {
    if (byId !== this.hostId) return 'Only the host can do that';
    if (this.phase === 'betting') {
      // Spin now.
      this.noMoreBets();
      return null;
    }
    if (this.phase !== 'waiting') return 'The wheel is already going';
    this.running = true;
    this.startBetting();
    return null;
  }

  chatHeard(id: string, text: string): void {
    const speaker = this.players.get(id);
    const kind = replyKind(text);
    const bots = this.seated.filter((p) => p.bot);
    if (!speaker || speaker.bot || !kind || !bots.length || Math.random() > 0.75) return;
    const bot = bots[Math.floor(Math.random() * bots.length)]!;
    this.botSay(bot, botLine(kind, speaker.name), 900 + Math.random() * 1200);
  }

  // ---------- Betting ----------

  private totalBets(p: RouletteSeat): number {
    let t = 0;
    for (const v of p.bets.values()) t += v;
    return t;
  }

  placeBet(id: string, spot: unknown, amount: unknown): string | null {
    const p = this.players.get(id);
    if (!p) return 'Not at this table';
    if (p.seat === null) return 'Take a seat to bet';
    if (this.phase !== 'betting' && this.phase !== 'waiting') return 'No more bets';
    if (!isValidSpot(spot)) return 'Unknown bet';
    const value = Number(amount);
    if (!Number.isInteger(value) || value < ROULETTE_LIMITS.minBet || value % 5 !== 0) return `Bets are in chips of ${ROULETTE_LIMITS.minBet}`;
    if (value > p.balance) return 'Not enough chips';
    const now = p.bets.get(spot) ?? 0;
    if (now + value > ROULETTE_LIMITS.maxSpot) return `At most ${ROULETTE_LIMITS.maxSpot} on one spot`;
    if (this.totalBets(p) + value > ROULETTE_LIMITS.maxTotal) return `At most ${ROULETTE_LIMITS.maxTotal} in all per spin`;
    p.bets.set(spot, now + value);
    p.balance -= value;
    p.ready = false;
    this.emit({ type: 'rbet', playerId: id, spot, amount: value });
    this.changed();
    // A solo table, or a table that is running, opens betting when the first chip goes down.
    if (this.phase === 'waiting' && (this.solo || this.autoStart || this.running)) {
      this.running = true;
      this.startBetting();
    }
    return null;
  }

  clearBets(id: string): string | null {
    const p = this.players.get(id);
    if (!p) return 'Not at this table';
    if (this.phase !== 'betting' && this.phase !== 'waiting') return 'No more bets';
    if (!p.bets.size) return null;
    p.balance += this.totalBets(p);
    p.bets.clear();
    p.ready = false;
    this.emit({ type: 'rclear', playerId: id });
    this.changed();
    return null;
  }

  /** Puts last round's bets down again. */
  rebet(id: string): string | null {
    const p = this.players.get(id);
    if (!p) return 'Not at this table';
    if (!p.lastBets.length) return 'No bets to repeat yet';
    const total = p.lastBets.reduce((s, [, v]) => s + v, 0);
    if (total > p.balance) return 'Not enough chips to repeat your bets';
    for (const [spot, v] of p.lastBets) {
      const err = this.placeBet(id, spot, v);
      if (err) return err;
    }
    return null;
  }

  /** "Spin": this player is done betting. When everyone is, the ball goes. */
  setReady(id: string): string | null {
    const p = this.players.get(id);
    if (!p) return 'Not at this table';
    if (this.phase === 'waiting') {
      if (!this.solo && !this.autoStart && !this.running) return id === this.hostId ? 'Press Start to open the betting' : 'Waiting for the host to start';
      this.running = true;
      this.startBetting();
    }
    if (this.phase !== 'betting') return 'The wheel is already spinning';
    if (!p.bets.size) return 'Place a bet first';
    p.ready = true;
    this.changed();
    this.checkAllReady();
    return null;
  }

  private checkAllReady(): void {
    if (this.phase !== 'betting') return;
    const humans = this.seated.filter((p) => !p.bot && p.connected);
    if (!humans.length) return;
    const bettors = humans.filter((p) => p.bets.size);
    if (bettors.length && humans.every((p) => p.ready || !p.bets.size) && bettors.every((p) => p.ready)) {
      this.schedule(this.timing.readyMs, () => this.noMoreBets());
      this.changed();
    }
  }

  // ---------- Rounds ----------

  private maybeStart(): void {
    if (this.phase !== 'waiting' || !(this.autoStart || this.solo)) return;
    if (this.seated.some((p) => !p.bot && p.connected)) {
      this.running = true;
      this.startBetting();
    }
  }

  private startBetting(): void {
    if (!this.seated.some((p) => !p.bot && p.connected)) {
      // Nobody left to play: stop and wait.
      this.running = false;
      this.phase = 'waiting';
      this.deadline = null;
      this.changed();
      return;
    }
    this.round++;
    this.phase = 'betting';
    this.result = null;
    this.spin = null;
    for (const p of this.players.values()) {
      p.ready = false;
      p.won = 0;
      p.staked = 0;
    }
    this.schedule(this.timing.bettingMs, () => this.noMoreBets());
    for (const b of this.seated.filter((p) => p.bot)) this.botBets(b);
    this.changed();
  }

  private noMoreBets(): void {
    if (this.phase !== 'betting') return;
    this.phase = 'spinning';
    this.emit({ type: 'nomore' });
    const number = this.nextNumber();
    this.schedule(this.timing.noMoreMs, () => {
      this.spin = { number, durationMs: this.timing.spinMs, endsAt: Date.now() + this.timing.spinMs };
      this.emit({ type: 'spin', number, durationMs: this.timing.spinMs });
      this.schedule(this.timing.spinMs, () => this.settle(number));
      this.changed();
    });
    this.changed();
  }

  private settle(number: number): void {
    this.phase = 'results';
    this.result = number;
    this.spin = null;
    this.history.unshift(number);
    if (this.history.length > 14) this.history.pop();
    const winners: { playerId: string; amount: number }[] = [];
    for (const p of this.players.values()) {
      if (!p.bets.size) continue;
      let back = 0;
      for (const [spot, v] of p.bets) back += betReturn(spot, v, number);
      p.staked = this.totalBets(p);
      p.won = back;
      p.balance += back;
      p.lastBets = [...p.bets.entries()];
      if (back > 0) winners.push({ playerId: p.id, amount: back });
    }
    this.emit({ type: 'result', number, winners });
    this.botReactions(number);
    this.schedule(this.timing.resultsMs, () => {
      // Winning bets are paid and losing chips swept away; the layout starts empty.
      for (const p of this.players.values()) {
        p.bets.clear();
        if (p.bot && p.balance < ROULETTE_LIMITS.minBet) p.balance = this.startingBalance;
      }
      this.emit({ type: 'clear' });
      if (this.running) this.startBetting();
      else {
        this.phase = 'waiting';
        this.deadline = null;
        this.changed();
      }
    });
    this.changed();
  }

  // ---------- Bots ----------

  private botBets(b: RouletteSeat): void {
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const t = setTimeout(
        () => {
          this.botTimers.delete(t);
          if (this.phase !== 'betting' || !this.players.has(b.id)) return;
          const r = Math.random();
          const spot =
            r < 0.45
              ? ['red', 'black', 'odd', 'even', 'low', 'high'][Math.floor(Math.random() * 6)]!
              : r < 0.65
                ? `${Math.random() < 0.5 ? 'dozen' : 'col'}:${1 + Math.floor(Math.random() * 3)}`
                : `n:${Math.floor(Math.random() * 37)}`;
          const chip = spot.startsWith('n:') ? 5 : [5, 10, 25, 25, 50][Math.floor(Math.random() * 5)]!;
          this.placeBet(b.id, spot, Math.min(chip, Math.floor(b.balance / 5) * 5));
        },
        this.timing.botMs * (0.5 + i * 0.8 + Math.random()),
      );
      this.botTimers.add(t);
    }
  }

  private botSay(bot: RouletteSeat, text: string, delay: number): void {
    const t = setTimeout(() => {
      this.botTimers.delete(t);
      if (this.players.has(bot.id)) this.onBotChat(bot.id, text);
    }, delay);
    this.botTimers.add(t);
  }

  private botReactions(number: number): void {
    const straight = [...this.players.values()].find((p) => p.bets.has(`n:${number}`));
    for (const p of this.seated.filter((x) => x.bot)) {
      if (p.won > 0 && Math.random() < p.bot!.chatty * 0.45) {
        this.botSay(p, p.bets.has(`n:${number}`) ? `${number}! Straight up! 🎉` : botLine('win'), 1200 + Math.random() * 1500);
        return;
      }
    }
    if (straight && !straight.bot) {
      const fan = this.seated.find((b) => b.bot);
      if (fan) this.botSay(fan, `Wow, ${straight.name} hit ${spotLabel(`n:${number}`)} straight up!`, 1400);
    }
  }

  // ---------- Timers & updates ----------

  private schedule(ms: number, fn: () => void): void {
    this.stopTimer();
    this.deadline = Date.now() + ms;
    this.timerMs = ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  private stopTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stopTimer();
    for (const t of this.botTimers) clearTimeout(t);
    this.botTimers.clear();
  }

  private emit(e: RouletteEvent): void {
    this.pending.push(e);
  }

  private changed(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      const events = this.pending;
      this.pending = [];
      this.onUpdate(events);
    });
  }

  publicState(_viewerId: string | null = null): RouletteState {
    return {
      game: 'roulette',
      code: this.code,
      solo: this.solo,
      phase: this.phase,
      round: this.round,
      deadline: this.phase === 'waiting' ? null : this.deadline,
      timerMs: this.timerMs,
      serverTime: Date.now(),
      hostId: this.hostId,
      players: [...this.players.values()]
        .sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99) || a.joinedAt - b.joinedAt)
        .map(
          (p): RoulettePlayer => ({
            id: p.id,
            name: p.name,
            seat: p.seat,
            bot: p.bot !== null,
            look: p.look,
            balance: p.balance,
            bets: [...p.bets.entries()].map(([spot, amount]): RouletteBet => ({ spot, amount })),
            ready: p.ready,
            connected: p.connected,
            isHost: p.id === this.hostId,
            won: p.won,
            staked: p.staked,
            canRebet: p.lastBets.length > 0,
          }),
        ),
      result: this.result,
      history: [...this.history],
      spin: this.spin ? { ...this.spin } : null,
      running: this.running,
      limits: { ...ROULETTE_LIMITS, startingBalance: this.startingBalance },
    };
  }
}
