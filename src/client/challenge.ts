// Challenges: friends start or join one with a code, everyone gets the same fresh stack of
// chips, and whoever has the most chips when the time runs out wins.
//
// While you're in a challenge your normal chips are put aside and you play with the
// challenge stack, at any game. Free refills and the cashier's vault are closed so nobody
// can top up. Your chip count is sent as you play; the leaderboard updates live. When the
// clock runs out, scores freeze, everyone sees the podium and gets their normal chips back.

import { CHALLENGE_MAX_MINUTES, CHALLENGE_MIN_MINUTES, type ChallengeBoard, type ChallengeInfo } from '../shared/protocol.js';
import type { ChallengeBackend } from './challenge-api.js';
import { h, toast } from './dom.js';
import { money } from './format.js';
import { avatarBadge } from './screens.js';
import { recordChallenge } from './stats.js';
import { prefs, store } from './storage.js';

const KEY = 'bj:challenge';

interface Saved {
  info: ChallengeInfo;
  playerId: string;
  secret: string;
  /** Your normal chips, given back when the challenge ends. */
  savedChips: number;
}

/** Quick picks; "Custom" lets you set any length from 1 minute to 7 days. */
const DURATIONS: [number, string][] = [
  [5, '5 min'],
  [15, '15 min'],
  [30, '30 min'],
  [60, '1 hour'],
  [1440, '1 day'],
];

/** "2 days 3 hours 15 minutes". */
export function lengthText(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const hh = Math.floor((minutes % 1440) / 60);
  const mm = minutes % 60;
  const part = (n: number, one: string) => (n ? `${n} ${one}${n === 1 ? '' : 's'}` : '');
  return [part(d, 'day'), part(hh, 'hour'), part(mm, 'minute')].filter(Boolean).join(' ') || '0 minutes';
}

/** Choose how long the challenge lasts: a quick pick, or any days / hours / minutes. */
function durationPicker(start = 30): { el: HTMLElement; value: () => number | null } {
  let minutes = start;
  let custom = false;
  const num = (label: string, max: number, value: number) =>
    h('input', { class: 'field dur-field', type: 'number', min: 0, max, step: 1, value, inputmode: 'numeric', 'aria-label': label });
  const days = num('Days', 7, 0);
  const hours = num('Hours', 23, 0);
  const mins = num('Minutes', 59, 30);
  const summary = h('p', { class: 'dur-summary', 'aria-live': 'polite' });
  const customRow = h(
    'div',
    { class: 'dur-custom', hidden: true },
    h('label', {}, days, h('span', {}, 'days')),
    h('label', {}, hours, h('span', {}, 'hours')),
    h('label', {}, mins, h('span', {}, 'minutes')),
  );
  const fromFields = () => {
    const v = (el: HTMLInputElement) => Math.max(0, Math.floor(Number(el.value) || 0));
    return v(days) * 1440 + v(hours) * 60 + v(mins);
  };
  const value = () => {
    const m = custom ? fromFields() : minutes;
    return m >= CHALLENGE_MIN_MINUTES && m <= CHALLENGE_MAX_MINUTES ? m : null;
  };
  const showSummary = () => {
    const m = value();
    if (m === null) {
      summary.textContent = 'Pick between 1 minute and 7 days.';
      summary.classList.add('bad');
      return;
    }
    summary.classList.remove('bad');
    const end = new Date(Date.now() + m * 60_000);
    const when = end.toLocaleString(undefined, { weekday: m >= 1440 ? 'short' : undefined, hour: '2-digit', minute: '2-digit' });
    summary.textContent = `Lasts ${lengthText(m)} · ends around ${when}`;
  };
  const row = h('div', { class: 'choice-row' });
  const draw = () => {
    row.replaceChildren(
      ...DURATIONS.map(([v, label]) =>
        h('button', { class: `pill${!custom && minutes === v ? ' on' : ''}`, type: 'button', onclick: () => ((minutes = v), (custom = false), draw()) }, label),
      ),
      h('button', {
        class: `pill${custom ? ' on' : ''}`,
        type: 'button',
        onclick: () => {
          if (!custom) {
            // Start the custom boxes from the current choice.
            days.value = String(Math.floor(minutes / 1440));
            hours.value = String(Math.floor((minutes % 1440) / 60));
            mins.value = String(minutes % 60);
          }
          custom = true;
          draw();
          mins.focus();
        },
      }, '⚙️ Custom'),
    );
    customRow.hidden = !custom;
    showSummary();
  };
  for (const f of [days, hours, mins]) f.addEventListener('input', showSummary);
  draw();
  return { el: h('div', { class: 'dur-picker' }, row, customRow, summary), value };
}

