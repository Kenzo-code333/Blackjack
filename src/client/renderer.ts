import type { AnyEvent, AnyState, PokerEvent, TableEvent } from '../shared/protocol.js';

/** Something that draws the table: the 3D blackjack or poker scene, or the simple 2D fallback. */
export interface TableRenderer {
  update(state: AnyState, events: AnyEvent[], me: string | null): void;
  setLowGraphics(low: boolean): void;
  /** Shows a chat line at that player's seat, if the view can. */
  say?(playerId: string, text: string): void;
  /** Resolves once the view can draw smoothly (shaders compiled). */
  readonly ready?: Promise<void>;
  dispose(): void;
}
