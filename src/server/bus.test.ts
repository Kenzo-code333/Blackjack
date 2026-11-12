import { describe, expect, it } from 'vitest';
import { Bus, matches } from './bus.js';

describe('message board', () => {
  it('delivers to matching subscribers, keeps retained messages for later, deletes with an empty one', () => {
    const bus = new Bus(null);
    const got: Record<string, string[]> = { a: [], b: [] };
    bus.connect('a', (t, p) => got.a!.push(`${t}=${p}`));
    bus.connect('b', (t, p) => got.b!.push(`${t}=${p}`));
    expect(bus.subscribe('a', 'vace/v1/g/#')).toBeNull();
    expect(bus.publish('vace/v1/g/day/1', 'hi', true)).toBeNull();
    expect(bus.publish('vace/v1/pos/lounge/x', 'moving', false)).toBeNull();
    expect(got.a).toEqual(['vace/v1/g/day/1=hi']);
    // A late subscriber gets what was kept, not what wasn't.
    bus.subscribe('b', 'vace/v1/#');
    expect(got.b).toEqual(['vace/v1/g/day/1=hi']);
    bus.publish('vace/v1/g/day/1', '', true);
    const c: string[] = [];
    bus.connect('c', (t, p) => c.push(p));
    bus.subscribe('c', 'vace/v1/g/#');
    expect(c).toEqual([]);
  });

  it('refuses bad topics, filters and huge messages', () => {
    const bus = new Bus(null);
    bus.connect('a', () => {});
    expect(bus.publish('other/app', 'x', false)).toMatch(/Bad topic/);
    expect(bus.publish('vace/v1/a/#', 'x', false)).toMatch(/Bad topic/);
    expect(bus.publish('vace/v1/a', 'x'.repeat(20_000), false)).toMatch(/too big/);
    expect(bus.subscribe('a', 'vace/v1/#/x')).toMatch(/Bad filter/);
    expect(matches('vace/v1/dm/ab/#', 'vace/v1/dm/ab/123')).toBe(true);
    expect(matches('vace/v1/dm/ab/#', 'vace/v1/dm/abc/123')).toBe(false);
  });
});
