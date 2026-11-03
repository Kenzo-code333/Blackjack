// App entry: picks a screen from the URL and wires the table view together.
//   /                → your avatar and table nickname
//   /lobby           → the casino floor: choose Blackjack or Texas Hold'em
//   /rules/<game>    → how to play
//   /table/ABC123    → join (or rejoin) that table

import './style.css';
import { Sound } from './audio.js';
import { h, toast } from './dom.js';
import { Hud } from './hud.js';
import { walletOf } from './format.js';
import { Net, forgetSession, savedSession } from './net.js';
import type { PreviewApi } from './preview/install.js';
import type { AnyState, GameKind } from '../shared/protocol.js';
import type { TableRenderer } from './renderer.js';
import { floorScreen } from './floor-screen.js';
import { CASINO_NAME, type LobbyActions, type OpenTableInfo, joinScreen, lobbyScreen, profileScreen, rulesScreen } from './screens.js';
import { prefs, store } from './storage.js';
import { Table2D } from './table2d.js';

const app = document.getElementById('app')!;
// The offline preview build installs an in-page server before this file runs.
const globals = globalThis as { __bjLocalSocket?: ConstructorParameters<typeof Net>[0]; __bjPreview?: PreviewApi };
const preview = globals.__bjPreview ?? null;
const PREVIEW = preview !== null;
const net = new Net(globals.__bjLocalSocket);
// The preview can't change the page address, so it keeps the current "path" in memory.
// An invite link to the preview ends in #table-abc123: open the join screen for that table.
const inviteFromHash = () => preview?.invitedCode() ?? null;
let currentPath = PREVIEW ? (inviteFromHash() ? `/invite/${inviteFromHash()}` : '/') : location.pathname;
/** Preview: the code of the online table we're at (hosting or joined), if any. */
let onlineCode: string | null = null;
/** Open the invite panel as soon as the next table view appears (right after creating a table). */
let openInviteNext = false;
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
  window.scrollTo(0, 0);
}

function go(path: string): void {
  if (!PREVIEW && location.pathname !== path) history.pushState(null, '', path);
  currentPath = path;
  route();
}

window.addEventListener('popstate', () => {
  if (PREVIEW) return;
  currentPath = location.pathname;
  route();
});
window.addEventListener('hashchange', () => {
  const code = PREVIEW ? inviteFromHash() : null;
  if (code && net.session?.code !== code) go(`/invite/${code}`);
});

