// One Texas Hold'em table (no-limit, play money).
//
//   waiting → preflop → flop → turn → river → showdown → results → next hand…
//
// Like the blackjack table, it knows nothing about sockets: it calls `onUpdate` with
// events, and `publicState(viewer)` gives each player only what they may see (their
// own hole cards; everyone's at the showdown).

import { randomBytes } from 'node:crypto';
import {
  type Card,
  type PokerHand,
  bestHand,
  buildPots,
  compareHands,
  cryptoRng,
  makeDeck,
  pokerValue,
  preflopStrength,
  shuffle,
} from '../game/index.js';
import {
  type Look,
  POKER_SEATS,
  type PokerAction,
  type PokerEvent,
  type PokerPhase,
  type PokerPlayer,
  type PokerState,
  cleanLook,
} from '../shared/protocol.js';
import { type BotPersonality, botLine, newBot, replyKind } from './bots.js';

export interface PokerTiming {
  turnMs: number;
  disconnectedTurnMs: number;
  cardMs: number;
  streetMs: number;
  resultsMs: number;
  botMs: number;
}

export const DEFAULT_POKER_TIMING: PokerTiming = {
  turnMs: 25_000,
  disconnectedTurnMs: 2_000,
  cardMs: 220,
  streetMs: 900,
  resultsMs: 5_500,
  botMs: 1_300,
};

export interface PokerSeat {
  id: string;
  token: string;
  name: string;
  seat: number | null;
  look: Look;
  bot: BotPersonality | null;
  connected: boolean;
  joinedAt: number;
  balance: number;
  hole: Card[];
  bet: number;
  total: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  lastAction: string | null;
  handName: string | null;
  won: number;
  showCards: boolean;
}

export interface PokerTableOptions {
  code: string;
  blinds?: { small: number; big: number };
  startingStack?: number;
  timing?: Partial<PokerTiming>;
  /** Start dealing as soon as two players are seated (tables made with bots). */
  autoStart?: boolean;
  onUpdate?: (events: PokerEvent[]) => void;
  onBotChat?: (playerId: string, text: string) => void;
  /** Fixed deck order for tests (first card dealt first). */
  deck?: () => Card[];
}

const newId = (bytes: number) => randomBytes(bytes).toString('base64url');

export class PokerTable {
  readonly game = 'poker' as const;
  readonly solo = false as const;
  readonly code: string;
  readonly players = new Map<string, PokerSeat>();
  readonly blinds: { small: number; big: number };
  readonly startingStack: number;
  readonly timing: PokerTiming;
  readonly autoStart: boolean;
  hostId: string | null = null;
  phase: PokerPhase = 'waiting';
  round = 0;
  board: Card[] = [];
  deadline: number | null = null;
  timerMs: number | null = null;
  buttonSeat: number | null = null;
  sbSeat: number | null = null;
  bbSeat: number | null = null;
  currentBet = 0;
  minRaise = 0;
  turn: string | null = null;
  winners: { playerId: string; amount: number; handName: string | null }[] = [];
  running = false;

  private deck: Card[] = [];
  private readonly makeDeck: () => Card[];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly botTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending: PokerEvent[] = [];
  private queued = false;
  private readonly onUpdate: (events: PokerEvent[]) => void;
  private readonly onBotChat: (playerId: string, text: string) => void;

  constructor(o: PokerTableOptions) {
    this.code = o.code;
    this.blinds = o.blinds ?? { small: 5, big: 10 };
    this.startingStack = o.startingStack ?? 1000;
    this.timing = { ...DEFAULT_POKER_TIMING, ...o.timing };
    this.autoStart = o.autoStart ?? false;
    this.onUpdate = o.onUpdate ?? (() => {});
    this.onBotChat = o.onBotChat ?? (() => {});
    this.makeDeck = o.deck ?? (() => shuffle(makeDeck(), cryptoRng));
  }

  // ---------- Seats ----------

  get seated(): PokerSeat[] {
    return [...this.players.values()].filter((p) => p.seat !== null).sort((a, b) => a.seat! - b.seat!);
  }

  get connectedCount(): number {
    return [...this.players.values()].filter((p) => p.connected && !p.bot).length;
  }

