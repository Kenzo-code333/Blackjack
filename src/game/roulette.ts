// European roulette: one green zero, 36 red and black numbers, a single-zero wheel.

/** The numbers in the order they sit around a European wheel, clockwise from zero. */
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26] as const;

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export type PocketColor = 'red' | 'black' | 'green';

export function pocketColor(n: number): PocketColor {
  if (n === 0) return 'green';
  return REDS.has(n) ? 'red' : 'black';
}

/**
 * Where a bet sits on the layout:
 *   n:17      one number (pays 35 to 1)
 *   red, black, odd, even, low (1–18), high (19–36)   (pay 1 to 1)
 *   green         the zero, the only green pocket       (pays 35 to 1)
 *   dozen:1|2|3   1–12, 13–24, 25–36                  (pays 2 to 1)
 *   col:1|2|3     the three columns (col:1 = 1, 4, 7…) (pays 2 to 1)
 */
export type BetSpot = string;

export const OUTSIDE_SPOTS = ['red', 'black', 'green', 'odd', 'even', 'low', 'high', 'dozen:1', 'dozen:2', 'dozen:3', 'col:1', 'col:2', 'col:3'] as const;

export function isValidSpot(spot: unknown): spot is BetSpot {
  if (typeof spot !== 'string') return false;
  if ((OUTSIDE_SPOTS as readonly string[]).includes(spot)) return true;
  const m = spot.match(/^n:(\d{1,2})$/);
  return !!m && Number(m[1]) <= 36 && String(Number(m[1])) === m[1];
}

/** The numbers a bet covers. */
export function spotNumbers(spot: BetSpot): number[] {
  const all = Array.from({ length: 36 }, (_, i) => i + 1);
  if (spot.startsWith('n:')) return [Number(spot.slice(2))];
  switch (spot) {
    case 'red':
      return all.filter((n) => REDS.has(n));
    case 'black':
      return all.filter((n) => !REDS.has(n));
    case 'green':
      return [0];
    case 'odd':
      return all.filter((n) => n % 2 === 1);
    case 'even':
      return all.filter((n) => n % 2 === 0);
    case 'low':
      return all.filter((n) => n <= 18);
    case 'high':
      return all.filter((n) => n >= 19);
  }
  const [kind, which] = spot.split(':');
  const k = Number(which);
  if (kind === 'dozen') return all.filter((n) => n > (k - 1) * 12 && n <= k * 12);
  if (kind === 'col') return all.filter((n) => (n - 1) % 3 === k - 1);
  return [];
}

/** "35 to 1" etc.: what one chip wins on top of being returned. */
export function spotOdds(spot: BetSpot): number {
  return 36 / spotNumbers(spot).length - 1;
}

/** What a bet returns when `result` comes up: the stake plus winnings, or 0. */
export function betReturn(spot: BetSpot, amount: number, result: number): number {
  return spotNumbers(spot).includes(result) ? amount * (spotOdds(spot) + 1) : 0;
}

/** A short name for the layout and the results: "17", "Red", "1st 12", "Column 2". */
export function spotLabel(spot: BetSpot): string {
  if (spot.startsWith('n:')) return spot.slice(2);
  const named: Record<string, string> = { red: 'Red', black: 'Black', green: 'Green', odd: 'Odd', even: 'Even', low: '1 to 18', high: '19 to 36' };
  if (named[spot]) return named[spot]!;
  const [kind, which] = spot.split(':');
  if (kind === 'dozen') return ['1st 12', '2nd 12', '3rd 12'][Number(which) - 1]!;
  return `Column ${which}`;
}
