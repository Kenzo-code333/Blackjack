// The rooms you walk around (Lounge, Casino, Arcade): the 3D room plus everything on top
// of it — your profile, quick "walk to" and "go to" buttons, the touch stick, and the card
// that opens when you walk up to something: a table (play solo / with bots / host for
// friends), the cashier, slot machines, a couch (sit down), an arcade game (play) or a
// doorway (go to the next room).

import { type GameKind, REFILL_LIMIT, STARTING_CHIPS } from '../shared/protocol.js';
import type { SlotMachine } from './slot-machine.js';
import { h, toast } from './dom.js';
import { money } from './format.js';
import { RULES } from './rules.js';
import { CASINO_NAME, type LobbyActions, avatarBadge, stepper } from './screens.js';
import { canRefill, inChallenge, prefs, store } from './storage.js';
import { challenge } from './challenge.js';
import type { CasinoFloor3D, Room, Station, StationId } from './three/casino-floor.js';
import { ARCADE } from './arcade/catalog.js';
import { playArcadeGame } from './arcade/player.js';
import { account } from './account.js';

export interface FloorScreenOptions extends LobbyActions {
  low: boolean;
  /** Which room this is. */
  room: Room;
  /** The room you came from (you arrive at its doorway). */
  from?: Room | null;
  /** Go to another room. */
  goRoom: (room: Room) => void;
  /** Lets the chat/social layer show the other players and follow you around the room. */
  onWorld?: (world: CasinoFloor3D | null) => void;
  /** Switch to the simple list of games. */
  listView: () => void;
  onAutoLow?: () => void;
}

const LAST_STATION = 'bj:station';

/**
 * Remember which table you walked up to, so leaving it puts you back beside it. Any other
 * way onto the floor (opening or resuming the game, signing in, "Enter the casino") starts
 * at the top of the red-carpet aisle.
 */