function load(): Saved | null {
  try {
    const s = JSON.parse(store.local.get(KEY) ?? 'null') as Saved | null;
    return s?.info?.code && s.playerId ? s : null;
  } catch {
    return null;
  }
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d) return `${d}d ${hh}h ${mm}m`;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
};

const MEDALS = ['🥇', '🥈', '🥉'];

class ChallengeManager {
  backend: ChallengeBackend | null = null;
  private link: (code: string) => string = (code) => code;
  private atTable: () => boolean = () => false;
  private board: ChallengeBoard | null = null;
  private stopWatch: (() => void) | null = null;
  private lastSent = -1;
  private lastSentAt = 0;
  private finishing = false;
  private readonly pill = h('button', { class: 'challenge-pill', hidden: true, onclick: () => this.open() });
  private modal: HTMLElement | null = null;

  init(o: { backend: ChallengeBackend | null; link: (code: string) => string; atTable: () => boolean }): void {
    this.backend = o.backend;
    this.link = o.link;
    this.atTable = o.atTable;
    document.body.append(this.pill);
    setInterval(() => this.tick(), 1000);
    if (load()) this.watch();
    this.tick();
  }

  /** In a challenge whose clock is still running. */
  get active(): boolean {
    const s = load();
    return Boolean(s && Date.now() < s.info.endsAt);
  }

  /** In a challenge at all (running, or over and waiting to be wrapped up). */
  get inChallenge(): boolean {
    return load() !== null;
  }

  private watch(): void {
    const s = load();
    this.stopWatch?.();
    this.stopWatch = null;
    if (!s || !this.backend) return;
    this.stopWatch = this.backend.watch(s.info.code, (b) => {
      if (b) this.board = b;
      this.renderPill();
      this.renderModal();
    });
  }

  private tick(): void {
    const s = load();
    if (!s) {
      this.pill.hidden = true;
      return;
    }
    const left = s.info.endsAt - Date.now();
    // Send your chip count when it changes (relays a little less often).
    const chips = prefs.chips;
    const gap = this.backend === null ? Infinity : 2500;
    if (left > 0 && this.backend && chips !== this.lastSent && Date.now() - this.lastSentAt > gap) {
      this.lastSent = chips;
      this.lastSentAt = Date.now();
      void this.backend.report(s.info.code, { playerId: s.playerId, secret: s.secret, name: prefs.name || 'Player', look: prefs.look }, chips);
    }
    if (left <= 0 && !this.atTable() && !this.finishing) void this.finish();
    this.renderPill();
    if (this.modal?.isConnected) this.renderModal(true);
  }

  private myRank(): { rank: number; of: number } | null {
    const s = load();
    if (!s || !this.board) return null;
    const i = this.board.players.findIndex((p) => p.id === s.playerId);
    return i < 0 ? null : { rank: i + 1, of: this.board.players.length };
  }

  private renderPill(): void {
    const s = load();
    if (!s) {
      this.pill.hidden = true;
      return;
    }
    this.pill.hidden = false;
    const left = s.info.endsAt - Date.now();
    const r = this.myRank();
    this.pill.classList.toggle('ending', left > 0 && left < 60_000);
    this.pill.replaceChildren(
      h('span', { class: 'cp-trophy' }, '🏆'),
      left > 0 ? h('b', {}, clock(left)) : h('b', {}, 'Time’s up!'),
      left > 0 ? h('span', {}, r ? ` · #${r.rank} of ${r.of}` : '', ` · ${money(prefs.chips)} chips`) : h('span', {}, this.atTable() ? ' · leave the table to see who won' : ' · results…'),
    );
  }

  // ---------- Starting, joining, leaving ----------

