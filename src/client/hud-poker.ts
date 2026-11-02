// Poker controls for the HUD: Fold, Check/Call, Raise (with a slider), All in,
// plus a panel with your two cards, the shared cards and the name of your best hand.

import { type Card, bestHand, pokerValue } from '../game/index.js';
import type { PokerState } from '../shared/protocol.js';
import { h, toast } from './dom.js';
import { SUIT_SYMBOL, isRed, money } from './format.js';
import type { Net } from './net.js';

const card = (c: Card | null, fresh = false) =>
  c
    ? h('span', { class: `mc-card${isRed(c) ? ' red' : ''}${fresh ? ' fresh' : ''}`, 'aria-label': `${c.rank} of ${c.suit}` }, h('b', {}, c.rank), SUIT_SYMBOL[c.suit])
    : h('span', { class: 'mc-card back', 'aria-label': 'face-down card' });

const PLURAL: Record<string, string> = {
  '2': 'twos', '3': 'threes', '4': 'fours', '5': 'fives', '6': 'sixes', '7': 'sevens', '8': 'eights',
  '9': 'nines', '10': 'tens', J: 'jacks', Q: 'queens', K: 'kings', A: 'aces',
};

/** Your best hand so far, in words ("Pair of kings"), or null before there's anything to say. */
export function handSoFar(hole: Card[], board: Card[]): string | null {
  if (hole.length < 2) return null;
  if (board.length >= 3) return bestHand([...hole, ...board]).name;
  const [a, b] = hole as [Card, Card];
  return pokerValue(a) === pokerValue(b) ? `Pair of ${PLURAL[a.rank]}` : null;
}

export class PokerControls {
  readonly row = h('div', { class: 'row poker-actions' });
  readonly raiseRow = h('div', { class: 'raise-box', hidden: true });
  readonly cards = h('div', { class: 'my-cards poker-cards', 'aria-live': 'polite' });
  private readonly fold: HTMLButtonElement;
  private readonly checkCall: HTMLButtonElement;
  private readonly raise: HTMLButtonElement;
  private readonly allIn: HTMLButtonElement;
  private readonly slider = h('input', { type: 'range', id: 'raise-amount', min: 0, max: 100, step: 5, 'aria-label': 'Raise to' });
  private readonly amountLabel = h('strong', { class: 'raise-amount' });
  private readonly confirm: HTMLButtonElement;
  private state: PokerState | null = null;
  private cardsKey = '';

  constructor(
    private readonly net: Net,
    press: (fn: () => unknown) => () => void,
  ) {
    const send = (p: Promise<{ ok: boolean; error?: string }>) =>
      p.then((res) => {
        if (!res.ok && 'error' in res) toast(res.error ?? 'Error', 'error');
      });
    this.fold = h('button', { class: 'btn big action-stand', onclick: press(() => send(net.pokerAct('fold'))) }, 'Fold', h('kbd', {}, 'F'));
    this.checkCall = h('button', {
      class: 'btn big action-hit',
      onclick: press(() => send(net.pokerAct(this.state?.turn?.canCheck ? 'check' : 'call'))),
    });
    this.raise = h('button', { class: 'btn big action-double', onclick: press(() => this.toggleRaise()) }, 'Raise', h('kbd', {}, 'R'));
    this.allIn = h('button', { class: 'btn big action-split', onclick: press(() => send(net.pokerAct('allin'))) }, 'All in');
    this.row.append(this.fold, this.checkCall, this.raise, this.allIn);

    this.slider.addEventListener('input', () => this.showAmount());
    const quick = (label: string, pick: (t: NonNullable<PokerState['turn']>, pot: number) => number) =>
      h(
        'button',
        {
          class: 'btn tiny ghost',
          onclick: () => {
            const s = this.state;
            if (!s?.turn) return;
            this.slider.value = String(Math.max(s.turn.minRaiseTo, Math.min(s.turn.maxRaiseTo, pick(s.turn, s.pot))));
            this.showAmount();
          },
        },
        label,
      );
    this.confirm = h(
      'button',
      {
        class: 'btn gold',
        onclick: press(() => {
          void send(net.pokerAct('raise', Number(this.slider.value)));
          this.raiseRow.hidden = true;
        }),
      },
      'Raise',
    );
    this.raiseRow.append(
      h(
        'div',
        { class: 'raise-top' },
        h('label', { for: 'raise-amount' }, 'Raise to '),
        this.amountLabel,
        h('button', { class: 'icon-btn', 'aria-label': 'Cancel raise', onclick: () => (this.raiseRow.hidden = true) }, '✕'),
      ),
      this.slider,
      h(
        'div',
        { class: 'raise-quick' },
        quick('Min', (t) => t.minRaiseTo),
        quick('½ pot', (t, pot) => t.toCall + Math.round(pot / 2 / 5) * 5 + (this.state?.currentBet ?? 0)),
        quick('Pot', (t, pot) => t.toCall + pot + (this.state?.currentBet ?? 0)),
        quick('All in', (t) => t.maxRaiseTo),
      ),
      this.confirm,
    );
  }

