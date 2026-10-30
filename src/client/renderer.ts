import type { PublicState, TableEvent } from '../shared/protocol.js';

/** Something that draws the table. The 3D scene and the simple 2D fallback both implement this. */
export interface TableRenderer {
  update(state: PublicState, events: TableEvent[], me: string | null): void;
  setLowGraphics(low: boolean): void;
  /** Shows a chat line at that player's seat, if the view can. */
  say?(playerId: string, text: string): void;
  dispose(): void;
}
