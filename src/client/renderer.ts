import type { PublicState, TableEvent } from '../shared/protocol.js';

/** Something that draws the table. The 3D scene and the simple 2D fallback both implement this. */
export interface TableRenderer {
  update(state: PublicState, events: TableEvent[], me: string | null): void;
  setLowGraphics(low: boolean): void;
  dispose(): void;
}
