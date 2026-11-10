// What the single-page builds (claude.ai preview, public website) give the app for
// playing without the Node server: tables run in the host's page, and friends connect
// through a live channel (the claude.ai room, or a public relay).

export interface OpenTable {
  code: string;
  host: string;
  players: number;
  seats: number;
}

export interface OnlineApi {
  /** Resolves false when online play isn't available in this view. */
  onlineAvailable(): Promise<boolean>;
  /** Whether this build can list open tables (the claude.ai room can; the relay can't). */
  readonly listsTables: boolean;
  /** Where accounts can be saved online (file and website builds), if anywhere. */
  /** Challenges through the public relays (file and website builds). */
  readonly challenges?: import('./challenge-api.js').ChallengeBackend;
  readonly cloud?: { get(id: string): Promise<string[]>; put(id: string, payload: string): Promise<number> };
  watchTables(fn: (tables: OpenTable[]) => void): Promise<() => void>;
  /** Open the table just created on this page to friends. */
  host(code: string, hostName: string): Promise<void>;
  /** Point the app at a friend's table (found with findTable or watchTables). */
  joinRemote(table: OpenTable): Promise<void>;
  /** Back to tables on this page. */
  useLocal(): void;
  /** Close the online table this page hosts, if any. */
  stopHosting(): Promise<void>;
  readonly hostingCode: string | null;
  /** Finds an open table by its code, waiting a few seconds for its host to answer. */
  findTable(code: string, timeoutMs?: number): Promise<OpenTable | null>;
  /** The link that opens this game straight at a table. */
  inviteLink(code: string): string;
  /** A short note shown under the invite link. */
  readonly inviteNote: string;
  /** The table code in the address this page was opened with, if any. */
  invitedCode(): string | null;
}
