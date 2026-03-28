import { createContext } from "react";

/**
 * A mutable Map that persists scroll offsets across column focus/unfocus cycles.
 * Keyed by column name. SceneColumn reads from and writes to this map on focus
 * transitions — saving when losing focus, restoring when regaining focus.
 *
 * Using a plain mutable Map (held in a ref at the Scene level) avoids triggering
 * React re-renders when the saved position changes.
 */
export const ScrollOffsetStoreContext = createContext<Map<string, number>>(
  new Map(),
);
