// Roulette controls for the HUD: pick a chip, quick outside bets, Clear / Rebet / Spin,
// your bets in words, and the last numbers that came up.
// Bets on single numbers, dozens and columns are placed by tapping the 3D layout.

import { pocketColor, spotLabel } from '../game/index.js';
import { CHIP_VALUES, type RouletteState } from '../shared/protocol.js';
import { h, toast } from './dom.js';
import { money } from './format.js';
import type { Net } from './net.js';

const QUICK: [string, string][] = [
  ['red', 'Red'],
  ['black', 'Black'],
  ['green', 'Green 0'],
  ['odd', 'Odd'],
  ['even', 'Even'],
  ['low', '1–18'],
  ['high', '19–36'],
];

export class RouletteControls {
  readonly row = h('div', { class: 'row roulette-row' });
  readonly info = h('div', { class: 'my-cards roulette-info', 'aria-live': 'polite' });
  private readonly history = h('div', { class: 'roulette-history', 'aria-label': 'Last numbers' });
  private readonly myBets = h('div', { class: 'roulette-bets' });
  private readonly chips: HTMLButtonElement[] = [];
  private readonly quick: HTMLButtonElement[] = [];
  private readonly clear: HTMLButtonElement;
  private readonly rebet: HTMLButtonElement;
  private readonly spin: HTMLButtonElement;
  private chip: number = CHIP_VALUES[1];
  private historyKey = '';

  constructor(
    private readonly net: Net,
    press: (fn: () => unknown) => () => void,
    private readonly play?: (name: 'click' | 'chip') => void,
  ) {
    const send = (p: Promise<{ ok: boolean; error?: string }>) =>
      p.then((res) => {
        if (!res.ok && 'error' in res) toast(res.error ?? 'Error', 'error');
      });
    for (const value of CHIP_VALUES) {
      const btn = h(
        'button',
        { class: `chip chip-${value}`, 'aria-label': `Use ${value} chips`, 'aria-pressed': 'false', onclick: press(() => this.pick(value)) },
        h('span', {}, String(value)),
      );
      this.chips.push(btn);
    }
    for (const [spot, label] of QUICK) {
      this.quick.push(h('button', { class: `btn small quick-bet q-${spot}`, onclick: press(() => this.bet(spot)) }, label));
    }
    this.clear = h('button', { class: 'btn ghost', onclick: press(() => send(net.rouletteClear())) }, 'Clear');
    this.rebet = h('button', { class: 'btn ghost', onclick: press(() => send(net.rouletteRebet())) }, 'Rebet');
    this.spin = h('button', { class: 'btn gold big spin-btn', onclick: press(() => send(net.rouletteReady())) }, 'Spin');
    this.row.append(
      h('div', { class: 'chips selectable' }, this.chips),
      h('div', { class: 'quick-bets' }, this.quick),
      h('div', { class: 'bet-buttons' }, this.clear, this.rebet, this.spin),
    );
    this.info.append(this.history, this.myBets);
    this.pick(this.chip);
  }

  get chipValue(): number {
    return this.chip;
  }

  private pick(value: number): void {
    this.chip = value;
    this.chips.forEach((b, i) => {
      const on = CHIP_VALUES[i] === value;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /** Puts the selected chip on a spot (from a button or a tap on the 3D layout). */
  bet(spot: string): void {
    this.play?.('chip');
    void this.net.rouletteBet(spot, this.chip).then((res) => {
      if (!res.ok) toast(res.error, 'error');
    });
  }

  key(k: string): boolean {
    if (k === ' ' || k === 'enter') {
      if (!this.spin.hidden && !this.spin.disabled) this.spin.click();
      return true;
    }
    const i = ['1', '2', '3', '4'].indexOf(k);
    if (i >= 0) {
      this.pick(CHIP_VALUES[i]!);
      return true;
    }
    return false;
  }

  update(state: RouletteState, me: string | null): void {
    const mine = state.players.find((p) => p.id === me);
    const seated = Boolean(mine && mine.seat !== null);
    const open = seated && (state.phase === 'betting' || (state.phase === 'waiting' && (state.solo || state.running)));
    const waitingForHost = state.phase === 'waiting' && !state.solo && !state.running;
    this.row.hidden = !seated || state.phase === 'spinning' || state.phase === 'results';
    const staked = mine ? mine.bets.reduce((s, b) => s + b.amount, 0) : 0;
    this.chips.forEach((b, i) => (b.disabled = !open || CHIP_VALUES[i]! > (mine?.balance ?? 0)));
    for (const b of this.quick) b.disabled = !open;
    this.clear.disabled = !open || staked === 0;
    this.rebet.hidden = !mine?.canRebet || staked > 0;
    this.rebet.disabled = !open;
    this.spin.disabled = !open || staked === 0 || Boolean(mine?.ready) || waitingForHost;
    this.spin.textContent = mine?.ready ? 'Ready ✓' : 'Spin';

    // Your bets in words.
    if (mine?.bets.length) {
      this.myBets.replaceChildren(
        h('span', { class: 'muted' }, 'Your bets: '),
        ...mine.bets.map((b) => h('span', { class: `rb rb-${b.spot.startsWith('n:') ? pocketColor(Number(b.spot.slice(2))) : b.spot}` }, `${spotLabel(b.spot)} · ${money(b.amount)}`)),
      );
    } else this.myBets.replaceChildren(h('span', { class: 'muted' }, open ? `Chip: ${money(this.chip)}. Tap a number or a box on the table.` : ''));

    const key = state.history.join(',');
    if (key !== this.historyKey) {
      this.historyKey = key;
      this.history.replaceChildren(
        h('span', { class: 'muted' }, 'Last: '),
        ...state.history.slice(0, 10).map((n, i) => h('span', { class: `rh rh-${pocketColor(n)}${i === 0 ? ' latest' : ''}` }, String(n))),
      );
    }
  }
}
