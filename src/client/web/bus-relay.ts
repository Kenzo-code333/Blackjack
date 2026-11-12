// The social message board through the public relays (file and website builds). Every
// message goes to every relay that answers, and comes back from each of them, so copies
// are dropped here: each topic+message is handled once.

import { type Bus, Listeners } from '../social/bus.js';
import { BROKERS, Mqtt } from './relay.js';

export function relayBus(): Bus {
  let links: Mqtt[] = [];
  let connecting: Promise<void> | null = null;
  const queue: [string, string, boolean][] = [];
  const seen = new Map<string, number>();
  const listeners = new Listeners(
    (filter) => links.forEach((m) => m.subscribe(filter, onMessage)),
    (filter) => links.forEach((m) => m.unsubscribe(filter)),
  );

  function onMessage(payload: string, topic: string): void {
    const key = `${topic}\n${payload}`;
    const now = Date.now();
    if ((seen.get(key) ?? 0) > now - 20_000) return;
    seen.set(key, now);
    if (seen.size > 4000) for (const [k, t] of seen) if (t < now - 20_000) seen.delete(k);
    listeners.deliver(topic, payload);
  }

  function connect(): Promise<void> {
    connecting ??= Promise.all(BROKERS.map((_, i) => Mqtt.connect(undefined, i).then((r) => r.mqtt).catch(() => null))).then((list) => {
      links = list.filter((m): m is Mqtt => m !== null);
      for (const m of links) {
        m.onClose = () => {
          links = links.filter((x) => x !== m);
          if (!links.length) {
            connecting = null;
            setTimeout(() => void connect(), 3000);
          }
        };
        for (const f of listeners.filters()) m.subscribe(f, onMessage);
      }
      for (const [t, p, r] of queue.splice(0)) links.forEach((m) => m.publish(t, p, r));
      if (!links.length) {
        connecting = null;
        setTimeout(() => void connect(), 5000);
      }
    });
    return connecting;
  }
  void connect();

  return {
    kind: 'relay',
    publish(topic, payload, retain = false) {
      if (!links.length) {
        if (queue.length < 200) queue.push([topic, payload, retain]);
        return;
      }
      for (const m of links) m.publish(topic, payload, retain);
    },
    subscribe(filter, fn) {
      return listeners.add(filter, fn);
    },
  };
}
