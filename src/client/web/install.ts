// Website build (e.g. GitHub Pages): tables run in this page, and online tables go through
// a free public relay, so friends need no account at all. Hands the app its plumbing
// through globals that main.ts reads.

import type { OnlineApi, OpenTable } from '../online-api.js';
import { PageServer } from '../preview/page-server.js';
import { LocalSocket, RemoteSocket, SwitchSocket } from '../preview/sockets.js';
import { BROKERS, RelayHost, RelayLink, type RelayTable, findRelayTable } from './relay.js';

const server = new PageServer();
const local = new LocalSocket(server);
const switcher = new SwitchSocket(local);
let hosting: RelayHost | null = null;

type Found = OpenTable & { relay: RelayTable };

declare const __SHARE_URL__: string;

/** Opened as a downloaded file (file://): there's no address to share, so links point to the website. */
const fromFile = () => location.protocol === 'file:';

/** The page address without any query or hash, e.g. https://name.github.io/Blackjack/ */
const base = () => (fromFile() ? __SHARE_URL__ : `${location.origin}${location.pathname}`);

const api: OnlineApi = {
  onlineAvailable: async () => typeof WebSocket !== 'undefined',
  listsTables: false,
  watchTables: async () => () => {},
  host: async (code, hostName) => {
    await api.stopHosting();
    const h = new RelayHost(server, code, hostName);
    await h.start();
    hosting = h;
  },
  joinRemote: async (table) => {
    const link = await RelayLink.connect((table as Found).relay);
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
  findTable: async (code, timeoutMs) => {
    const relay = await findRelayTable(code, invitedBroker(code), timeoutMs);
    return relay ? ({ code: relay.code, host: relay.host, players: 0, seats: 5, relay } satisfies Found) : null;
  },
  // `r` says which relay the host uses, so friends connect to the same one straight away.
  inviteLink: (code) => `${base()}?table=${code}${hosting && hosting.broker > 0 ? `&r=${hosting.broker}` : ''}`,
  get inviteNote() {
    return fromFile()
      ? 'Friends can open the link (the game website), or open their own copy of the game file and type the code in "Join with code". No account needed. Keep this window open while you play: the table lives here.'
      : 'Anyone can open this link: no account or app needed. The table lives in your browser tab, so keep it open while you play.';
  },
  invitedCode: () => new URLSearchParams(location.search).get('table')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || null,
};

/** The relay index from the invite link, if it was for this table. */
function invitedBroker(code: string): number | undefined {
  const q = new URLSearchParams(location.search);
  const r = Number(q.get('r'));
  return q.get('table')?.toUpperCase() === code.toUpperCase() && Number.isInteger(r) && r >= 0 && r < BROKERS.length ? r : undefined;
}

const g = globalThis as { __bjLocalSocket?: unknown; __bjPreview?: OnlineApi };
g.__bjLocalSocket = switcher;
g.__bjPreview = api;
