// The walkable casino floor: the 3D room plus everything on top of it — your profile,
// "Join with code", quick "walk to" buttons, the touch stick, and the card that opens
// when you walk up to a table (Play solo / with bots / host for friends / how to play).

import { type GameKind, STARTING_CHIPS } from '../shared/protocol.js';
import { h, toast } from './dom.js';
import { money } from './format.js';
import { RULES } from './rules.js';
import { CASINO_NAME, type LobbyActions, characterPreview, stepper } from './screens.js';
import { prefs, store } from './storage.js';
import type { CasinoFloor3D, Station, StationId } from './three/casino-floor.js';

export interface FloorScreenOptions extends LobbyActions {
  low: boolean;
  /** Switch to the simple list of games. */
  listView: () => void;
  onAutoLow?: () => void;
}

const LAST_STATION = 'bj:station';

/** Remember which table you walked up to, so leaving it puts you back there. */
export const lastStation = {
  get: () => store.session.get(LAST_STATION) as StationId | null,
  set: (id: StationId) => store.session.set(LAST_STATION, id),
};

export function floorScreen(a: FloorScreenOptions): { el: HTMLElement; dispose(): void } {
  let busy = false;
  const run = (fn: () => Promise<void>) => async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } finally {
      busy = false;
    }
  };
  const stage = h('div', { class: 'floor-stage' });
  const loading = h('div', { class: 'loading floor-loading' }, h('div', { class: 'spinner' }), `Opening the doors of ${CASINO_NAME}…`);
  const me = characterPreview(prefs.look, 'mini');
  const profile = h(
    'button',
    { class: 'profile-chip', onclick: a.editProfile, 'aria-label': 'Edit your avatar and nickname' },
    me.el,
    h('span', { class: 'chip-text' }, h('b', {}, prefs.name || 'Player'), h('small', {}, 'Edit avatar & name')),
  );

  // Join with a code (a small pop-over).
  const code = h('input', { class: 'field code', id: 'join-code', maxlength: 6, placeholder: 'ABC123', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Table code' });
  const joinBox = h(
    'form',
    {
      class: 'floor-join',
      hidden: true,
      onsubmit: (e: Event) => {
        e.preventDefault();
        const c = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (c.length !== 6) return toast('Table codes have 6 characters', 'error');
        a.join(c);
      },
    },
    h('b', {}, 'Got an invite?'),
    h('span', { class: 'muted' }, 'Type the 6-letter code a friend sent you.'),
    h('div', { class: 'join-row' }, code, h('button', { class: 'btn gold', type: 'submit' }, 'Join')),
  );
  const joinBtn = h('button', { class: 'btn gold small', onclick: () => {
    joinBox.hidden = !joinBox.hidden;
    if (!joinBox.hidden) code.focus();
  } }, '🎟️ Join with code');

  // Your chips: they come with you to every table. Refill to 1,000 any time.
  const chipsText = h('b', {}, money(prefs.chips));
  const wallet = h(
    'div',
    { class: 'floor-wallet', title: 'Your chips go with you to every table' },
    h('span', { class: 'coin', 'aria-hidden': 'true' }),
    chipsText,
    h('span', { class: 'muted' }, ' chips'),
    h(
      'button',
      {
        class: 'refill-btn',
        title: 'Refill to 1,000 chips',
        'aria-label': 'Refill chips to 1,000',
        onclick: () => {
          prefs.chips = Math.max(prefs.chips, STARTING_CHIPS);
          showChips();
          toast('Chips refilled to 1,000');
        },
      },
      '↻',
    ),
  );

  const showChips = () => (chipsText.textContent = money(prefs.chips));

  let floor: CasinoFloor3D | null = null;
  const walk = (id: StationId) => floor?.goTo(id);
  const top = h(
    'header',
    { class: 'floor-top' },
    h('div', { class: 'floor-brand' }, h('span', { class: 'suit red' }, '♥'), CASINO_NAME, h('span', { class: 'suit' }, '♠')),
    h('div', { class: 'spacer' }),
    wallet,
    joinBtn,
    h('button', { class: 'btn ghost small', onclick: a.listView, title: 'A simple list of all the games' }, '☰ List'),
    profile,
  );
  const touch = matchMedia('(pointer: coarse)').matches;
  const hint = h('div', { class: 'floor-hint' }, touch ? 'Left thumb: walk · Right: look around · Tap a table to go there' : 'Walk with W A S D or the arrow keys · Drag to look · Click a table to walk to it');
  const goButtons = h(
    'nav',
    { class: 'floor-go', 'aria-label': 'Walk to a table' },
    h('span', { class: 'muted' }, 'Walk to'),
    h('button', { class: 'go bj', onclick: () => walk('blackjack-solo') }, '🂡 Blackjack'),
    h('button', { class: 'go rl', onclick: () => walk('roulette') }, '🎡 Roulette'),
    h('button', { class: 'go pk', onclick: () => walk('poker') }, '♣ Poker'),
    h('button', { class: 'go cs', onclick: () => walk('cashier') }, '💰 Cashier'),
  );

  // The card for the table you're standing at.
  const card = h('aside', { class: 'station-card', hidden: true, 'aria-live': 'polite' });
  const onlineLabel = a.preview ? 'Host an online table' : 'Host a table for friends';
  /** The cashier's window: cash out your chips into the vault, or take them back out. */
  const fillCashier = (receipt: string | null = null) => {
    const chips = prefs.chips;
    const vault = prefs.vault;
    const row = (label: string, value: number) => h('div', { class: 'cash-row' }, h('span', {}, label), h('b', {}, `${money(value)} chips`));
    card.className = 'station-card cashier';
    card.replaceChildren(
      ...([
      h('div', { class: 'station-head' }, h('h2', {}, 'Cashier'), h('p', { class: 'tagline' }, 'Cash out your chips and keep them safe in your vault.')),
      row('In your pocket', chips),
      row('In your vault', vault),
      receipt ? h('div', { class: 'cash-ticket', role: 'status' }, receipt) : null,
      h(
        'div',
        { class: 'game-actions' },
        h('button', {
          class: 'btn gold big',
          disabled: chips <= 0,
          onclick: () => {
            const n = prefs.chips;
            if (n <= 0) return;
            const net = n - STARTING_CHIPS;
            prefs.vault = prefs.vault + n;
            prefs.chips = 0;
            const best = n > prefs.bestCashOut;
            if (best) prefs.bestCashOut = n;
            showChips();
            fillCashier(`🎟️ You cashed out ${money(n)} chips${net > 0 ? ` (${money(net)} more than you started with!)` : ''}.${best ? ' 🏆 Your biggest cash-out yet!' : ''}`);
          },
        }, `💵 Cash out ${money(chips)} chips`),
        h('button', {
          class: 'btn ghost',
          disabled: vault <= 0,
          onclick: () => {
            prefs.chips = prefs.chips + prefs.vault;
            prefs.vault = 0;
            showChips();
            fillCashier('Your vault chips are back in your pocket. Good luck!');
          },
        }, `🏦 Take ${money(vault)} chips from the vault`),
        h('button', {
          class: 'btn ghost',
          disabled: chips >= STARTING_CHIPS,
          onclick: () => {
            prefs.chips = STARTING_CHIPS;
            showChips();
            fillCashier('Here are 1,000 fresh chips, on the house.');
          },
        }, '↻ Free refill to 1,000 chips'),
      ),
      prefs.bestCashOut > 0 ? h('p', { class: 'muted small' }, `Biggest cash-out: ${money(prefs.bestCashOut)} chips`) : null,
      h('p', { class: 'muted small' }, 'Play money only: chips are just for fun and can’t be exchanged for real money.'),
      ].filter(Boolean) as HTMLElement[]),
    );
  };

  const fill = (s: Station) => {
    lastStation.set(s.id);
    if (!s.game) return fillCashier();
    const game: GameKind = s.game;
    const bots = stepper(1, game === 'blackjack' ? 4 : 5, game === 'blackjack' ? 3 : 4, 'bots');
    const solo = game !== 'poker' ? h('button', { class: 'btn gold big', onclick: run(() => a.solo(game)) }, 'Play solo') : null;
    const withBots = h('div', { class: 'bots-row' }, h('button', { class: `btn ${game === 'poker' ? 'gold big' : 'ghost'} grow`, onclick: run(() => a.bots(game, bots.value())) }, 'Play with bots'), bots.el);
    card.className = `station-card ${game}`;
    card.replaceChildren(
      h('div', { class: 'station-head' }, h('h2', {}, s.title), h('p', { class: 'tagline' }, RULES[game].tagline)),
      h('div', { class: 'game-actions' }, s.id === 'blackjack' ? withBots : solo, s.id === 'blackjack' ? solo : withBots, h('button', { class: 'btn ghost', onclick: run(() => a.create(game)) }, `👥 ${onlineLabel}`)),
      h('button', { class: 'btn link rules-link', onclick: () => a.rules(game) }, `📖 How to play ${RULES[game].name}`),
    );
    if (game === 'blackjack' && s.id === 'blackjack') (card.querySelector('.bots-row .btn') as HTMLElement).className = 'btn gold big grow';
  };

  // Touch stick.
  const knob = h('div', { class: 'knob' });
  const stick = h('div', { class: 'stick', hidden: true }, knob);

  const el = h('main', { class: 'floor-screen' }, stage, loading, top, joinBox, hint, goButtons, card, stick);

  let disposed = false;
  void (async () => {
    try {
      const [{ CasinoFloor3D }, { webglAvailable }] = await Promise.all([import('./three/casino-floor.js'), import('./three/scene3d.js')]);
      if (disposed) return;
      if (!webglAvailable()) throw new Error('no WebGL');
      floor = new CasinoFloor3D(stage, {
        low: a.low,
        start: lastStation.get(),
        onNear: (s) => {
          card.hidden = !s;
          hint.hidden = Boolean(s);
          if (s) fill(s);
        },
        onAutoLow: a.onAutoLow,
      });
      floor.onStick = (active, x, y, dx, dy) => {
        stick.hidden = !active;
        if (!active) return;
        stick.style.left = `${x}px`;
        stick.style.top = `${y}px`;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      loading.remove();
      setTimeout(() => hint.classList.add('fade'), 9000);
    } catch (err) {
      console.warn('3D floor unavailable', err);
      if (!disposed) a.listView();
    }
  })();

  return {
    el,
    dispose() {
      disposed = true;
      floor?.dispose();
      me.dispose();
    },
  };
}
