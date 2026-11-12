// A tiny publish/subscribe message board for the social features (people list, friends,
// chats, who is walking around which room), shared by everyone connected to this server.
//
// It behaves like the public relays the file and website builds use (MQTT): a message is
// published on a topic like "vace/v1/u/abc"; whoever subscribed to a matching filter
// ("vace/v1/u/#") receives it; "retained" messages are kept and sent to anyone who
// subscribes later (that's how chat history and profiles are stored).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const BUS_PREFIX = 'vace/v1/';
const MAX_TOPIC = 200;
const MAX_PAYLOAD = 12_000;
const MAX_RETAINED = 50_000;

export function topicOk(topic: unknown): topic is string {
  return typeof topic === 'string' && topic.startsWith(BUS_PREFIX) && topic.length <= MAX_TOPIC && !/[#+\s]/.test(topic);
}

export function filterOk(filter: unknown): filter is string {
  if (typeof filter !== 'string' || !filter.startsWith(BUS_PREFIX) || filter.length > MAX_TOPIC || /\s|\+/.test(filter)) return false;
  const hash = filter.indexOf('#');
  return hash === -1 || (hash === filter.length - 1 && filter.endsWith('/#'));
}

export function matches(filter: string, topic: string): boolean {
  return filter === topic || (filter.endsWith('/#') && topic.startsWith(filter.slice(0, -1)));
}

export class Bus {
  private readonly retained = new Map<string, string>();
  private readonly subscribers = new Map<string, { filters: Set<string>; send: (topic: string, payload: string) => void }>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file: string | null = process.env.BUS_FILE ?? path.resolve('data', 'bus.json')) {
    if (file && existsSync(file)) {
      try {
        for (const [t, p] of JSON.parse(readFileSync(file, 'utf8')) as [string, string][]) this.retained.set(t, p);
      } catch (err) {
        console.error('Could not read the message board file', err);
      }
    }
  }

  connect(id: string, send: (topic: string, payload: string) => void): void {
    this.subscribers.set(id, { filters: new Set(), send });
  }

  disconnect(id: string): void {
    this.subscribers.delete(id);
  }

  subscribe(id: string, filter: unknown): string | null {
    const s = this.subscribers.get(id);
    if (!s) return 'Not connected';
    if (!filterOk(filter)) return 'Bad filter';
    if (s.filters.size >= 200) return 'Too many subscriptions';
    s.filters.add(filter);
    // Kept messages that match go out straight away.
    for (const [t, p] of this.retained) if (matches(filter, t)) s.send(t, p);
    return null;
  }

  unsubscribe(id: string, filter: unknown): void {
    if (typeof filter === 'string') this.subscribers.get(id)?.filters.delete(filter);
  }

  publish(topic: unknown, payload: unknown, retain: unknown): string | null {
    if (!topicOk(topic)) return 'Bad topic';
    if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD) return 'Message too big';
    if (retain === true) {
      // An empty retained message deletes the kept one (as with MQTT).
      if (payload === '') this.retained.delete(topic);
      else {
        if (!this.retained.has(topic) && this.retained.size >= MAX_RETAINED) {
          const oldest = this.retained.keys().next().value;
          if (oldest !== undefined) this.retained.delete(oldest);
        }
        this.retained.set(topic, payload);
      }
      this.persist();
    }
    for (const s of this.subscribers.values()) {
      for (const f of s.filters) {
        if (matches(f, topic)) {
          s.send(topic, payload);
          break;
        }
      }
    }
    return null;
  }

  private persist(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 2000);
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify([...this.retained]));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (err) {
      console.error('Could not save the message board', err);
    }
  }
}
