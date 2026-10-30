// App entry: picks a screen from the URL and wires the table view together.
//   /                → home screen
//   /table/ABC123    → join (or rejoin) that table

import './style.css';
import { Sound } from './audio.js';
import { h, toast } from './dom.js';
import { Hud } from './hud.js';
import { Net, forgetSession, savedSession } from './net.js';
import type { TableRenderer } from './renderer.js';
import { homeScreen, joinScreen } from './screens.js';
import { prefs } from './storage.js';
import { Table2D } from './table2d.js';

const app = document.getElementById('app')!;
const net = new Net();
const sound = new Sound(prefs.muted);

// Browsers only allow sound after the first tap or click.
window.addEventListener('pointerdown', () => sound.unlock(), { capture: true });
window.addEventListener('keydown', () => sound.unlock(), { capture: true });

/** Phones and small/older machines start in low graphics unless the player chose otherwise. */
function defaultLowGraphics(): boolean {
  const saved = prefs.lowGraphics;
  if (saved !== null) return saved;
  const touch = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  return touch || cores <= 4;
}

let teardown: (() => void) | null = null;

function mount(el: HTMLElement): void {
  teardown?.();
  teardown = null;
  app.replaceChildren(el);
}

function go(path: string): void {
  if (location.pathname !== path) history.pushState(null, '', path);
  route();
}

window.addEventListener('popstate', () => route());

function tableCodeFromUrl(): string | null {
  const m = location.pathname.match(/^\/table\/([A-Za-z0-9]{6})\/?$/);
  return m ? m[1]!.toUpperCase() : null;
}

function route(): void {
  const code = tableCodeFromUrl();
  if (!code) {
    if (net.session) net.leave();
    showHome();
    return;
  }
  if (net.session?.code === code) {
    showTable();
    return;
  }
  if (net.session) net.leave();
  // Saved seat from earlier (reload, or came back within 60s): try to sit straight back down.
  if (savedSession(code)) {
    void net.join(code, prefs.name).then((res) => {
      if (res.ok) showTable();
      else {
        forgetSession(code);
        showJoin(code);
      }
    });
    return;
  }
  showJoin(code);
}

function showHome(): void {
  document.title = 'Blackjack';
  mount(
    homeScreen({
      solo: async (name) => {
        const res = await net.create(name, true);
        if (res.ok) go(`/table/${res.code}`);
        else toast(res.error, 'error');
      },
      create: async (name) => {
        const res = await net.create(name, false);
        if (res.ok) go(`/table/${res.code}`);
        else toast(res.error, 'error');
      },
      join: (code) => go(`/table/${code}`),
    }),
  );
}

function showJoin(code: string): void {
  document.title = `Join table ${code} · Blackjack`;
  mount(
    joinScreen(
      code,
      async (name) => {
        const res = await net.join(code, name);
        if (res.ok) showTable();
        else toast(res.error, 'error');
      },
      () => go('/'),
    ),
  );
}

function showTable(): void {
  const code = net.session!.code;
  document.title = `Table ${code} · Blackjack`;
  const stage = h('div', { class: 'stage' });
  const loading = h('div', { class: 'loading' }, 'Setting up the table…');
  const view = h('div', { class: 'table-view' }, stage, loading);
  mount(view);

  let low = defaultLowGraphics();
  let renderer: TableRenderer | null = null;
  let disposed = false;

  const hud = new Hud(net, {
    muted: prefs.muted,
    lowGraphics: low,
    onLeave: () => go('/'),
    onToggleMute: () => {
      prefs.muted = !prefs.muted;
      sound.muted = prefs.muted;
      return prefs.muted;
    },
    onToggleGraphics: () => {
      low = !low;
      prefs.lowGraphics = low;
      renderer?.setLowGraphics(low);
      return low;
    },
    onInteract: () => sound.unlock(),
    sound: (name) => sound.play(name),
  });
  view.append(hud.el);

  const bet = (value: number) => {
    sound.play('chip');
    void net.bet(value).then((r) => !r.ok && toast(r.error, 'error'));
  };

  // The 3D scene is a separate download, so the home screen stays quick.
  const start = async () => {
    try {
      const { Table3D, webglAvailable } = await import('./three/scene3d.js');
      if (disposed) return;
      if (!webglAvailable()) throw new Error('WebGL not available');
      renderer = new Table3D(stage, {
        sound,
        low,
        onChipClick: bet,
        onAutoLow: () => {
          low = true;
          hud.setLowGraphics(true);
          toast('Switched to low graphics for smoother play');
        },
      });
    } catch (err) {
      console.warn('3D unavailable, using the 2D table', err);
      if (disposed) return;
      renderer = new Table2D(stage);
    }
    loading.remove();
    if (net.state) {
      renderer.update(net.state, [], net.me);
      hud.update(net.state);
    }
  };
  void start();

  net.onState = (state, events) => {
    renderer?.update(state, events, net.me);
    hud.update(state);
  };
  net.onChat = (m) => hud.addChat(m);
  net.onChatHistory = (m) => hud.setChatHistory(m);
  net.onStatus = (s) => hud.setConnection(s);
  net.onKicked = () => {
    toast('The host removed you from the table', 'error');
    go('/');
  };
  net.onLost = (error) => {
    toast(error, 'error');
    net.session = null;
    go('/');
  };
  hud.setConnection(net.status);
  if (net.state) hud.update(net.state);

  teardown = () => {
    disposed = true;
    net.onState = () => {};
    net.onChat = () => {};
    net.onChatHistory = () => {};
    hud.dispose();
    renderer?.dispose();
  };
}

route();
