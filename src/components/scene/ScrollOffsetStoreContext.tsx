import { createContext } from "react";

/**
 * A saved scroll position for a column, keyed by column name in
 * ScrollOffsetStoreContext.
 */
export interface ScrollOffsetEntry {
  /** The saved scroll offset (px). */
  offset: number;
  /**
   * The joined focused-object-name key (see SceneColumn's
   * computeFocusedObjectKey) active when this entry was saved. Compared
   * against the current key to distinguish an unchanged inner focus
   * arrangement (park/return — restore) from a within-column swap (reset
   * per the newly-focused object's resetAlignment) — the A2 swap-reset model.
   */
  focusedKey: string;
  /**
   * The column's content height at the moment this entry was saved (i.e. at
   * the last park). Lives on the entry — not a separate per-instance ref —
   * so it survives an unmount/remount of a same-named column (B7): a fresh
   * component instance has no ref history of its own, but the store entry
   * (keyed by name, owned by the parent Scene) persists across it.
   */
  contentHeightAtSave: number;
}

/**
 * A mutable Map that persists scroll offsets across column focus/unfocus cycles.
 * Keyed by column name. SceneColumn reads from and writes to this map on focus
 * transitions — saving when losing focus, restoring when regaining focus.
 *
 * Using a plain mutable Map (held in a ref at the Scene level) avoids triggering
 * React re-renders when the saved position changes.
 */
export const ScrollOffsetStoreContext = createContext<Map<string, ScrollOffsetEntry>>(
  new Map(),
);
