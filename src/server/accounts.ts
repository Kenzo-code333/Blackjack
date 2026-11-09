// Player accounts: an email and a password that keep a player's nickname, character,
// chips and stats, so they can pick up where they left off on any device.
//
// Passwords are never stored: only a salted scrypt hash. Accounts are kept in a small
// JSON file (ACCOUNTS_FILE, default data/accounts.json). Sign-in gives a random token
// that the browser keeps and sends with each save.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface AccountRecord {
  email: string;
  salt: string;
  hash: string;
  created: number;
  /** The player's saved profile: nickname, look, chips, vault, stats, settings. */
  data: Record<string, unknown>;
  tokens: string[];
}

export type AccountResult = { ok: true; email: string; token: string; data: Record<string, unknown> } | { ok: false; error: string };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
export const MAX_DATA_BYTES = 24_000;

export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

export function passwordProblem(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length < 6) return 'Your password needs at least 6 characters';
  if (raw.length > 200) return 'That password is too long';
  return null;
}

/** Only plain JSON objects of a sane size are stored. */
export function cleanData(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  try {
    const text = JSON.stringify(raw);
    if (text.length > MAX_DATA_BYTES) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class AccountStore {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly byToken = new Map<string, string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** `file` = null keeps accounts in memory only (tests). */
  constructor(private readonly file: string | null = process.env.ACCOUNTS_FILE ?? path.resolve('data', 'accounts.json')) {
    if (file && existsSync(file)) {
      try {
        const list = JSON.parse(readFileSync(file, 'utf8')) as AccountRecord[];
        for (const a of list) {
          this.accounts.set(a.email, a);
          for (const t of a.tokens ?? []) this.byToken.set(t, a.email);
        }
      } catch (err) {
        console.error('Could not read the accounts file', err);
      }
    }
  }

  get size(): number {
    return this.accounts.size;
  }

  private async hash(password: string, salt: Buffer): Promise<Buffer> {
    return scrypt(password, salt, 32);
  }

  private issueToken(a: AccountRecord): string {
    const token = randomBytes(24).toString('base64url');
    a.tokens = [...(a.tokens ?? []), token].slice(-10); // up to 10 devices stay signed in
    this.byToken.clear();
    for (const acc of this.accounts.values()) for (const t of acc.tokens) this.byToken.set(t, acc.email);
    return token;
  }

  async signUp(rawEmail: unknown, password: unknown, rawData: unknown): Promise<AccountResult> {
    const email = cleanEmail(rawEmail);
    if (!email) return { ok: false, error: 'Please enter a valid email address' };
    const problem = passwordProblem(password);
    if (problem) return { ok: false, error: problem };
    if (this.accounts.has(email)) return { ok: false, error: 'There is already an account with this email. Sign in instead.' };
    const salt = randomBytes(16);
    const hash = await this.hash(password as string, salt);
    const a: AccountRecord = { email, salt: salt.toString('base64'), hash: hash.toString('base64'), created: Date.now(), data: cleanData(rawData) ?? {}, tokens: [] };
    this.accounts.set(email, a);
    const token = this.issueToken(a);
    this.persist();
    return { ok: true, email, token, data: a.data };
  }

  async logIn(rawEmail: unknown, password: unknown): Promise<AccountResult> {
    const email = cleanEmail(rawEmail);
    const a = email ? this.accounts.get(email) : undefined;
    const wrong = { ok: false as const, error: 'Wrong email or password' };
    if (!a || typeof password !== 'string') return wrong;
    const hash = await this.hash(password, Buffer.from(a.salt, 'base64'));
    if (!timingSafeEqual(hash, Buffer.from(a.hash, 'base64'))) return wrong;
    const token = this.issueToken(a);
    this.persist();
    return { ok: true, email: a.email, token, data: a.data };
  }

  byTokenOf(token: unknown): AccountRecord | undefined {
    if (typeof token !== 'string') return undefined;
    const email = this.byToken.get(token);
    return email ? this.accounts.get(email) : undefined;
  }

  save(token: unknown, rawData: unknown): string | null {
    const a = this.byTokenOf(token);
    if (!a) return 'Please sign in again';
    const data = cleanData(rawData);
    if (!data) return 'That save is too big or not valid';
    a.data = data;
    this.persist();
    return null;
  }

  logOut(token: unknown): void {
    const a = this.byTokenOf(token);
    if (!a) return;
    a.tokens = a.tokens.filter((t) => t !== token);
    this.byToken.delete(token as string);
    this.persist();
  }

  /** Writes the file a moment later (many saves in a row become one write). */
  private persist(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 400);
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify([...this.accounts.values()]));
      renameSync(tmp, this.file);
    } catch (err) {
      console.error('Could not save accounts', err);
    }
  }
}
