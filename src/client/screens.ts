// The screens before you sit down:
//   profile  → your avatar and table nickname
//   lobby    → the casino floor: pick Blackjack or Texas Hold'em
//   rules    → how to play, in simple bullet points
//   join     → someone sent you an invite

import { type GameKind, LOOK_OPTIONS, type Look } from '../shared/protocol.js';
import { h, toast } from './dom.js';
import { RULES, rulesContent } from './rules.js';
import { prefs } from './storage.js';

export const CASINO_NAME = 'The Velvet Ace';

function nameField(id = 'name'): HTMLInputElement {
  const input = h('input', {
    class: 'field',
    id,
    maxlength: 20,
    autocomplete: 'nickname',
    placeholder: 'Your table nickname',
    'aria-label': 'Table nickname',
    value: prefs.name,
  });
  // Remember the name as it's typed.
  input.addEventListener('input', () => (prefs.name = input.value.trim()));
  return input;
}

function readName(input: HTMLInputElement): string | null {
  const name = input.value.trim();
  if (!name) {
    toast('Pick a table nickname first', 'error');
    input.focus();
    return null;
  }
  prefs.name = name;
  return name;
}

/** The marquee sign at the top of the casino screens. */
function marquee(small = false): HTMLElement {
  return h(
    'div',
    { class: `marquee${small ? ' small' : ''}`, 'aria-hidden': small ? 'true' : undefined },
    h('div', { class: 'bulbs' }),
    h('div', { class: 'marquee-name' }, h('span', { class: 'suit red' }, '♥'), CASINO_NAME, h('span', { class: 'suit' }, '♠')),
    small ? null : h('div', { class: 'marquee-sub' }, 'Blackjack · Texas Hold’em · Play money only'),
  );
}

/** A 3D turntable of your character, loaded on demand (nothing without WebGL). */
export function characterPreview(look: Look, cls = ''): { el: HTMLElement; setLook(l: Look): void; dispose(): void } {
  const el = h('div', { class: `char-preview ${cls}`, 'aria-hidden': 'true' });
  let preview: { setLook(l: Look): void; dispose(): void } | null = null;
  let current = look;
  let disposed = false;
  void import('./three/character-preview.js')
    .then(({ CharacterPreview }) => {
      if (disposed) return;
      preview = new CharacterPreview(el);
      preview.setLook(current);
    })
    .catch(() => el.classList.add('no-3d'));
  return {
    el,
    setLook(l) {
      current = l;
      preview?.setLook(l);
    },
    dispose() {
      disposed = true;
      preview?.dispose();
    },
  };
}

// ---------- Profile (the home page) ----------

/** Your avatar and nickname. "Enter the casino" takes you to the lobby. */
export function profileScreen(onEnter: () => void): { el: HTMLElement; dispose(): void } {
  let look = prefs.look;
  const preview = characterPreview(look, 'big');
  const name = nameField();
  const rows = h('div', { class: 'look-rows' });
  const update = (patch: Partial<Look>) => {
    look = { ...look, ...patch };
    prefs.look = look;
    preview.setLook(look);
    render();
  };
  const swatches = (key: 'skin' | 'hairColor' | 'outfit', label: string) =>
    h(
      'div',
      { class: 'look-row' },
      h('span', { class: 'field-label' }, label),
      h(
        'div',
        { class: 'swatches', role: 'radiogroup', 'aria-label': label },
        ...LOOK_OPTIONS[key].map((color, i) =>
          h('button', {
            class: `swatch${look[key] === i ? ' on' : ''}`,
            role: 'radio',
            'aria-checked': String(look[key] === i),
            'aria-label': `${label} ${i + 1}`,
            style: { background: color },
            onclick: () => update({ [key]: i }),
          }),
        ),
      ),
    );
  const choices = (key: 'hair' | 'extra', label: string) =>
    h(
      'div',
      { class: 'look-row' },
      h('span', { class: 'field-label' }, label),
      h(
        'div',
        { class: 'chips-row', role: 'radiogroup', 'aria-label': label },
        ...LOOK_OPTIONS[key].map((text, i) =>
          h('button', { class: `pill${look[key] === i ? ' on' : ''}`, role: 'radio', 'aria-checked': String(look[key] === i), onclick: () => update({ [key]: i }) }, text),
        ),
      ),
    );
  const render = () =>
    rows.replaceChildren(
      swatches('skin', 'Skin'),
      choices('hair', 'Hair'),
      swatches('hairColor', 'Hair colour'),
      swatches('outfit', 'Outfit'),
      choices('extra', 'Accessory'),
    );
  render();
  const surprise = () => {
    const r = (n: number) => Math.floor(Math.random() * n);
    update({ skin: r(6), hair: r(7), hairColor: r(7), outfit: r(8), extra: r(5) });
  };
  const enter = (e?: Event) => {
    e?.preventDefault();
    if (readName(name)) onEnter();
  };
  const el = h(
    'main',
    { class: 'casino-screen' },
    marquee(),
    h(
      'form',
      { class: 'profile', onsubmit: enter },
      h('div', { class: 'profile-stage' }, preview.el, h('button', { class: 'btn ghost small', type: 'button', onclick: surprise }, '🎲 Surprise me')),
      h(
        'div',
        { class: 'profile-side' },
        h('h1', { class: 'screen-title' }, 'Who’s playing?'),
        h('label', { class: 'field-label', for: 'name' }, 'Table nickname'),
        name,
        rows,
        h('button', { class: 'btn gold big enter', type: 'submit' }, 'Enter the casino'),
      ),
    ),
  );
  return { el, dispose: () => preview.dispose() };
}

