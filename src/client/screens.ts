// Home screen, the character editor, and the join screen for invite links.

import { LOOK_OPTIONS, type Look } from '../shared/protocol.js';
import { h, toast } from './dom.js';
import { prefs } from './storage.js';

const RULES = ['6 decks', 'Dealer stands on soft 17', 'Blackjack pays 3 to 2', 'Play money only'];

function nameField(): HTMLInputElement {
  const input = h('input', {
    class: 'field',
    id: 'name',
    maxlength: 20,
    autocomplete: 'nickname',
    placeholder: 'Your display name',
    'aria-label': 'Display name',
    value: prefs.name,
  });
  // Remember the name as it's typed, so it survives a trip to the character editor.
  input.addEventListener('input', () => (prefs.name = input.value.trim()));
  return input;
}

function readName(input: HTMLInputElement): string | null {
  const name = input.value.trim();
  if (!name) {
    toast('Pick a display name first', 'error');
    input.focus();
    return null;
  }
  prefs.name = name;
  return name;
}

function shell(wide: boolean, ...children: (HTMLElement | null)[]): HTMLElement {
  return h(
    'main',
    { class: 'screen' },
    h(
      'div',
      { class: `card-panel${wide ? ' wide' : ''}` },
      h('div', { class: 'logo', 'aria-hidden': 'true' }, h('span', {}, 'A♠'), h('span', { class: 'red' }, 'K♥')),
      h('h1', {}, 'Blackjack'),
      ...children,
      h('p', { class: 'rules-line' }, RULES.join(' · ')),
    ),
  );
}

/** A 3D turntable of your character, loaded on demand (falls back to nothing without WebGL). */
export function characterPreview(look: Look): { el: HTMLElement; setLook(l: Look): void; dispose(): void } {
  const el = h('div', { class: 'char-preview', 'aria-hidden': 'true' });
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

export interface OpenTableInfo {
  code: string;
  host: string;
  players: number;
  seats: number;
}

export interface HomeActions {
  /** Preview build: tables run in this page; online tables go through the live room. */
  preview: boolean;
  solo: (name: string) => Promise<void>;
  bots: (name: string, count: number) => Promise<void>;
  /** Real server: create a table with an invite link. Preview: host an online table. */
  create: (name: string) => Promise<void>;
  join: (code: string) => void;
  /** Preview: join an open table from the list. */
  joinOpen?: (name: string, table: OpenTableInfo) => Promise<void>;
  /** Preview: subscribe to the list of open tables; null means online play is unavailable. */
  watchTables?: (fn: (tables: OpenTableInfo[] | null) => void) => () => void;
  customize: () => void;
}

export function homeScreen(actions: HomeActions): { el: HTMLElement; dispose(): void } {
  const name = nameField();
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
  const withName = (fn: (n: string) => Promise<void>) =>
    run(async () => {
      const n = readName(name);
      if (n) await fn(n);
    });

  // Your character.
  const preview = characterPreview(prefs.look);
  const character = h(
    'div',
    { class: 'char-row' },
    preview.el,
    h(
      'div',
      { class: 'char-side' },
      h('label', { class: 'field-label', for: 'name' }, 'Display name'),
      name,
      h('button', { class: 'btn ghost small', onclick: actions.customize }, 'Customize character'),
    ),
  );

  // Play with bots: how many.
  let botCount = 3;
  const countLabel = h('span', { class: 'count' }, String(botCount));
  const step = (d: number) => () => {
    botCount = Math.max(1, Math.min(4, botCount + d));
    countLabel.textContent = String(botCount);
  };
  const botsRow = h(
    'div',
    { class: 'bots-row' },
    h('button', { class: 'btn gold big grow', onclick: withName((n) => actions.bots(n, botCount)) }, 'Play with bots'),
    h(
      'div',
      { class: 'stepper', role: 'group', 'aria-label': 'Number of bots' },
      h('button', { class: 'icon-btn', 'aria-label': 'Fewer bots', onclick: step(-1) }, '−'),
      countLabel,
      h('button', { class: 'icon-btn', 'aria-label': 'More bots', onclick: step(1) }, '+'),
    ),
  );

  const code = h('input', {
    class: 'field code',
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
        if (readName(name) === null) return;
        actions.join(c);
      },
    },
    code,
    h('button', { class: 'btn ghost', type: 'submit' }, 'Join with code'),
  );

  // Online tables (preview build only).
  let unwatch: () => void = () => {};
  let online: HTMLElement | null = null;
  if (actions.preview) {
    const list = h('ul', { class: 'open-tables' }, h('li', { class: 'muted' }, 'Looking for open tables…'));
    online = h(
      'section',
      { class: 'online' },
      h('h2', {}, 'Online tables'),
      list,
      h('button', { class: 'btn ghost', onclick: withName(actions.create) }, 'Host an online table'),
    );
    unwatch =
      actions.watchTables?.((tables) => {
        if (tables === null) {
          list.replaceChildren(h('li', { class: 'muted' }, 'Online play works when this page is open on claude.ai and you are signed in.'));
          return;
        }
        if (!tables.length) {
          list.replaceChildren(h('li', { class: 'muted' }, 'No open tables yet. Host one, then ask friends to open this page.'));
          return;
        }
        list.replaceChildren(
          ...tables.map((t) =>
            h(
              'li',
              {},
              h('span', {}, h('b', {}, `${t.host}'s table`), h('span', { class: 'muted' }, ` · ${t.players}/${t.seats} seated`)),
              h('button', { class: 'btn gold small', onclick: withName((n) => actions.joinOpen!(n, t)) }, t.players >= t.seats ? 'Watch' : 'Join'),
            ),
          ),
        );
      }) ?? (() => {});
  }

  const el = shell(
    true,
    character,
    h(
      'div',
      { class: 'menu' },
      h('button', { class: 'btn gold big', onclick: withName(actions.solo) }, 'Play solo'),
      botsRow,
      actions.preview ? null : h('button', { class: 'btn gold big', onclick: withName(actions.create) }, 'Create table'),
      actions.preview ? null : joinForm,
    ),
    online,
  );
  return {
    el,
    dispose() {
      unwatch();
      preview.dispose();
    },
  };
}

