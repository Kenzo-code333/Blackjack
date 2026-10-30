// The heads-up display: everything you click. It sits on top of the table view
// (2D or 3D) and never draws the table itself.

import type { Action } from '../game/index.js';
import { CHIP_VALUES, type ChatMessage, type PublicPlayer, type PublicState } from '../shared/protocol.js';
import { h, show, toast } from './dom.js';
import { bannerText, money } from './format.js';
import type { Net } from './net.js';

export interface HudOptions {
  onLeave: () => void;
  onToggleMute: () => boolean; // returns new muted state
  onToggleGraphics: () => boolean; // returns new low-graphics state
  muted: boolean;
  lowGraphics: boolean;
  /** Called after any button press, e.g. to unlock audio on mobile. */
  onInteract?: () => void;
  /** Click feedback sounds. */
  sound?: (name: 'click' | 'chip') => void;
}

const ACTION_LABELS: Record<Action, string> = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split' };
const ACTION_KEYS: Record<string, Action> = { h: 'hit', s: 'stand', d: 'double', p: 'split' };

export class Hud {
  readonly el: HTMLElement;
  private state: PublicState | null = null;
  private lastBet = 0;
  private lastPhase = '';
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
  private readonly hostRow = h('div', { class: 'row host' });
  private readonly hostBtn: HTMLButtonElement;
  private readonly seatRow = h('div', { class: 'row seat' });
  private readonly brokeRow = h('div', { class: 'row broke' });
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
      opts.sound?.('click');
      void fn();
    };
    const send = (p: Promise<{ ok: boolean; error?: string }>) =>
      p.then((res) => {
        if (!res.ok && 'error' in res) toast(res.error ?? 'Error', 'error');
      });

    // --- Top bar ---
    const code = net.session?.code ?? '';
    const inviteBtn = (this.inviteBtn = h('button', { class: 'btn small gold invite', 'aria-label': 'Copy invite link', onclick: press(() => this.invite()) }, h('span', { class: 'long' }, 'Copy invite link'), h('span', { class: 'short' }, '🔗', h('span', { class: 'invite-word' }, ' Invite'))));
    this.muteBtn = h('button', { class: 'icon-btn', title: 'Sound on/off', 'aria-label': 'Sound', onclick: press(() => this.toggleMute()) });
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
      h('button', { class: 'icon-btn', title: 'Leave table', 'aria-label': 'Leave table', onclick: press(() => opts.onLeave()) }, '←'),
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
            opts.sound?.('chip');
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

    this.insuranceRow.append(
      this.insuranceText,
      h('button', { class: 'btn gold', onclick: press(() => send(net.insurance(true))) }, 'Take insurance'),
      h('button', { class: 'btn ghost', onclick: press(() => send(net.insurance(false))) }, 'No thanks'),
    );

    this.hostBtn = h('button', { class: 'btn gold big', onclick: press(() => send(net.hostStart())) }, 'Start round');
    this.hostRow.append(this.hostBtn);
    this.seatRow.append(h('button', { class: 'btn gold', onclick: press(() => send(net.takeSeat())) }, 'Take a seat'));
    this.brokeRow.append(
      h('span', {}, 'Out of chips?'),
      h('button', { class: 'btn gold', onclick: press(() => send(net.resetChips())) }, 'Reset to 1,000'),
    );

    const wallet = h('div', { class: 'wallet' }, h('span', {}, 'Chips ', this.balanceEl), h('span', {}, 'Bet ', this.betEl));
    const controls = h('footer', { class: 'controls' }, wallet, this.hostRow, this.insuranceRow, this.actionsRow, this.bettingRow, this.seatRow, this.brokeRow);

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
        h('button', { class: 'btn ghost small', onclick: press(() => send(net.resetChips())) }, 'Reset my chips'),
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
        h('p', {}, 'Get closer to 21 than the dealer without going over. Face cards count 10, aces 1 or 11.'),
        h(
          'ul',
          {},
          h('li', {}, h('b', {}, 'Bet: '), 'tap the chips (or your chip stacks on the table), then ', h('b', {}, 'Deal'), '.'),
          h('li', {}, h('b', {}, 'Hit'), ' (H) take a card · ', h('b', {}, 'Stand'), ' (S) keep your hand'),
          h('li', {}, h('b', {}, 'Double'), ' (D) double the bet, take exactly one card'),
          h('li', {}, h('b', {}, 'Split'), ' (P) a pair into two hands, up to 3 hands'),
          h('li', {}, h('b', {}, 'Insurance'), ' when the dealer shows an ace: half your bet, pays 2 to 1'),
          h('li', {}, 'You have 20 seconds per decision, then you stand automatically.'),
          h('li', {}, 'Drag on the table to look around. Double-click (or double-tap) to look straight ahead.'),
        ),
        h('p', { class: 'muted' }, '6 decks · Dealer stands on soft 17 · Blackjack pays 3 to 2 · Play money only.'),
      ),
    );

    this.el = h('div', { class: 'hud' }, top, banner, controls, this.chatPanel, this.playersPanel, this.helpPanel, this.offline);

    // Keyboard shortcuts (ignored while typing in chat).
    window.addEventListener('keydown', this.onKey);
    this.tickTimer();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const s = this.state;
    if (!s) return;
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

  update(state: PublicState): void {
    const me = state.players.find((p) => p.id === this.net.me);
    // Remember what we bet so "Rebet" can repeat it.
    if (this.lastPhase === 'betting' && state.phase !== 'betting' && me && me.bet > 0) this.lastBet = me.bet;
    this.lastPhase = state.phase;
    this.state = state;

    this.banner.textContent = bannerText(state, this.net.me);
    // Solo tables are private, so there is nobody to invite.
    this.inviteBtn.hidden = state.solo;
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
    if (insuranceDecision) this.insuranceText.textContent = `Dealer shows an ace. Insure for ${money(me!.hands[0]!.bet / 2)}?`;

    const isHost = me?.isHost ?? false;
    const canStart = isHost && !state.solo && (state.phase === 'waiting' || (state.phase === 'betting' && state.players.some((p) => p.bet > 0)));
    show(this.hostRow, canStart);
    this.hostBtn.textContent = state.phase === 'waiting' ? 'Start round' : 'Deal now for everyone';
    this.hostBtn.className = state.phase === 'waiting' ? 'btn gold big' : 'btn ghost small';

    const freeSeat = state.players.filter((p) => p.seat !== null).length < (state.solo ? 1 : 5);
    show(this.seatRow, Boolean(me && me.seat === null && freeSeat));
    const broke = Boolean(me && me.seat !== null && !me.inRound && me.balance + me.bet < state.limits.minBet);
    show(this.brokeRow, broke);

    this.renderPlayers(state);
  }

  private renderPlayers(state: PublicState): void {
    const amHost = state.hostId === this.net.me;
    const row = (p: PublicPlayer) =>
      h(
        'li',
        { class: p.connected ? '' : 'away' },
        h('span', { class: 'p-name' }, p.isHost ? '👑 ' : '', p.name, p.id === this.net.me ? ' (you)' : ''),
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
    this.playersList.replaceChildren(...state.players.map(row));
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

  private togglePanel(which: 'chat' | 'players' | 'help' | null): void {
    const openChat = which === 'chat' && this.chatPanel.hidden;
    const openPlayers = which === 'players' && this.playersPanel.hidden;
    const openHelp = which === 'help' && this.helpPanel.hidden;
    this.chatPanel.hidden = !openChat;
    this.playersPanel.hidden = !openPlayers;
    this.helpPanel.hidden = !openHelp;
    if (openChat) {
      this.unreadChat = 0;
      this.chatBadge.hidden = true;
      this.chatLog.scrollTop = this.chatLog.scrollHeight;
      if (!matchMedia('(pointer: coarse)').matches) this.chatInput.focus();
    }
  }

  private async invite(): Promise<void> {
    const url = `${location.origin}/table/${this.net.session?.code ?? ''}`;
    const data = { title: 'Blackjack table', text: 'Join my blackjack table!', url };
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Invite link copied: send it to your friends');
    } catch {
      prompt('Copy this link and send it to your friends:', url);
    }
  }

  private toggleMute(): void {
    this.opts.muted = this.opts.onToggleMute();
    this.updateToggles();
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
    this.muteBtn.textContent = this.opts.muted ? '🔇' : '🔊';
    this.gfxBtn.textContent = this.opts.lowGraphics ? '◐' : '●';
    this.gfxBtn.title = this.opts.lowGraphics ? 'Low graphics (click for high)' : 'High graphics (click for low)';
  }

  /** Smooth countdown bar, driven by the server's deadline. */
  private tickTimer = () => {
    const s = this.state;
    if (s?.deadline && ['betting', 'insurance', 'playing'].includes(s.phase)) {
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