// ---------- Lobby (the casino floor) ----------

export interface OpenTableInfo {
  code: string;
  host: string;
  players: number;
  seats: number;
}

export interface LobbyActions {
  /** Single-page builds: online tables go through a live channel instead of the server. */
  preview: boolean;
  listsTables: boolean;
  solo: () => Promise<void>;
  bots: (game: GameKind, count: number) => Promise<void>;
  /** Server: a table with an invite link. Single-page builds: an online table you host. */
  create: (game: GameKind) => Promise<void>;
  join: (code: string) => void;
  joinOpen?: (table: OpenTableInfo) => Promise<void>;
  watchTables?: (fn: (tables: OpenTableInfo[] | null) => void) => () => void;
  rules: (game: GameKind) => void;
  editProfile: () => void;
}

function stepper(min: number, max: number, start: number, label: string): { el: HTMLElement; value: () => number } {
  let n = start;
  const count = h('span', { class: 'count' }, String(n));
  const set = (d: number) => () => {
    n = Math.max(min, Math.min(max, n + d));
    count.textContent = String(n);
  };
  return {
    el: h(
      'div',
      { class: 'stepper', role: 'group', 'aria-label': label },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Fewer ${label}`, onclick: set(-1) }, '−'),
      count,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `More ${label}`, onclick: set(1) }, '+'),
    ),
    value: () => n,
  };
}

export function lobbyScreen(a: LobbyActions): { el: HTMLElement; dispose(): void } {
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

  const me = characterPreview(prefs.look, 'mini');
  const profile = h(
    'button',
    { class: 'profile-chip', onclick: a.editProfile, 'aria-label': 'Edit your avatar and nickname' },
    me.el,
    h('span', { class: 'chip-text' }, h('b', {}, prefs.name || 'Player'), h('small', {}, 'Edit avatar & name')),
  );

  const bjBots = stepper(1, 4, 3, 'bots');
  const pkBots = stepper(1, 5, 4, 'bots');
  const onlineLabel = a.preview ? 'Host an online table' : 'Create a table for friends';

  const blackjack = h(
    'article',
    { class: 'game-card blackjack' },
    h(
      'div',
      { class: 'game-art', 'aria-hidden': 'true' },
      h('span', { class: 'art-card' }, 'A', h('i', {}, '♠')),
      h('span', { class: 'art-card red' }, 'K', h('i', {}, '♥')),
      h('span', { class: 'art-chip c5' }),
      h('span', { class: 'art-chip c25' }),
    ),
    h('h2', {}, 'Blackjack'),
    h('p', { class: 'tagline' }, RULES.blackjack.tagline),
    h('p', { class: 'game-facts' }, 'You vs the dealer · Blackjack pays 3 to 2'),
    h(
      'div',
      { class: 'game-actions' },
      h('button', { class: 'btn gold big', onclick: run(a.solo) }, 'Play solo'),
      h('div', { class: 'bots-row' }, h('button', { class: 'btn gold big grow', onclick: run(() => a.bots('blackjack', bjBots.value())) }, 'Play with bots'), bjBots.el),
      h('button', { class: 'btn ghost', onclick: run(() => a.create('blackjack')) }, onlineLabel),
    ),
    h('button', { class: 'btn link rules-link', onclick: () => a.rules('blackjack') }, '📖 How to play Blackjack'),
  );

  const poker = h(
    'article',
    { class: 'game-card poker' },
    h(
      'div',
      { class: 'game-art', 'aria-hidden': 'true' },
      h('span', { class: 'art-card' }, 'A', h('i', {}, '♣')),
      h('span', { class: 'art-card red' }, 'A', h('i', {}, '♦')),
      h('span', { class: 'art-chip c100' }),
      h('span', { class: 'art-chip c500' }),
    ),
    h('h2', {}, 'Texas Hold’em'),
    h('p', { class: 'tagline' }, RULES.poker.tagline),
    h('p', { class: 'game-facts' }, 'You vs the other players · Up to 6 seats'),
    h(
      'div',
      { class: 'game-actions' },
      h('div', { class: 'bots-row' }, h('button', { class: 'btn gold big grow', onclick: run(() => a.bots('poker', pkBots.value())) }, 'Play with bots'), pkBots.el),
      h('button', { class: 'btn ghost', onclick: run(() => a.create('poker')) }, onlineLabel),
    ),
    h('button', { class: 'btn link rules-link', onclick: () => a.rules('poker') }, '📖 How to play Poker'),
  );

  // Join a friend's table.
  const code = h('input', {
    class: 'field code',
    id: 'join-code',
    maxlength: 6,
    placeholder: 'ABC123',
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Table code',
  });
  const joinForm = h(
    'form',
    {
      class: 'join-row',
      onsubmit: (e: Event) => {
        e.preventDefault();
        const c = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (c.length !== 6) return toast('Table codes have 6 characters', 'error');
        a.join(c);
      },
    },
    code,
    h('button', { class: 'btn gold', type: 'submit' }, 'Join with code'),
  );
  let unwatch: () => void = () => {};
  const list = h('ul', { class: 'open-tables' });
  if (a.listsTables && a.watchTables) {
    list.replaceChildren(h('li', { class: 'muted' }, 'Looking for open tables…'));
    unwatch = a.watchTables((tables) => {
      if (tables === null) return list.replaceChildren(h('li', { class: 'muted' }, 'Open tables show here when this page is open on claude.ai.'));
      if (!tables.length) return list.replaceChildren(h('li', { class: 'muted' }, 'No open tables right now.'));
      list.replaceChildren(
        ...tables.map((t) =>
          h(
            'li',
            {},
            h('span', {}, h('b', {}, `${t.host}'s table`), h('span', { class: 'muted' }, ` · ${t.players}/${t.seats}`)),
            h('button', { class: 'btn gold small', onclick: run(() => a.joinOpen!(t)) }, 'Join'),
          ),
        ),
      );
    });
  }
  const friends = h(
    'section',
    { class: 'friends' },
    h('h2', {}, 'Got an invite?'),
    h('p', { class: 'muted' }, 'Type the 6-letter table code a friend sent you.'),
    joinForm,
    a.listsTables ? list : null,
  );

  const el = h(
    'main',
    { class: 'casino-screen lobby' },
    h('header', { class: 'lobby-top' }, marquee(true), profile),
    h('h1', { class: 'screen-title center' }, 'Choose your table'),
    h('div', { class: 'game-cards' }, blackjack, poker),
    friends,
    h('p', { class: 'fine-print' }, 'Play money only. No real money, ever.'),
  );
  return {
    el,
    dispose() {
      unwatch();
      me.dispose();
    },
  };
}

