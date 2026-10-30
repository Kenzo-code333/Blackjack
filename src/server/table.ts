// One blackjack table: seats, bets and the round state machine.
//
//   waiting → betting → dealing → (insurance) → playing → dealer → results → betting…
//
// This class knows nothing about sockets. It calls `onUpdate` whenever something
// changed; the room layer turns that into network messages. Every method that a
// player can trigger returns an error string, or null if the move was accepted.

import { randomBytes } from 'node:crypto';
import {
  type Action,
  type Card,
  type PlayerHand,
  type Rules,
  type Settlement,
  DEFAULT_RULES,
  Shoe,
  dealerShouldHit,
  dealerShouldPeek,
  describeHand,
  double,
  evaluateHand,
  hit,
  insuranceCost,
  insuranceOffered,
  isBlackjack,
  isHandDone,
  legalActions,
  newHand,
  settleHand,
  settleInsurance,
  split,
  stand,
} from '../game/index.js';
import { MAX_SEATS, type Phase, type PublicPlayer, type PublicState, type TableEvent } from '../shared/protocol.js';

export interface TableTiming {
  /** Betting countdown. null = no countdown, wait for "Deal" (used for solo tables). */
  bettingMs: number | null;
  insuranceMs: number;
  turnMs: number;
  /** How long to wait before auto-standing for a disconnected player. */
  disconnectedTurnMs: number;
  resultsMs: number;
  /** Time per card, so the server waits while clients animate the deal. */
  cardMs: number;
  revealMs: number;
}

export const DEFAULT_TIMING: TableTiming = {
  bettingMs: 15_000,
  insuranceMs: 10_000,
  turnMs: 20_000,
  disconnectedTurnMs: 1_500,
  resultsMs: 5_000,
  cardMs: 450,
  revealMs: 800,
};

export interface Player {
  id: string;
  /** Secret, only ever sent to the player themselves. Used to rejoin after a disconnect. */
  token: string;
  name: string;
  seat: number | null;
  balance: number;
  bet: number;
  hands: PlayerHand[];
  results: (Settlement | null)[];
  insurance: number | null;
  insurancePayout: number | null;
  inRound: boolean;
  ready: boolean;
  connected: boolean;
  joinedAt: number;
}

export interface TableOptions {
  code: string;
  solo?: boolean;
  rules?: Rules;
  timing?: Partial<TableTiming>;
  shoe?: Shoe;
  onUpdate?: (events: TableEvent[]) => void;
}

const newId = (bytes: number) => randomBytes(bytes).toString('base64url');

export class Table {
  readonly code: string;
  readonly solo: boolean;
  readonly rules: Rules;
  readonly timing: TableTiming;
  readonly shoe: Shoe;
  readonly players = new Map<string, Player>();
  phase: Phase = 'waiting';
  round = 0;
  hostId: string | null = null;
  deadline: number | null = null;
  timerMs: number | null = null;
  dealer: Card[] = [];
  dealerRevealed = false;
  turn: { playerId: string; handIndex: number } | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingEvents: TableEvent[] = [];
  private updateQueued = false;
  private readonly onUpdate: (events: TableEvent[]) => void;

  constructor(options: TableOptions) {
    this.code = options.code;
    this.solo = options.solo ?? false;
    this.rules = options.rules ?? DEFAULT_RULES;
    this.timing = { ...DEFAULT_TIMING, ...(this.solo ? { bettingMs: null } : {}), ...options.timing };
    this.shoe = options.shoe ?? new Shoe({ decks: this.rules.decks, penetration: this.rules.penetration });
    this.onUpdate = options.onUpdate ?? (() => {});
  }

  get maxSeats(): number {
    return this.solo ? 1 : MAX_SEATS;
  }

  // ---------- Players ----------

