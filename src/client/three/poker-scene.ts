// The first-person Texas Hold'em table: an oval table, the dealer at the far side,
// up to six players around it, the shared cards in the middle.
//
// Same approach as the blackjack scene: server events play as animations, then the
// scene snaps to the exact state, so it can never show something the server didn't say.

import * as THREE from 'three';
import { addEnvironmentLight, warmUp } from './env-light.js';
import type { AnyEvent, AnyState, PokerEvent, PokerState, TableEvent } from '../../shared/protocol.js';
import type { Sound } from '../audio.js';
import { money } from '../format.js';
import type { TableRenderer } from '../renderer.js';
import { Avatar } from './avatar.js';
import { Dealer } from './dealer.js';
import { Celebrations } from './effects.js';
import { buildRoom } from './environment.js';
import { CARD_H, CHIP_H, TABLE_Y, jitter } from './layout.js';
import { CardObject, ChipStack, breakdown, makeChip, playerStacks, setChipDetail } from './pieces.js';
import { LabelSprite, feltTextureFrom, setMaxAnisotropy, woodTexture } from './textures.js';
import { Animator, damp, ease, lerp } from './tween.js';

export interface PokerSceneOptions {
  sound: Sound;
  low: boolean;
  onAutoLow?: () => void;
}

// The oval table, in meters.
const RX = 1.3;
const RZ = 0.8;
const DEALER = new THREE.Vector3(0, 0, -1.06);
const DECK_POS = new THREE.Vector3(0.18, TABLE_Y + 0.012, -0.56);

/**
 * Seats go around the oval, leaving the dealer's side free: seat 0 is on the dealer's
 * left, seat 2 straight across from the dealer, seat 5 on the dealer's right.
 */
function seatAngle(seat: number): number {
  const step = (52 * Math.PI) / 180;
  return Math.PI / 2 + (seat - 2) * step;
}

/** A point at fraction `r` of the way from the center to the table edge, toward a seat. */
function seatPoint(seat: number, r: number, y = TABLE_Y): THREE.Vector3 {
  const a = seatAngle(seat);
  return new THREE.Vector3(Math.cos(a) * RX * r, y, Math.sin(a) * RZ * r);
}

/** Unit vector along the edge, to the seat's right as they face the center. */
function seatRight(seat: number): THREE.Vector3 {
  const p = seatPoint(seat, 1);
  const inward = p.clone().negate().setY(0).normalize();
  return new THREE.Vector3(-inward.z, 0, inward.x).negate();
}

function seatYaw(seat: number): number {
  const p = seatPoint(seat, 1);
  return Math.atan2(p.x, p.z); // card bottom edge toward the player
}

const boardPos = (i: number) => new THREE.Vector3((i - 2) * 0.085, TABLE_Y + 0.001, 0.02);
const POT_POS = new THREE.Vector3(0, TABLE_Y, -0.2);

interface SeatView {
  id: string;
  seat: number;
  avatar: Avatar | null;
  hole: CardObject[];
  bet: ChipStack;
  stack: ChipStack[];
  label: LabelSprite;
}