// ---------- Rules ----------

export function rulesScreen(game: GameKind, onBack: () => void, onPlay: () => void): HTMLElement {
  const r = RULES[game];
  return h(
    'main',
    { class: 'casino-screen rules-screen' },
    h('header', { class: 'lobby-top' }, marquee(true), h('button', { class: 'btn ghost small', onclick: onBack }, '← Back to the tables')),
    h('h1', { class: 'screen-title center' }, `How to play ${r.name}`),
    h('p', { class: 'tagline center' }, r.tagline),
    rulesContent(game),
    h('div', { class: 'rules-cta' }, h('button', { class: 'btn gold big', onclick: onPlay }, `Play ${game === 'poker' ? 'poker' : 'blackjack'} now`)),
  );
}

// ---------- Join (from an invite) ----------

export function joinScreen(code: string, onJoin: (name: string) => Promise<void>, onHome: () => void): { el: HTMLElement; dispose(): void } {
  const name = nameField();
  const preview = characterPreview(prefs.look);
  let busy = false;
  const form = h(
    'form',
    {
      class: 'menu',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const n = readName(name);
        if (!n || busy) return;
        busy = true;
        try {
          await onJoin(n);
        } finally {
          busy = false;
        }
      },
    },
    h('div', { class: 'char-row' }, preview.el, h('div', { class: 'char-side' }, h('label', { class: 'field-label', for: 'name' }, 'Table nickname'), name)),
    h('button', { class: 'btn gold big', type: 'submit' }, 'Sit down'),
  );
  setTimeout(() => name.focus(), 50);
  const el = h(
    'main',
    { class: 'casino-screen' },
    marquee(),
    h(
      'div',
      { class: 'card-panel' },
      h('p', { class: 'lead' }, 'You are invited to table ', h('strong', { class: 'code-pill' }, code)),
      form,
      h('button', { class: 'btn link', onclick: onHome }, 'Back to the casino'),
    ),
  );
  return { el, dispose: () => preview.dispose() };
}