  addPlayer(name: string): Player {
    const player: Player = {
      id: newId(6),
      token: newId(18),
      name,
      seat: this.freeSeat(),
      balance: this.rules.startingBalance,
      bet: 0,
      hands: [],
      results: [],
      insurance: null,
      insurancePayout: null,
      inRound: false,
      ready: false,
      connected: true,
      joinedAt: Date.now(),
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    // Solo tables start betting straight away.
    if (this.solo && this.phase === 'waiting') this.startBetting();
    this.changed();
    return player;
  }

  findByToken(token: string): Player | undefined {
    for (const p of this.players.values()) if (p.token === token) return p;
    return undefined;
  }

  get seated(): Player[] {
    return [...this.players.values()].filter((p) => p.seat !== null).sort((a, b) => a.seat! - b.seat!);
  }

  /** Players with hands this round, in seat order (= turn order). */
  get participants(): Player[] {
    return this.seated.filter((p) => p.inRound);
  }

  get connectedCount(): number {
    return [...this.players.values()].filter((p) => p.connected).length;
  }

  private freeSeat(): number | null {
    const taken = new Set(this.seated.map((p) => p.seat));
    for (let s = 0; s < this.maxSeats; s++) if (!taken.has(s)) return s;
    return null;
  }

  takeSeat(playerId: string): string | null {
    const p = this.players.get(playerId);
    if (!p) return 'Not at this table';
    if (p.seat !== null) return 'Already seated';
    const seat = this.freeSeat();
    if (seat === null) return 'Table is full';
    p.seat = seat;
    this.changed();
    return null;
  }

  setConnected(playerId: string, connected: boolean): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = connected;
    if (connected) {
      // Back in time for their turn: give them a fresh timer.
      if (this.turn?.playerId === playerId) this.startTurnTimer(p);
    } else {
      if (this.turn?.playerId === playerId) this.startTurnTimer(p);
      if (this.phase === 'insurance' && p.inRound && p.insurance === null) this.decideInsurance(p, false);
      if (this.hostId === playerId) this.pickNewHost();
    }
    this.changed();
  }

  removePlayer(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    // Bets on the table during betting go back to the player (they're leaving anyway);
    // hands already in play are forfeited.
    this.players.delete(playerId);
    if (this.hostId === playerId) this.pickNewHost();
    if (this.turn?.playerId === playerId) this.advanceTurn();
    if (this.phase === 'insurance') this.maybeFinishInsurance();
    if (this.phase === 'betting') this.maybeEndBettingEarly();
    if (this.players.size === 0) this.stopTimer();
    this.changed();
  }