  private begin(info: ChallengeInfo, playerId: string, secret: string): void {
    const saved: Saved = { info, playerId, secret, savedChips: prefs.chips };
    store.local.set(KEY, JSON.stringify(saved));
    prefs.chips = info.startChips;
    this.lastSent = -1;
    this.board = null;
    this.watch();
    this.tick();
  }

  private async create(name: string, minutes: number, startChips: number): Promise<string | null> {
    if (!this.backend) return 'Challenges aren’t available in this version of the game';
    if (!prefs.name) return 'Pick a table nickname first (on the home page)';
    const r = await this.backend.create({ name, minutes, startChips, player: { name: prefs.name, look: prefs.look } });
    if (!r.ok) return r.error;
    this.begin(r.info, r.playerId, r.secret);
    return null;
  }

  private async join(code: string): Promise<string | null> {
    if (!this.backend) return 'Challenges aren’t available in this version of the game';
    if (!prefs.name) return 'Pick a table nickname first (on the home page)';
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length !== 6) return 'Challenge codes have 6 characters';
    const r = await this.backend.join(clean, { name: prefs.name, look: prefs.look });
    if (!r.ok) return r.error;
    this.begin(r.info, r.playerId, r.secret);
    toast(`You joined “${r.info.name}”. Good luck!`);
    return null;
  }

  /** Leave early: your normal chips come back; your last score stays on the board. */
  private leave(): void {
    const s = load();
    if (!s) return;
    // At a table your challenge chips are in play there: leave the table first.
    if (this.atTable()) return void toast('Leave the table first, then leave the challenge', 'error');
    prefs.chips = s.savedChips;
    store.local.remove(KEY);
    this.stopWatch?.();
    this.stopWatch = null;
    this.board = null;
    this.tick();
  }

  /** Time's up: wait a moment for the last scores, then show the podium and give normal chips back. */
  private async finish(): Promise<void> {
    const s = load();
    if (!s) return;
    this.finishing = true;
    await new Promise((r) => setTimeout(r, this.backend ? 3000 : 0));
    const board = this.board;
    const rank = board ? board.players.findIndex((p) => p.id === s.playerId) + 1 : 0;
    const finalChips = board?.players.find((p) => p.id === s.playerId)?.chips ?? prefs.chips;
    prefs.chips = s.savedChips;
    store.local.remove(KEY);
    this.stopWatch?.();
    this.stopWatch = null;
    this.finishing = false;
    if (rank > 0) recordChallenge(rank === 1);
    this.showResults(s, board, rank, finalChips);
    this.board = null;
    this.tick();
  }

  // ---------- Screens ----------

  /** The challenge window: start/join when you're not in one, the leaderboard when you are. */
  open(tab: 'start' | 'join' = 'start', code = ''): void {
    this.modal?.remove();
    this.modal = h('div', { class: 'challenge-overlay', role: 'dialog', 'aria-label': 'Challenge', onclick: (e: Event) => e.target === this.modal && this.close() });
    document.body.append(this.modal);
    if (!this.backend) {
      this.modal.append(
        h('div', { class: 'challenge-card' }, h('h2', {}, '🏆 Challenges'), h('p', {}, 'Challenges between friends work in the downloadable game file, on the game website and on your own game server. This preview can’t reach the online service they use.'), h('button', { class: 'btn gold', onclick: () => this.close() }, 'OK')),
      );
      return;
    }
    if (load()) this.renderModal();
    else this.renderStart(tab, code);
  }

  close(): void {
    this.modal?.remove();
    this.modal = null;
  }

  private renderStart(tab: 'start' | 'join', code: string): void {
    if (!this.modal) return;
    const duration = durationPicker();
    let chips = 1000;
    const error = h('p', { class: 'login-error', hidden: true });
    const fail = (msg: string | null) => {
      error.textContent = msg ?? '';
      error.hidden = !msg;
    };
    const choice = <T,>(list: [T, string][], get: () => T, set: (v: T) => void) => {
      const row = h('div', { class: 'choice-row' });
      const draw = () =>
        row.replaceChildren(
          ...list.map(([v, label]) => h('button', { class: `pill${get() === v ? ' on' : ''}`, type: 'button', onclick: () => (set(v), draw()) }, label)),
        );
      draw();
      return row;
    };
    const name = h('input', { class: 'field', maxlength: 40, placeholder: `${prefs.name || 'My'}’s challenge`, 'aria-label': 'Challenge name' });
    const codeField = h('input', { class: 'field code', maxlength: 6, placeholder: 'ABC123', value: code, autocapitalize: 'characters', 'aria-label': 'Challenge code' });
    let busy = false;
    const go = (fn: () => Promise<string | null>) => async (e: Event) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      fail(null);
      (e.target as HTMLFormElement).querySelector('button[type=submit]')?.setAttribute('disabled', '');
      const err = await fn();
      busy = false;
      (e.target as HTMLFormElement).querySelector('button[type=submit]')?.removeAttribute('disabled');
      if (err) fail(err);
      else this.renderModal();
    };
    const startForm = h(
      'form',
      {
        class: 'challenge-form',
        onsubmit: go(async () => {
          const minutes = duration.value();
          if (minutes === null) return 'Choose a length between 1 minute and 7 days';
          return this.create(name.value.trim(), minutes, chips);
        }),
      },
      h('label', { class: 'field-label' }, 'Name (optional)'),
      name,
      h('label', { class: 'field-label' }, 'How long?'),
      duration.el,
      h('label', { class: 'field-label' }, 'Everyone starts with'),
      choice([[1000, '1,000 chips'], [5000, '5,000 chips']], () => chips, (v) => (chips = v)),
      h('button', { class: 'btn gold big', type: 'submit' }, '🏆 Start the challenge'),
    );
    // Changing anything clears an old error message.
    startForm.addEventListener('input', () => fail(null));
    startForm.addEventListener('click', (e) => (e.target as HTMLElement).closest('.pill') && fail(null));
    const joinForm = h(
      'form',
      { class: 'challenge-form', onsubmit: go(() => this.join(codeField.value)) },
      h('label', { class: 'field-label' }, 'Challenge code'),
      codeField,
      h('button', { class: 'btn gold big', type: 'submit' }, 'Join the challenge'),
    );
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const body = h('div', {});
    const show = (t: 'start' | 'join') => {
      tabs.replaceChildren(
        h('button', { class: `tab${t === 'start' ? ' on' : ''}`, type: 'button', onclick: () => show('start') }, 'Start one'),
        h('button', { class: `tab${t === 'join' ? ' on' : ''}`, type: 'button', onclick: () => show('join') }, 'Join with a code'),
      );
      body.replaceChildren(t === 'start' ? startForm : joinForm);
      fail(null);
    };
    show(tab);
    this.modal.replaceChildren(
      h(
        'div',
        { class: 'challenge-card' },
        h('button', { class: 'icon-btn close-x', 'aria-label': 'Close', onclick: () => this.close() }, '✕'),
        h('h2', {}, '🏆 Challenge your friends'),
        h(
          'ul',
          { class: 'challenge-rules' },
          h('li', {}, 'Everyone gets the same fresh stack of chips.'),
          h('li', {}, 'Play any game you like until the time runs out.'),
          h('li', {}, 'Whoever has the most chips at the end wins!'),
          h('li', {}, 'Your normal chips wait for you and come back at the end.'),
        ),
        tabs,
        body,
        error,
      ),
    );
  }

  /** The live leaderboard. `light`: just refresh the numbers (every second). */
  private renderModal(light = false): void {
    const s = load();
    if (!this.modal?.isConnected || !s) return;
    const left = s.info.endsAt - Date.now();
    if (light) {
      const t = this.modal.querySelector('.challenge-clock');
      if (t) t.textContent = left > 0 ? `${clock(left)} left` : 'Time’s up!';
      return;
    }
    const link = this.link(s.info.code);
    const message = `🏆 I challenge you at The Velvet Ace! Everyone starts with ${money(s.info.startChips)} chips; most chips when the time runs out wins.\nJoin here: ${link}\nor type the code ${s.info.code} under 🏆 Challenge.`;
    const copy = async (text: string, what: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast(`${what} copied`);
      } catch {
        toast('Select the text and copy it yourself', 'error');
      }
    };
    const rows = (this.board?.players ?? []).map((p, i) =>
      h(
        'li',
        { class: `lb-row${p.id === s.playerId ? ' me' : ''}` },
        h('span', { class: 'lb-rank' }, MEDALS[i] ?? `#${i + 1}`),
        avatarBadge(p.look),
        h('span', { class: 'lb-name' }, p.name, p.id === s.playerId ? ' (you)' : ''),
        h('b', { class: 'lb-chips' }, money(p.chips)),
        h('small', { class: 'lb-x' }, `×${(p.chips / s.info.startChips).toFixed(2)}`),
      ),
    );
    this.modal.replaceChildren(
      h(
        'div',
        { class: 'challenge-card wide' },
        h('button', { class: 'icon-btn close-x', 'aria-label': 'Close', onclick: () => this.close() }, '✕'),
        h('h2', {}, `🏆 ${s.info.name}`),
        h('div', { class: 'challenge-head' }, h('span', { class: 'challenge-clock' }, left > 0 ? `${clock(left)} left` : 'Time’s up!'), h('span', { class: 'muted' }, `Started by ${s.info.host} · lasts ${lengthText(Math.round((s.info.endsAt - s.info.createdAt) / 60_000))} · everyone began with ${money(s.info.startChips)}`)),
        h('ol', { class: 'leaderboard' }, ...(rows.length ? rows : [h('li', { class: 'muted' }, 'Loading the leaderboard…')])),
        h(
          'div',
          { class: 'challenge-invite' },
          h('div', {}, h('span', { class: 'muted' }, 'Code '), h('b', { class: 'big-code' }, s.info.code)),
          h('button', { class: 'btn gold small', onclick: () => copy(message, 'Invite message') }, 'Copy invite'),
          h('button', { class: 'btn ghost small', onclick: () => copy(link, 'Link') }, 'Copy link'),
          typeof navigator.share === 'function' ? h('button', { class: 'btn ghost small', onclick: () => void navigator.share({ title: 'The Velvet Ace challenge', text: message }).catch(() => {}) }, 'Share…') : null,
        ),
        h('p', { class: 'muted small' }, 'Play any game: your chip count updates here as you play. Free refills and the vault are closed during the challenge.'),
        h('div', { class: 'challenge-foot' }, h('button', { class: 'btn ghost small', onclick: () => {
            if (!confirm('Leave this challenge? Your normal chips come back, and your score stays where it is.')) return;
            this.leave();
            if (!load()) this.close();
          } }, 'Leave the challenge'), h('button', { class: 'btn gold', onclick: () => this.close() }, 'Back to playing')),
      ),
    );
  }

  private showResults(s: Saved, board: ChallengeBoard | null, rank: number, finalChips: number): void {
    this.modal?.remove();
    const top = (board?.players ?? []).slice(0, 3);
    const won = rank === 1;
    this.modal = h(
      'div',
      { class: `challenge-overlay results${won ? ' won' : ''}`, role: 'dialog', 'aria-label': 'Challenge results' },
      h(
        'div',
        { class: 'challenge-card wide' },
        won ? h('div', { class: 'confetti', 'aria-hidden': 'true' }, ...Array.from({ length: 40 }, (_, i) => h('i', { style: `--i:${i}` }))) : null,
        h('h2', {}, won ? '🏆 You won the challenge!' : rank ? `You finished #${rank}` : 'The challenge is over'),
        h('p', { class: 'muted' }, `“${s.info.name}” · you ended with ${money(finalChips)} chips (×${(finalChips / s.info.startChips).toFixed(2)})`),
        h(
          'div',
          { class: 'podium' },
          ...[1, 0, 2].map((i) => {
            const p = top[i];
            return h('div', { class: `step step-${i + 1}` }, p ? [avatarBadge(p.look), h('b', {}, p.name), h('span', {}, money(p.chips))] : null, h('div', { class: 'block' }, MEDALS[i]));
          }),
        ),
        h('p', { class: 'muted small' }, `Your normal chips are back: ${money(prefs.chips)}.`),
        h('button', { class: 'btn gold big', onclick: () => this.close() }, 'Back to the casino'),
      ),
    );
    document.body.append(this.modal);
  }
}

export const challenge = new ChallengeManager();
