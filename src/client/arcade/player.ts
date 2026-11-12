// Plays an arcade game full screen, over the arcade floor. The game runs in a frame that
// shares this page's storage, so its saves (best scores, tracks, settings…) are part of
// your profile and your account. Press "Back to the arcade" to return.

import { h } from '../dom.js';
import { ARCADE, type ArcadeGameId } from './catalog.js';

export async function playArcadeGame(id: ArcadeGameId, onClose: () => void): Promise<void> {
  const game = ARCADE.find((g) => g.id === id)!;
  const loading = h('div', { class: 'arcade-loading' }, h('div', { class: 'spinner' }), `Loading ${game.title}…`);
  const frame = h('iframe', { class: 'arcade-frame', title: game.title, allow: 'fullscreen; autoplay; gamepad; clipboard-write', allowfullscreen: true });
  const close = () => {
    el.remove();
    window.removeEventListener('keydown', onKey, true);
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    // Escape is often used inside games; Shift+Escape always leaves.
    if (e.key === 'Escape' && e.shiftKey) close();
  };
  const el = h(
    'div',
    { class: 'arcade-overlay', role: 'dialog', 'aria-label': game.title, style: `--neon:${game.color}` },
    h(
      'header',
      { class: 'arcade-bar' },
      h('button', { class: 'arcade-back', onclick: close }, '← Back to the arcade'),
      h('b', { class: 'arcade-title' }, game.title),
      h('span', { class: 'muted small arcade-hint' }, 'Free play · your progress is saved'),
    ),
    frame,
    loading,
  );
  document.body.append(el);
  window.addEventListener('keydown', onKey, true);
  const { GAME_HTML } = await import('./games.js');
  frame.addEventListener('load', () => loading.remove(), { once: true });
  frame.srcdoc = GAME_HTML[id];
  frame.focus();
}