  /** Keyboard: F fold, C check/call, R raise. */
  key(k: string): boolean {
    const s = this.state;
    if (!s?.turn || s.turn.playerId !== this.net.me) return false;
    if (k === 'f') this.fold.click();
    else if (k === 'c' || k === 'k') this.checkCall.click();
    else if (k === 'r' && !this.raise.disabled) this.raise.click();
    else return false;
    return true;
  }

  private toggleRaise(): void {
    const t = this.state?.turn;
    if (!t) return;
    this.raiseRow.hidden = !this.raiseRow.hidden;
    if (!this.raiseRow.hidden) {
      this.slider.min = String(t.minRaiseTo);
      this.slider.max = String(t.maxRaiseTo);
      this.slider.value = String(t.minRaiseTo);
      this.showAmount();
    }
  }

  private showAmount(): void {
    const v = Number(this.slider.value);
    const t = this.state?.turn;
    const allIn = t && v >= t.maxRaiseTo;
    this.amountLabel.textContent = allIn ? `${money(v)} (all in)` : money(v);
    this.confirm.textContent = allIn ? 'All in' : (this.state?.currentBet ?? 0) === 0 ? `Bet ${money(v)}` : `Raise to ${money(v)}`;
  }

  update(state: PokerState): void {
    this.state = state;
    const t = state.turn;
    const mine = Boolean(t && t.playerId === this.net.me);
    this.row.hidden = !mine;
    if (!mine) this.raiseRow.hidden = true;
    if (t && mine) {
      this.checkCall.replaceChildren(t.canCheck ? 'Check' : `Call ${money(t.toCall)}`, h('kbd', {}, 'C'));
      const canRaise = t.maxRaiseTo > state.currentBet && t.maxRaiseTo > t.toCall + state.currentBet - (t.canCheck ? 0 : 0);
      this.raise.disabled = !canRaise || t.minRaiseTo >= t.maxRaiseTo;
      this.raise.firstChild!.textContent = state.currentBet === 0 ? 'Bet' : 'Raise';
      this.allIn.hidden = t.maxRaiseTo <= t.toCall;
    }
    this.renderCards(state);
  }

  private renderCards(state: PokerState): void {
    const me = state.players.find((p) => p.id === this.net.me);
    const hole = me?.hole ?? [];
    const key = JSON.stringify([hole, state.board, me?.folded, state.phase]);
    if (key === this.cardsKey) return;
    this.cardsKey = key;
    this.cards.hidden = !hole.length && !state.board.length;
    if (this.cards.hidden) return;
    const name = me?.folded ? 'Folded' : handSoFar(hole, state.board);
    this.cards.replaceChildren(
      state.board.length
        ? h('div', { class: 'mc-hand dealer' }, h('span', { class: 'mc-who' }, 'Table'), h('span', { class: 'mc-cards' }, state.board.map((c) => card(c))))
        : '',
      hole.length
        ? h(
            'div',
            { class: `mc-hand${me?.folded ? ' bust' : ''}` },
            h('span', { class: 'mc-who' }, 'You'),
            h('span', { class: 'mc-cards' }, hole.map((c) => card(c))),
            name ? h('span', { class: 'mc-total' }, name) : null,
          )
        : '',
    );
  }
}
