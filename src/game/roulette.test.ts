import { describe, expect, it } from 'vitest';
import { WHEEL_ORDER, betReturn, isValidSpot, pocketColor, spotNumbers, spotOdds } from './roulette.js';

describe('roulette rules', () => {
  it('has a single-zero wheel with every number once, alternating red and black', () => {
    expect(WHEEL_ORDER).toHaveLength(37);
    expect(new Set(WHEEL_ORDER).size).toBe(37);
    expect(pocketColor(0)).toBe('green');
    for (let i = 1; i < 36; i++) expect(pocketColor(WHEEL_ORDER[i]!)).not.toBe(pocketColor(WHEEL_ORDER[i + 1]!));
    expect(spotNumbers('red')).toHaveLength(18);
    expect(pocketColor(32)).toBe('red');
    expect(pocketColor(26)).toBe('black');
  });

  it('pays the standard odds', () => {
    expect(spotOdds('n:17')).toBe(35);
    expect(spotOdds('red')).toBe(1);
    expect(spotOdds('dozen:2')).toBe(2);
    expect(spotOdds('col:3')).toBe(2);
    expect(betReturn('n:17', 10, 17)).toBe(360);
    expect(betReturn('red', 10, 0)).toBe(0); // zero loses every outside bet
    expect(betReturn('col:1', 10, 34)).toBe(30);
    expect(betReturn('dozen:3', 10, 24)).toBe(0);
    expect(spotNumbers('col:1')).toContain(34);
    expect(spotNumbers('low')).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it('accepts only real spots', () => {
    for (const ok of ['n:0', 'n:36', 'red', 'dozen:1', 'col:3', 'high']) expect(isValidSpot(ok)).toBe(true);
    for (const bad of ['n:37', 'n:07', 'n:-1', 'dozen:4', 'blue', 7, null]) expect(isValidSpot(bad)).toBe(false);
  });
});