  /**
   * People get the seats facing the dealer first (seat 2 is straight across); bots fill
   * in from the dealer's sides. Turn order still follows the seat numbers.
   */
  private freeSeat(bot = false): number | null {
    const taken = new Set(this.seated.map((p) => p.seat));
    const order = bot ? [0, 5, 1, 4, 3, 2] : [2, 3, 1, 4, 0, 5];
    return order.find((s) => s < POKER_SEATS && !taken.has(s)) ?? null;
  }

  addPlayer(name: string, look?: Look, bot: BotPersonality | null = null): PokerSeat {
    const p: PokerSeat = {
      id: newId(6),
      token: newId(18),
      name,
      seat: this.freeSeat(bot !== null),
      look: cleanLook(look),
      bot,
      connected: true,
      joinedAt: Date.now(),
      balance: this.startingStack,
      hole: [],
      bet: 0,
      total: 0,
      inHand: false,
      folded: false,
      allIn: false,
      acted: false,
      lastAction: null,
      handName: null,
      won: 0,
      showCards: false,
    };
    this.players.set(p.id, p);
    if (!this.hostId && !bot) this.hostId = p.id;
    this.changed();
    this.maybeStart();
    return p;
  }

  addBot(byId: string | null): string | null {
    if (byId !== null && byId !== this.hostId) return 'Only the host can do that';
    if (this.freeSeat() === null) return 'Table is full';
    const bot = newBot(new Set([...this.players.values()].map((p) => p.name)));
    this.addPlayer(bot.name, bot.look, bot.personality);
    return null;
  }

  findByToken(token: string): PokerSeat | undefined {
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
    if (this.turn === id) this.startTurnTimer(p);
    if (!connected && this.hostId === id) this.pickHost();
    this.changed();
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    if (p.inHand && !p.folded && this.isBetting()) {
      p.folded = true;
      if (this.turn === id) this.turn = null;
    }
    this.players.delete(id);
    if (this.hostId === id) this.pickHost();
    if (this.isBetting() && (this.turn === null || this.turn === id)) this.advance();
    this.changed();
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
    if (p.inHand && this.isBetting()) return 'Wait until this hand is over';
    p.balance = this.startingStack;
    this.changed();
    this.maybeStart();
    return null;
  }

