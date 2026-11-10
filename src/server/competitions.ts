// Challenges between friends: everyone starts with the same chips, plays any game for a
// set time, and whoever has the most chips when the clock runs out wins.
//
// The server keeps each challenge's details and every player's latest chip count (sent by
// their browser as they play). Counts that arrive after the end are ignored. Saved to a
// small JSON file next to the accounts so a restart doesn't lose them.

import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type ChallengeBoard, type ChallengeInfo, cleanChallengeMinutes, cleanLook } from '../shared/protocol.js';
import { cleanName } from './rooms.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const START_CHIPS = [1000, 5000] as const;
const MAX_PLAYERS = 50;
/** Scores sent this soon after the end still count (the last report on the way). */
const GRACE_MS = 5000;

interface Entry {
  id: string;
  secret: string;
  name: string;
  look: unknown;
  chips: number;
  at: number;
}

interface Challenge {
  info: ChallengeInfo;
  players: Entry[];
}

type Res<T> = ({ ok: true } & T) | { ok: false; error: string };

export class ChallengeStore {
  private readonly all = new Map<string, Challenge>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly file: string | null = process.env.CHALLENGES_FILE ?? path.resolve('data', 'challenges.json'),
    private readonly now: () => number = Date.now,
  ) {
    if (file && existsSync(file)) {
      try {
        for (const c of JSON.parse(readFileSync(file, 'utf8')) as Challenge[]) this.all.set(c.info.code, c);
      } catch (err) {
        console.error('Could not read the challenges file', err);
      }
    }
  }

  create(raw: { name?: unknown; minutes?: unknown; startChips?: unknown; player?: { name?: unknown; look?: unknown } }): Res<{ code: string; playerId: string; secret: string; info: ChallengeInfo }> {
    const host = cleanName(raw.player?.name);
    if (!host) return { ok: false, error: 'Please enter your nickname first' };
    const minutes = cleanChallengeMinutes(raw.minutes);
    const startChips = START_CHIPS.includes(Number(raw.startChips) as (typeof START_CHIPS)[number]) ? Number(raw.startChips) : 1000;
    this.prune();
    let code: string;
    do code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    while (this.all.has(code));
    const t = this.now();
    // CHALLENGE_TEST_SECONDS (tests only): every challenge lasts that many seconds instead.
    const testSeconds = Number(process.env.CHALLENGE_TEST_SECONDS) || 0;
    const info: ChallengeInfo = { code, name: cleanName(raw.name) || `${host}’s challenge`, host, startChips, createdAt: t, endsAt: t + (testSeconds ? testSeconds * 1000 : minutes * 60_000) };
    this.all.set(code, { info, players: [] });
    const joined = this.join(code, raw.player ?? {});
    if (!joined.ok) return joined;
    return { ...joined, code };
  }

  join(rawCode: unknown, player: { name?: unknown; look?: unknown }): Res<{ playerId: string; secret: string; info: ChallengeInfo }> {
    const c = this.get(rawCode);
    if (!c) return { ok: false, error: 'No challenge with that code. Check it with your friend.' };
    if (this.now() >= c.info.endsAt) return { ok: false, error: 'That challenge is already over' };
    const name = cleanName(player.name);
    if (!name) return { ok: false, error: 'Please enter your nickname first' };
    if (c.players.length >= MAX_PLAYERS) return { ok: false, error: 'That challenge is full' };
    const e: Entry = { id: randomBytes(6).toString('base64url'), secret: randomBytes(16).toString('base64url'), name, look: cleanLook(player.look), chips: c.info.startChips, at: this.now() };
    c.players.push(e);
    this.persist();
    return { ok: true, playerId: e.id, secret: e.secret, info: c.info };
  }

  /** A player's latest chip count. Only they can send it (with their secret); late counts are ignored. */
  report(rawCode: unknown, playerId: unknown, secret: unknown, chips: unknown): string | null {
    const c = this.get(rawCode);
    const e = c?.players.find((p) => p.id === playerId);
    if (!c || !e || e.secret !== secret) return 'Not in this challenge';
    if (this.now() > c.info.endsAt + GRACE_MS) return 'The challenge is over';
    const n = Math.floor(Number(chips));
    if (!Number.isFinite(n) || n < 0) return 'Bad chip count';
    e.chips = Math.min(n, 100_000_000);
    e.at = this.now();
    this.persist();
    return null;
  }

  board(rawCode: unknown): ChallengeBoard | null {
    const c = this.get(rawCode);
    if (!c) return null;
    return {
      info: c.info,
      players: c.players.map((p) => ({ id: p.id, name: p.name, look: cleanLook(p.look), chips: p.chips, at: p.at })).sort((a, b) => b.chips - a.chips || a.at - b.at),
    };
  }

  private get(raw: unknown): Challenge | undefined {
    const code = typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '';
    return this.all.get(code);
  }

  /** Forget challenges that ended more than a week ago. */
  private prune(): void {
    const old = this.now() - 7 * 86_400_000;
    for (const [code, c] of this.all) if (c.info.endsAt < old) this.all.delete(code);
  }

  private persist(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 1000);
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify([...this.all.values()]));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (err) {
      console.error('Could not save challenges', err);
    }
  }
}
