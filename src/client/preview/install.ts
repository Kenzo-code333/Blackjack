// Preview build only: sets up the in-page server and the online-table plumbing,
// then hands them to the app through globals that main.ts reads.

import { PageServer } from './page-server.js';
import { OnlineHost, type OpenTable, RoomLink, getRoom, watchOpenTables } from './room-link.js';
import { LocalSocket, RemoteSocket, SwitchSocket } from './sockets.js';

const server = new PageServer();
const local = new LocalSocket(server);
const switcher = new SwitchSocket(local);
let hosting: OnlineHost | null = null;

export interface PreviewApi {
  /** Resolves false when online play isn't available in this view. */
  onlineAvailable(): Promise<boolean>;
  watchTables(fn: (tables: OpenTable[]) => void): Promise<() => void>;
  /** Open the table just created on this page to friends. */
  host(code: string, hostName: string): Promise<void>;
  /** Point the app at a friend's table. */
  joinRemote(table: OpenTable): Promise<void>;
  /** Back to tables on this page. */
  useLocal(): void;
  /** Close the online table this page hosts, if any. */
  stopHosting(): Promise<void>;
  readonly hostingCode: string | null;
}

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
    const link = await RoomLink.connect(room, table);
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
};

const g = globalThis as { __bjLocalSocket?: unknown; __bjPreview?: PreviewApi };
g.__bjLocalSocket = switcher;
g.__bjPreview = api;
