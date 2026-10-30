// App entry: picks a screen from the URL and wires the table view together.
//   /                → home screen
//   /character       → character editor
//   /table/ABC123    → join (or rejoin) that table

import './style.css';
import { Sound } from './audio.js';
import { h, toast } from './dom.js';
import { Hud } from './hud.js';
import { Net, forgetSession, savedSession } from './net.js';
import type { PreviewApi } from './preview/install.js';
import type { TableRenderer } from './renderer.js';
import { type OpenTableInfo, characterScreen, homeScreen, joinScreen } from './screens.js';
import { prefs, store } from './storage.js';
import { Table2D } from './table2d.js';

const app = document.getElementById('app')!;
// The offline preview build installs an in-page server before this file runs.
const globals = globalThis as { __bjLocalSocket?: ConstructorParameters<typeof Net>[0]; __bjPreview?: PreviewApi };
const preview = globals.__bjPreview ?? null;
const PREVIEW = preview !== null;
const net = new Net(globals.__bjLocalSocket);
// The preview can't change the page address, so it keeps the current "path" in memory.
let currentPath = PREVIEW ? '/' : location.pathname;
const sound = new Sound({ muted: prefs.muted, music: prefs.musicVolume, sfx: prefs.sfxVolume, voice: prefs.dealerVoice });

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

function mount(el: HTMLElement, dispose?: () => void): void {
  teardown?.();
  teardown = dispose ?? null;
  app.replaceChildren(el);
}

function go(path: string): void {
  if (!PREVIEW && location.pathname !== path) history.pushState(null, '', path);
  currentPath = path;
  route();
}

window.addEventListener('popstate', () => {
  currentPath = location.pathname;
  route();
});

function tableCodeFromUrl(): string | null {
  const m = currentPath.match(/^\/table\/([A-Za-z0-9]{6})\/?$/);
  return m ? m[1]!.toUpperCase() : null;
}

/** Leaves the current table (and, in the preview, closes an online table you host). */
function leaveTable(): void {
  if (net.session) net.leave();
  if (preview) {
    void preview.stopHosting();
    preview.useLocal();
  }
}

function route(): void {
  const code = tableCodeFromUrl();
  if (!code) {
    leaveTable();
    if (currentPath === '/character') showCharacter();
    else showHome();
    return;
  }
  if (net.session?.code === code) {
    showTable();
    return;
  }
  leaveTable();
  // Saved seat from earlier (reload, or came back within 60s): try to sit straight back down.
  if (savedSession(code)) {
    void net.rejoin(code).then((res) => {
      if (res.ok) showTable();
      else {
        // Another tab already holds that seat: this tab joins as a new player.
        if (res.code !== 'SEAT_IN_USE') forgetSession(code);
        showJoin(code);
      }
    });
    return;
  }
  showJoin(code);
}

async function openTable(res: Awaited<ReturnType<Net['create']>>): Promise<void> {
  if (res.ok) go(`/table/${res.code}`);
  else toast(res.error, 'error');
}

function showHome(): void {
  document.title = 'Blackjack';
  const screen = homeScreen({
    preview: PREVIEW,
    solo: async (name) => openTable(await net.create(name, { solo: true })),
    bots: async (name, count) => openTable(await net.create(name, { bots: count })),
    create: async (name) => {
      const res = await net.create(name);
      if (res.ok && preview) {
        try {
          await preview.host(res.code, name);
        } catch {
          net.leave();
          toast('Online play is not available here', 'error');
          return;
        }
      }
      await openTable(res);
    },
    join: (code) => go(`/table/${code}`),
    joinOpen: async (name, table: OpenTableInfo) => {
      if (!preview) return;
      try {
        await preview.joinRemote({ ...table, peer: (table as OpenTableInfo & { peer: string }).peer });
      } catch {
        toast('Could not reach that table', 'error');
        preview.useLocal();
        return;
      }
      const res = await net.join(table.code, name);
      if (res.ok) go(`/table/${res.code}`);
      else {
        preview.useLocal();
        toast(res.error, 'error');
      }
    },
    watchTables: preview
      ? (fn) => {
          let off = () => {};
          let stopped = false;
          void preview.onlineAvailable().then(async (ok) => {
            if (stopped) return;
            if (!ok) return fn(null);
            off = await preview.watchTables(fn);
            if (stopped) off();
          });
          return () => {
            stopped = true;
            off();
          };
        }
      : undefined,
    customize: () => go('/character'),
  });
  mount(screen.el, screen.dispose);
}

function showCharacter(): void {
  document.title = 'Your character · Blackjack';
  const screen = characterScreen(() => go('/'));
  mount(screen.el, screen.dispose);
}

function showJoin(code: string): void {
  document.title = `Join table ${code} · Blackjack`;
  const screen = joinScreen(
    code,
    async (name) => {
      const res = await net.join(code, name);
      if (res.ok) showTable();
      else toast(res.error, 'error');
    },
    () => go('/'),
  );
  mount(screen.el, screen.dispose);
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
    lowGraphics: low,
    sound: {
      get muted() {
        return prefs.muted;
      },
      get music() {
        return prefs.musicVolume;
      },
      get sfx() {
        return prefs.sfxVolume;
      },
      get voice() {
        return prefs.dealerVoice;
      },
      setVoice: (on) => {
        prefs.dealerVoice = on;
        sound.setVoice(on);
      },
      setMuted: (m) => {
        prefs.muted = m;
        sound.muted = m;
      },
      setMusic: (v) => {
        prefs.musicVolume = v;
        sound.setMusicVolume(v);
      },
      setSfx: (v) => {
        prefs.sfxVolume = v;
        sound.setSfxVolume(v);
      },
    },
    onLeave: () => go('/'),
    onToggleGraphics: () => {
      low = !low;
      prefs.lowGraphics = low;
      renderer?.setLowGraphics(low);
      return low;
    },
    onInteract: () => sound.unlock(),
    play: (name) => sound.play(name),
    canInvite: !PREVIEW,
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
        onMoment: (kind, mine, name) => hud.celebrate(kind, mine, name),
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
    if (!store.local.get('bj:hinted')) {
      store.local.set('bj:hinted', '1');
      setTimeout(() => toast('Tip: drag to look around · tap ? for help'), 1200);
    }
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
  net.onChat = (m) => {
    hud.addChat(m);
    if (m.playerId && m.playerId !== net.me) renderer?.say?.(m.playerId, m.text);
  };
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