export class PokerScene3D implements TableRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.05, 60);
  private readonly anim = new Animator();
  private readonly dealer: Dealer;
  private readonly lamp: THREE.SpotLight;
  private readonly extras: THREE.Object3D[];
  private readonly seats = new Map<string, SeatView>();
  private readonly board: CardObject[] = [];
  private readonly pot = new ChipStack(14);
  private readonly potLabel = new LabelSprite(320, 80, 0.045);
  private readonly button: THREE.Mesh;
  private readonly turnRing: THREE.Mesh;
  private readonly dealerBubble = new LabelSprite(640, 96, 0.07);
  private readonly celebrations: Celebrations;
  private readonly observer: ResizeObserver;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private me: string | null = null;
  private state: PokerState | null = null;
  private low: boolean;
  private disposed = false;
  /** Resolves when the shaders are compiled and the first frame is on its way. */
  readonly ready: Promise<void>;
  private frame = 0;
  private last = performance.now();
  private clock = 0;
  private bubbleUntil = 0;
  private celebrated = '';
  // Camera.
  private readonly eye = new THREE.Vector3(0, 1.75, 2.4);
  private readonly look = new THREE.Vector3(0, 0.85, 0);
  private readonly eyeTarget = new THREE.Vector3(0, 1.75, 2.4);
  private readonly lookTarget = new THREE.Vector3(0, 0.85, 0);
  private yaw = 0;
  private pitch = 0;
  private yawTarget = 0;
  private pitchTarget = 0;
  private drag: { x: number; y: number } | null = null;
  private fpsFrames = 0;
  private fpsTime = 0;
  private slow = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: PokerSceneOptions,
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
    addEnvironmentLight(this.renderer, this.scene, 0.22);
    this.scene.background = new THREE.Color(0x080605);
    this.scene.fog = new THREE.FogExp2(0x080605, 0.08);

    const room = buildRoom();
    this.lamp = room.lamp;
    this.lamp.position.set(0, 2.6, 0);
    this.lamp.target.position.set(0, TABLE_Y, 0);
    this.extras = room.extras;
    this.scene.add(room.group, this.buildTable());

    this.dealer = new Dealer(this.anim, DEALER);
    this.scene.add(this.dealer.group, this.dealer.limbs);
    this.dealer.lookAt(new THREE.Vector3(0, 1.1, 1));

    this.pot.group.position.copy(POT_POS);
    this.potLabel.position.copy(POT_POS).add(new THREE.Vector3(0, 0.1, 0));
    this.dealerBubble.position.set(DEALER.x, 1.74, DEALER.z + 0.1);
    this.dealerBubble.visible = false;
    this.scene.add(this.pot.group, this.potLabel, this.dealerBubble);

    // The dealer button: a white puck with a "D".
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f6f1e4';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '800 40px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('D', 32, 34);
    const top = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), roughness: 0.5 });
    (top.map as THREE.Texture).colorSpace = THREE.SRGBColorSpace;
    const side = new THREE.MeshStandardMaterial({ color: 0xe9e4d6 });
    this.button = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 24), [side, top, side]);
    this.button.castShadow = true;
    this.button.visible = false;
    this.scene.add(this.button);

    this.turnRing = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.112, 48),
      new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.turnRing.rotation.x = -Math.PI / 2;
    this.turnRing.visible = false;
    this.scene.add(this.turnRing);

    this.celebrations = new Celebrations(this.scene);
    this.applyQuality();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => (this.drag = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const h = Math.max(1, el.clientHeight);
      this.yawTarget = THREE.MathUtils.clamp(this.yawTarget + ((e.clientX - this.drag.x) * 2.2) / h, -0.9, 0.9);
      this.pitchTarget = THREE.MathUtils.clamp(this.pitchTarget + ((e.clientY - this.drag.y) * 2.2) / h, -0.45, 0.35);
      this.drag = { x: e.clientX, y: e.clientY };
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => (this.drag = null));
    el.addEventListener('dblclick', () => (this.yawTarget = this.pitchTarget = 0));
    this.ready = warmUp(this.renderer, this.scene, this.camera).then(() => {
      if (this.disposed) return;
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.loop);
    });
  }

  private buildTable(): THREE.Group {
    return buildPokerTable();
  }

  // ---------- TableRenderer ----------

  update(anyState: AnyState, anyEvents: AnyEvent[], me: string | null): void {
    if (anyState.game !== 'poker') return;
    const state = anyState;
    const events = anyEvents as PokerEvent[];
    this.me = me;
    this.pending++;
    this.queue = this.queue
      .then(() => this.play(state, events))
      .catch((err) => console.error('poker animation error', err))
      .finally(() => this.pending--);
  }

  setLowGraphics(low: boolean): void {
    this.low = low;
    this.applyQuality();
  }

  say(playerId: string, text: string): void {
    this.seats.get(playerId)?.avatar?.say(text);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- Events ----------

  private async play(state: PokerState, events: PokerEvent[]): Promise<void> {
    if (this.disposed) return;
    const prev = this.state;
    this.state = state;
    this.syncSeats(state);
    for (const e of events) {
      if (this.disposed) return;
      await this.animate(e, state);
    }
    this.reconcile(state);
    this.callouts(state, prev);
  }

  private dealerSays(text: string, voice = true): void {
    this.dealerBubble.set({ text, bg: 'rgba(250, 246, 236, 0.95)', color: '#1d1a16' });
    this.dealerBubble.visible = true;
    this.bubbleUntil = this.clock + 3;
    if (voice) this.opts.sound.speak(text);
  }

  private panFor(pos: THREE.Vector3): number {
    const v = pos.clone().applyMatrix4(this.camera.matrixWorldInverse);
    return THREE.MathUtils.clamp((v.x / Math.max(0.3, -v.z)) * 0.8, -0.9, 0.9);
  }

  private async animate(e: PokerEvent, state: PokerState): Promise<void> {
    const sound = this.opts.sound;
    switch (e.type) {
      case 'shuffle':
        sound.play('shuffle', { delay: 0.1 });
        await this.dealer.shuffle();
        break;
      case 'blinds':
        sound.play('chips');
        break;
      case 'hole': {
        const view = this.seats.get(e.to);
        if (!view) return;
        const k = view.hole.length;
        const obj = new CardObject(e.card);
        view.hole.push(obj);
        const mine = e.to === this.me;
        await this.flyCard(obj, this.holePos(view.seat, k), seatYaw(view.seat) + (k ? 0.12 : -0.12), mine, 0.22);
        break;
      }
      case 'board': {
        if (e.street === 'flop') this.dealerSays('The flop.', false);
        else this.dealerSays(e.street === 'turn' ? 'The turn.' : 'The river.', false);
        for (const card of e.cards) {
          const obj = new CardObject(card);
          const i = this.board.length;
          this.board.push(obj);
          await this.flyCard(obj, boardPos(i), 0, true, 0.3);
        }
        break;
      }
      case 'pact': {
        const view = this.seats.get(e.playerId);
        if (!view) return;
        const at = seatPoint(view.seat, 0.6);
        if (e.action === 'check') {
          view.avatar?.signal('hit'); // a double tap on the table
          sound.play('tap', { pan: this.panFor(at) });
        } else if (e.action === 'fold') {
          view.avatar?.signal('stand');
          await Promise.all(view.hole.map((c) => this.slide(c, DECK_POS.clone().setY(TABLE_Y + 0.02), 0.35, true)));
          for (const c of view.hole) c.mesh.removeFromParent();
          view.hole = [];
        } else {
          view.avatar?.signal('double');
          const from = seatPoint(view.seat, 0.86, TABLE_Y + 0.02);
          await Promise.all(breakdown(Math.max(5, e.amount)).slice(0, 4).map((v, i) => this.anim.wait(i * 0.05).then(() => this.flyChip(v, from, seatPoint(view.seat, 0.55, TABLE_Y + i * CHIP_H), 0.3))));
          sound.play('chips', { pan: this.panFor(at) });
        }
        break;
      }
      case 'collect': {
        const flights: Promise<void>[] = [];
        for (const v of this.seats.values()) {
          if (!v.bet.group.visible) continue;
          const from = v.bet.group.position.clone();
          v.bet.group.visible = false;
          v.bet.amount = -1;
          flights.push(this.flyChip(5, from, POT_POS.clone().setY(TABLE_Y + 0.02), 0.35));
        }
        if (flights.length) sound.play('chipSlide');
        await Promise.all(flights);
        break;
      }
      case 'showdown':
        this.dealerSays('Showdown!', false);
        // Reveal: the new state carries the cards; flip them over.
        for (const p of state.players) {
          const view = this.seats.get(p.id);
          if (!view || !p.hole || p.id === this.me) continue;
          p.hole.forEach((card, i) => {
            const obj = view.hole[i];
            if (!obj) return;
            obj.setCard(card);
            void this.anim.tween(0.35, (k) => (obj.mesh.rotation.z = Math.PI * (1 - k)), ease.inOutSine);
          });
        }
        sound.play('flip');
        await this.anim.wait(0.5);
        break;
      case 'win': {
        const view = this.seats.get(e.playerId);
        if (!view) return;
        const to = seatPoint(view.seat, 0.86, TABLE_Y + 0.02);
        this.pot.group.visible = false;
        this.dealer.lookAt(to);
        void this.dealer.reach(to.x > 0 ? 'left' : 'right', POT_POS.clone().setY(TABLE_Y + 0.05), 0.25).then(() =>
          this.dealer.reach(to.x > 0 ? 'left' : 'right', seatPoint(view.seat, 0.45, TABLE_Y + 0.05), 0.35).then(() => this.dealer.rest(to.x > 0 ? 'left' : 'right')),
        );
        sound.play('chipSlide', { pan: this.panFor(to) });
        await Promise.all(breakdown(e.amount).slice(0, 8).map((v, i) => this.anim.wait(i * 0.04).then(() => this.flyChip(v, POT_POS.clone().setY(TABLE_Y + 0.02), to, 0.45))));
        const p = state.players.find((x) => x.id === e.playerId);
        this.dealerSays(`${p?.name ?? 'Player'} wins ${money(e.amount)}.`, e.playerId === this.me || state.winners.length === 1);
        if (e.playerId === this.me) {
          if (e.amount >= 200) this.opts.sound.play('applause', { gain: 0.5 });
          this.opts.sound.play('win');
        }
        break;
      }
      case 'clear': {
        const cards = [...this.board, ...[...this.seats.values()].flatMap((v) => v.hole)];
        await Promise.all(cards.map((c, i) => this.anim.wait(i * 0.03).then(() => this.slide(c, DECK_POS.clone().setY(TABLE_Y + 0.02), 0.35, true))));
        for (const c of cards) c.mesh.removeFromParent();
        this.board.length = 0;
        for (const v of this.seats.values()) v.hole = [];
        break;
      }
    }
  }

  private holePos(seat: number, k: number): THREE.Vector3 {
    return seatPoint(seat, 0.7, TABLE_Y + 0.001 + k * 0.0012).addScaledVector(seatRight(seat), (k - 0.5) * 0.05);
  }

  private async flyCard(obj: CardObject, target: THREE.Vector3, yaw: number, faceUp: boolean, duration: number): Promise<void> {
    const m = obj.mesh;
    m.position.copy(DECK_POS).setY(TABLE_Y + 0.03);
    m.rotation.set(0, 0, Math.PI);
    this.scene.add(m);
    this.opts.sound.play('card', { pan: this.panFor(target) });
    const from = m.position.clone();
    await this.anim.tween(
      duration,
      (k) => {
        m.position.lerpVectors(from, target, k);
        m.position.y += Math.sin(Math.PI * k) * 0.05;
        m.rotation.y = lerp(0, yaw, k);
        if (faceUp) m.rotation.z = Math.PI * (1 - THREE.MathUtils.clamp((k - 0.3) / 0.6, 0, 1));
      },
      ease.outCubic,
    );
  }

  private slide(obj: CardObject, to: THREE.Vector3, duration: number, faceDown: boolean): Promise<void> {
    const m = obj.mesh;
    const from = m.position.clone();
    const z0 = m.rotation.z;
    return this.anim.tween(duration, (k) => {
      m.position.lerpVectors(from, to, k);
      if (faceDown) m.rotation.z = lerp(z0, Math.PI, k);
    });
  }

  private async flyChip(value: number, from: THREE.Vector3, to: THREE.Vector3, duration: number): Promise<void> {
    const chip = makeChip(value);
    chip.position.copy(from);
    this.scene.add(chip);
    await this.anim.tween(
      duration,
      (k) => {
        chip.position.lerpVectors(from, to, k);
        chip.position.y += Math.sin(Math.PI * k) * 0.06;
      },
      ease.inOutSine,
    );
    chip.removeFromParent();
  }

  // ---------- Reconcile ----------

  private syncSeats(state: PokerState): void {
    const present = new Set<string>();
    for (const p of state.players) {
      if (p.seat === null) continue;
      present.add(p.id);
      let v = this.seats.get(p.id);
      if (v && v.seat !== p.seat) {
        this.removeSeat(v);
        v = undefined;
      }
      if (!v) {
        v = { id: p.id, seat: p.seat, avatar: null, hole: [], bet: new ChipStack(10), stack: [], label: new LabelSprite(420, 80, 0.042) };
        this.scene.add(v.bet.group, v.label);
        this.seats.set(p.id, v);
      }
      const isMe = p.id === this.me;
      if (!isMe && !v.avatar) {
        const at = seatPoint(p.seat, 1.32, 0);
        v.avatar = new Avatar(0, p.look, { position: at, rotationY: Math.atan2(-at.x, -at.z) });
        this.scene.add(v.avatar.group);
      } else if (isMe && v.avatar) {
        v.avatar.dispose();
        v.avatar = null;
      }
    }
    for (const v of [...this.seats.values()]) if (!present.has(v.id)) this.removeSeat(v);
  }

  private removeSeat(v: SeatView): void {
    v.avatar?.dispose();
    for (const c of v.hole) c.mesh.removeFromParent();
    v.bet.group.removeFromParent();
    for (const s of v.stack) s.group.removeFromParent();
    v.label.removeFromParent();
    this.seats.delete(v.id);
  }

  private reconcile(state: PokerState): void {
    for (const p of state.players) {
      const v = this.seats.get(p.id);
      if (!v) continue;
      // Hole cards.
      const want = p.inHand && !p.folded ? p.holeCount : 0;
      while (v.hole.length > want) v.hole.pop()!.mesh.removeFromParent();
      for (let k = 0; k < want; k++) {
        let obj = v.hole[k];
        const card = p.hole?.[k] ?? null;
        if (!obj) {
          obj = new CardObject(card);
          v.hole[k] = obj;
          this.scene.add(obj.mesh);
        }
        obj.setCard(card);
        obj.mesh.position.copy(this.holePos(p.seat!, k));
        // Your own cards tilt up a little toward you, like peeking at them.
        const mine = p.id === this.me;
        obj.mesh.rotation.set(mine ? -0.35 : 0, seatYaw(p.seat!) + (k ? 0.12 : -0.12), card ? 0 : Math.PI);
        if (mine) obj.mesh.position.y += 0.012;
      }
      // Bet in front, stack by the rail.
      v.bet.group.position.copy(seatPoint(p.seat!, 0.55));
      v.bet.group.visible = p.bet > 0;
      if (p.bet > 0) v.bet.set(p.bet);
      const plan = playerStacks(p.balance);
      while (v.stack.length < plan.length) {
        const s = new ChipStack(20);
        v.stack.push(s);
        this.scene.add(s.group);
      }
      plan.forEach(({ value, count }, i) => {
        const s = v.stack[i]!;
        s.group.position.copy(seatPoint(p.seat!, 0.88)).addScaledVector(seatRight(p.seat!), (i - (plan.length - 1) / 2) * 0.05);
        s.group.visible = count > 0;
        if (count > 0) s.set(count * value, Array(count).fill(value));
      });
      // Status next to the cards.
      const status = p.folded ? 'Folded' : p.allIn ? 'All in' : p.lastAction ?? '';
      v.label.position.copy(seatPoint(p.seat!, 0.7, TABLE_Y + 0.11));
      const won = state.phase === 'results' && p.won > 0;
      v.label.set({
        text: won ? `Wins ${money(p.won)}` : p.handName && state.phase !== 'waiting' ? p.handName : status,
        bg: won ? 'rgba(36, 140, 80, 0.92)' : p.folded ? 'rgba(70, 70, 70, 0.85)' : undefined,
      });
      // Your own status is in the controls at the bottom; only your wins show on the table.
      if (p.id === this.me && !won) v.label.visible = false;
      v.avatar?.setLook(p.look);
      v.avatar?.setInfo({
        name: p.name,
        balance: `${money(p.balance)} chips`,
        isTurn: state.turn?.playerId === p.id,
        away: !p.connected,
        host: p.isHost,
        bot: p.bot,
      });
    }

    // Board and pot.
    while (this.board.length > state.board.length) this.board.pop()!.mesh.removeFromParent();
    state.board.forEach((card, i) => {
      let obj = this.board[i];
      if (!obj) {
        obj = new CardObject(card);
        this.board[i] = obj;
        this.scene.add(obj.mesh);
      }
      obj.setCard(card);
      obj.mesh.position.copy(boardPos(i));
      obj.mesh.rotation.set(0, jitter(i, 0.02), 0);
    });
    const inPot = state.pot - state.players.reduce((s, p) => s + p.bet, 0);
    this.pot.group.visible = inPot > 0 && state.phase !== 'results';
    if (inPot > 0) this.pot.set(inPot);
    this.potLabel.set({ text: state.pot > 0 && state.phase !== 'results' ? `Pot ${money(state.pot)}` : '' });

    // Dealer button and the turn ring.
    this.button.visible = state.buttonSeat !== null && state.phase !== 'waiting';
    if (this.button.visible) this.button.position.copy(seatPoint(state.buttonSeat!, 0.6, TABLE_Y + 0.005)).addScaledVector(seatRight(state.buttonSeat!), 0.16);
    const turn = state.turn ? this.seats.get(state.turn.playerId) : undefined;
    this.turnRing.visible = Boolean(turn);
    if (turn) this.turnRing.position.copy(seatPoint(turn.seat, 0.7, TABLE_Y + 0.002));

    // Camera: your seat, or a spectator's view from behind.
    const mine = state.players.find((p) => p.id === this.me);
    if (mine?.seat !== null && mine?.seat !== undefined) {
      // Seated a little behind the rail, high enough to see the whole table and everyone at it.
      this.eyeTarget.copy(seatPoint(mine.seat, 1.5, 1.42));
      this.lookTarget.set(0, 0.8, 0).lerp(seatPoint(mine.seat, -0.45, 0.8), 0.5);
    } else {
      this.eyeTarget.set(0, 1.9, 2.3);
      this.lookTarget.set(0, 0.8, 0);
    }
  }

  private callouts(state: PokerState, prev: PokerState | null): void {
    if (prev?.phase === 'waiting' && state.phase === 'preflop') this.dealerSays('Blinds, please. Good luck!', false);
    const turn = state.turn;
    if (turn) {
      const v = this.seats.get(turn.playerId);
      if (v) this.dealer.lookAt(seatPoint(v.seat, 1.3, 1.1));
      if (turn.playerId === this.me && prev?.turn?.playerId !== this.me) this.opts.sound.play('turn');
    }
    // A big hand at the showdown gets a burst of sparkles.
    if (state.phase === 'results' && this.celebrated !== `${state.round}`) {
      this.celebrated = `${state.round}`;
      for (const w of state.winners) {
        const v = this.seats.get(w.playerId);
        const strong = /flush|full house|four|straight/i.test(w.handName ?? '');
        if (v && (strong || w.playerId === this.me)) this.celebrations.burst(seatPoint(v.seat, 0.7), strong, this.low || w.playerId !== this.me);
      }
    }
  }

  // ---------- Frame loop ----------

  private loop = (now: number) => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    this.anim.timeScale = Math.min(8, 1 + Math.max(0, this.pending - 1) * 1.5);
    this.anim.tick(dt);
    this.dealer.update(dt);
    this.celebrations.update(dt);
    for (const v of this.seats.values()) v.avatar?.update(dt);
    if (this.turnRing.visible) (this.turnRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(this.clock * 5) * 0.3;
    if (this.dealerBubble.visible && this.clock > this.bubbleUntil) this.dealerBubble.visible = false;

    for (const k of ['x', 'y', 'z'] as const) {
      this.eye[k] = damp(this.eye[k], this.eyeTarget[k], 3, dt);
      this.look[k] = damp(this.look[k], this.lookTarget[k], 3, dt);
    }
    this.yaw = damp(this.yaw, this.yawTarget, 6, dt);
    this.pitch = damp(this.pitch, this.pitchTarget, 6, dt);
    const t = this.clock;
    const portrait = this.camera.aspect < 0.85;
    const back = this.eye.clone().sub(this.look).setY(0).normalize().multiplyScalar(portrait ? 0.25 : 0);
    this.camera.position.copy(this.eye).add(back).add(new THREE.Vector3(Math.sin(t * 0.43) * 0.005, Math.sin(t * 0.9) * 0.004, 0));
    this.camera.lookAt(portrait ? this.look.clone().setY(this.look.y - 0.2) : this.look);
    this.camera.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -this.yaw);
    this.camera.rotateX(-this.pitch);
    this.renderer.render(this.scene, this.camera);

    if (!this.low && !document.hidden) {
      this.fpsFrames++;
      this.fpsTime += dt;
      if (this.fpsTime > 3) {
        this.slow = this.fpsFrames / this.fpsTime < 28 ? this.slow + 1 : 0;
        this.fpsFrames = this.fpsTime = 0;
        if (this.slow >= 2) {
          this.slow = 0;
          this.setLowGraphics(true);
          this.opts.onAutoLow?.();
        }
      }
    }
  };

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.fov = this.camera.aspect < 0.85 ? 78 : this.camera.aspect < 1.3 ? 68 : 62;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private applyQuality(): void {
    const low = this.low;
    this.renderer.setPixelRatio(low ? Math.min(window.devicePixelRatio, 1) : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !low;
    this.lamp.castShadow = !low;
    for (const o of this.extras) o.visible = !low;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
    this.resize();
  }
}

