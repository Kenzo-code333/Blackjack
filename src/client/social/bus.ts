// The connection the social features talk through: publish a message on a topic, and get
// the messages on topics you subscribed to (a filter ending in "/#" matches everything
// below it). "Retained" messages are kept and handed to anyone who subscribes later.
//
//  - Server version: through the game server (see src/server/bus.ts).
//  - File and website versions: through the public relays (see web/bus-relay.ts).

import { io } from 'socket.io-client';

export interface Bus {
  readonly kind: 'server' | 'relay';
  publish(topic: string, payload: string, retain?: boolean): void;
  /** Returns a function that stops the subscription. */
  subscribe(filter: string, fn: (payload: string, topic: string) => void): () => void;
}

export const NS = 'vace/v1/';

const matches = (filter: string, topic: string) => filter === topic || (filter.endsWith('/#') && topic.startsWith(filter.slice(0, -1)));

/** Keeps one real subscription per filter, however many listeners want it. */
export class Listeners {
  private readonly map = new Map<string, Set<(payload: string, topic: string) => void>>();
  constructor(
    private readonly sub: (filter: string) => void,
    private readonly unsub: (filter: string) => void,
  ) {}

  add(filter: string, fn: (payload: string, topic: string) => void): () => void {
    let set = this.map.get(filter);
    if (!set) {
      set = new Set();
      this.map.set(filter, set);
      this.sub(filter);
    }
    set.add(fn);
    return () => {
      const s = this.map.get(filter);
      if (!s) return;
      s.delete(fn);
      if (!s.size) {
        this.map.delete(filter);
        this.unsub(filter);
      }
    };
  }

  deliver(topic: string, payload: string): void {
    for (const [filter, fns] of this.map) if (matches(filter, topic)) for (const fn of fns) fn(payload, topic);
  }

  /** Every filter (to subscribe again after a reconnect). */
  filters(): string[] {
    return [...this.map.keys()];
  }
}

export function serverBus(): Bus {
  const socket = io({ transports: ['websocket', 'polling'] });
  const listeners = new Listeners(
    (filter) => socket.emit('bus:sub', { filter }),
    (filter) => socket.emit('bus:unsub', { filter }),
  );
  socket.on('bus:msg', (m: { topic: string; payload: string }) => listeners.deliver(m.topic, m.payload));
  // After a reconnect the server has forgotten our subscriptions.
  socket.io.on('reconnect', () => {
    for (const f of listeners.filters()) socket.emit('bus:sub', { filter: f });
  });
  return {
    kind: 'server',
    publish: (topic, payload, retain = false) => void socket.emit('bus:pub', { topic, payload, retain }),
    subscribe: (filter, fn) => listeners.add(filter, fn),
  };
}