  private pickNewHost(): void {
    const candidates = [...this.players.values()]
      .filter((p) => p.connected && p.id !== this.hostId)
      .sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99) || a.joinedAt - b.joinedAt);
    // Keep the current host if nobody else is connected (they may come back).
    if (candidates[0]) this.hostId = candidates[0].id;
    else if (!this.hostId || !this.players.has(this.hostId)) this.hostId = [...this.players.keys()][0] ?? null;
  }

  kick(byId: string, targetId: string): string | null {
    if (byId !== this.hostId) return 'Only the host can do that';
    if (byId === targetId) return "You can't kick yourself";
    if (!this.players.has(targetId)) return 'Player not found';
    this.removePlayer(targetId);
    return null;
  }

  resetChips(playerId: string): string | null {
    const p = this.players.get(playerId);
    if (!p) return 'Not at this table';
    if (p.inRound && this.phase !== 'results') return 'Wait until the round is over';
    p.balance = this.rules.startingBalance;
    p.bet = 0;
    p.ready = false;
    this.changed();
    return null;
  }

  // ---------- Betting ----------

  /** Host action: start the betting round from "waiting", or deal now if betting is open. */
  hostStart(byId: string): string | null {
    if (byId !== this.hostId) return 'Only the host can do that';
    if (this.phase === 'waiting') {
      this.startBetting();
      return null;
    }
    if (this.phase === 'betting') {
      if (!this.seated.some((p) => p.bet > 0)) return 'Nobody has placed a bet yet';
      this.endBetting();
      return null;
    }
    return 'A round is already in progress';
  }

  addBet(playerId: string, amount: number): string | null {
    const p = this.players.get(playerId);
    if (!p || p.seat === null) return 'Take a seat to bet';
    if (this.phase !== 'betting') return 'Betting is closed';
    if (!Number.isInteger(amount) || amount <= 0) return 'Invalid amount';
    if (p.bet + amount > this.rules.maxBet) return `Maximum bet is ${this.rules.maxBet}`;
    if (amount > p.balance) return 'Not enough chips';
    p.balance -= amount;
    p.bet += amount;
    p.ready = false;
    this.emit({ type: 'bet', playerId, amount });
    this.changed();
    return null;
  }

  clearBet(playerId: string): string | null {
    const p = this.players.get(playerId);
    if (!p) return 'Not at this table';
    if (this.phase !== 'betting') return 'Betting is closed';
    p.balance += p.bet;
    p.bet = 0;
    p.ready = false;
    this.changed();
    return null;
  }

  /** "Deal" button: this player is happy with their bet. */
  setReady(playerId: string): string | null {
    const p = this.players.get(playerId);
    if (!p || p.seat === null) return 'Take a seat to bet';
    if (this.phase !== 'betting') return 'Betting is closed';
    if (p.bet < this.rules.minBet) return `Minimum bet is ${this.rules.minBet}`;
    p.ready = true;
    this.changed();
    this.maybeEndBettingEarly();
    return null;
  }

  private startBetting(): void {
    if (this.shoe.cutCardReached) {
      this.shoe.shuffle();
      this.emit({ type: 'shuffle' });
    }
    this.phase = 'betting';
    this.round++;
    this.dealer = [];
    this.dealerRevealed = false;
    this.turn = null;
    for (const p of this.players.values()) {
      p.hands = [];
      p.results = [];
      p.insurance = null;
      p.insurancePayout = null;
      p.inRound = false;
      p.ready = false;
    }
    if (this.timing.bettingMs === null) {
      this.deadline = null;
      this.stopTimer();
    } else {
      this.schedule(this.timing.bettingMs, () => this.endBetting());
    }
    this.changed();
  }

  /** Deal early once every connected seated player has pressed "Deal". */
  private maybeEndBettingEarly(): void {
    if (this.phase !== 'betting') return;
    const active = this.seated.filter((p) => p.connected);
    if (active.length > 0 && active.every((p) => p.ready)) this.endBetting();
  }

  private endBetting(): void {
    for (const p of this.seated) {
      if (p.bet > 0 && p.bet < this.rules.minBet) {
        p.balance += p.bet;
        p.bet = 0;
      }
      p.inRound = p.bet > 0;
    }
    if (this.participants.length === 0) {
      // Nobody bet. Solo tables keep waiting for a bet; others go idle until the host restarts.
      if (this.solo) this.startBetting();
      else this.goIdle();
      return;
    }
    this.deal();
  }

  private goIdle(): void {
    this.phase = 'waiting';
    this.deadline = null;
    this.stopTimer();
    this.changed();
  }

  // ---------- Dealing ----------

  private draw(): Card {
    return this.shoe.draw();
  }

  private deal(): void {
    this.phase = 'dealing';
    this.deadline = null;
    const players = this.participants;
    for (const p of players) {
      p.hands = [newHand(p.bet)];
      p.results = [null];
    }
    // Real order: one card to each player, dealer up card, second card each, dealer hole card.
    for (let pass = 0; pass < 2; pass++) {
      for (const p of players) {
        const card = this.draw();
        p.hands[0]!.cards.push(card);
        this.emit({ type: 'deal', to: p.id, handIndex: 0, card });
      }
      const card = this.draw();
      this.dealer.push(card);
      // The hole card goes out face down: the event carries no card.
      this.emit({ type: 'deal', to: 'dealer', handIndex: 0, card: pass === 0 ? card : null });
    }
    const cards = players.length * 2 + 2;
    this.schedule(cards * this.timing.cardMs, () => this.afterDeal());
    this.changed();
  }

  private afterDeal(): void {
    const up = this.dealer[0]!;
    if (insuranceOffered(up)) {
      this.phase = 'insurance';
      for (const p of this.participants) {
        const canAfford = p.balance >= insuranceCost(p.hands[0]!);
        p.insurance = canAfford && p.connected ? null : 0;
      }
      this.schedule(this.timing.insuranceMs, () => {
        for (const p of this.participants) if (p.insurance === null) p.insurance = 0;
        this.peek();
      });
      this.changed();
      this.maybeFinishInsurance();
      return;
    }
    this.peek();
  }

  // ---------- Insurance & peek ----------

  takeInsurance(playerId: string, take: boolean): string | null {
    const p = this.players.get(playerId);
    if (!p || !p.inRound) return 'You are not in this round';
    if (this.phase !== 'insurance') return 'Insurance is not on offer';
    if (p.insurance !== null) return 'Already decided';
    this.decideInsurance(p, take);
    return null;
  }

  private decideInsurance(p: Player, take: boolean): void {
    const cost = insuranceCost(p.hands[0]!);
    if (take && p.balance >= cost) {
      p.balance -= cost;
      p.insurance = cost;
    } else {
      p.insurance = 0;
    }
    this.changed();
    this.maybeFinishInsurance();
  }

  private maybeFinishInsurance(): void {
    if (this.phase !== 'insurance') return;
    if (this.participants.every((p) => p.insurance !== null)) this.peek();
  }

  private peek(): void {
    this.stopTimer();
    const up = this.dealer[0]!;
    if (dealerShouldPeek(up)) {
      const blackjack = isBlackjack(this.dealer);
      this.emit({ type: 'peek', blackjack });
      if (blackjack) {
        this.phase = 'dealer';
        this.reveal();
        this.schedule(this.timing.revealMs, () => this.settle());
        this.changed();
        return;
      }
    }
    this.phase = 'playing';
    this.advanceTurn();
  }

  // ---------- Player turns ----------

  act(playerId: string, action: Action): string | null {
    if (this.phase !== 'playing' || !this.turn) return 'Not your turn';
    if (this.turn.playerId !== playerId) return 'Not your turn';
    const p = this.players.get(playerId)!;
    const index = this.turn.handIndex;
    const hand = p.hands[index]!;
    const ctx = { hand, handCount: p.hands.length, balance: p.balance, rules: this.rules };
    if (!legalActions(ctx).includes(action)) return `You can't ${action} now`;

    switch (action) {
      case 'hit': {
        const card = this.draw();
        hit(hand, card);
        this.emit({ type: 'deal', to: p.id, handIndex: index, card });
        break;
      }
      case 'stand':
        stand(hand);
        break;
      case 'double': {
        p.balance -= hand.bet;
        const card = this.draw();
        double(hand, card);
        this.emit({ type: 'double', playerId: p.id, handIndex: index });
        this.emit({ type: 'deal', to: p.id, handIndex: index, card });
        break;
      }
      case 'split': {
        p.balance -= hand.bet;
        const [a, b] = split(hand);
        p.hands.splice(index, 1, a, b);
        p.results.splice(index, 1, null, null);
        this.emit({ type: 'split', playerId: p.id, handIndex: index });
        break;
      }
    }
    if (isHandDone(p.hands[index]!, this.rules) || action === 'split') this.advanceTurn();
    else this.startTurnTimer(p);
    this.changed();
    return null;
  }

  /** Moves to the first hand that still needs a decision, dealing second cards to split hands on the way. */
  private advanceTurn(): void {
    for (const p of this.participants) {
      for (let i = 0; i < p.hands.length; i++) {
        const hand = p.hands[i]!;
        if (hand.cards.length === 1) {
          const card = this.draw();
          hit(hand, card);
          this.emit({ type: 'deal', to: p.id, handIndex: i, card });
        }
        if (!isHandDone(hand, this.rules)) {
          this.turn = { playerId: p.id, handIndex: i };
          this.startTurnTimer(p);
          this.changed();
          return;
        }
      }
    }
    this.turn = null;
    this.dealerTurn();
  }

  private startTurnTimer(p: Player): void {
    const ms = p.connected ? this.timing.turnMs : this.timing.disconnectedTurnMs;
    this.schedule(ms, () => {
      // Time's up: auto-stand.
      if (this.turn?.playerId !== p.id) return;
      const hand = p.hands[this.turn.handIndex];
      if (hand) stand(hand);
      this.advanceTurn();
      this.changed();
    });
  }

  // ---------- Dealer ----------

  private reveal(): void {
    if (this.dealerRevealed) return;
    this.dealerRevealed = true;
    this.emit({ type: 'reveal', card: this.dealer[1]! });
  }

  private dealerTurn(): void {
    this.phase = 'dealer';
    this.deadline = null;
    this.reveal();
    this.changed();
    // The dealer only draws if some hand is still live and isn't a natural blackjack.
    const live = this.participants.some((p) =>
      p.hands.some((h) => !evaluateHand(h.cards).bust && !isBlackjack(h.cards, h.fromSplit)),
    );
    const step = () => {
      if (!live || !dealerShouldHit(this.dealer, this.rules)) {
        this.schedule(this.timing.cardMs, () => this.settle());
        return;
      }
      const card = this.draw();
      this.dealer.push(card);
      this.emit({ type: 'deal', to: 'dealer', handIndex: 0, card });
      this.changed();
      this.schedule(this.timing.cardMs, step);
    };
    this.schedule(this.timing.revealMs, step);
  }

  // ---------- Settlement ----------

  private settle(): void {
    this.reveal();
    for (const p of this.participants) {
      p.results = p.hands.map((h) => settleHand(h, this.dealer, this.rules));
      for (const r of p.results) p.balance += r!.payout;
      if (p.insurance) {
        p.insurancePayout = settleInsurance(p.insurance, this.dealer);
        p.balance += p.insurancePayout;
      }
      p.bet = 0;
    }
    this.phase = 'results';
    this.turn = null;
    this.emit({ type: 'settle' });
    this.schedule(this.timing.resultsMs, () => this.endRound());
    this.changed();
  }

  private endRound(): void {
    this.emit({ type: 'clear' });
    for (const p of this.players.values()) {
      p.hands = [];
      p.results = [];
      p.inRound = false;
    }
    this.dealer = [];
    if (this.seated.some((p) => p.connected)) this.startBetting();
    else this.goIdle();
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

  /** Stop all timers (used when the room closes). */
  dispose(): void {
    this.stopTimer();
  }

  private emit(event: TableEvent): void {
    this.pendingEvents.push(event);
  }

  /** Batches changes: listeners get one update per tick, with the events that happened. */
  private changed(): void {
    if (this.updateQueued) return;
    this.updateQueued = true;
    queueMicrotask(() => {
      this.updateQueued = false;
      const events = this.pendingEvents;
      this.pendingEvents = [];
      this.onUpdate(events);
    });
  }

  // ---------- What clients are allowed to see ----------

  publicState(): PublicState {
    const turnPlayer = this.turn ? this.players.get(this.turn.playerId) : undefined;
    const turnHand = turnPlayer && this.turn ? turnPlayer.hands[this.turn.handIndex] : undefined;
    const visibleDealer = this.dealerRevealed ? this.dealer : this.dealer.slice(0, 1);
    return {
      code: this.code,
      solo: this.solo,
      phase: this.phase,
      round: this.round,
      deadline: this.deadline,
      timerMs: this.timerMs,
      serverTime: Date.now(),
      hostId: this.hostId,
      dealer: {
        // The hole card is replaced by null until revealed. It never leaves the server early.
        cards: this.dealer.map((card, i) => (i === 1 && !this.dealerRevealed ? null : card)),
        label: describeHand(visibleDealer),
        revealed: this.dealerRevealed,
      },
      shoe: { remaining: this.shoe.remaining, size: this.shoe.size, cutCardReached: this.shoe.cutCardReached },
      players: [...this.players.values()]
        .sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99) || a.joinedAt - b.joinedAt)
        .map((p): PublicPlayer => ({
          id: p.id,
          name: p.name,
          seat: p.seat,
          balance: p.balance,
          bet: p.bet,
          ready: p.ready,
          connected: p.connected,
          isHost: p.id === this.hostId,
          inRound: p.inRound,
          insurance: p.insurance,
          insurancePayout: p.insurancePayout,
          hands: p.hands.map((h, i) => ({
            cards: [...h.cards],
            bet: h.bet,
            doubled: h.doubled,
            fromSplit: h.fromSplit,
            label: describeHand(h.cards, h.fromSplit),
            done: isHandDone(h, this.rules),
            outcome: p.results[i]?.outcome ?? null,
            payout: p.results[i]?.payout ?? null,
          })),
        })),
      turn:
        this.turn && turnPlayer && turnHand
          ? {
              ...this.turn,
              actions: legalActions({
                hand: turnHand,
                handCount: turnPlayer.hands.length,
                balance: turnPlayer.balance,
                rules: this.rules,
              }),
            }
          : null,
      limits: { minBet: this.rules.minBet, maxBet: this.rules.maxBet, startingBalance: this.rules.startingBalance },
    };
  }
}