function tableCodeFromUrl(): string | null {
  const m = currentPath.match(/^\/table\/([A-Za-z0-9]{6})\/?$/);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Leaves the current table. In the single-page builds an online table you host lives in
 * this page: if friends are still playing there, it keeps running for them (someone else
 * becomes the host) until everyone has left. It only closes if nobody else is there.
 */
function leaveTable(): void {
  const code = net.session?.code ?? null;
  const othersHere = Boolean(net.state?.players.some((p) => p.id !== net.me && !p.bot && p.connected));
  if (net.session) net.leave();
  if (preview) {
    if (preview.hostingCode && preview.hostingCode === code) {
      if (othersHere) toast('You left. Your table keeps running for your friends while this page stays open.');
      else void preview.stopHosting();
    }
    preview.useLocal();
  }
  onlineCode = null;
}

/** Preview: find an online table by code and sit down at it. */
async function joinOnline(code: string, name: string): Promise<void> {
  if (!preview) return;
  if (!(await preview.onlineAvailable())) {
    toast('Online tables work when this page is open on claude.ai and you are signed in.', 'error');
    return;
  }
  const table = await preview.findTable(code);
  if (!table) {
    toast(`Table ${code} isn't open right now. Check the code, or ask your friend to keep their table open.`, 'error');
    return;
  }
  try {
    await preview.joinRemote(table);
  } catch {
    preview.useLocal();
    toast('Could not reach that table', 'error');
    return;
  }
  const res = await net.join(table.code, name);
  if (res.ok) {
    onlineCode = res.code;
    go(`/table/${res.code}`);
  } else {
    preview.useLocal();
    toast(res.error, 'error');
  }
}

function route(): void {
  const invited = PREVIEW ? currentPath.match(/^\/invite\/([A-Z0-9]{6})$/)?.[1] : undefined;
  if (invited) {
    leaveTable();
    showOnlineJoin(invited);
    return;
  }
  const code = tableCodeFromUrl();
  if (!code) {
    leaveTable();
    const rules = currentPath.match(/^\/rules\/(blackjack|poker|roulette)$/)?.[1] as GameKind | undefined;
    if (rules) showRules(rules);
    else if (currentPath === '/lobby' && prefs.name) showLobby();
    else showProfile();
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

const GAME_TITLE: Record<GameKind, string> = { blackjack: 'Blackjack', poker: 'Texas Hold’em', roulette: 'Roulette' };

/** The home page: your avatar and table nickname. */
function showProfile(): void {
  document.title = `${CASINO_NAME} · Blackjack & Poker`;
  const screen = profileScreen(() => go('/lobby'));
  mount(screen.el, screen.dispose);
}

/** The casino floor: walk around in 3D (or a simple list), then pick a table. */
function showLobby(): void {
  document.title = `${CASINO_NAME} · Casino floor`;
  const name = () => prefs.name || 'Player';
  const actions: LobbyActions = {
    preview: PREVIEW,
    listsTables: preview?.listsTables ?? false,
    solo: async (game) => openTable(await net.create(name(), { solo: true, game })),
    bots: async (game, count) => openTable(await net.create(name(), { bots: count, game })),
    create: async (game) => {
      const res = await net.create(name(), { game });
      if (res.ok && preview) {
        try {
          await preview.host(res.code, name());
          onlineCode = res.code;
        } catch {
          net.leave();
          toast("Couldn't open the table online. Check your internet connection and try again.", 'error');
          return;
        }
      }
      openInviteNext = res.ok;
      await openTable(res);
    },
    join: (code) => go(PREVIEW ? `/invite/${code}` : `/table/${code}`),
    joinOpen: async (table: OpenTableInfo) => {
      if (!preview) return;
      try {
        await preview.joinRemote(table);
      } catch {
        toast('Could not reach that table', 'error');
        preview.useLocal();
        return;
      }
      const res = await net.join(table.code, name());
      if (res.ok) {
        onlineCode = res.code;
        go(`/table/${res.code}`);
      } else {
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
    rules: (game) => go(`/rules/${game}`),
    editProfile: () => go('/'),
  };
  const listView = store.local.get('bj:lobby') === 'list';
  if (listView) {
    const screen = lobbyScreen({
      ...actions,
      floorView: () => {
        store.local.set('bj:lobby', 'floor');
        showLobby();
      },
    });
    mount(screen.el, screen.dispose);
    return;
  }
  const screen = floorScreen({
    ...actions,
    low: defaultLowGraphics(),
    listView: () => {
      store.local.set('bj:lobby', 'list');
      showLobby();
    },
    onAutoLow: () => {
      prefs.lowGraphics = true;
      toast('Switched to low graphics for smoother play');
    },
  });
  mount(screen.el, screen.dispose);
}

function showRules(game: GameKind): void {
  document.title = `How to play ${GAME_TITLE[game]} · ${CASINO_NAME}`;
  mount(
    rulesScreen(
      game,
      () => go('/lobby'),
      async () => {
        if (!prefs.name) return go('/');
        await openTable(await net.create(prefs.name, game === 'poker' ? { game, bots: 4 } : { solo: true, game }));
      },
    ),
  );
  window.scrollTo(0, 0);
}

/** Single-page builds: someone opened an invite link (or typed a code). */
function showOnlineJoin(code: string): void {
  document.title = `Join table ${code} · ${CASINO_NAME}`;
  const screen = joinScreen(code, (name) => joinOnline(code, name), () => go('/lobby'));
  mount(screen.el, screen.dispose);
}

function showJoin(code: string): void {
  document.title = `Join table ${code} · ${CASINO_NAME}`;
  const screen = joinScreen(
    code,
    async (name) => {
      const res = await net.join(code, name);
      if (res.ok) showTable();
      else toast(res.error, 'error');
    },
    () => go('/lobby'),
  );
  mount(screen.el, screen.dispose);
}

/** Resolves with the table's state (it arrives right after joining). */
function firstState(): Promise<AnyState> {
  if (net.state) return Promise.resolve(net.state);
  return new Promise((resolve) => {
    const prev = net.onState;
    net.onState = (state, events) => {
      net.onState = prev;
      prev(state, events);
      resolve(state);
    };
  });
}

/** What to send friends so they can join this table, or null if it can't be joined. */
function inviteFor(code: string): { link: string; note: string } | null {
  if (!preview) {
    return { link: `${location.origin}/table/${code}`, note: 'No account or app needed: friends open the link, type a name and sit down.' };
  }
  if (onlineCode !== code) return null; // tables with bots run only on this page
  return { link: preview.inviteLink(code), note: preview.inviteNote };
}

function showTable(): void {
  const code = net.session!.code;
  const session = net.session;
  const loadingView = h('div', { class: 'table-view' }, h('div', { class: 'loading' }, 'Finding your seat…'));
  mount(loadingView);
  void firstState().then((state) => {
    if (net.session === session) showTableFor(code, state.game);
  });
}

function showTableFor(code: string, game: GameKind): void {
  document.title = `${GAME_TITLE[game]} · Table ${code} · ${CASINO_NAME}`;
  const stage = h('div', { class: 'stage' });
  const loading = h('div', { class: 'loading' }, 'Setting up the table…');
  const view = h('div', { class: 'table-view' }, stage, loading);
  mount(view);

  let low = defaultLowGraphics();
  let renderer: TableRenderer | null = null;
  let disposed = false;

  const hud = new Hud(net, {
    game,
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
    onLeave: () => go('/lobby'),
    onToggleGraphics: () => {
      low = !low;
      prefs.lowGraphics = low;
      renderer?.setLowGraphics(low);
      return low;
    },
    onInteract: () => sound.unlock(),
    play: (name) => sound.play(name),
    invite: inviteFor(code),
  });
  view.append(hud.el);
  if (openInviteNext) {
    openInviteNext = false;
    setTimeout(() => hud.openInvite(), 400);
  }

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
      if (game === 'poker') {
        const { PokerScene3D } = await import('./three/poker-scene.js');
        if (disposed) return;
        renderer = new PokerScene3D(stage, {
          sound,
          low,
          onAutoLow: () => {
            low = true;
            hud.setLowGraphics(true);
            toast('Switched to low graphics for smoother play');
          },
        });
      } else if (game === 'roulette') {
        const { RouletteScene3D } = await import('./three/roulette-scene.js');
        if (disposed) return;
        renderer = new RouletteScene3D(stage, {
          sound,
          low,
          onSpot: (spot) => hud.roulette?.bet(spot),
          onAutoLow: () => {
            low = true;
            hud.setLowGraphics(true);
            toast('Switched to low graphics for smoother play');
          },
        });
      } else renderer = new Table3D(stage, {
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
      if (game !== 'blackjack') {
        toast(`This device can’t show the 3D ${GAME_TITLE[game]} table.`, 'error');
        return;
      }
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
    // Your chips go with you to the next table.
    const wallet = walletOf(state, net.me);
    if (wallet !== null) prefs.chips = wallet;
  };
  net.onChat = (m) => {
    hud.addChat(m);
    if (m.playerId && m.playerId !== net.me) renderer?.say?.(m.playerId, m.text);
  };
  net.onChatHistory = (m) => hud.setChatHistory(m);
  net.onStatus = (s) => hud.setConnection(s);
  net.onKicked = () => {
    toast('The host removed you from the table', 'error');
    go('/lobby');
  };
  net.onLost = (error) => {
    toast(error, 'error');
    net.session = null;
    go('/lobby');
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