/** Felt for the oval table: a gold ring, the game's name, and outlines for the five cards. */
function pokerFelt(): THREE.CanvasTexture {
  const W = 2048;
  const H = Math.round((W * RZ) / RX);
  return feltTextureFrom(W, H, (ctx) => {
    const ink = 'rgba(246, 232, 196, 0.8)';
    const gold = 'rgba(232, 196, 110, 0.9)';
    ctx.strokeStyle = gold;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, W * 0.43, H * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, W * 0.415, H * 0.375, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = gold;
    ctx.textAlign = 'center';
    ctx.font = '700 46px "Playfair Display", Georgia, serif';
    ctx.fillText('TEXAS HOLD’EM', W / 2, H * 0.68);
    ctx.font = '600 22px "Playfair Display", Georgia, serif';
    ctx.fillStyle = ink;
    ctx.fillText('NO LIMIT · BLINDS 5 / 10', W / 2, H * 0.725);
    // Card spots for the board.
    const cw = (0.07 / (2 * RX)) * W;
    const ch = (CARD_H / (2 * RZ)) * H;
    ctx.strokeStyle = 'rgba(246, 232, 196, 0.3)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      const x = W / 2 + ((i - 2) * 0.085 * W) / (2 * RX);
      const y = H / 2 + (0.02 * H) / (2 * RZ);
      ctx.strokeRect(x - cw / 2 - 4, y - ch / 2 - 4, cw + 8, ch + 8);
    }
  });
}