  hostStart(byId: string): string | null {
    if (byId !== this.hostId) return 'Only the host can do that';
    if (this.running) return 'The game is already running';
    if (this.eligible().length < 2) return 'You need at least two players with chips. Add a bot or invite a friend.';
    this.running = true;
    this.startHand();
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

  // ---------- Hands ----------

  private isBetting(): boolean {
    return this.phase === 'preflop' || this.phase === 'flop' || this.phase === 'turn' || this.phase === 'river';
  }

  /** Players who can be dealt in: seated, with chips, and either a bot or connected. */
  private eligible(): PokerSeat[] {
    return this.seated.filter((p) => p.balance > 0 && (p.bot || p.connected));
  }

  private maybeStart(): void {
    if (this.phase !== 'waiting' || !this.autoStart) return;
    if (this.eligible().length >= 2 && this.seated.some((p) => !p.bot && p.connected)) {
      this.running = true;
      this.schedule(600, () => this.startHand());
    }
  }

  /** Next seat after `from` among `list` (wrapping around). */
  private nextAfter(from: number | null, list: PokerSeat[]): PokerSeat | undefined {
    if (!list.length) return undefined;
    const sorted = [...list].sort((a, b) => a.seat! - b.seat!);
    if (from === null) return sorted[0];
    return sorted.find((p) => p.seat! > from) ?? sorted[0];
  }

  private startHand(): void {
    const players = this.eligible();
    if (players.length < 2 || !this.seated.some((p) => !p.bot && p.connected)) {
      this.phase = 'waiting';
      this.running = false;
      this.deadline = null;
      this.changed();
      return;
    }
    this.round++;
    this.board = [];
    this.winners = [];
    this.deck = this.makeDeck();
    this.emit({ type: 'shuffle' });
    for (const p of this.players.values()) {
      Object.assign(p, { hole: [], bet: 0, total: 0, inHand: false, folded: false, allIn: false, acted: false, lastAction: null, handName: null, won: 0, showCards: false });
    }
    for (const p of players) p.inHand = true;

    const button = this.nextAfter(this.buttonSeat, players)!;
    this.buttonSeat = button.seat;
    const headsUp = players.length === 2;
    const sb = headsUp ? button : this.nextAfter(button.seat, players)!;
    const bb = this.nextAfter(sb.seat, players)!;
    this.sbSeat = sb.seat;
    this.bbSeat = bb.seat;
    this.put(sb, Math.min(this.blinds.small, sb.balance));
    this.put(bb, Math.min(this.blinds.big, bb.balance));
    sb.lastAction = `Small blind ${sb.bet}`;
    bb.lastAction = `Big blind ${bb.bet}`;
    this.emit({ type: 'blinds', small: sb.id, big: bb.id });
    this.currentBet = this.blinds.big;
    this.minRaise = this.blinds.big;

    // Two cards each, one at a time, starting left of the button.
    const order: PokerSeat[] = [];
    let at = button.seat;
    for (let i = 0; i < players.length; i++) {
      const p = this.nextAfter(at, players)!;
      order.push(p);
      at = p.seat;
    }
    for (let r = 0; r < 2; r++) {
      for (const p of order) {
        const card = this.deck.pop()!;
        p.hole.push(card);
        this.emit({ type: 'hole', to: p.id, card });
      }
    }
    this.phase = 'preflop';
    this.turn = null;
    const first = headsUp ? sb : this.nextAfter(bb.seat, players)!;
    this.schedule(players.length * 2 * this.timing.cardMs + 300, () => this.nextTurn(first, true));
    this.changed();
  }

  private put(p: PokerSeat, amount: number): void {
    const a = Math.min(amount, p.balance);
    p.balance -= a;
    p.bet += a;
    p.total += a;
    if (p.balance === 0) p.allIn = true;
  }

  private live(): PokerSeat[] {
    return this.seated.filter((p) => p.inHand && !p.folded);
  }

  private needsAction(p: PokerSeat): boolean {
    return p.inHand && !p.folded && !p.allIn && (!p.acted || p.bet < this.currentBet);
  }

  /** Gives the turn to `from` (if `inclusive`) or the next player after it who still has to act. */
  private nextTurn(from: PokerSeat, inclusive = false): void {
    const candidates = this.seated.filter((p) => this.needsAction(p));
    if (!candidates.length) return this.endStreet();
    const next = inclusive && this.needsAction(from) ? from : this.nextAfter(from.seat, candidates)!;
    this.turn = next.id;
    this.startTurnTimer(next);
    this.changed();
  }

  private startTurnTimer(p: PokerSeat): void {
    const ms = p.connected || p.bot ? this.timing.turnMs : this.timing.disconnectedTurnMs;
    this.schedule(ms, () => {
      if (this.turn !== p.id) return;
      // Time's up: check if you can, otherwise fold.
      this.act(p.id, p.bet === this.currentBet ? 'check' : 'fold');
    });
  }

  /** What the player whose turn it is may do. */
  turnInfo(p: PokerSeat) {
    const toCall = Math.max(0, this.currentBet - p.bet);
    const maxRaiseTo = p.bet + p.balance;
    const minRaiseTo = Math.min(maxRaiseTo, this.currentBet + this.minRaise);
    return { toCall: Math.min(toCall, p.balance), canCheck: toCall === 0, minRaiseTo, maxRaiseTo, canRaise: maxRaiseTo > this.currentBet };
  }

  act(id: string, action: PokerAction, amount = 0): string | null {
    if (!this.isBetting() || this.turn !== id) return 'Not your turn';
    const p = this.players.get(id);
    if (!p) return 'Not at this table';
    const info = this.turnInfo(p);
    let label: string;
    let shown = 0;
    switch (action) {
      case 'fold':
        p.folded = true;
        label = 'Fold';
        break;
      case 'check':
        if (!info.canCheck) return `You need to call ${info.toCall} or fold`;
        label = 'Check';
        break;
      case 'call': {
        if (info.canCheck) return 'Nothing to call: check instead';
        const before = p.bet;
        this.put(p, info.toCall);
        shown = p.bet - before;
        label = p.allIn ? 'All in' : `Call ${shown}`;
        break;
      }
      case 'allin':
      case 'raise': {
        const to = action === 'allin' ? info.maxRaiseTo : Math.floor(Number(amount));
        if (!info.canRaise && action === 'raise') return 'You can only call or fold';
        if (!Number.isFinite(to) || to <= this.currentBet) {
          if (action === 'allin') {
            // All in for less than (or equal to) a call.
            this.put(p, p.balance);
            label = 'All in';
            shown = p.bet;
            break;
          }
          return `Raise to at least ${info.minRaiseTo}`;
        }
        if (to > info.maxRaiseTo) return `You only have ${info.maxRaiseTo} in total`;
        if (to < info.minRaiseTo && to < info.maxRaiseTo) return `Raise to at least ${info.minRaiseTo}`;
        const raiseBy = to - this.currentBet;
        const wasBet = this.currentBet === 0;
        this.put(p, to - p.bet);
        if (raiseBy >= this.minRaise) this.minRaise = raiseBy;
        this.currentBet = to;
        // Everyone else gets to answer the raise.
        for (const o of this.seated) if (o !== p && !o.folded && !o.allIn) o.acted = false;
        label = p.allIn ? 'All in' : wasBet ? `Bet ${to}` : `Raise to ${to}`;
        shown = to;
        break;
      }
      default:
        return 'Unknown action';
    }
    p.acted = true;
    p.lastAction = label;
    this.emit({ type: 'pact', playerId: id, action, amount: shown });
    this.turn = null;
    this.stopTimer();
    this.advance(p);
    this.changed();
    return null;
  }

  private advance(after?: PokerSeat): void {
    const live = this.live();
    if (live.length === 1) {
      this.winAlone(live[0]!);
      return;
    }
    if (!live.length) return this.endHand();
    const someoneMustAct = this.seated.some((p) => this.needsAction(p));
    if (!someoneMustAct) return this.endStreet();
    const from = after ?? this.seated.find((p) => p.seat === this.buttonSeat) ?? this.seated[0]!;
    this.nextTurn(from);
  }

  private endStreet(): void {
    this.turn = null;
    for (const p of this.seated) {
      p.bet = 0;
      p.acted = false;
    }
    this.currentBet = 0;
    this.minRaise = this.blinds.big;
    this.emit({ type: 'collect' });
    if (this.phase === 'river') {
      this.changed();
      this.schedule(this.timing.streetMs, () => this.showdown());
      return;
    }
    const next = this.phase === 'preflop' ? 'flop' : this.phase === 'flop' ? 'turn' : 'river';
    this.changed();
    this.schedule(this.timing.streetMs, () => {
      this.deck.pop(); // burn a card, like a real dealer
      const count = next === 'flop' ? 3 : 1;
      const cards = Array.from({ length: count }, () => this.deck.pop()!);
      this.board.push(...cards);
      this.phase = next;
      for (const p of this.seated) if (p.inHand && !p.folded && !p.allIn) p.lastAction = null;
      this.emit({ type: 'board', cards, street: next });
      const canAct = this.live().filter((p) => !p.allIn);
      if (canAct.length <= 1) {
        // Everyone's all in: deal the rest of the board without betting.
        this.changed();
        this.schedule(this.timing.streetMs + count * this.timing.cardMs, () => this.endStreet());
        return;
      }
      const button = this.seated.find((p) => p.seat === this.buttonSeat) ?? this.seated[0]!;
      this.changed();
      this.schedule(count * this.timing.cardMs + 250, () => this.nextTurn(button));
    });
  }

  private winAlone(p: PokerSeat): void {
    this.turn = null;
    const amount = [...this.players.values()].reduce((s, o) => s + o.total, 0);
    p.balance += amount;
    p.won = amount;
    this.winners = [{ playerId: p.id, amount, handName: null }];
    for (const o of this.seated) o.bet = 0;
    this.emit({ type: 'collect' });
    this.emit({ type: 'win', playerId: p.id, amount });
    this.phase = 'results';
    this.botReactions();
    this.schedule(this.timing.resultsMs, () => this.endHand());
    this.changed();
  }

  private showdown(): void {
    this.phase = 'showdown';
    const live = this.live();
    const hands = new Map<string, PokerHand>();
    for (const p of live) {
      const h = bestHand([...p.hole, ...this.board]);
      hands.set(p.id, h);
      p.handName = h.name;
      p.showCards = true;
    }
    this.emit({ type: 'showdown' });
    const pots = buildPots([...this.players.values()].filter((p) => p.total > 0).map((p) => ({ id: p.id, total: p.total, folded: p.folded })));
    const winnings = new Map<string, number>();
    for (const pot of pots) {
      const eligible = pot.eligible.filter((id) => hands.has(id));
      let best: string[] = [];
      for (const id of eligible) {
        if (!best.length) best = [id];
        else {
          const c = compareHands(hands.get(id)!, hands.get(best[0]!)!);
          if (c > 0) best = [id];
          else if (c === 0) best.push(id);
        }
      }
      if (!best.length) continue;
      // Split ties; an odd chip goes to the first winner left of the button.
      const order = best
        .map((id) => this.players.get(id)!)
        .sort((a, b) => ((a.seat! - this.buttonSeat! + POKER_SEATS) % POKER_SEATS) - ((b.seat! - this.buttonSeat! + POKER_SEATS) % POKER_SEATS));
      const share = Math.floor(pot.amount / best.length);
      let rest = pot.amount - share * best.length;
      for (const w of order) {
        const amt = share + (rest > 0 ? 1 : 0);
        if (rest > 0) rest--;
        winnings.set(w.id, (winnings.get(w.id) ?? 0) + amt);
      }
    }
    this.winners = [];
    for (const [id, amount] of winnings) {
      const p = this.players.get(id);
      if (!p) continue;
      p.balance += amount;
      p.won = amount;
      this.winners.push({ playerId: id, amount, handName: p.handName });
      this.emit({ type: 'win', playerId: id, amount });
    }
    this.schedule(600, () => {
      this.phase = 'results';
      this.botReactions();
      this.schedule(this.timing.resultsMs, () => this.endHand());
      this.changed();
    });
    this.changed();
  }

  private endHand(): void {
    this.emit({ type: 'clear' });
    this.turn = null;
    for (const p of this.players.values()) {
      Object.assign(p, { hole: [], bet: 0, total: 0, inHand: false, folded: false, allIn: false, acted: false, showCards: false });
      // Bots who run out of chips buy back in.
      if (p.bot && p.balance === 0) p.balance = this.startingStack;
    }
    this.board = [];
    this.phase = 'waiting';
    this.deadline = null;
    this.changed();
    if (this.running) this.schedule(400, () => this.startHand());
  }

  // ---------- Bots ----------

  private botLater(key: string, ms: number, fn: () => void): void {
    if (this.botTimers.has(key)) return;
    this.botTimers.set(
      key,
      setTimeout(() => {
        this.botTimers.delete(key);
        fn();
      }, ms),
    );
  }

  private driveBots(): void {
    const p = this.turn ? this.players.get(this.turn) : undefined;
    if (!p?.bot || !this.isBetting()) return;
    const key = `${p.id}:${this.round}:${this.phase}:${this.currentBet}:${p.bet}`;
    this.botLater(key, this.timing.botMs * (0.6 + Math.random() * 0.9), () => {
      if (this.turn !== p.id) return;
      const { action, amount } = this.botDecision(p);
      if (this.act(p.id, action, amount)) this.act(p.id, this.turnInfo(p).canCheck ? 'check' : 'fold');
    });
  }

  /** A simple, believable strategy: hand strength against the price of calling, with some bluffs. */
  private botDecision(p: PokerSeat): { action: PokerAction; amount?: number } {
    const info = this.turnInfo(p);
    const pot = [...this.players.values()].reduce((s, o) => s + o.total, 0);
    const odds = info.toCall / Math.max(1, pot + info.toCall);
    const style = p.bot!.betShare * 10; // 0.2 … 0.8: higher = more aggressive
    let strength: number;
    if (!this.board.length) strength = preflopStrength(p.hole);
    else {
      const made = bestHand([...p.hole, ...this.board]);
      strength = [0.12, 0.42, 0.62, 0.74, 0.8, 0.84, 0.9, 0.96, 0.99][made.category]!;
      // A pair that uses a hole card is worth more than one on the board.
      if (made.category === 1 && !p.hole.some((c) => made.values[0] === pokerValue(c))) strength = 0.2;
      if (made.category <= 1) strength += this.drawBonus(p);
    }
    strength += (Math.random() - 0.5) * 0.15;
    const raiseTo = (mult: number) => Math.min(info.maxRaiseTo, Math.max(info.minRaiseTo, Math.round((this.currentBet + pot * mult) / 5) * 5));
    if (strength > 0.82 && info.maxRaiseTo > this.currentBet && Math.random() < 0.6 + style * 0.3) return { action: 'raise', amount: raiseTo(0.75) };
    if (strength > 0.6 && info.maxRaiseTo > this.currentBet && info.canCheck && Math.random() < 0.35 + style * 0.4) return { action: 'raise', amount: raiseTo(0.5) };
    if (info.canCheck) {
      if (Math.random() < 0.07 * style && info.maxRaiseTo > this.currentBet) return { action: 'raise', amount: raiseTo(0.5) }; // a bluff
      return { action: 'check' };
    }
    if (strength > odds + 0.18 || (strength > 0.45 && info.toCall <= this.blinds.big * 2)) return { action: 'call' };
    return { action: 'fold' };
  }

  /** Flush and straight draws make a weak hand worth continuing with. */
  private drawBonus(p: PokerSeat): number {
    if (this.board.length >= 5) return 0;
    const cards = [...p.hole, ...this.board];
    const suits = new Map<string, number>();
    for (const c of cards) suits.set(c.suit, (suits.get(c.suit) ?? 0) + 1);
    let bonus = [...suits.values()].some((n) => n === 4) ? 0.2 : 0;
    const vals = [...new Set(cards.map(pokerValue))].sort((a, b) => a - b);
    for (let i = 0; i + 3 < vals.length; i++) if (vals[i + 3]! - vals[i]! === 3) bonus = Math.max(bonus, 0.16);
    return bonus;
  }

  private botSay(bot: PokerSeat, text: string, delay: number): void {
    setTimeout(() => {
      if (this.players.has(bot.id)) this.onBotChat(bot.id, text);
    }, delay);
  }

  private botReactions(): void {
    let delay = 900;
    for (const w of this.winners) {
      const p = this.players.get(w.playerId);
      if (!p) continue;
      if (p.bot && Math.random() < p.bot.chatty * 0.5) this.botSay(p, botLine('win'), (delay += 700));
      else if (!p.bot) {
        const fan = this.seated.filter((b) => b.bot)[0];
        if (fan && Math.random() < 0.4) this.botSay(fan, `Nice pot, ${p.name}.`, (delay += 900));
      }
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
    for (const t of this.botTimers.values()) clearTimeout(t);
    this.botTimers.clear();
  }

  private emit(e: PokerEvent): void {
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
      this.driveBots();
    });
  }

