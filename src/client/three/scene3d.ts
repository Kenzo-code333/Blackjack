// The first-person 3D table.
//
// How it stays in sync: every server update carries the new state plus the events
// that led to it. Events are played as animations, one after another. After each
// batch the scene "reconciles": it snaps every card and chip to exactly what the
// state says, so the picture can never drift from the real game (and joining in
// the middle of a round just works).

import * as THREE from 'three';
import type { PublicPlayer, PublicState, TableEvent } from '../../shared/protocol.js';
import type { Sound } from '../audio.js';
import { OUTCOME_TEXT, money } from '../format.js';
import type { TableRenderer } from '../renderer.js';
import { Avatar } from './avatar.js';
import { Dealer } from './dealer.js';
import { Celebrations } from './effects.js';
import { type Environment, buildEnvironment, buildLimitsSign } from './environment.js';
import {
  CENTER,
  CHIP_H,
  DEALER_POS,
  DISCARD_POS,
  EYE_Y,
  RACK_POS,
  R_EYES,
  SHOE_MOUTH,
  TABLE_Y,
  betPos,
  dealerCardPos,
  handAnchor,
  insurancePos,
  jitter,
  onArc,
  playerCardPos,
  seatAngle,
  stackPos,
  towardDealer,
  winPos,
} from './layout.js';
import { CardObject, ChipStack, breakdown, makeChip, playerStacks, setChipDetail } from './pieces.js';
import { LabelSprite, setMaxAnisotropy } from './textures.js';
import { Animator, damp, ease, lerp } from './tween.js';

export interface Table3DOptions {
  sound: Sound;
  low: boolean;
  /** The player clicked one of their own chip stacks in 3D. */
  onChipClick: (value: number) => void;
  /** Frame rate was too low and graphics were lowered automatically. */
  onAutoLow?: () => void;
  /** A hand just reached 21 or a blackjack (for the on-screen celebration). */
  onMoment?: (kind: 'blackjack' | 'twentyone', mine: boolean, name: string) => void;
}

/** Everything drawn for one player's seat. */
interface SeatView {
  playerId: string;
  angle: number;
  avatar: Avatar | null;
  hands: CardObject[][];
  labels: LabelSprite[];
  stacks: Map<string, ChipStack>;
}

