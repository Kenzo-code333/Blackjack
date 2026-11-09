// The heads-up display: everything you click. It sits on top of the table view
// (2D or 3D) and never draws the table itself.

import type { Action, Card } from '../game/index.js';
import { type AnyState, CHIP_VALUES, type ChatMessage, type GameKind, type PokerPlayer, type PokerState, type PublicPlayer, type PublicState, type RoulettePlayer, type RouletteState } from '../shared/protocol.js';
import { h, show, toast } from './dom.js';
import { OUTCOME_TEXT, SUIT_SYMBOL, bannerText, isRed, money, pocketName, pokerBanner, rouletteBanner } from './format.js';
import { PokerControls } from './hud-poker.js';
import { RouletteControls } from './hud-roulette.js';
import { rulesContent } from './rules.js';
import { canRefill } from './storage.js';
import type { Net } from './net.js';

export interface SoundControls {
  readonly muted: boolean;
  readonly music: number;
  readonly sfx: number;
  readonly voice: boolean;
  setVoice(on: boolean): void;
  setMuted(m: boolean): void;
  setMusic(v: number): void;
  setSfx(v: number): void;
}

export interface HudOptions {
  /** Which game this table plays: picks the controls and the rules shown in help. */
  game: GameKind;
  onLeave: () => void;
  onToggleGraphics: () => boolean; // returns new low-graphics state
  lowGraphics: boolean;
  sound: SoundControls;
  /** Called after any button press, e.g. to unlock audio on mobile. */
  onInteract?: () => void;
  /** Click feedback sounds. */
  play?: (name: 'click' | 'chip') => void;
  /** How friends join this table: the link to send and a short note. null = can't be joined. */
  invite?: { link: string; note: string } | null;
}

const ACTION_LABELS: Record<Action, string> = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split' };
const ACTION_KEYS: Record<string, Action> = { h: 'hit', s: 'stand', d: 'double', p: 'split' };

export class Hud {
  readonly el: HTMLElement;
  private state: AnyState | null = null;
  private poker: PokerControls | null = null;
  /** Roulette: the chip picker and buttons (the 3D layout calls `roulette.bet`). */
  roulette: RouletteControls | null = null;
  private lastBet = 0;
  private lastPhase = '';
  private myCardsKey = '';
  private celebratedHand = '';
  private celebrationTimer: ReturnType<typeof setTimeout> | undefined;
  private shownCards = new Set<string>();
  private unreadChat = 0;
  private timerFrame = 0;

  // Elements updated on every state change.
  private readonly banner = h('div', { class: 'banner-text' });
  private readonly timerBar = h('div', { class: 'timer-fill' });
  private readonly timerText = h('span', { class: 'timer-text' });
  private readonly balanceEl = h('strong');
  private readonly betEl = h('strong');
  private readonly statusDot = h('span', { class: 'status-dot', title: 'Connection' });
  private readonly bettingRow = h('div', { class: 'row betting' });
  private readonly chipButtons: HTMLButtonElement[] = [];
  private readonly clearBtn: HTMLButtonElement;
  private readonly rebetBtn: HTMLButtonElement;
  private readonly dealBtn: HTMLButtonElement;
  private readonly actionsRow = h('div', { class: 'row actions' });
  private readonly actionButtons = new Map<Action, HTMLButtonElement>();
  private readonly insuranceRow = h('div', { class: 'row insurance' });
  private readonly insuranceText = h('span', { class: 'insurance-text' });
  private insuranceYes!: HTMLButtonElement;
  private readonly invitePanel: HTMLElement;
  private readonly inviteQr = h('canvas', { class: 'invite-qr', width: 220, height: 220, 'aria-label': 'QR code of the invite link' });
  private readonly celebration = h('div', { class: 'celebration', 'aria-live': 'assertive' });
  private readonly hostRow = h('div', { class: 'row host' });
  private addBotBtn!: HTMLButtonElement;
  private readonly myCards = h('div', { class: 'my-cards', 'aria-live': 'polite' });
  private readonly soundPanel: HTMLElement;
  private readonly hostBtn: HTMLButtonElement;
  private readonly seatRow = h('div', { class: 'row seat' });
  private readonly brokeRow = h('div', { class: 'row broke' });
  private refillBtn!: HTMLButtonElement;
  private panelRefillBtn!: HTMLButtonElement;
  private readonly chatPanel: HTMLElement;
  private readonly chatLog = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  private readonly chatInput = h('input', { class: 'chat-input', maxlength: 200, placeholder: 'Say something…', 'aria-label': 'Chat message' });
  private readonly chatBadge = h('span', { class: 'badge', hidden: true });
  private readonly playersPanel: HTMLElement;
  private readonly playersList = h('ul', { class: 'players-list' });
  private readonly helpPanel: HTMLElement;
  private readonly offline = h('div', { class: 'offline', hidden: true }, h('div', { class: 'spinner' }), 'Reconnecting…');
  private inviteBtn!: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly gfxBtn: HTMLButtonElement;