/** Pick skin, hair, outfit and accessory, with a live 3D preview. */
export function characterScreen(onDone: () => void): { el: HTMLElement; dispose(): void } {
  let look = prefs.look;
  const preview = characterPreview(look);
  const update = (patch: Partial<Look>) => {
    look = { ...look, ...patch };
    prefs.look = look;
    preview.setLook(look);
    render();
  };

  const rows = h('div', { class: 'look-rows' });
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
          h(
            'button',
            { class: `pill${look[key] === i ? ' on' : ''}`, role: 'radio', 'aria-checked': String(look[key] === i), onclick: () => update({ [key]: i }) },
            text,
          ),
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

  const el = shell(
    true,
    h('div', { class: 'editor' }, preview.el, rows),
    h(
      'div',
      { class: 'editor-actions' },
      h(
        'button',
        {
          class: 'btn ghost',
          onclick: () => {
            const rand = () => Math.floor(Math.random() * 1000);
            update({
              skin: rand() % LOOK_OPTIONS.skin.length,
              hair: rand() % LOOK_OPTIONS.hair.length,
              hairColor: rand() % LOOK_OPTIONS.hairColor.length,
              outfit: rand() % LOOK_OPTIONS.outfit.length,
              extra: rand() % LOOK_OPTIONS.extra.length,
            });
          },
        },
        'Surprise me',
      ),
      h('button', { class: 'btn gold big', onclick: onDone }, 'Done'),
    ),
  );
  return { el, dispose: () => preview.dispose() };
}

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
    h('div', { class: 'char-row' }, preview.el, h('div', { class: 'char-side' }, h('label', { class: 'field-label', for: 'name' }, 'Display name'), name)),
    h('button', { class: 'btn gold big', type: 'submit' }, 'Sit down'),
  );
  setTimeout(() => name.focus(), 50);
  const el = shell(
    false,
    h('p', { class: 'lead' }, 'You are invited to table ', h('strong', { class: 'code-pill' }, code)),
    form,
    h('button', { class: 'btn link', onclick: onHome }, 'Back to home'),
  );
  return { el, dispose: () => preview.dispose() };
}