const SHOE_YAW = -0.45;

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export class Table3D implements TableRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.05, 60);
  private readonly anim = new Animator();
  private readonly dealer: Dealer;
  private readonly env: Environment;
  private readonly seats = new Map<string, SeatView>();
  private readonly dealerCards: CardObject[] = [];
  private readonly dealerLabel = new LabelSprite(320, 80, 0.04);
  private readonly dealerBubble = new LabelSprite(640, 96, 0.07);
  private dealerBubbleUntil = 0;
  private celebrations!: Celebrations;
  private readonly celebrated = new Set<string>();
  private readonly turnRing: THREE.Mesh;
  private readonly betGlow: THREE.Mesh;
  private readonly resizeObserver: ResizeObserver;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private me: string | null = null;
  private state: PublicState | null = null;
  private pendingDouble: { playerId: string; handIndex: number } | null = null;
  private frame = 0;
  private lastTime = performance.now();
  private disposed = false;
  private low: boolean;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Camera look-around.
  private yaw = 0;
  private pitch = 0;
  private yawTarget = 0;
  private pitchTarget = 0;
  private hoverX = 0;
  private hoverY = 0;
  private drag: { x: number; y: number; moved: number } | null = null;
  private readonly eye = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly eyeTarget = new THREE.Vector3();
  private readonly lookTargetV = new THREE.Vector3();
  private cameraPlaced = false;
  private lastDrag = -100;
  private lastTurnKey = '';
  private turnGlance: string | null = null;
  private chatGlance: { playerId: string; until: number } | null = null;
  private clock = 0;

  // Frame-rate watch for automatic low graphics.
  private fpsFrames = 0;
  private fpsTime = 0;
  private slowWindows = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: Table3DOptions,
  ) {
    this.low = opts.low;
    setChipDetail(this.low);
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.low, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x080605);
    this.scene.fog = new THREE.FogExp2(0x080605, 0.085);

    this.env = buildEnvironment();
    this.scene.add(this.env.group);

    this.dealer = new Dealer(this.anim);
    this.scene.add(this.dealer.group, this.dealer.limbs);

    this.dealerLabel.position.set(0, TABLE_Y + 0.02, CENTER.z + 0.42);
    this.dealerBubble.position.set(0, 1.74, DEALER_POS.z + 0.1);
    this.dealerBubble.visible = false;
    this.scene.add(this.dealerBubble);
    this.celebrations = new Celebrations(this.scene);
    this.scene.add(buildLimitsSign());
    this.scene.add(this.dealerLabel);

    this.turnRing = new THREE.Mesh(
      new THREE.RingGeometry(0.085, 0.095, 48),
      new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.turnRing.rotation.x = -Math.PI / 2;
    this.turnRing.visible = false;
    this.scene.add(this.turnRing);

    this.betGlow = new THREE.Mesh(
      new THREE.RingGeometry(0.068, 0.078, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd77a, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.betGlow.rotation.x = -Math.PI / 2;
    this.betGlow.visible = false;
    this.scene.add(this.betGlow);

    this.applyQuality();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('dblclick', this.recenter);
    el.addEventListener('webglcontextlost', (e) => e.preventDefault());

    this.frame = requestAnimationFrame(this.loop);
  }

  // ---------- TableRenderer ----------

  update(state: PublicState, events: TableEvent[], me: string | null): void {
    this.me = me;
    this.pending++;
    this.queue = this.queue
      .then(() => this.play(state, events))
      .catch((err) => console.error('animation error', err))
      .finally(() => this.pending--);
  }

  setLowGraphics(low: boolean): void {
    this.low = low;
    this.applyQuality();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- Playing events ----------

  private async play(state: PublicState, events: TableEvent[]): Promise<void> {
    if (this.disposed) return;
    const prev = this.state;
    this.state = state;
    this.syncSeats(state);
    for (const event of events) {
      if (this.disposed) return;
      await this.animate(event, state, prev);
    }
    this.reconcile(state, events.length > 0);
    this.reactToState(state, prev);
    this.checkMoments(state);
  }

  /** Celebrate a hand that just reached 21 or a blackjack (once per hand). */
  private checkMoments(state: PublicState): void {
    for (const p of state.players) {
      const view = this.seats.get(p.id);
      if (!view) continue;
      p.hands.forEach((hand, i) => {
        const kind = hand.label === 'Blackjack' ? 'blackjack' : hand.label === '21' ? 'twentyone' : null;
        const key = `${state.round}:${p.id}:${i}`;
        if (!kind || this.celebrated.has(key)) return;
        this.celebrated.add(key);
        const mine = p.id === this.me;
        const at = playerCardPos(view.angle, i, p.hands.length, Math.max(0, hand.cards.length - 1));
        this.celebrations.burst(at, kind === 'blackjack', this.low || !mine);
        if (kind === 'blackjack') {
          this.dealerSays('Blackjack!', mine);
          if (!mine) this.opts.sound.play('applause', { pan: this.panFor(at), gain: 0.6 });
        }
        if (mine) this.opts.sound.play(kind, { pan: this.panFor(at) });
        this.opts.onMoment?.(kind, mine, p.name);
      });
    }
    if (this.celebrated.size > 200) this.celebrated.clear();
  }

  /** Stereo position (−1 left … 1 right) of a point, as heard from your seat. */
  private panFor(pos: THREE.Vector3): number {
    const v = pos.clone().applyMatrix4(this.camera.matrixWorldInverse);
    return THREE.MathUtils.clamp((v.x / Math.max(0.3, -v.z)) * 0.8, -0.9, 0.9);
  }

  /** The dealer's callout: a speech bubble, and the voice for the important ones. */
  private dealerSays(text: string, voice = true): void {
    this.dealerBubble.set({ text, bg: 'rgba(250, 246, 236, 0.95)', color: '#1d1a16' });
    this.dealerBubble.visible = true;
    this.dealerBubbleUntil = this.clock + 3.2;
    if (voice) this.opts.sound.speak(text);
  }

  private viewOf(playerId: string): SeatView | undefined {
    return this.seats.get(playerId);
  }

  private async animate(event: TableEvent, state: PublicState, prev: PublicState | null): Promise<void> {
    const sound = this.opts.sound;
    switch (event.type) {
      case 'shuffle':
        this.dealerSays('Shuffling up.');
        sound.play('shuffle', { delay: 0.2 });
        await this.dealer.shuffle();
        this.env.setDiscardHeight(0);
        this.env.setShoeFill(1);
        break;

      case 'burn': {
        // The first card after a shuffle goes face down into the discard tray.
        const obj = new CardObject(null);
        await this.dealCard(obj, DISCARD_POS.clone().setY(TABLE_Y + 0.03), 0, false);
        await this.anim.wait(0.1);
        obj.mesh.removeFromParent();
        break;
      }

      case 'act': {
        const view = this.viewOf(event.playerId);
        const at = view ? handAnchor(view.angle, event.handIndex, Math.max(1, (view.hands.length || 1))) : null;
        view?.avatar?.signal(event.action);
        if (event.action === 'hit' && at) sound.play('tap', { pan: this.panFor(at), delay: view?.avatar ? 0.12 : 0, gain: view?.avatar ? 0.7 : 1 });
        if (view?.avatar) await this.anim.wait(event.action === 'stand' ? 0.35 : 0.5);
        break;
      }

      case 'deal': {
        if (event.to === 'dealer') {
          const k = this.dealerCards.length;
          const obj = new CardObject(event.card);
          this.dealerCards.push(obj);
          // Spread the existing dealer cards to make room.
          this.dealerCards.slice(0, k).forEach((c, i) => this.moveTo(c, dealerCardPos(i, k + 1), 0, 0.2));
          await this.dealCard(obj, dealerCardPos(k, k + 1), jitter(k, 0.03), event.card !== null);
        } else {
          const seat = this.viewOf(event.to);
          if (!seat) return;
          while (seat.hands.length <= event.handIndex) seat.hands.push([]);
          const hand = seat.hands[event.handIndex]!;
          const k = hand.length;
          const obj = new CardObject(event.card);
          hand.push(obj);
          const doubled = this.pendingDouble?.playerId === event.to && this.pendingDouble.handIndex === event.handIndex;
          if (doubled) this.pendingDouble = null;
          const yaw = seat.angle + (doubled ? Math.PI / 2 : 0) + jitter(k + event.handIndex * 7, 0.06);
          await this.dealCard(obj, playerCardPos(seat.angle, event.handIndex, seat.hands.length, k), yaw, true);
        }
        break;
      }

      case 'peek': {
        const hole = this.dealerCards[1];
        if (!hole) return;
        const at = hole.mesh.position.clone().add(new THREE.Vector3(0, 0.02, 0.04));
        await this.dealer.reach('right', at, 0.25);
        await this.anim.tween(0.25, (k) => (hole.mesh.rotation.x = -0.35 * k));
        await this.anim.wait(0.15);
        await this.anim.tween(0.2, (k) => (hole.mesh.rotation.x = -0.35 * (1 - k)));
        void this.dealer.rest('right');
        break;
      }

      case 'reveal': {
        const hole = this.dealerCards[1];
        if (!hole) return;
        hole.setCard(event.card);
        const base = hole.mesh.position.clone();
        this.dealer.lookAt(base);
        await this.dealer.reach('right', base.clone().add(new THREE.Vector3(0, 0.03, 0.03)), 0.22);
        sound.play('flip', { pan: this.panFor(base) });
        await this.anim.tween(
          0.32,
          (k) => {
            hole.mesh.rotation.z = Math.PI * (1 - k);
            hole.mesh.position.y = base.y + Math.sin(Math.PI * k) * 0.05;
            this.dealer.follow('right', hole.mesh.position.clone().add(new THREE.Vector3(0, 0.03, 0.03)));
          },
          ease.inOutSine,
        );
        void this.dealer.rest('right');
        break;
      }

      case 'split': {
        const seat = this.viewOf(event.playerId);
        const hand = seat?.hands[event.handIndex];
        if (!seat || !hand || hand.length < 2) return;
        seat.hands.splice(event.handIndex, 1, [hand[0]!], [hand[1]!]);
        sound.play('chips');
        await Promise.all(
          seat.hands.flatMap((h, i) =>
            h.map((c, k) => this.moveTo(c, playerCardPos(seat.angle, i, seat.hands.length, k), seat.angle + jitter(k + i * 7, 0.06), 0.3)),
          ),
        );
        break;
      }

      case 'double':
        this.pendingDouble = { playerId: event.playerId, handIndex: event.handIndex };
        sound.play('chips', { pan: this.panFor(betPos(this.viewOf(event.playerId)?.angle ?? 0, 0, 1)) });
        break;

      case 'bet': {
        const seat = this.viewOf(event.playerId);
        if (!seat) return;
        const target = betPos(seat.angle, 0, 1);
        const circle = seat.stacks.get('bet0');
        const baseHeight = circle?.group.visible ? circle.group.children.length * CHIP_H : 0;
        const chips = breakdown(event.amount);
        await Promise.all(
          chips.map((value, i) => {
            const from = this.chipSource(seat, value);
            const to = target.clone().setY(TABLE_Y + baseHeight + (chips.length - 1 - i) * CHIP_H + CHIP_H / 2);
            return this.anim.wait(i * 0.05).then(() => this.flyChip(value, from, to, 0.32, true));
          }),
        );
        break;
      }

      case 'settle':
        // Show results on the hand labels right away; chips follow.
        for (const p of state.players) {
          const view = this.seats.get(p.id);
          if (view && p.hands.length === view.labels.length) this.updateLabels(view, p);
        }
        await this.animateSettle(state, prev);
        break;

      case 'clear':
        await this.animateClear();
        break;
    }
  }

  /** Dealer takes a card from the shoe and slides it to `target`. */
  private async dealCard(obj: CardObject, target: THREE.Vector3, yaw: number, faceUp: boolean): Promise<void> {
    const mesh = obj.mesh;
    mesh.position.copy(SHOE_MOUTH);
    mesh.rotation.set(0, SHOE_YAW, Math.PI);
    mesh.visible = false;
    this.scene.add(mesh);
    await this.dealer.reach('left', SHOE_MOUTH.clone().add(new THREE.Vector3(0, 0.03, 0.02)), 0.12);
    mesh.visible = true;
    this.opts.sound.play('card', { pan: this.panFor(target) });
    this.dealer.lookAt(target);
    const from = SHOE_MOUTH.clone();
    const handOffset = new THREE.Vector3(0, 0.025, -0.02);
    await this.anim.tween(
      0.36,
      (k) => {
        mesh.position.lerpVectors(from, target, k);
        mesh.position.y += Math.sin(Math.PI * k) * 0.06;
        mesh.rotation.y = lerp(SHOE_YAW, yaw, k);
        if (faceUp) mesh.rotation.z = Math.PI * (1 - ease.inOutSine(THREE.MathUtils.clamp((k - 0.2) / 0.6, 0, 1)));
        if (k < 0.6) this.dealer.follow('left', mesh.position.clone().add(handOffset));
      },
      ease.outCubic,
    );
    void this.dealer.rest('left', 0.35);
  }

  private moveTo(obj: CardObject, to: THREE.Vector3, yaw: number, duration: number): Promise<void> {
    const mesh = obj.mesh;
    const from = mesh.position.clone();
    const fromYaw = mesh.rotation.y;
    if (from.distanceTo(to) < 0.001 && Math.abs(fromYaw - yaw) < 0.001) return Promise.resolve();
    return this.anim.tween(duration, (k) => {
      mesh.position.lerpVectors(from, to, k);
      mesh.rotation.y = lerp(fromYaw, yaw, k);
    });
  }

  /** A single chip flying along an arc. It's removed at the end; reconcile shows the real stacks. */
  private async flyChip(value: number, from: THREE.Vector3, to: THREE.Vector3, duration: number, click = false): Promise<void> {
    const chip = makeChip(value);
    chip.position.copy(from);
    this.scene.add(chip);
    await this.anim.tween(
      duration,
      (k) => {
        chip.position.lerpVectors(from, to, k);
        chip.position.y += Math.sin(Math.PI * k) * 0.07;
        chip.rotation.x = Math.sin(Math.PI * k) * 0.4;
      },
      ease.inOutSine,
    );
    if (click) this.opts.sound.play('chip', { pan: this.panFor(to) });
    chip.removeFromParent();
  }

  private chipSource(seat: SeatView, value: number): THREE.Vector3 {
    const stack = seat.stacks.get(`bal${value}`);
    if (stack?.group.visible) return stack.topWorld();
    return onArc(seat.angle, 1.12, TABLE_Y + 0.03);
  }

  private async animateSettle(state: PublicState, _prev: PublicState | null): Promise<void> {
    const sound = this.opts.sound;
    const players = state.players.filter((p) => p.inRound && this.seats.has(p.id));
    // Settle from third base (the dealer's right) to first base, like a real dealer.
    players.sort((a, b) => (b.seat ?? 0) - (a.seat ?? 0));
    const rackTop = RACK_POS.clone().setY(TABLE_Y + 0.05);
    for (const p of players) {
      const seat = this.seats.get(p.id)!;
      const n = p.hands.length;
      for (let i = 0; i < n; i++) {
        const hand = p.hands[i]!;
        const bet = betPos(seat.angle, i, n);
        if (hand.outcome === 'lose' || hand.outcome === 'bust') {
          // Dealer takes the bet.
          const stack = seat.stacks.get(`bet${i}`);
          this.dealer.lookAt(bet);
          void this.dealer.reach('right', bet.clone().setY(TABLE_Y + 0.04), 0.2);
          if (stack) stack.group.visible = false;
          sound.play('chipSlide', { pan: this.panFor(bet) });
          await Promise.all(breakdown(hand.bet).slice(0, 6).map((v, j) => this.flyChip(v, bet.clone().setY(TABLE_Y + j * CHIP_H), rackTop, 0.35)));
          if (stack) stack.amount = -1;
        } else if (hand.outcome === 'win' || hand.outcome === 'blackjack') {
          // Dealer pays from the rack.
          const win = (hand.payout ?? 0) - hand.bet;
          const to = winPos(seat.angle, i, n);
          this.dealer.lookAt(to);
          void this.dealer.reach('right', to.clone().setY(TABLE_Y + 0.05), 0.22);
          sound.play('chips', { pan: this.panFor(to) });
          await Promise.all(
            breakdown(win)
              .slice(0, 8)
              .map((v, j) => this.anim.wait(j * 0.04).then(() => this.flyChip(v, rackTop, to.clone().setY(TABLE_Y + j * CHIP_H + CHIP_H / 2), 0.35))),
          );
          const winStack = this.stack(seat, `win${i}`);
          winStack.group.position.copy(to);
          winStack.group.userData.amount = win;
          winStack.set(win);
          winStack.group.visible = true;
        }
      }
    }
    void this.dealer.rest('right');
    const mine = state.players.find((p) => p.id === this.me);
    if (mine?.inRound) {
      const net = mine.hands.reduce((s, h) => s + (h.payout ?? 0) - h.bet, 0);
      if (net > 0) sound.play('win');
      else if (net < 0) sound.play('lose');
    }
  }

  private async animateClear(): Promise<void> {
    const cards = [...this.dealerCards, ...[...this.seats.values()].flatMap((s) => s.hands.flat())];
    this.dealer.lookAt(DISCARD_POS);
    void this.dealer.reach('right', DISCARD_POS.clone().add(new THREE.Vector3(0.1, 0.06, 0.1)), 0.3);
    const flights = cards.map((c, i) => {
      const from = c.mesh.position.clone();
      const fromYaw = c.mesh.rotation.y;
      const fromZ = c.mesh.rotation.z;
      const to = DISCARD_POS.clone().setY(TABLE_Y + 0.05);
      return this.anim.wait(i * 0.035).then(() => {
        if (i % 3 === 0) this.opts.sound.play('card');
        return this.anim.tween(0.38, (k) => {
          c.mesh.position.lerpVectors(from, to, k);
          c.mesh.position.y += Math.sin(Math.PI * k) * 0.05;
          c.mesh.rotation.y = lerp(fromYaw, 0, k);
          c.mesh.rotation.z = lerp(fromZ, Math.PI, k);
        });
      });
    });
    // Chips left on the table go back to their owners.
    const chipFlights: Promise<void>[] = [];
    for (const seat of this.seats.values()) {
      for (const [key, stack] of seat.stacks) {
        if (!/^(bet|win|ins)/.test(key) || !stack.group.visible || stack.amount <= 0) continue;
        const from = stack.group.position.clone();
        const to = onArc(seat.angle, 1.1, TABLE_Y);
        stack.group.visible = false;
        stack.amount = -1;
        chipFlights.push(...breakdown(Number(stack.group.userData.amount ?? 0)).slice(0, 4).map((v) => this.flyChip(v, from, to, 0.4)));
      }
    }
    await Promise.all([...flights, ...chipFlights]);
    for (const c of cards) c.mesh.removeFromParent();
    this.dealerCards.length = 0;
    for (const seat of this.seats.values()) seat.hands = [];
    void this.dealer.rest('right');
  }

  // ---------- Reconcile: make the scene match the state exactly ----------

  private visualSeat(state: PublicState, p: PublicPlayer): number {
    return state.solo ? 2 : p.seat!;
  }

  private syncSeats(state: PublicState): void {
    const present = new Set<string>();
    for (const p of state.players) {
      if (p.seat === null) continue;
      present.add(p.id);
      const angle = seatAngle(this.visualSeat(state, p));
      let view = this.seats.get(p.id);
      if (view && view.angle !== angle) {
        this.removeSeat(view);
        view = undefined;
      }
      if (!view) {
        view = { playerId: p.id, angle, avatar: null, hands: [], labels: [], stacks: new Map() };
        this.seats.set(p.id, view);
      }
      const isMe = p.id === this.me;
      if (!isMe && !view.avatar) {
        view.avatar = new Avatar(angle, p.look);
        this.scene.add(view.avatar.group);
      } else if (isMe && view.avatar) {
        view.avatar.dispose();
        view.avatar = null;
      }
    }
    for (const view of [...this.seats.values()]) if (!present.has(view.playerId)) this.removeSeat(view);
  }

  private removeSeat(view: SeatView): void {
    view.avatar?.dispose();
    for (const c of view.hands.flat()) c.mesh.removeFromParent();
    for (const l of view.labels) l.removeFromParent();
    for (const s of view.stacks.values()) s.group.removeFromParent();
    this.seats.delete(view.playerId);
  }

  private stack(view: SeatView, key: string): ChipStack {
    let s = view.stacks.get(key);
    if (!s) {
      s = new ChipStack(key.startsWith('bal') ? 24 : 12);
      if (key.startsWith('bal')) s.group.userData.chipValue = Number(key.slice(3));
      view.stacks.set(key, s);
      this.scene.add(s.group);
    }
    return s;
  }

  private setStack(view: SeatView, key: string, amount: number, pos: THREE.Vector3, chips?: number[]): void {
    const s = this.stack(view, key);
    s.group.position.copy(pos);
    s.group.userData.amount = amount;
    if (amount <= 0) {
      s.group.visible = false;
      s.amount = 0;
      return;
    }
    s.group.visible = true;
    s.set(amount, chips);
  }

  private reconcile(state: PublicState, animated: boolean): void {
    const results = state.phase === 'results';
    for (const p of state.players) {
      const view = this.seats.get(p.id);
      if (!view) continue;
      const a = view.angle;
      const n = p.hands.length;

      // Cards.
      p.hands.forEach((hand, i) => {
        view.hands[i] ??= [];
        const objs = view.hands[i]!;
        hand.cards.forEach((card, k) => {
          let obj = objs[k];
          if (!obj) {
            obj = new CardObject(card);
            objs[k] = obj;
          }
          obj.setCard(card);
          const yaw = a + (hand.doubled && k === 2 ? Math.PI / 2 : 0) + jitter(k + i * 7, 0.06);
          this.place(obj, playerCardPos(a, i, n, k), yaw, 0, animated);
        });
        for (const extra of objs.splice(hand.cards.length)) extra.mesh.removeFromParent();
      });
      for (const extra of view.hands.splice(n).flat()) extra.mesh.removeFromParent();

      // Chips in the betting area.
      const keep = new Set<string>();
      if (n === 0) {
        this.setStack(view, 'bet0', p.bet, betPos(a, 0, 1));
        keep.add('bet0');
      } else {
        p.hands.forEach((hand, i) => {
          const lost = results && (hand.outcome === 'lose' || hand.outcome === 'bust');
          this.setStack(view, `bet${i}`, lost ? 0 : hand.bet, betPos(a, i, n));
          const won = results && (hand.outcome === 'win' || hand.outcome === 'blackjack');
          this.setStack(view, `win${i}`, won ? (hand.payout ?? 0) - hand.bet : 0, winPos(a, i, n));
          keep.add(`bet${i}`).add(`win${i}`);
        });
      }
      const ins = results ? (p.insurancePayout ?? 0) : (p.insurance ?? 0);
      this.setStack(view, 'ins', ins, insurancePos(a));
      keep.add('ins');

      // The player's own chips by the rail.
      const plan = playerStacks(p.balance);
      plan.forEach(({ value, count }, col) => {
        this.setStack(view, `bal${value}`, count * value, stackPos(a, col, plan.length), Array(count).fill(value));
        keep.add(`bal${value}`);
      });
      for (const [key, s] of view.stacks) {
        if (!keep.has(key)) {
          s.group.removeFromParent();
          view.stacks.delete(key);
        }
      }

      this.updateLabels(view, p);

      // Avatar name tag.
      view.avatar?.setLook(p.look);
      view.avatar?.setInfo({
        bot: p.bot,
        name: p.name,
        balance: `${money(p.balance)} chips`,
        isTurn: state.turn?.playerId === p.id,
        away: !p.connected,
        host: p.isHost,
      });
    }

    // Dealer cards.
    const dc = state.dealer.cards;
    dc.forEach((card, k) => {
      let obj = this.dealerCards[k];
      if (!obj) {
        obj = new CardObject(card);
        this.dealerCards[k] = obj;
      }
      obj.setCard(card);
      this.place(obj, dealerCardPos(k, dc.length), jitter(k, 0.03), card ? 0 : Math.PI, animated);
    });
    for (const extra of this.dealerCards.splice(dc.length)) extra.mesh.removeFromParent();
    this.dealerLabel.set({ text: dc.length ? `Dealer ${state.dealer.label}` : '' });

    // Shoe and discard tray.
    const onTable = dc.length + state.players.reduce((s, p) => s + p.hands.reduce((t, h) => t + h.cards.length, 0), 0);
    this.env.setShoeFill(state.shoe.remaining / state.shoe.size);
    this.env.setDiscardHeight((state.shoe.size - state.shoe.remaining - onTable) / state.shoe.size);

    // Highlights.
    const turn = state.turn;
    const turnView = turn ? this.seats.get(turn.playerId) : undefined;
    const turnPlayer = turn ? state.players.find((p) => p.id === turn.playerId) : undefined;
    this.turnRing.visible = Boolean(state.phase === 'playing' && turnView && turnPlayer);
    if (this.turnRing.visible) {
      this.turnRing.position.copy(handAnchor(turnView!.angle, turn!.handIndex, turnPlayer!.hands.length)).setY(TABLE_Y + 0.002);
      this.turnRing.scale.setScalar(1.25);
    }
    const mine = state.players.find((p) => p.id === this.me);
    const myView = mine ? this.seats.get(mine.id) : undefined;
    this.betGlow.visible = Boolean(state.phase === 'betting' && mine && myView && mine.bet === 0);
    if (this.betGlow.visible) this.betGlow.position.copy(betPos(myView!.angle, 0, 1)).setY(TABLE_Y + 0.002);

    // Camera seat.
    if (myView) {
      // Look across the table at the dealer, slightly down so your own cards are in view.
      this.eyeTarget.copy(onArc(myView.angle, R_EYES, EYE_Y));
      // Side seats aim a little toward the rest of the table, so you see the other players.
      this.lookTargetV.set(-Math.sin(myView.angle) * 0.45, 0.95, DEALER_POS.z + 0.1);
    } else {
      this.eyeTarget.set(0, 1.75, CENTER.z + 2.3);
      this.lookTargetV.set(0, 0.9, CENTER.z + 0.3);
    }
    if (!this.cameraPlaced) {
      this.eye.copy(this.eyeTarget);
      this.look.copy(this.lookTargetV);
      this.cameraPlaced = true;
    }
  }

  /** Hand totals and results floating next to each hand. */
  private updateLabels(view: SeatView, p: PublicPlayer): void {
    const a = view.angle;
    const n = p.hands.length;
    while (view.labels.length < n) {
      const l = new LabelSprite(440, 80, p.id === this.me ? 0.034 : 0.05);
      view.labels.push(l);
      this.scene.add(l);
    }
    for (const l of view.labels.splice(n)) l.removeFromParent();
    p.hands.forEach((hand, i) => {
      const label = view.labels[i]!;
      const anchor = handAnchor(a, i, n);
      // Just beyond the last card, toward the dealer.
      const mine = p.id === this.me;
      label.position
        .copy(anchor)
        .addScaledVector(towardDealer(a), 0.09 + hand.cards.length * 0.026)
        .setY(TABLE_Y + (mine ? 0.018 : 0.06));
      const outcome = hand.outcome;
      const bg =
        outcome === 'win' || outcome === 'blackjack'
          ? 'rgba(36, 140, 80, 0.92)'
          : outcome === 'lose' || outcome === 'bust'
            ? 'rgba(160, 40, 48, 0.92)'
            : outcome === 'push'
              ? 'rgba(90, 90, 90, 0.92)'
              : undefined;
      const text = !outcome ? hand.label : outcome === 'blackjack' ? 'Blackjack!' : `${hand.label} · ${OUTCOME_TEXT[outcome]}`;
      label.set({ text, bg });
    });

  }

  private place(obj: CardObject, pos: THREE.Vector3, yaw: number, flip: number, animated: boolean): void {
    const mesh = obj.mesh;
    if (!mesh.parent) {
      mesh.position.copy(pos);
      mesh.rotation.set(0, yaw, flip);
      this.scene.add(mesh);
      return;
    }
    mesh.rotation.x = 0;
    if (Math.abs(mesh.rotation.z - flip) > 0.01) mesh.rotation.z = flip;
    if (mesh.position.distanceTo(pos) > 0.002 || Math.abs(mesh.rotation.y - yaw) > 0.01) {
      if (animated) void this.moveTo(obj, pos, yaw, 0.2);
      else {
        mesh.position.copy(pos);
        mesh.rotation.y = yaw;
      }
    }
  }

  /**
   * The dealer runs the table like a real one: callouts at each stage, a gesture toward
   * whoever is to act. You glance at them too, and hear a ping when it's your turn.
   */
  private reactToState(state: PublicState, prev: PublicState | null): void {
    const turn = state.turn;
    const phaseChanged = prev?.phase !== state.phase;
    const mine = state.players.find((p) => p.id === this.me);
    if (phaseChanged) {
      if (state.phase === 'betting') {
        this.dealerSays(state.shoe.cutCardReached ? 'Last hand before the shuffle. Place your bets.' : 'Place your bets, please.');
      } else if (state.phase === 'dealing' && prev) {
        this.dealerSays('No more bets.');
      } else if (state.phase === 'insurance') {
        const evenMoney = mine?.hands[0]?.label === 'Blackjack';
        this.dealerSays(evenMoney ? 'Even money?' : 'Insurance, anyone?');
      } else if (state.phase === 'results' && state.dealer.revealed) {
        const d = state.dealer.label;
        this.dealerSays(d === 'Blackjack' ? 'Dealer has blackjack.' : d.startsWith('Bust') ? 'Dealer busts!' : `Dealer has ${d.replace('soft ', '')}.`);
      }
    }
    if (turn) {
      const view = this.seats.get(turn.playerId);
      const turnKey = `${turn.playerId}:${turn.handIndex}`;
      if (view && turnKey !== this.lastTurnKey) {
        this.lastTurnKey = turnKey;
        this.dealer.lookAt(onArc(view.angle, 1.4, 1.1));
        // An open-palm gesture toward the player's cards.
        const player = state.players.find((p) => p.id === turn.playerId);
        const anchor = handAnchor(view.angle, turn.handIndex, player?.hands.length ?? 1).setY(TABLE_Y + 0.06);
        const side = anchor.x > 0 ? 'left' : 'right';
        void this.dealer.reach(side, anchor.lerp(new THREE.Vector3(0, TABLE_Y + 0.06, CENTER.z + 0.25), 0.35), 0.35).then(() =>
          this.anim.wait(0.5).then(() => this.dealer.rest(side, 0.4)),
        );
        if (turn.playerId !== this.me && player && Math.random() < 0.5) this.dealerSays(`${player.name}?`, false);
      }
      const wasMine = prev?.turn?.playerId === this.me;
      if (turn.playerId === this.me && !wasMine) this.opts.sound.play('turn');
    } else {
      this.lastTurnKey = '';
      if (state.phase === 'betting') this.dealer.lookAt(new THREE.Vector3(0, 1.1, 1.2));
    }
    // A player who just busted: "Too many."
    if (prev && state.phase === 'playing') {
      for (const p of state.players) {
        const before = prev.players.find((q) => q.id === p.id);
        p.hands.forEach((h, i) => {
          if (h.label.startsWith('Bust') && !before?.hands[i]?.label.startsWith('Bust')) this.dealerSays('Too many.', p.id === this.me);
        });
      }
    }
    this.turnGlance = turn && turn.playerId !== this.me && state.phase === 'playing' ? turn.playerId : null;
  }

  /** A chat line: speech bubble over that player, and a quick look their way. */
  say(playerId: string, text: string): void {
    const view = this.seats.get(playerId);
    if (!view?.avatar) return;
    view.avatar.say(text);
    this.chatGlance = { playerId, until: this.clock + 3 };
  }

  /** How far to turn your head (radians, + = right) to look at another player. */
  private glanceYaw(): number {
    if (this.clock - this.lastDrag < 6) return 0; // the player is looking around themselves
    const mine = this.me ? this.state?.turn?.playerId === this.me : false;
    if (mine) return 0;
    const who = this.turnGlance ?? (this.chatGlance && this.clock < this.chatGlance.until ? this.chatGlance.playerId : null);
    const face = who ? this.seats.get(who)?.avatar?.faceWorld() : undefined;
    if (!face) return 0;
    const d0 = this.look.clone().sub(this.eye).setY(0).normalize();
    const d1 = face.sub(this.eye).setY(0).normalize();
    const right = new THREE.Vector3(-d0.z, 0, d0.x);
    const angle = Math.atan2(d1.dot(right), d1.dot(d0));
    return THREE.MathUtils.clamp(angle * 0.6, -0.95, 0.95);
  }

  // ---------- Input ----------

  private onPointerDown = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (e.pointerType === 'mouse' && !this.drag) {
      this.hoverX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      this.hoverY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    }
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.drag.moved += Math.abs(dx) + Math.abs(dy);
    const speed = 2.2 / Math.max(rect.height, 1);
    this.yawTarget = THREE.MathUtils.clamp(this.yawTarget + dx * speed, -0.85, 0.85);
    this.lastDrag = this.clock;
    this.pitchTarget = THREE.MathUtils.clamp(this.pitchTarget + dy * speed, -0.45, 0.35);
  };

  private onPointerUp = (e: PointerEvent) => {
    const drag = this.drag;
    this.drag = null;
    if (!drag || drag.moved > 8) return;
    this.opts.sound.unlock();
    // A tap: did it hit one of my chip stacks?
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const mine = this.me ? this.seats.get(this.me) : undefined;
    if (!mine) return;
    const targets = [...mine.stacks.entries()].filter(([k, s]) => k.startsWith('bal') && s.group.visible).map(([, s]) => s.group);
    const hit = ray.intersectObjects(targets, true)[0];
    if (!hit) return;
    let o: THREE.Object3D | null = hit.object;
    while (o && o.userData.chipValue === undefined) o = o.parent;
    if (o) this.opts.onChipClick(o.userData.chipValue as number);
  };

  private recenter = () => {
    this.lastDrag = -100;
    this.yawTarget = 0;
    this.pitchTarget = 0;
  };

  // ---------- Frame loop ----------

  private loop = (now: number) => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.clock += dt;

    // Catch up if updates pile up (slow device, or the tab was in the background).
    // People who prefer reduced motion get quicker animations.
    const base = this.reducedMotion ? 2 : 1;
    this.anim.timeScale = Math.min(8, base + Math.max(0, this.pending - 1) * 1.5);
    this.anim.tick(dt);
    this.dealer.update(dt);
    this.celebrations.update(dt);
    if (this.dealerBubble.visible && this.clock > this.dealerBubbleUntil) this.dealerBubble.visible = false;
    for (const v of this.seats.values()) v.avatar?.update(dt);
    if (this.turnRing.visible) (this.turnRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(this.clock * 5) * 0.3;
    if (this.betGlow.visible) (this.betGlow.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(this.clock * 3) * 0.25;

    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.watchFps(dt);
  };

  private updateCamera(dt: number): void {
    this.eye.x = damp(this.eye.x, this.eyeTarget.x, 3, dt);
    this.eye.y = damp(this.eye.y, this.eyeTarget.y, 3, dt);
    this.eye.z = damp(this.eye.z, this.eyeTarget.z, 3, dt);
    this.look.x = damp(this.look.x, this.lookTargetV.x, 3, dt);
    this.look.y = damp(this.look.y, this.lookTargetV.y, 3, dt);
    this.look.z = damp(this.look.z, this.lookTargetV.z, 3, dt);
    this.yaw = damp(this.yaw, this.yawTarget + this.hoverX * 0.06 + this.glanceYaw(), 2.5, dt);
    this.pitch = damp(this.pitch, this.pitchTarget + this.hoverY * 0.04, 6, dt);

    // Natural head sway: slow breathing bob plus a tiny drift.
    const t = this.clock;
    const sway = new THREE.Vector3(Math.sin(t * 0.43) * 0.006, Math.sin(t * 0.9) * 0.004, Math.cos(t * 0.31) * 0.004);
    const portrait = this.camera.aspect < 0.85;
    const back = portrait ? 0.18 : 0;
    const dir = this.eye.clone().sub(this.look).setY(0).normalize();
    this.camera.position.copy(this.eye).addScaledVector(dir, back).add(sway);
    if (portrait) this.camera.position.y += 0.06;
    // In portrait the screen is tall: aim lower so the table fills it instead of the dark room.
    this.camera.lookAt(portrait ? this.look.clone().setY(this.look.y - 0.28) : this.look);
    this.camera.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -this.yaw);
    this.camera.rotateX(-this.pitch + Math.sin(t * 0.7) * 0.003);
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    // Portrait phones need a taller field of view to fit the table.
    this.camera.fov = this.camera.aspect < 0.85 ? 72 : this.camera.aspect < 1.3 ? 62 : 55;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private applyQuality(): void {
    const low = this.low;
    this.renderer.setPixelRatio(low ? Math.min(window.devicePixelRatio, 1) : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !low;
    this.env.lamp.castShadow = !low;
    this.env.lamp.shadow.mapSize.set(low ? 512 : 2048, low ? 512 : 2048);
    this.env.lamp.shadow.map?.dispose();
    this.env.lamp.shadow.map = null;
    for (const o of this.env.extras) o.visible = !low;
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((m) => (m.needsUpdate = true));
      else if (mat) mat.needsUpdate = true;
    });
    this.resize();
  }

  private watchFps(dt: number): void {
    if (this.low || document.hidden) return;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime < 3) return;
    const fps = this.fpsFrames / this.fpsTime;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.slowWindows = fps < 28 ? this.slowWindows + 1 : 0;
    if (this.slowWindows >= 2) {
      this.slowWindows = 0;
      this.setLowGraphics(true);
      this.opts.onAutoLow?.();
    }
  }
}