  /** Hole cards in events are hidden from everyone but their owner. */
  eventsFor(events: PokerEvent[], viewerId: string | null): PokerEvent[] {
    return events.map((e) => (e.type === 'hole' && e.to !== viewerId ? { ...e, card: null } : e));
  }

  // ---------- What each viewer may see ----------

  publicState(viewerId: string | null = null): PokerState {
    const turnPlayer = this.turn ? this.players.get(this.turn) : undefined;
    const info = turnPlayer ? this.turnInfo(turnPlayer) : null;
    return {
      game: 'poker',
      code: this.code,
      solo: false,
      phase: this.phase,
      round: this.round,
      deadline: this.turn || this.phase === 'results' ? this.deadline : null,
      timerMs: this.timerMs,
      serverTime: Date.now(),
      hostId: this.hostId,
      board: [...this.board],
      pot: [...this.players.values()].reduce((s, p) => s + p.total, 0),
      blinds: { ...this.blinds },
      buttonSeat: this.buttonSeat,
      smallBlindSeat: this.sbSeat,
      bigBlindSeat: this.bbSeat,
      currentBet: this.currentBet,
      players: [...this.players.values()]
        .sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99) || a.joinedAt - b.joinedAt)
        .map(
          (p): PokerPlayer => ({
            id: p.id,
            name: p.name,
            seat: p.seat,
            bot: p.bot !== null,
            look: p.look,
            balance: p.balance,
            bet: p.bet,
            total: p.total,
            inHand: p.inHand,
            folded: p.folded,
            allIn: p.allIn,
            connected: p.connected,
            isHost: p.id === this.hostId,
            lastAction: p.lastAction,
            hole: p.id === viewerId || p.showCards ? [...p.hole] : null,
            holeCount: p.hole.length,
            handName: p.showCards ? p.handName : null,
            won: p.won,
          }),
        ),
      turn:
        turnPlayer && info
          ? { playerId: turnPlayer.id, toCall: info.toCall, canCheck: info.canCheck, minRaiseTo: info.minRaiseTo, maxRaiseTo: info.maxRaiseTo }
          : null,
      running: this.running,
      winners: [...this.winners],
      limits: { startingBalance: this.startingStack },
    };
  }
}