/** The oval poker table: felt, wooden body, padded rail, pedestal and the deck. */
export function buildPokerTable(): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, RX, RZ, 0, Math.PI * 2, false, 0);
  const feltGeo = new THREE.ShapeGeometry(shape, 96);
  feltGeo.rotateX(-Math.PI / 2);
  const pos = feltGeo.attributes.position!;
  const uv = feltGeo.attributes.uv!;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + RX) / (2 * RX), 1 - (pos.getZ(i) + RZ) / (2 * RZ));
  const felt = new THREE.Mesh(feltGeo, new THREE.MeshStandardMaterial({ map: pokerFelt(), roughness: 0.92 }));
  felt.position.y = TABLE_Y;
  felt.receiveShadow = true;
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0xd9a77a, roughness: 0.45 });
  const outer = new THREE.Shape();
  outer.absellipse(0, 0, RX + 0.08, RZ + 0.08, 0, Math.PI * 2, false, 0);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.12, bevelEnabled: false, curveSegments: 64 }), woodMat);
  body.rotation.x = -Math.PI / 2;
  body.position.y = TABLE_Y - 0.121;
  body.castShadow = body.receiveShadow = true;
  const railPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    railPts.push(new THREE.Vector3(Math.cos(a) * (RX + 0.03), TABLE_Y + 0.03, Math.sin(a) * (RZ + 0.03)));
  }
  const rail = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts, true), 160, 0.055, 16, true),
    new THREE.MeshStandardMaterial({ color: 0x2a1610, roughness: 0.38, metalness: 0.1 }),
  );
  rail.castShadow = rail.receiveShadow = true;
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.36, TABLE_Y - 0.12, 20), woodMat);
  pedestal.position.y = (TABLE_Y - 0.12) / 2;
  // The deck by the dealer.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, CARD_H), new THREE.MeshStandardMaterial({ color: 0x7d1622, roughness: 0.6 }));
  deck.position.copy(DECK_POS);
  deck.castShadow = true;
  g.add(felt, body, rail, pedestal, deck);
  return g;
}
