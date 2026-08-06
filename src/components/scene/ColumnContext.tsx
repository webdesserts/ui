import { createContext } from "react";

/**
 * Depth info for an unfocused SceneObject that is sandwiched between two
 * focused siblings within the same column. These objects receive depth-deck
 * visual treatment (opacity, greyscale, scale) and are positioned to peek
 * above the lower focused sibling rather than being hidden.
 */
export interface WithinColumnDepthInfo {
  /** Depth index: 1 = adjacent to the lower focused sibling, increasing outward. */
  depth: number;
}

interface ColumnRegistration {
  /**
   * Register a SceneObject's outer element, focus state, and its own
   * height-channel target (ui#21 — see GeometryEntry's own `heightTarget`
   * doc comment for why this must be REPORTED, not DOM-measured, here).
   * Returns an unregister function. `focused` feeds the column's OWN
   * registration with Scene (S6 registration architecture) — it's tracked
   * separately from this column's internal deriveObjectStates prop walk
   * (scope pin: column-level classification only, see SceneColumn.tsx's own
   * registration effect). `heightTarget` is called unconditionally
   * every render (mirrors `focused`'s own unconditional-per-render
   * rationale — a same-commit reflection requirement, not just a mount-time
   * one), so remeasureGeometry always reads this render's own value.
   */
  register: (name: string, el: HTMLElement, focused: boolean, heightTarget: number | undefined) => () => void;
  /**
   * Depth info for unfocused SceneObjects sandwiched between two focused
   * siblings. Objects not in this map receive normal (hidden) treatment.
   */
  withinColumnDepths: Map<string, WithinColumnDepthInfo>;
  /**
   * This column's own objectGap (px) — exposed so SceneObject's own
   * margin-bottom gap-compensation channel (ui#21, mirrors SceneColumn's
   * own marginMV/-columnGap channel vertically) can read it without a
   * separate prop-drilling path.
   */
  objectGap: number;
  /**
   * Join/leave the column's shared ResizeObserver (ui#32 Cluster 2). Keyed
   * to DOM element identity, not render cadence — SceneObject calls these
   * from a callback ref (fires exactly on genuine attach/detach), never
   * from its own per-render registration effect. Calling
   * observe()/unobserve() on the same element every render (the pre-fix
   * behavior) reset the ResizeObserver's internal `lastReportedSize`
   * tracking each time, spuriously queuing a delivery even though the
   * element never actually changed size.
   */
  observeElement: (el: HTMLElement) => void;
  unobserveElement: (el: HTMLElement) => void;
}

export const ColumnContext = createContext<ColumnRegistration | null>(null);
