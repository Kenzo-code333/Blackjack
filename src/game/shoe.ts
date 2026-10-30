// A multi-deck shoe with a cut card.
//
// The cut card is placed roughly `penetration` of the way into the shoe. When a draw
// passes it, `cutCardReached` becomes true: the current round finishes normally and
// the table reshuffles before the next one (that's how real casinos do it).

import { type Card, makeDeck } from './cards.js';
import { type Rng, cryptoRng, shuffle } from './random.js';

export interface ShoeOptions {
  decks?: number;
  /** Fraction of the shoe dealt before the cut card, e.g. 0.75. */
  penetration?: number;
  rng?: Rng;
}

export class Shoe {
  readonly decks: number;
  readonly penetration: number;
  private readonly rng: Rng;
  private cards: Card[] = [];
  private next = 0;
  private cutIndex = 0;
  /** Number of times the shoe has been shuffled (handy for showing a "shuffling" animation). */
  shuffleCount = 0;

  constructor(options: ShoeOptions = {}) {
    this.decks = options.decks ?? 6;
    this.penetration = options.penetration ?? 0.75;
    this.rng = options.rng ?? cryptoRng;
    this.shuffle();
  }

  shuffle(): void {
    const cards: Card[] = [];
    for (let d = 0; d < this.decks; d++) cards.push(...makeDeck());
    this.cards = shuffle(cards, this.rng);
    this.next = 0;
    // Jitter the cut card by up to ±4% so its position isn't exactly predictable.
    const jitter = (this.rng() - 0.5) * 0.08;
    this.cutIndex = Math.floor(this.cards.length * Math.min(0.9, Math.max(0.5, this.penetration + jitter)));
    this.shuffleCount++;
  }

  draw(): Card {
    // Safety net: never run dry mid-round, even with unusual settings.
    if (this.next >= this.cards.length) this.shuffle();
    return this.cards[this.next++]!;
  }

  get size(): number {
    return this.cards.length;
  }

  get remaining(): number {
    return this.cards.length - this.next;
  }

  get dealt(): number {
    return this.next;
  }

  get cutCardReached(): boolean {
    return this.next >= this.cutIndex;
  }

  /** Test helper: put specific cards on top of the shoe (first element is drawn first). */
  stackForTesting(top: Card[]): void {
    this.cards.splice(this.next, 0, ...top);
  }
}