export const lastStation = {
  get: () => store.session.get(LAST_STATION) as StationId | null,
  set: (id: StationId) => store.session.set(LAST_STATION, id),
  /** Call when leaving a table: the next floor visit starts beside it. */
  returning: () => store.session.set('bj:back', '1'),
  /** Where to start this visit (and forget the "returning" note). */
  takeStart: (): StationId | null => {
    const back = store.session.get('bj:back') === '1';
    store.session.remove('bj:back');
    return back ? (store.session.get(LAST_STATION) as StationId | null) : null;
  },
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
  const loading = h(
    'div',
    { class: 'loading floor-loading' },
    h('div', { class: 'spinner' }),
    a.room === 'casino' ? `Opening the doors of ${CASINO_NAME}…` : a.room === 'lounge' ? 'Welcome! Finding you a comfy spot…' : 'Powering up the arcade…',
  );
  const me = { el: avatarBadge(prefs.look), dispose: () => {} };
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

  // Your chips: they come with you to every table. Down to 100 or less? Refill to 1,000.
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
        title: 'Free refill to 1,000 chips',
        'aria-label': 'Free refill to 1,000 chips',
        onclick: () => {
          if (!canRefill()) return toast(`Free refills are only for when you're down to ${REFILL_LIMIT} chips or less`, 'error');
          prefs.chips = STARTING_CHIPS;
          showChips();
          toast('Chips refilled to 1,000');
        },
      },
      '↻',
    ),
  );
  const refillBtn = wallet.querySelector('.refill-btn') as HTMLButtonElement;

  const showChips = () => {
    chipsText.textContent = money(prefs.chips);
    refillBtn.hidden = !canRefill();
  };
  showChips();

  let floor: CasinoFloor3D | null = null;
  const walk = (id: StationId) => floor?.goTo(id);
  const top = h(
    'header',
    { class: 'floor-top' },
    h('div', { class: `floor-brand ${a.room}` }, h('span', { class: 'suit red' }, '♥'), a.room === 'casino' ? CASINO_NAME : a.room === 'lounge' ? 'The Lounge' : 'The Arcade', h('span', { class: 'suit' }, '♠')),
    h('div', { class: 'spacer' }),
    wallet,
    h('button', { class: 'btn small challenge-btn', onclick: () => challenge.open() }, '🏆 Challenge'),
    joinBtn,
    h('button', { class: 'btn ghost small', onclick: a.listView, title: 'A simple list of all the games' }, '☰ List'),
    profile,
  );
  const touch = matchMedia('(pointer: coarse)').matches;
  const what = a.room === 'lounge' ? 'a couch or a doorway' : a.room === 'arcade' ? 'a game' : 'a table';
  const hint = h('div', { class: 'floor-hint' }, touch ? `Left thumb: walk · Right: look around · Tap ${what} to go there` : `Walk with W A S D or the arrow keys · Drag to look · Click ${what} to walk to it`);
  const roomBtn = (room: Room) =>
    h('button', { class: `go room-${room}`, onclick: () => a.goRoom(room) }, room === 'lounge' ? '🛋 Lounge' : room === 'casino' ? '🎰 Casino' : '🕹 Arcade');
  const goButtons = h(
    'nav',
    { class: 'floor-go', 'aria-label': 'Walk to' },
    h('span', { class: 'muted' }, 'Walk to'),
    ...(a.room === 'casino'
      ? [
          h('button', { class: 'go bj', onclick: () => walk('blackjack-solo') }, '🂡 Blackjack'),
          h('button', { class: 'go rl', onclick: () => walk('roulette') }, '🎡 Roulette'),
          h('button', { class: 'go pk', onclick: () => walk('poker') }, '♣ Poker'),
          h('button', { class: 'go sl', onclick: () => walk('slots-left') }, '🎰 Slots'),
          h('button', { class: 'go cs', onclick: () => walk('cashier') }, '💰 Cashier'),
        ]
      : a.room === 'arcade'
        ? ARCADE.map((g) => h('button', { class: 'go arc', style: `--neon:${g.color}`, onclick: () => walk(g.id === 'game-night' ? 'arcade-game-night' : `arcade-${g.id}`) }, g.title))
        : [h('button', { class: 'go couch', onclick: () => walk('couch-0-left') }, '🛋 A couch')]),
    h('span', { class: 'go-sep' }),
    ...(['lounge', 'casino', 'arcade'] as Room[]).filter((r) => r !== a.room).map(roomBtn),
  );
  // Sitting on a couch: a button to stand up again.
  const standBtn = h('button', { class: 'btn gold stand-up', hidden: true, onclick: () => floor?.standUp() }, '⬆ Stand up');

  // Playing a slot machine: the machine covers the floor, which pauses meanwhile.
  let machine: SlotMachine | null = null;
  const openSlots = async () => {
    if (machine) return;
    const { SlotMachine } = await import('./slot-machine.js');
    machine = new SlotMachine({
      play: a.play,
      onChips: () => showChips(),
      onClose: () => {
        machine = null;
        if (!chatting) floor?.setPaused(false);
        if (lastNear) fill(lastNear);
      },
    });
    floor?.setPaused(true);
    el.append(machine.el);
  };
  let lastNear: Station | null = null;
  /** At a row of slot machines. */
  const fillSlots = () => {
    card.className = 'station-card slots';
    card.replaceChildren(
      h('div', { class: 'station-head' }, h('h2', {}, 'Slot machines'), h('p', { class: 'tagline' }, 'Pull the lever and line up three of a kind!')),
      h('div', { class: 'cash-row' }, h('span', {}, 'Your chips'), h('b', {}, `${money(prefs.chips)}`)),
      h('div', { class: 'game-actions' }, h('button', { class: 'btn gold big', onclick: () => void openSlots() }, '🎰 Play the slots')),
      h('p', { class: 'muted small' }, 'Bets from 5 to 100 chips. Three diamonds pay 100 times your bet. Plays with the chips in your pocket.'),
    );
  };

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
          disabled: chips <= 0 || inChallenge(),
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
          disabled: vault <= 0 || inChallenge(),
          onclick: () => {
            prefs.chips = prefs.chips + prefs.vault;
            prefs.vault = 0;
            showChips();
            fillCashier('Your vault chips are back in your pocket. Good luck!');
          },
        }, `🏦 Take ${money(vault)} chips from the vault`),
        h('button', {
          class: 'btn ghost',
          disabled: !canRefill(),
          onclick: () => {
            if (!canRefill()) return;
            prefs.chips = STARTING_CHIPS;
            showChips();
            fillCashier('Here are 1,000 fresh chips, on the house.');
          },
        }, '↻ Free refill to 1,000 chips'),
      ),
      inChallenge()
        ? h('p', { class: 'muted small' }, 'The vault and free refills are closed while you’re in a challenge: everyone plays with the same stack.')
        : canRefill() ? null : h('p', { class: 'muted small' }, `Free refills are only for players down to ${REFILL_LIMIT} chips or less (pocket and vault together).`),
      prefs.bestCashOut > 0 ? h('p', { class: 'muted small' }, `Biggest cash-out: ${money(prefs.bestCashOut)} chips`) : null,
      h('p', { class: 'muted small' }, 'Play money only: chips are just for fun and can’t be exchanged for real money.'),
      ].filter(Boolean) as HTMLElement[]),
    );
  };

  /** A couch, a doorway, or an arcade game. */
  const fillOther = (s: Station) => {
    if (s.kind === 'couch') {
      card.className = 'station-card lounge';
      const seated = floor?.sitting === s;
      card.replaceChildren(
        h('div', { class: 'station-head' }, h('h2', {}, seated ? 'Comfy?' : 'A comfy couch'), h('p', { class: 'tagline' }, seated ? 'Chat with everyone from here: tap 💬 Chats.' : 'Sit down, relax and chat with the others.')),
        h(
          'div',
          { class: 'game-actions' },
          seated
            ? h('button', { class: 'btn ghost', onclick: () => floor?.standUp() }, '⬆ Stand up')
            : h('button', { class: 'btn gold big', onclick: () => (floor?.sit(s.id) ? fillOther(s) : toast('This couch is full: try another one', 'error')) }, '🛋 Sit down'),
        ),
      );
      return;
    }
    if (s.kind === 'door' && s.to) {
      const to = s.to;
      card.className = `station-card door-${to}`;
      card.replaceChildren(
        h('div', { class: 'station-head' }, h('h2', {}, s.title), h('p', { class: 'tagline' }, s.sub)),
        h('div', { class: 'game-actions' }, h('button', { class: 'btn gold big', onclick: () => a.goRoom(to) }, `Go to ${s.title.replace(/^The /, 'the ')} →`)),
      );
      return;
    }
    if ((s.kind === 'arcade' || s.kind === 'screen') && s.arcade) {
      const g = ARCADE.find((x) => x.id === s.arcade)!;
      card.className = 'station-card arcade';
      card.style.setProperty('--neon', g.color);
      card.replaceChildren(
        h('div', { class: 'station-head' }, h('h2', {}, g.title), h('p', { class: 'tagline' }, g.tagline)),
        h(
          'div',
          { class: 'game-actions' },
          h('button', {
            class: 'btn gold big',
            onclick: () => {
              floor?.setPaused(true);
              void playArcadeGame(g.id, () => {
                floor?.setPaused(false);
                // Your new best scores and saves go to your account right away.
                void account.saveNow();
              });
            },
          }, '▶ Play'),
        ),
        h('p', { class: 'muted small' }, 'Free play: no chips needed. Your progress is saved with your account.'),
      );
    }
  };

  const fill = (s: Station) => {
    if (a.room === 'casino') lastStation.set(s.id);
    lastNear = s;
    if (s.kind === 'couch' || s.kind === 'door' || s.kind === 'arcade' || s.kind === 'screen') return fillOther(s);
    if (s.kind === 'slots') return fillSlots();
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
  // On touch screens: a faint ring showing where your thumb walks (put it anywhere on the left).
  const stickGuide = h('div', { class: 'stick-guide', hidden: !matchMedia('(pointer: coarse)').matches, 'aria-hidden': 'true' }, h('span', {}, 'walk'));

  const el = h('main', { class: `floor-screen room-${a.room}` }, stage, loading, top, joinBox, hint, goButtons, card, stickGuide, stick, standBtn);

  let disposed = false;
  // While the chats cover the screen the room rests (nothing to draw behind them).
  let chatting = false;
  const onChatOpen = () => ((chatting = true), floor?.setPaused(true));
  const onChatClose = () => {
    chatting = false;
    if (!machine) floor?.setPaused(false);
  };
  window.addEventListener('bj:chat-open', onChatOpen);
  window.addEventListener('bj:chat-close', onChatClose);
  void (async () => {
    try {
      const [{ CasinoFloor3D, stationsOf }, { webglAvailable }] = await Promise.all([import('./three/casino-floor.js'), import('./three/scene3d.js')]);
      if (disposed) return;
      if (!webglAvailable()) throw new Error('no WebGL');
      // Coming through a doorway: arrive at the matching doorway of this room.
      const door = a.from ? stationsOf(a.room).find((st) => st.kind === 'door' && st.to === a.from) : undefined;
      const back = a.room === 'casino' ? lastStation.takeStart() : null;
      floor = new CasinoFloor3D(stage, {
        room: a.room,
        low: a.low,
        start: back ?? door?.id ?? null,
        onSit: (st) => {
          standBtn.hidden = !st;
          if (lastNear) fill(lastNear);
        },
        onDoor: (to) => a.goRoom(to),
        onNear: (s) => {
          card.hidden = !s;
          hint.hidden = Boolean(s);
          if (s) fill(s);
        },
        onAutoLow: a.onAutoLow,
      });
      floor.onStick = (active, x, y, dx, dy) => {
        stick.hidden = !active;
        stickGuide.classList.toggle('used', active);
        if (!active) return;
        stick.style.left = `${x}px`;
        stick.style.top = `${y}px`;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      // The doors open once the room can draw smoothly.
      await floor.ready;
      if (chatting) floor.setPaused(true);
      document.body.dataset.floorReady = '1';
      a.onWorld?.(floor);
      if (location.search.includes('debug') || store.local.get('bj:debug')) (globalThis as { bjFloor?: unknown }).bjFloor = floor;
      if (disposed) return;
      loading.classList.add('done');
      setTimeout(() => loading.remove(), 600);
      setTimeout(() => hint.classList.add('fade'), 9000);
    } catch (err) {
      console.warn('3D floor unavailable', err);
      if (!disposed) {
        toast('Your device couldn’t show the 3D rooms right now, so here’s the list of games. The 3D rooms will be tried again next time.', 'error');
        a.listView();
      }
    }
  })();

  return {
    el,
    dispose() {
      disposed = true;
      window.removeEventListener('bj:chat-open', onChatOpen);
      window.removeEventListener('bj:chat-close', onChatClose);
      a.onWorld?.(null);
      machine?.close();
      delete document.body.dataset.floorReady;
      floor?.dispose();
      me.dispose();
    },
  };
}