  constructor(
    private readonly net: Net,
    private readonly opts: HudOptions,
  ) {
    const press = (fn: () => unknown) => () => {
      opts.onInteract?.();
      opts.play?.('click');
      void fn();
    };
    const send = (p: Promise<{ ok: boolean; error?: string }>) =>
      p.then((res) => {
        if (!res.ok && 'error' in res) toast(res.error ?? 'Error', 'error');
      });

    // --- Top bar ---
    const code = net.session?.code ?? '';
    const inviteBtn = (this.inviteBtn = h('button', { class: 'btn small gold invite', 'aria-label': 'Invite friends', onclick: press(() => this.togglePanel('invite')) }, h('span', { class: 'long' }, 'Invite friends'), h('span', { class: 'short' }, '🔗', h('span', { class: 'invite-word' }, ' Invite'))));
    this.muteBtn = h('button', { class: 'icon-btn', title: 'Sound', 'aria-label': 'Sound settings', onclick: press(() => this.togglePanel('sound')) });
    this.gfxBtn = h('button', { class: 'icon-btn', title: 'Low graphics on/off', 'aria-label': 'Graphics quality', onclick: press(() => this.toggleGfx()) });
    const chatBtn = h(
      'button',
      { class: 'icon-btn', title: 'Chat', 'aria-label': 'Chat', onclick: press(() => this.togglePanel('chat')) },
      '💬',
      this.chatBadge,
    );
    const helpBtn = h('button', { class: 'icon-btn', title: 'Help', 'aria-label': 'Help', onclick: press(() => this.togglePanel('help')) }, '?');
    const playersBtn = h('button', { class: 'icon-btn', title: 'Players', 'aria-label': 'Players', onclick: press(() => this.togglePanel('players')) }, '👥');
    const top = h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'leave-btn', title: 'Leave the table and go back to the casino floor', 'aria-label': 'Leave table', onclick: press(() => opts.onLeave()) }, h('span', { class: 'leave-icon', 'aria-hidden': 'true' }, '⏏'), h('span', { class: 'leave-word' }, 'Leave')),
      h('div', { class: 'table-code' }, this.statusDot, h('span', { class: 'code-label' }, 'Table'), h('strong', {}, code)),
      inviteBtn,
      h('div', { class: 'spacer' }),
      chatBtn,
      playersBtn,
      helpBtn,
      this.muteBtn,
      this.gfxBtn,
    );
    this.updateToggles();

    // --- Banner with countdown ---
    const banner = h('div', { class: 'banner' }, this.banner, h('div', { class: 'timer' }, this.timerBar), this.timerText);

    // --- Bottom controls ---
    for (const value of CHIP_VALUES) {
      const btn = h(
        'button',
        {
          class: `chip chip-${value}`,
          'aria-label': `Bet ${value}`,
          onclick: () => {
            opts.onInteract?.();
            opts.play?.('chip');
            void send(net.bet(value));
          },
        },
        h('span', {}, String(value)),
      );
      this.chipButtons.push(btn);
    }
    this.clearBtn = h('button', { class: 'btn ghost', onclick: press(() => send(net.clearBet())) }, 'Clear');
    this.rebetBtn = h('button', { class: 'btn ghost', onclick: press(() => send(net.bet(this.lastBet))) }, 'Rebet');
    this.dealBtn = h('button', { class: 'btn gold big', onclick: press(() => send(net.ready())) }, 'Deal');
    this.bettingRow.append(h('div', { class: 'chips' }, this.chipButtons), h('div', { class: 'bet-buttons' }, this.clearBtn, this.rebetBtn, this.dealBtn));

    for (const action of ['hit', 'stand', 'double', 'split'] as Action[]) {
      const btn = h(
        'button',
        { class: `btn big action-${action}`, onclick: press(() => send(net.act(action))) },
        ACTION_LABELS[action],
        h('kbd', {}, Object.keys(ACTION_KEYS).find((k) => ACTION_KEYS[k] === action)!.toUpperCase()),
      );
      this.actionButtons.set(action, btn);
      this.actionsRow.append(btn);
    }

    this.insuranceYes = h('button', { class: 'btn gold', onclick: press(() => send(net.insurance(true))) }, 'Take insurance');
    this.insuranceRow.append(
      this.insuranceText,
      this.insuranceYes,
      h('button', { class: 'btn ghost', onclick: press(() => send(net.insurance(false))) }, 'No thanks'),
    );

    this.hostBtn = h('button', { class: 'btn gold big', onclick: press(() => send(net.hostStart())) }, 'Start round');
    this.addBotBtn = h('button', { class: 'btn ghost small', onclick: press(() => send(net.addBot())) }, '+ Add bot');
    this.hostRow.append(this.hostBtn, this.addBotBtn);
    this.seatRow.append(h('button', { class: 'btn gold', onclick: press(() => send(net.takeSeat())) }, 'Take a seat'));
    this.brokeRow.append(
      h('span', {}, 'Out of chips?'),
      h('button', { class: 'btn gold', onclick: press(() => send(net.resetChips())) }, 'Refill to 1,000'),
    );

    const refill = (this.refillBtn = h(
      'button',
      {
        class: 'refill-btn',
        hidden: true,
        title: 'Free refill to 1,000 chips (when you are down to 100 or less)',
        'aria-label': 'Free refill to 1,000 chips',
        onclick: press(() => {
          if (confirm('Refill your chips back to 1,000?')) void send(net.resetChips());
        }),
      },
      '↻',
    ));
    const wallet = h('div', { class: 'wallet' }, h('span', {}, 'Chips ', this.balanceEl, refill), h('span', {}, 'Bet ', this.betEl));
    if (opts.game === 'poker') this.poker = new PokerControls(net, press);
    if (opts.game === 'roulette') this.roulette = new RouletteControls(net, press, opts.play);
    const controls = h(
      'footer',
      { class: 'controls' },
      this.poker ? this.poker.cards : this.roulette ? this.roulette.info : this.myCards,
      wallet,
      this.hostRow,
      this.poker?.raiseRow ?? null,
      this.poker?.row ?? null,
      this.roulette?.row ?? null,
      this.insuranceRow,
      this.actionsRow,
      this.bettingRow,
      this.seatRow,
      this.brokeRow,
    );

    // --- Side panels ---
    const chatForm = h(
      'form',
      {
        class: 'chat-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          const text = this.chatInput.value.trim();
          if (!text) return;
          void net.chat(text).then((res) => {
            if (res.ok) this.chatInput.value = '';
            else toast(res.error, 'error');
          });
        },
      },
      this.chatInput,
      h('button', { class: 'btn small gold', type: 'submit' }, 'Send'),
    );
    this.chatPanel = h(
      'aside',
      { class: 'panel chat-panel', hidden: true },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Table chat'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => this.togglePanel(null) }, '✕')),
      this.chatLog,
      chatForm,
    );
    this.playersPanel = h(
      'aside',
      { class: 'panel players-panel', hidden: true },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Players'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => this.togglePanel(null) }, '✕')),
      this.playersList,
      h(
        'div',
        { class: 'panel-foot' },
        (this.panelRefillBtn = h('button', { class: 'btn ghost small', hidden: true, onclick: press(() => send(net.resetChips())) }, 'Free refill to 1,000 chips')),
        h('button', { class: 'btn ghost small', onclick: press(() => opts.onLeave()) }, 'Leave table'),
      ),
    );

    this.helpPanel = h(
      'aside',
      { class: 'panel help-panel', hidden: true },
      h('div', { class: 'panel-head' }, h('h2', {}, 'How to play'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => this.togglePanel(null) }, '✕')),
      h(
        'div',
        { class: 'help-body' },
        rulesContent(opts.game),
        h(
          'p',
          { class: 'muted' },
          opts.game === 'poker'
            ? 'Keys: F fold · C check or call · R raise. Drag on the table to look around.'
            : 'Keys: H hit · S stand · D double · P split. Drag on the table to look around; double-click to look straight ahead.',
        ),
      ),
    );

    // Sound settings.
    const slider = (label: string, id: string, value: number, onInput: (v: number) => void) => {
      const input = h('input', { type: 'range', id, min: 0, max: 100, value: Math.round(value * 100), 'aria-label': label });
      input.addEventListener('input', () => onInput(Number(input.value) / 100));
      return h('label', { class: 'slider-row', for: id }, h('span', {}, label), input);
    };
    const voiceBox = h('input', { type: 'checkbox', id: 'dealer-voice', checked: opts.sound.voice });
    voiceBox.addEventListener('change', () => opts.sound.setVoice(voiceBox.checked));
    const muteBox = h('input', { type: 'checkbox', id: 'mute-all', checked: opts.sound.muted });
    muteBox.addEventListener('change', () => {
      opts.sound.setMuted(muteBox.checked);
      this.updateToggles();
    });
    this.soundPanel = h(
      'aside',
      { class: 'panel sound-panel', hidden: true },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Sound'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => this.togglePanel(null) }, '✕')),
      h(
        'div',
        { class: 'sound-body' },
        slider('Music', 'vol-music', opts.sound.music, (v) => opts.sound.setMusic(v)),
        slider('Effects', 'vol-sfx', opts.sound.sfx, (v) => {
          opts.sound.setSfx(v);
          opts.play?.('chip');
        }),
        h('label', { class: 'check-row', for: 'dealer-voice' }, voiceBox, h('span', {}, 'Dealer speaks out loud')),
        h('label', { class: 'check-row', for: 'mute-all' }, muteBox, h('span', {}, 'Mute everything')),
      ),
    );

    // Inviting friends: the code, a ready-to-send message with the link, copy / share, and a QR code.
    const invite = opts.invite ?? null;
    const tableCode = net.session?.code ?? '';
    const inviteUrl = invite?.link ?? '';
    const message = `Join my blackjack table! 🃏\nTable code: ${tableCode}\n${inviteUrl}`;
    const linkField = h('input', { class: 'field invite-link', id: 'invite-link', readonly: true, value: inviteUrl, 'aria-label': 'Invite link' });
    linkField.addEventListener('focus', () => linkField.select());
    const messageField = h('textarea', { class: 'field invite-message', id: 'invite-message', readonly: true, rows: 3, 'aria-label': 'Invite message' }, message);
    messageField.addEventListener('focus', () => messageField.select());
    const copyText = async (text: string, field: HTMLInputElement | HTMLTextAreaElement, what: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast(`${what} copied. Paste it to your friends.`);
      } catch {
        field.focus();
        field.select();
        toast('Press Ctrl+C (or ⌘C) to copy the selected text');
      }
    };
    const share = async () => {
      try {
        await navigator.share({ title: 'Blackjack table', text: `Join my blackjack table! Table code: ${tableCode}`, url: inviteUrl });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') void copyText(message, messageField, 'Invite');
      }
    };
    this.invitePanel = h(
      'aside',
      { class: 'panel invite-panel', hidden: true },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Invite friends'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => this.togglePanel(null) }, '✕')),
      h(
        'div',
        { class: 'invite-body' },
        h('div', { class: 'invite-code' }, h('span', {}, 'Table code'), h('strong', { id: 'invite-code' }, tableCode)),
        h('label', { class: 'field-label', for: 'invite-message' }, 'Ready to send'),
        messageField,
        h(
          'div',
          { class: 'invite-actions' },
          h('button', { class: 'btn gold', onclick: press(() => copyText(message, messageField, 'Invite')) }, 'Copy message'),
          h('button', { class: 'btn ghost', onclick: press(() => copyText(inviteUrl, linkField, 'Link')) }, 'Copy link'),
          typeof navigator.share === 'function' ? h('button', { class: 'btn ghost', onclick: press(share) }, 'Share…') : null,
        ),
        h('label', { class: 'field-label', for: 'invite-link' }, 'Link'),
        linkField,
        invite?.note ? h('p', { class: 'muted invite-note' }, invite.note) : null,
        h('div', { class: 'invite-qr-wrap' }, this.inviteQr, h('span', { class: 'muted' }, 'Friends next to you can scan this with their phone camera.')),
      ),
    );
    if (inviteUrl) {
      void import('qrcode')
        .then((QR) => QR.toCanvas(this.inviteQr, inviteUrl, { width: 220, margin: 1, color: { dark: '#14100c', light: '#f6f1e4' } }))
        .catch(() => (this.inviteQr.hidden = true));
    }

    this.el = h(
      'div',
      { class: 'hud' },
      top,
      banner,
      controls,
      this.chatPanel,
      this.playersPanel,
      this.helpPanel,
      this.soundPanel,
      this.invitePanel,
      this.celebration,
      this.offline,
    );

    // Keyboard shortcuts (ignored while typing in chat).
    window.addEventListener('keydown', this.onKey);
    this.tickTimer();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const s = this.state;
    if (!s) return;
    if (s.game === 'poker') {
      if (this.poker?.key(e.key.toLowerCase())) e.preventDefault();
      return;
    }
    if (s.game === 'roulette') {
      if (this.roulette?.key(e.key.toLowerCase())) e.preventDefault();
      return;
    }
    const action = ACTION_KEYS[e.key.toLowerCase()];
    if (action && s.turn?.playerId === this.net.me && s.turn.actions.includes(action)) {
      this.actionButtons.get(action)!.click();
    } else if ((e.key === ' ' || e.key === 'Enter') && s.phase === 'betting' && !this.dealBtn.disabled) {
      e.preventDefault();
      this.dealBtn.click();
    }
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    cancelAnimationFrame(this.timerFrame);
    this.el.remove();
  }

  setConnection(status: 'connecting' | 'online' | 'offline'): void {
    this.offline.hidden = status === 'online';
    this.statusDot.className = `status-dot ${status}`;
    this.statusDot.title = status === 'online' ? 'Connected' : status === 'offline' ? 'Disconnected, reconnecting…' : 'Connecting…';
  }

  update(anyState: AnyState): void {
    if (anyState.game === 'poker') return this.updatePoker(anyState);
    if (anyState.game === 'roulette') return this.updateRoulette(anyState);
    const state = anyState;
    const me = state.players.find((p) => p.id === this.net.me);
    // Remember what we bet so "Rebet" can repeat it.
    if (this.lastPhase === 'betting' && state.phase !== 'betting' && me && me.bet > 0) this.lastBet = me.bet;
    this.lastPhase = state.phase;
    this.state = state;

    this.banner.textContent = bannerText(state, this.net.me);
    // Solo tables are private, so there is nobody to invite.
    this.inviteBtn.hidden = state.solo || !this.opts.invite;
    this.balanceEl.textContent = me ? money(me.balance) : '–';
    const onTable = me && state.phase !== 'results' ? me.hands.reduce((s, x) => s + x.bet, 0) || me.bet : 0;
    this.betEl.textContent = money(onTable);

    const seated = me?.seat !== null && me !== undefined;
    const betting = state.phase === 'betting' && seated;
    show(this.bettingRow, betting && !me!.ready);
    if (betting) {
      this.chipButtons.forEach((btn, i) => {
        const v = CHIP_VALUES[i]!;
        btn.disabled = v > me!.balance || me!.bet + v > state.limits.maxBet;
      });
      this.clearBtn.disabled = me!.bet === 0;
      this.rebetBtn.hidden = !(this.lastBet > 0 && me!.bet === 0);
      this.rebetBtn.disabled = this.lastBet > me!.balance;
      this.dealBtn.disabled = me!.bet < state.limits.minBet;
      this.rebetBtn.textContent = `Rebet ${money(this.lastBet)}`;
    }

    const myTurn = state.phase === 'playing' && state.turn?.playerId === this.net.me;
    show(this.actionsRow, myTurn);
    if (myTurn) {
      for (const [action, btn] of this.actionButtons) {
        const allowed = state.turn!.actions.includes(action);
        btn.disabled = !allowed;
        btn.hidden = !allowed && (action === 'split' || action === 'double');
      }
    }

    const insuranceDecision = state.phase === 'insurance' && me?.inRound && me.insurance === null;
    show(this.insuranceRow, Boolean(insuranceDecision));
    if (insuranceDecision) {
      // With a blackjack, insurance is "even money": you're paid 1 to 1 right away, whatever the dealer has.
      const evenMoney = me!.hands[0]!.label === 'Blackjack';
      this.insuranceText.textContent = evenMoney
        ? `Blackjack against an ace. Take even money (a sure win of ${money(me!.hands[0]!.bet)})?`
        : `Dealer shows an ace. Insure for ${money(me!.hands[0]!.bet / 2)}?`;
      this.insuranceYes.textContent = evenMoney ? 'Even money' : 'Take insurance';
    }

    const isHost = me?.isHost ?? false;
    const canStart = isHost && !state.solo && (state.phase === 'waiting' || (state.phase === 'betting' && state.players.some((p) => p.bet > 0)));
    const seatsFree = state.players.filter((p) => p.seat !== null).length < 5;
    const canAddBot = isHost && !state.solo && seatsFree && (state.phase === 'waiting' || state.phase === 'betting');
    show(this.hostRow, canStart || canAddBot);
    this.hostBtn.hidden = !canStart;
    this.addBotBtn.hidden = !canAddBot;
    this.renderMyCards(state);
    this.hostBtn.textContent = state.phase === 'waiting' ? 'Start round' : 'Deal now for everyone';
    this.hostBtn.className = state.phase === 'waiting' ? 'btn gold big' : 'btn ghost small';

    const freeSeat = state.players.filter((p) => p.seat !== null).length < (state.solo ? 1 : 5);
    show(this.seatRow, Boolean(me && me.seat === null && freeSeat));
    const broke = Boolean(me && me.seat !== null && !me.inRound && me.balance + me.bet < state.limits.minBet);
    show(this.brokeRow, broke);
    this.showRefill(me && me.seat !== null ? me.balance + me.bet : null, state.phase !== 'betting' && me?.inRound === true && state.phase !== 'results');

    this.renderPlayers(state);
  }

  /** Poker: the action buttons, your cards, and the host's Start / Add bot buttons. */
  private updatePoker(state: PokerState): void {
    this.state = state;
    const me = state.players.find((p) => p.id === this.net.me);
    this.banner.textContent = pokerBanner(state, this.net.me);
    this.inviteBtn.hidden = !this.opts.invite;
    this.balanceEl.textContent = me ? money(me.balance) : '–';
    this.betEl.textContent = money(state.pot);
    this.betEl.previousSibling!.textContent = 'Pot ';
    for (const row of [this.bettingRow, this.actionsRow, this.insuranceRow, this.myCards]) row.hidden = true;
    this.poker!.update(state);
    const isHost = me?.isHost ?? false;
    const seated = state.players.filter((p) => p.seat !== null);
    const canStart = isHost && !state.running && state.phase === 'waiting';
    const canAddBot = isHost && seated.length < 6;
    show(this.hostRow, canStart || canAddBot);
    this.hostBtn.hidden = !canStart;
    this.hostBtn.textContent = 'Start the game';
    this.hostBtn.className = 'btn gold big';
    this.addBotBtn.hidden = !canAddBot;
    const freeSeat = seated.length < 6;
    show(this.seatRow, Boolean(me && me.seat === null && freeSeat));
    show(this.brokeRow, Boolean(me && me.seat !== null && me.balance === 0 && !me.inHand));
    this.showRefill(me && me.seat !== null ? me.balance + me.bet : null, Boolean(me?.inHand && state.phase !== 'waiting' && state.phase !== 'results'));
    // Your big win gets a celebration.
    const myWin = state.phase === 'results' ? state.winners.find((w) => w.playerId === this.net.me) : undefined;
    const key = `${state.round}`;
    if (myWin && this.celebratedHand !== key) {
      this.celebratedHand = key;
      this.celebrateText('You win!', `${money(myWin.amount)} chips${myWin.handName ? ` · ${myWin.handName}` : ''}`, myWin.amount >= 200);
      this.opts.play?.('chip');
    }
    this.renderPlayers(state);
  }

  /** Roulette: chips, quick bets, Spin, and the host's Start / Add bot buttons. */
  private updateRoulette(state: RouletteState): void {
    this.state = state;
    const me = state.players.find((p) => p.id === this.net.me);
    this.banner.textContent = rouletteBanner(state, this.net.me);
    this.inviteBtn.hidden = state.solo || !this.opts.invite;
    this.balanceEl.textContent = me ? money(me.balance) : '–';
    const staked = me ? me.bets.reduce((s, b) => s + b.amount, 0) : 0;
    this.betEl.textContent = money(state.phase === 'results' ? me?.staked ?? 0 : staked);
    for (const row of [this.bettingRow, this.actionsRow, this.insuranceRow, this.myCards]) row.hidden = true;
    this.roulette!.update(state, this.net.me);
    const isHost = me?.isHost ?? false;
    const seated = state.players.filter((p) => p.seat !== null);
    const canStart = isHost && !state.solo && !state.running && state.phase === 'waiting';
    const canAddBot = isHost && !state.solo && seated.length < 6 && (state.phase === 'waiting' || state.phase === 'betting');
    show(this.hostRow, canStart || canAddBot);
    this.hostBtn.hidden = !canStart;
    this.hostBtn.textContent = 'Open the betting';
    this.hostBtn.className = 'btn gold big';
    this.addBotBtn.hidden = !canAddBot;
    show(this.seatRow, Boolean(me && me.seat === null && seated.length < 6));
    show(this.brokeRow, Boolean(me && me.seat !== null && me.balance + staked < state.limits.minBet && state.phase !== 'spinning'));
    this.showRefill(me && me.seat !== null ? me.balance + staked : null, state.phase === 'spinning');
    const key = `${state.round}`;
    if (state.phase === 'results' && me && me.won > 0 && this.celebratedHand !== key) {
      this.celebratedHand = key;
      const straight = me.won >= me.staked * 10;
      this.celebrateText(straight ? 'Straight up!' : 'Winner!', `${pocketName(state.result ?? 0)} · ${money(me.won)} chips back`, straight);
      this.opts.play?.('chip');
    }
    this.renderPlayers(state);
  }

  /** The free refill shows only for players down to 100 chips or less (vault included). */
  private showRefill(chips: number | null, busy: boolean): void {
    const ok = chips !== null && !busy && canRefill(chips);
    this.refillBtn.hidden = !ok;
    this.panelRefillBtn.hidden = !ok;
    // Chips in your vault come first: take them out at the Cashier.
    if (!ok) this.brokeRow.hidden = true;
  }

  private renderPlayers(state: AnyState): void {
    const amHost = state.hostId === this.net.me;
    const row = (p: PublicPlayer | PokerPlayer | RoulettePlayer) =>
      h(
        'li',
        { class: p.connected ? '' : 'away' },
        h('span', { class: 'p-name' }, p.isHost ? '👑 ' : '', p.name, p.id === this.net.me ? ' (you)' : '', p.bot ? h('span', { class: 'bot-tag' }, 'bot') : null),
        h('span', { class: 'p-meta' }, p.seat === null ? 'watching' : `seat ${p.seat + 1}`, ' · ', money(p.balance), p.connected ? '' : ' · away'),
        amHost && p.id !== this.net.me
          ? h(
              'button',
              {
                class: 'btn tiny ghost',
                onclick: () => {
                  if (confirm(`Remove ${p.name} from the table?`)) void this.net.kick(p.id).then((r) => !r.ok && toast(r.error, 'error'));
                },
              },
              'Kick',
            )
          : null,
      );
    this.playersList.replaceChildren(...(state.players as (PublicPlayer | PokerPlayer | RoulettePlayer)[]).map(row));
  }

  addChat(msg: ChatMessage): void {
    const mine = msg.playerId === this.net.me;
    const line = h(
      'div',
      { class: `chat-line${msg.playerId ? '' : ' system'}${mine ? ' mine' : ''}` },
      msg.playerId ? h('b', {}, msg.name, ': ') : null,
      msg.text,
    );
    this.chatLog.append(line);
    while (this.chatLog.childElementCount > 80) this.chatLog.firstElementChild?.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    if (this.chatPanel.hidden && msg.playerId && !mine) {
      this.unreadChat++;
      this.chatBadge.textContent = String(this.unreadChat);
      this.chatBadge.hidden = false;
      toast(`${msg.name}: ${msg.text}`);
    }
  }

  setChatHistory(msgs: ChatMessage[]): void {
    this.chatLog.replaceChildren();
    for (const m of msgs) this.addChat(m);
    this.unreadChat = 0;
    this.chatBadge.hidden = true;
  }

  private togglePanel(which: 'chat' | 'players' | 'help' | 'sound' | 'invite' | null): void {
    const openInvite = which === 'invite' && this.invitePanel.hidden;
    this.invitePanel.hidden = !openInvite;
    const openChat = which === 'chat' && this.chatPanel.hidden;
    const openPlayers = which === 'players' && this.playersPanel.hidden;
    const openHelp = which === 'help' && this.helpPanel.hidden;
    const openSound = which === 'sound' && this.soundPanel.hidden;
    this.chatPanel.hidden = !openChat;
    this.playersPanel.hidden = !openPlayers;
    this.helpPanel.hidden = !openHelp;
    this.soundPanel.hidden = !openSound;
    if (openChat) {
      this.unreadChat = 0;
      this.chatBadge.hidden = true;
      this.chatLog.scrollTop = this.chatLog.scrollHeight;
      if (!matchMedia('(pointer: coarse)').matches) this.chatInput.focus();
    }
  }

  /** Opens the invite panel (right after creating a table, so the code and link are ready). */
  openInvite(): void {
    if (this.opts.invite && this.invitePanel.hidden) this.togglePanel('invite');
  }

  /** A big moment: your 21 or blackjack gets a banner and confetti; others get a note. */
  celebrate(kind: 'blackjack' | 'twentyone', mine: boolean, name: string): void {
    if (!mine) {
      toast(kind === 'blackjack' ? `${name} has blackjack!` : `${name} made 21`);
      return;
    }
    const big = kind === 'blackjack';
    this.celebrateText(big ? 'Blackjack!' : '21!', big ? 'Pays 3 to 2' : 'Twenty-one', big);
  }

  /** A gold banner in the middle of the screen; `big` adds confetti. */
  private celebrateText(title: string, subtitle: string, big: boolean): void {
    const confetti = big
      ? Array.from({ length: 48 }, (_, i) =>
          h('i', {
            class: 'confetti',
            style: {
              left: `${Math.random() * 100}%`,
              background: ['#f2c94c', '#e2574c', '#5bc0eb', '#9bc53d', '#ffffff', '#c77dff'][i % 6],
              animationDelay: `${Math.random() * 0.4}s`,
              animationDuration: `${1.8 + Math.random() * 1.2}s`,
              transform: `rotate(${Math.random() * 360}deg)`,
            },
          }),
        )
      : [];
    this.celebration.className = `celebration show ${big ? 'blackjack' : 'twentyone'}`;
    this.celebration.replaceChildren(
      ...confetti,
      h('div', { class: 'celebration-text' }, title, h('small', {}, subtitle)),
    );
    clearTimeout(this.celebrationTimer);
    this.celebrationTimer = setTimeout(() => (this.celebration.className = 'celebration'), big ? 3200 : 2000);
  }

  /** Your hands as big, readable cards, plus the dealer's visible cards. */
  private renderMyCards(state: PublicState): void {
    const me = state.players.find((p) => p.id === this.net.me);
    const hands = me?.hands ?? [];
    const key = JSON.stringify([hands, state.dealer.cards, state.turn, state.phase]);
    if (key === this.myCardsKey) return;
    this.myCardsKey = key;
    this.myCards.hidden = hands.length === 0;
    if (!hands.length) return;
    // Only cards that weren't shown before slide in.
    const seen = this.shownCards;
    const next = new Set<string>();
    const card = (where: string) => (c: Card | null, i: number) => {
      const id = `${where}:${i}:${c ? c.rank + c.suit : 'back'}`;
      next.add(id);
      const fresh = !seen.has(id) ? ' fresh' : '';
      return c
        ? h('span', { class: `mc-card${isRed(c) ? ' red' : ''}${fresh}`, 'aria-label': `${c.rank} of ${c.suit}` }, h('b', {}, c.rank), SUIT_SYMBOL[c.suit])
        : h('span', { class: `mc-card back${fresh}`, 'aria-label': 'face-down card' });
    };
    this.shownCards = next;
    const dealer = h(
      'div',
      { class: 'mc-hand dealer' },
      h('span', { class: 'mc-who' }, 'Dealer'),
      h('span', { class: 'mc-cards' }, state.dealer.cards.map(card('d'))),
      state.dealer.label ? h('span', { class: 'mc-total' }, state.dealer.label) : null,
    );
    const mine = hands.map((hand, i) => {
      const active = state.phase === 'playing' && state.turn?.playerId === me!.id && state.turn.handIndex === i;
      return h(
        'div',
        { class: `mc-hand${active ? ' active' : ''}${hand.outcome ? ` ${hand.outcome}` : ''}` },
        h('span', { class: 'mc-who' }, hands.length > 1 ? `Hand ${i + 1}` : 'You'),
        h('span', { class: 'mc-cards' }, hand.cards.map(card(`h${i}`))),
        h(
          'span',
          { class: 'mc-total' },
          !hand.outcome ? hand.label : hand.outcome === 'blackjack' ? 'Blackjack!' : `${hand.label} · ${OUTCOME_TEXT[hand.outcome]}`,
        ),
      );
    });
    this.myCards.replaceChildren(dealer, ...mine);
  }

  /** Called when the scene lowered graphics on its own. */
  setLowGraphics(low: boolean): void {
    this.opts.lowGraphics = low;
    this.updateToggles();
  }

  private toggleGfx(): void {
    this.opts.lowGraphics = this.opts.onToggleGraphics();
    this.updateToggles();
    toast(this.opts.lowGraphics ? 'Low graphics: faster, simpler' : 'High graphics: shadows and effects on');
  }

  private updateToggles(): void {
    this.muteBtn.textContent = this.opts.sound.muted ? '🔇' : '🔊';
    this.gfxBtn.textContent = this.opts.lowGraphics ? '◐' : '●';
    this.gfxBtn.title = this.opts.lowGraphics ? 'Low graphics (click for high)' : 'High graphics (click for low)';
  }

  /** Smooth countdown bar, driven by the server's deadline. */
  private tickTimer = () => {
    const s = this.state;
    const timed = s?.game === 'poker' ? Boolean(s.turn) : Boolean(s && ['betting', 'insurance', 'playing'].includes(s.phase));
    if (s?.deadline && timed) {
      const left = Math.max(0, s.deadline - this.net.now());
      this.timerBar.style.transform = `scaleX(${Math.min(1, left / (s.timerMs || 1))})`;
      this.timerBar.classList.toggle('urgent', left < 5000);
      this.timerText.textContent = `${Math.ceil(left / 1000)}s`;
      this.timerBar.parentElement!.hidden = false;
      this.timerText.hidden = false;
    } else {
      this.timerBar.parentElement!.hidden = true;
      this.timerText.hidden = true;
    }
    this.timerFrame = requestAnimationFrame(this.tickTimer);
  };
}
