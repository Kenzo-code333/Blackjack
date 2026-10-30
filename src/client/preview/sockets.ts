// Stand-ins for a Socket.IO client socket, so the app code (net.ts) runs unchanged:
//  - LocalSocket talks to the PageServer in this page.
//  - RemoteSocket talks to a friend's page (the online host) through a named room.
//  - SwitchSocket is what Net actually holds; it forwards to whichever one is in use.

import type { PageServer } from './page-server.js';
import type { RoomLink } from './room-link.js';

type Handler = (...args: unknown[]) => void;

/** The minimal socket surface net.ts uses. */
export interface FakeSocket {
  on(event: string, fn: Handler): unknown;
  emit(event: string, ...args: unknown[]): unknown;
}

abstract class BaseSocket implements FakeSocket {
  protected readonly handlers = new Map<string, Handler[]>();

  on(event: string, fn: Handler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return this;
  }

  /** Deliver an event to this socket's listeners, asynchronously like a network. */
  push(event: string, ...args: unknown[]): void {
    setTimeout(() => {
      for (const fn of this.handlers.get(event) ?? []) fn(...args);
    }, 0);
  }

  abstract emit(event: string, ...args: unknown[]): this;

  protected splitAck(args: unknown[]): { payload: Record<string, unknown>; ack: Handler | null } {
    const ack = typeof args[args.length - 1] === 'function' ? (args.pop() as Handler) : null;
    return { payload: (args[0] ?? {}) as Record<string, unknown>, ack };
  }
}

let nextId = 0;

export class LocalSocket extends BaseSocket {
  readonly id = `local-${++nextId}`;

  constructor(private readonly server: PageServer) {
    super();
    server.connect({ id: this.id, remote: false, deliver: (event, ...args) => this.push(event, ...args) });
  }

  emit(event: string, ...args: unknown[]): this {
    const { payload, ack } = this.splitAck(args);
    setTimeout(() => {
      let res: unknown;
      try {
        res = this.server.handle(this.id, event, payload);
      } catch (err) {
        console.error(err);
        res = { ok: false, error: 'Something went wrong' };
      }
      if (ack && res !== undefined) ack(res);
    }, 0);
    return this;
  }
}

/** A friend's table, reached through the artifact's room. */
export class RemoteSocket extends BaseSocket {
  private seq = 0;
  private readonly waiting = new Map<number, { ack: Handler; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly link: RoomLink) {
    super();
    link.onPush = (event, args) => this.push(event, ...args);
    link.onResponse = (id, res) => {
      const w = this.waiting.get(id);
      if (!w) return;
      clearTimeout(w.timer);
      this.waiting.delete(id);
      w.ack(res);
    };
  }

  emit(event: string, ...args: unknown[]): this {
    const { payload, ack } = this.splitAck(args);
    const id = ++this.seq;
    if (ack) {
      this.waiting.set(id, {
        ack,
        timer: setTimeout(() => {
          this.waiting.delete(id);
          ack({ ok: false, error: 'The host did not answer' });
        }, 8000),
      });
    }
    void this.link.request(id, event, payload).catch((err: { code?: string }) => {
      const w = this.waiting.get(id);
      if (!w) return;
      clearTimeout(w.timer);
      this.waiting.delete(id);
      w.ack({
        ok: false,
        error:
          err?.code === 'not_permitted'
            ? 'You need Contributor access to this page to play online. Ask its owner to share it with you.'
            : 'Could not reach the host',
      });
    });
    return this;
  }

  close(): void {
    for (const w of this.waiting.values()) clearTimeout(w.timer);
    this.waiting.clear();
    void this.link.leave();
  }
}

/** What Net holds: forwards to the current target and keeps Net's listeners across switches. */
export class SwitchSocket extends BaseSocket {
  /** Socket.IO's manager; Net only listens for reconnect attempts on it. */
  readonly io = { on: () => {} };
  private target: BaseSocket;
  private readonly bound = new WeakSet<BaseSocket>();

  constructor(initial: BaseSocket) {
    super();
    this.target = initial;
    this.bind(initial);
    this.push('connect');
  }

  private bind(target: BaseSocket): void {
    if (this.bound.has(target)) return;
    this.bound.add(target);
    for (const event of ['state', 'chat', 'chat:history', 'kicked', 'closed']) {
      target.on(event, (...args) => {
        if (this.target === target) for (const fn of this.handlers.get(event) ?? []) fn(...args);
      });
    }
  }

  use(target: BaseSocket): void {
    if (target === this.target) return;
    if (this.target instanceof RemoteSocket) this.target.close();
    this.target = target;
    this.bind(target);
  }

  get current(): BaseSocket {
    return this.target;
  }

  emit(event: string, ...args: unknown[]): this {
    this.target.emit(event, ...args);
    return this;
  }
}
