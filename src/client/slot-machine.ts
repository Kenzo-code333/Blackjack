// A playable three-reel slot machine, shown over the casino floor. It plays with the
// chips in your pocket (your wallet), so wins and losses follow you to the tables.
//
// Pick a bet, pull the lever (or press SPIN / the space bar), and the reels stop one
// after another. Three of a kind on the gold line wins; so do two cherries.

import { REEL, SLOT_BETS, type SlotSymbol, THREE_OF_A_KIND, TWO_CHERRIES, spinReels } from '../game/index.js';
import type { SoundName } from './audio.js';
import { h, toast } from './dom.js';
import { money } from './format.js';
import { prefs } from './storage.js';
import { recordPlay } from './stats.js';

const NAMES: Record<SlotSymbol, [string, string]> = {
  cherry: ['Cherry', 'Cherries'],
  lemon: ['Lemon', 'Lemons'],
  bell: ['Bell', 'Bells'],
  bar: ['Bar', 'Bars'],
  seven: ['Seven', 'Sevens'],
  diamond: ['Diamond', 'Diamonds'],
};

// ---------- Symbol artwork (drawn once) ----------

const art = new Map<SlotSymbol, string>();

function symbolImage(s: SlotSymbol): string {
  const hit = art.get(s);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.translate(80, 80);
  ctx.lineJoin = 'round';
  const shine = (x: number, y: number, r: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  switch (s) {
    case 'cherry': {
      ctx.strokeStyle = '#3f7d22';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(-26, 18);
      ctx.quadraticCurveTo(-18, -30, 14, -52);
      ctx.moveTo(26, 22);
      ctx.quadraticCurveTo(26, -20, 14, -52);
      ctx.stroke();
      ctx.fillStyle = '#4f9a2b';
      ctx.beginPath();
      ctx.ellipse(32, -52, 22, 10, -0.4, 0, Math.PI * 2);
      ctx.fill();
      for (const [x, y] of [
        [-28, 30],
        [26, 34],
      ] as const) {
        const g = ctx.createRadialGradient(x - 8, y - 10, 2, x, y, 30);
        g.addColorStop(0, '#ff6b6b');
        g.addColorStop(0.6, '#c8102e');
        g.addColorStop(1, '#6e0614');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 28, 0, Math.PI * 2);
        ctx.fill();
        shine(x - 9, y - 10, 9);
      }
      break;
    }
    case 'lemon': {
      const g = ctx.createRadialGradient(-14, -16, 4, 0, 0, 60);
      g.addColorStop(0, '#fff6a8');
      g.addColorStop(0.55, '#f7d330');
      g.addColorStop(1, '#b98c0a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, 58, 42, -0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(55, -14, 9, 7, -0.25, 0, Math.PI * 2);
      ctx.ellipse(-55, 14, 8, 6, -0.25, 0, Math.PI * 2);
      ctx.fill();
      shine(-18, -14, 14);
      break;
    }
    case 'bell': {
      const g = ctx.createLinearGradient(-50, 0, 50, 0);
      g.addColorStop(0, '#8a5a10');
      g.addColorStop(0.35, '#ffe08a');
      g.addColorStop(0.6, '#e2a72e');
      g.addColorStop(1, '#7a4c0a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -58);
      ctx.bezierCurveTo(32, -58, 36, -20, 40, 10);
      ctx.quadraticCurveTo(44, 32, 60, 38);
      ctx.lineTo(-60, 38);
      ctx.quadraticCurveTo(-44, 32, -40, 10);
      ctx.bezierCurveTo(-36, -20, -32, -58, 0, -58);
      ctx.fill();
      ctx.fillStyle = '#7a4c0a';
      ctx.beginPath();
      ctx.arc(0, 48, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-6, -70, 12, 14);
      shine(-14, -26, 13);
      break;
    }
    case 'bar': {
      ctx.fillStyle = '#111';
      ctx.strokeStyle = '#e9c46a';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(-66, -30, 132, 60, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f4ead2';
      ctx.font = '900 46px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BAR', 0, 3);
      break;
    }
    case 'seven': {
      ctx.font = '900 140px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 12;
      ctx.strokeStyle = '#f2c94c';
      ctx.strokeText('7', 0, 8);
      const g = ctx.createLinearGradient(0, -60, 0, 60);
      g.addColorStop(0, '#ff5a5f');
      g.addColorStop(1, '#a30d1f');
      ctx.fillStyle = g;
      ctx.fillText('7', 0, 8);
      break;
    }
    case 'diamond': {
      const pts: [number, number][] = [
        [-58, -18],
        [-32, -50],
        [32, -50],
        [58, -18],
        [0, 60],
      ];
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      const g = ctx.createLinearGradient(-50, -50, 50, 60);
      g.addColorStop(0, '#d8fbff');
      g.addColorStop(0.45, '#41c6e8');
      g.addColorStop(1, '#1b5f9e');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-58, -18);
      ctx.lineTo(58, -18);
      ctx.moveTo(-32, -50);
      ctx.lineTo(-14, -18);
      ctx.lineTo(0, 60);
      ctx.lineTo(14, -18);
      ctx.lineTo(32, -50);
      ctx.stroke();
      shine(-22, -32, 12);
      break;
    }
  }
  const url = c.toDataURL();
  art.set(s, url);
  return url;
}

const img = (s: SlotSymbol, cls = '') => h('img', { class: cls, src: symbolImage(s), alt: NAMES[s][0], draggable: 'false' });

// ---------- The machine ----------

const N = REEL.length;
const COPIES = 3;

class Reel {
  readonly el: HTMLElement;
  private readonly strip: HTMLElement;
  /** Position in stops: the stop shown on the payline (fractional while moving). */
  pos: number;
  speed = 0;
  stopping: { from: number; to: number; start: number; duration: number } | null = null;

  constructor(start: number) {
    this.pos = start;
    this.strip = h('div', { class: 'reel-strip' }, ...Array.from({ length: N * COPIES }, (_, k) => img(REEL[k % N]!, 'sym')));
    this.el = h('div', { class: 'reel' }, this.strip);
    this.draw();
  }

  draw(): void {
    // The window shows three rows: the payline stop sits in the middle one.
    const p = ((this.pos % N) + N) % N;
    this.strip.style.transform = `translateY(calc(${-(p - 1 + N)} * var(--sym)))`;
    this.el.classList.toggle('blur', this.speed > 9);
  }
}

export interface SlotMachineOptions {
  play?: (name: SoundName, opts?: { gain?: number; delay?: number }) => void;
  /** Called after every spin and when the machine closes, so the wallet shown elsewhere updates. */
  onChips?: (chips: number) => void;
  onClose?: () => void;
}

export class SlotMachine {
  readonly el: HTMLElement;
  private readonly reels: Reel[];
  private readonly chipsEl = h('b', {}, '0');
  private readonly betEl = h('b', {}, '0');
  private readonly winEl = h('b', { class: 'led-win' }, '0');
  private readonly message = h('div', { class: 'slot-message', 'aria-live': 'polite' }, 'Pull the lever!');
  private readonly spinBtn: HTMLButtonElement;
  private readonly lever: HTMLElement;
  private readonly payTable: HTMLElement;
  private bet: number = SLOT_BETS[1];
  private spinning = false;
  private frame = 0;
  private last = 0;
  private tick: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  private countId = 0;
  /** The spin in progress: already decided, paid when the reels stop (or if you walk away). */
  private current: { result: ReturnType<typeof spinReels>; bet: number } | null = null;

  constructor(private readonly opts: SlotMachineOptions = {}) {
    this.reels = [0, 1, 2].map(() => new Reel(Math.floor(Math.random() * N)));
    this.spinBtn = h('button', { class: 'slot-spin', onclick: () => this.spin() }, 'SPIN');
    this.lever = h(
      'button',
      { class: 'slot-lever', 'aria-label': 'Pull the lever to spin', onclick: () => this.spin() },
      h('span', { class: 'lever-rod' }, h('span', { class: 'lever-ball' })),
      h('span', { class: 'lever-base' }),
    );
    const betDown = h('button', { class: 'slot-btn', 'aria-label': 'Lower bet', onclick: () => this.changeBet(-1) }, '−');
    const betUp = h('button', { class: 'slot-btn', 'aria-label': 'Raise bet', onclick: () => this.changeBet(1) }, '+');
    const row = (syms: SlotSymbol[], pays: string) => h('div', { class: 'pay-row' }, h('span', { class: 'pay-syms' }, ...syms.map((s) => img(s))), h('b', {}, pays));
    this.payTable = h(
      'div',
      { class: 'pay-table', hidden: true },
      h('h3', {}, 'Pay table'),
      h('p', { class: 'muted' }, 'Wins are paid on the gold line, as times your bet.'),
      ...(Object.keys(THREE_OF_A_KIND) as SlotSymbol[]).map((s) => row([s, s, s], `${THREE_OF_A_KIND[s]}×`)),
      row(['cherry', 'cherry'], `${TWO_CHERRIES}×`),
      h('p', { class: 'muted small' }, 'Any two cherries on the line also win. Play money only.'),
    );
    const bulbs = h('div', { class: 'slot-bulbs', 'aria-hidden': 'true' }, ...Array.from({ length: 18 }, () => h('i')));
    const cabinet = h(
      'div',
      { class: 'slot-cabinet' },
      h('div', { class: 'slot-topper' }, bulbs, h('div', { class: 'slot-title' }, h('span', {}, 'LUCKY'), ' 7 ', h('span', {}, 'VELVET'))),
      h('div', { class: 'slot-window' }, ...this.reels.map((r) => r.el), h('div', { class: 'payline', 'aria-hidden': 'true' })),
      this.message,
      h(
        'div',
        { class: 'slot-leds' },
        h('div', { class: 'led' }, h('span', {}, 'CHIPS'), this.chipsEl),
        h('div', { class: 'led' }, h('span', {}, 'BET'), h('div', { class: 'bet-row' }, betDown, this.betEl, betUp)),
        h('div', { class: 'led' }, h('span', {}, 'WIN'), this.winEl),
      ),
      h('div', { class: 'slot-deck' }, h('button', { class: 'slot-btn wide', onclick: () => (this.payTable.hidden = !this.payTable.hidden) }, 'Pay table'), this.spinBtn),
      this.payTable,
    );
    this.el = h(
      'div',
      { class: 'slot-overlay', role: 'dialog', 'aria-label': 'Slot machine' },
      h('div', { class: 'slot-machine' }, cabinet, this.lever),
      h('button', { class: 'slot-close', 'aria-label': 'Leave the slot machine', onclick: () => this.close() }, '✕ Back to the floor'),
    );
    window.addEventListener('keydown', this.onKey);
    this.refresh();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.spin();
    } else if (e.key === 'Escape') this.close();
    else if (e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === '+') this.changeBet(1);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === '-') this.changeBet(-1);
    else return;
    e.stopPropagation();
  };

  private refresh(): void {
    this.chipsEl.textContent = money(prefs.chips);
    this.betEl.textContent = money(this.bet);
    this.spinBtn.disabled = this.spinning;
  }

  private changeBet(d: number): void {
    if (this.spinning) return;
    const i = SLOT_BETS.indexOf(this.bet as (typeof SLOT_BETS)[number]);
    const next = SLOT_BETS[Math.max(0, Math.min(SLOT_BETS.length - 1, i + d))]!;
    if (next !== this.bet) this.opts.play?.('chip', { gain: 0.6 });
    this.bet = next;
    this.refresh();
  }

  spin(): void {
    if (this.spinning || this.closed) return;
    if (prefs.chips < this.bet) {
      toast(prefs.chips < SLOT_BETS[0] ? 'Out of chips! Visit the Cashier.' : 'Not enough chips for that bet: lower it with −', 'error');
      return;
    }
    prefs.chips = prefs.chips - this.bet;
    this.opts.onChips?.(prefs.chips);
    const result = spinReels();
    this.current = { result, bet: this.bet };
    this.spinning = true;
    this.el.classList.remove('won', 'big');
    this.countId++;
    this.winEl.textContent = '0';
    this.message.textContent = 'Good luck…';
    this.refresh();
    this.lever.classList.remove('pull');
    void this.lever.offsetWidth;
    this.lever.classList.add('pull');
    this.opts.play?.('chips', { gain: 0.7 });
    this.opts.play?.('shuffle', { gain: 0.35, delay: 0.05 });
    // The clicking of the reels going round.
    this.tick = setInterval(() => this.opts.play?.('click', { gain: 0.25 }), 90);
    const now = performance.now();
    this.reels.forEach((r, i) => {
      r.speed = 0;
      r.stopping = null;
      // Each reel stops a little after the one before it.
      const stopAt = now + 900 + i * 520;
      setTimeout(() => {
        const duration = 650;
        const minTravel = (r.speed * duration) / 1000 / 2.2;
        let to = Math.ceil(r.pos + minTravel);
        while ((((to % N) + N) % N) !== result.stops[i]) to++;
        r.stopping = { from: r.pos, to, start: performance.now(), duration };
      }, stopAt - now);
    });
    this.last = now;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame((t) => this.animate(t, result));
  }

  private animate(t: number, result: ReturnType<typeof spinReels>): void {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    let moving = 0;
    this.reels.forEach((r) => {
      if (r.stopping) {
        const k = Math.min(1, (t - r.stopping.start) / r.stopping.duration);
        // Ease out with a small bounce past the stop, like a real reel catching.
        const c = 1.4;
        const e = 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
        r.pos = r.stopping.from + (r.stopping.to - r.stopping.from) * e;
        r.speed = k < 1 ? 6 * (1 - k) : 0;
        if (k >= 1) {
          r.pos = r.stopping.to;
          r.stopping = null;
          r.speed = -1; // stopped for this spin
          this.opts.play?.('tap', { gain: 0.8 });
        } else moving++;
      } else if (r.speed >= 0) {
        r.speed = Math.min(22, r.speed + dt * 60);
        r.pos += r.speed * dt;
        moving++;
      }
      r.draw();
    });
    if (moving > 0 && !this.closed) {
      this.frame = requestAnimationFrame((tt) => this.animate(tt, result));
      return;
    }
    for (const r of this.reels) r.speed = 0;
    clearInterval(this.tick);
    this.finish(result);
  }

  private finish(result: ReturnType<typeof spinReels>): void {
    this.spinning = false;
    this.current = null;
    const win = this.bet * result.multiplier;
    if (win > 0) {
      prefs.chips = prefs.chips + win;
      const [a, b, c] = result.line;
      this.message.textContent =
        a === b && b === c ? `Three ${NAMES[a][1]}! ${result.multiplier}× your bet` : 'Two cherries! 2× your bet';
      const big = result.multiplier >= 20;
      this.el.classList.add('won');
      if (big) this.el.classList.add('big');
      this.opts.play?.(big ? 'blackjack' : 'win');
      // Count the win up on the display, like the real thing.
      const start = performance.now();
      const id = ++this.countId;
      const run = (t: number) => {
        if (id !== this.countId) return; // a new spin started
        const k = Math.min(1, (t - start) / (big ? 1800 : 900));
        this.winEl.textContent = money(Math.round(win * k));
        if (k < 1) requestAnimationFrame(run);
      };
      requestAnimationFrame(run);
    } else {
      this.message.textContent = prefs.chips < SLOT_BETS[0] ? 'Out of chips. The Cashier can help!' : 'So close… spin again!';
    }
    recordPlay('slots', win - this.bet, result.multiplier >= 50);
    this.opts.onChips?.(prefs.chips);
    this.refresh();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.tick);
    cancelAnimationFrame(this.frame);
    window.removeEventListener('keydown', this.onKey);
    // A spin that was still going pays out anyway.
    if (this.spinning && this.current) {
      prefs.chips = prefs.chips + this.current.bet * this.current.result.multiplier;
      this.spinning = false;
      this.current = null;
    }
    this.el.remove();
    this.opts.onChips?.(prefs.chips);
    this.opts.onClose?.();
  }
}
