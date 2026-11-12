// Plays an arcade game full screen, over the arcade floor. The game runs in a frame that
// shares this page's storage, so its saves (best scores, tracks, settings…) are part of
// your profile and your account. Press "Back to the arcade" to return.

import { h } from '../dom.js';
import { ARCADE, type ArcadeGameId } from './catalog.js';

/**
 * Runs first in each game's frame: lends the frame the page's `claude` object (so a game
 * can use the claude.ai features the page has, like Orbit Hop's global leaderboard) and
 * does the same for any frame the game itself creates (Game Night runs Orbit Hop in one).
 * Outside claude.ai there's no `claude` object and this does nothing.
 */
const BRIDGE = `(function s(){window.__vaBridge=1;try{if(!window.claude&&window.parent!==window&&window.parent.claude)window.claude=window.parent.claude}catch(e){}var d=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'srcdoc');if(d&&d.set&&!HTMLIFrameElement.prototype.__vaBridged){Object.defineProperty(HTMLIFrameElement.prototype,'__vaBridged',{value:1});Object.defineProperty(HTMLIFrameElement.prototype,'srcdoc',{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){if(typeof v==='string'&&v.indexOf('__vaBridge')<0)v=v.replace(/<head[^>]*>/i,function(m){return m+'<script>('+s+')()<\\/script>'});d.set.call(this,v)}})}})()`;

/** The game's page with the bridge script at the very top of its head. */
export function withBridge(html: string): string {
  const tag = `<script>${BRIDGE}</script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
}

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
  frame.srcdoc = withBridge(GAME_HTML[id]);
  frame.focus();
}
