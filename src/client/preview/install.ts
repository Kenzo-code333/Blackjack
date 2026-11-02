// Preview build only: sets up the in-page server and the online-table plumbing,
// then hands them to the app through globals that main.ts reads.

import type { OnlineApi } from '../online-api.js';
import { PageServer } from './page-server.js';
import { OnlineHost, type OpenTable, RoomLink, getRoom, watchOpenTables } from './room-link.js';
import { LocalSocket, RemoteSocket, SwitchSocket } from './sockets.js';

declare const __PREVIEW_URL__: string;

const server = new PageServer();
const local = new LocalSocket(server);
const switcher = new SwitchSocket(local);
let hosting: OnlineHost | null = null;

export type PreviewApi = OnlineApi;

const api: PreviewApi = {
  onlineAvailable: async () => (await getRoom()) !== null,
  watchTables: async (fn) => {
    const room = await getRoom();
    if (!room) return () => {};
    return watchOpenTables(room, fn);
  },
  host: async (code, hostName) => {
    const room = await getRoom();
    if (!room) throw new Error('Online play is not available here');
    await api.stopHosting();
    hosting = new OnlineHost(room, server, code, hostName);
    await hosting.start();
  },
  joinRemote: async (table) => {
    const room = await getRoom();
    if (!room) throw new Error('Online play is not available here');
    const link = await RoomLink.connect(room, table as OpenTable);
    switcher.use(new RemoteSocket(link));
  },
  useLocal: () => switcher.use(local),
  stopHosting: async () => {
    const h = hosting;
    hosting = null;
    await h?.stop();
  },
  get hostingCode() {
    return hosting?.code ?? null;
  },
  listsTables: true,
  inviteLink: (code) => `${__PREVIEW_URL__}#table-${code.toLowerCase()}`,
  inviteNote:
    "This link opens the game on claude.ai: friends need a Claude account and access to this page (Contributor, from the page's Share menu). For a link anyone can open without an account, use the website version (see the README). The table lives in its host's tab, so keep it open.",
  invitedCode: () => location.hash.match(/^#table-([a-z0-9]{6})$/i)?.[1]?.toUpperCase() ?? null,
  findTable: async (code, timeoutMs = 8000) => {
    const room = await getRoom();
    if (!room) return null;
    const wanted = code.toUpperCase();
    return new Promise((resolve) => {
      let off: () => void = () => {};
      const timer = setTimeout(() => {
        off();
        resolve(null);
      }, timeoutMs);
      off = watchOpenTables(room, (tables) => {
        const t = tables.find((x) => x.code.toUpperCase() === wanted);
        if (!t) return;
        clearTimeout(timer);
        setTimeout(() => off(), 0);
        resolve(t);
      });
    });
  },
};

const g = globalThis as { __bjLocalSocket?: unknown; __bjPreview?: PreviewApi };
g.__bjLocalSocket = switcher;
g.__bjPreview = api;
