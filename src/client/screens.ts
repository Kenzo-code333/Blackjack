// The home screen ("Play solo / Create table / Join with code") and the join screen
// people see when they open an invite link.

import { h, toast } from './dom.js';
import { prefs } from './storage.js';

const RULES = ['6 decks', 'Dealer stands on soft 17', 'Blackjack pays 3 to 2', 'Play money only'];

function nameField(): HTMLInputElement {
  return h('input', {
    class: 'field',
    id: 'name',
    maxlength: 20,
    autocomplete: 'nickname',
    placeholder: 'Your display name',
    'aria-label': 'Display name',
    value: prefs.name,
  });
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

function shell(...children: HTMLElement[]): HTMLElement {
  return h(
    'main',
    { class: 'screen' },
    h(
      'div',
      { class: 'card-panel' },
      h('div', { class: 'logo', 'aria-hidden': 'true' }, h('span', {}, 'A♠'), h('span', { class: 'red' }, 'K♥')),
      h('h1', {}, 'Blackjack'),
      ...children,
      h('p', { class: 'rules-line' }, RULES.join(' · ')),
    ),
  );
}

export interface HomeActions {
  /** Offline preview: only solo play, with a note explaining why. */
  soloOnly?: boolean;
  solo: (name: string) => Promise<void>;
  create: (name: string) => Promise<void>;
  join: (code: string) => void;
}

export function homeScreen(actions: HomeActions): HTMLElement {
  const name = nameField();
  const code = h('input', {
    class: 'field code',
    maxlength: 6,
    placeholder: 'ABC123',
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Table code',
  });
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
  const solo = h('button', { class: 'btn gold big', onclick: run(async () => { const n = readName(name); if (n) await actions.solo(n); }) }, 'Play solo');
  const create = h('button', { class: 'btn gold big', onclick: run(async () => { const n = readName(name); if (n) await actions.create(n); }) }, 'Create table');
  return shell(
    h('label', { class: 'field-label', for: 'name' }, 'Display name'),
    name,
    actions.soloOnly
      ? h('div', { class: 'menu' }, solo, h('p', { class: 'preview-note' }, 'This preview runs entirely in your browser, so it is solo only. Tables with friends need the deployed server.'))
      : h('div', { class: 'menu' }, solo, create, joinForm),
  );
}

export function joinScreen(code: string, onJoin: (name: string) => Promise<void>, onHome: () => void): HTMLElement {
  const name = nameField();
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
    h('label', { class: 'field-label', for: 'name' }, 'Display name'),
    name,
    h('button', { class: 'btn gold big', type: 'submit' }, 'Sit down'),
  );
  setTimeout(() => name.focus(), 50);
  return shell(
    h('p', { class: 'lead' }, 'You are invited to table ', h('strong', { class: 'code-pill' }, code)),
    form,
    h('button', { class: 'btn link', onclick: onHome }, 'Back to home'),
  );
}
