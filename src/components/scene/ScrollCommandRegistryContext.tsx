import { createContext } from "react";
import type { ScrollCommand } from "./inputController";

/**
 * A mutable Map from column name to that column's command applier, letting
 * Scene's wheel handler route a decided ScrollCommand straight to the target
 * column without an intervening DOM event (replaces the old `columnscroll`
 * CustomEvent bridge). SceneColumn registers its `applyScrollCommand`
 * closure under its `name` on mount and keeps the registration fresh as the
 * closure changes; Scene's wheel handler looks it up by the column name it
 * decided on and calls it directly — fully synchronous, so the handler can
 * still call `preventDefault()` in the same tick as `passive: false` requires.
 *
 * Using a plain mutable Map (held in a ref at the Scene level) avoids
 * triggering React re-renders on registration — mirrors
 * ScrollOffsetStoreContext's pattern.
 */
export const ScrollCommandRegistryContext = createContext<Map<string, (cmd: ScrollCommand) => void>>(
  new Map(),
);
