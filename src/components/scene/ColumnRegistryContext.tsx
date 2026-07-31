import { createContext } from "react";

/** A column's self-reported registration data. */
export interface RegisteredColumn {
  /** Whether any of this column's registered SceneObjects are currently focused. */
  focused: boolean;
  /** The column's own outer DOM element. */
  element: HTMLElement;
  /**
   * The anchor's own owned width-channel target (ui#17 target-derived
   * camera aiming) — the SAME value the width channel itself springs
   * toward (focused: computeFocusedWidth's result; in-between/decked:
   * the permanent zero-footprint target once known; a genuinely
   * never-focused, non-in-between column: undefined, matching the width
   * channel's own widthTarget having nothing to drive toward). Reported
   * because it's known synchronously at the SAME commit a focus change
   * lands — no measurement, no animation lag — which is what makes it
   * usable for computing the camera's OWN final aim point at that exact
   * commit, instead of measuring a DOM box mid-collapse/mid-growth.
   */
  widthTarget: number | undefined;
  /**
   * The anchor's own owned margin-compensation target (0 while focused
   * or not yet known to be in-between; -columnGap once a permanent
   * zero-footprint anchor is settled) — see marginMV's own declaration
   * comment in SceneColumn for the full "a zero-width flex item still
   * inserts one real columnGap" rationale this cancels.
   */
  marginTarget: number;
}

/**
 * Registers a column's current focus state, DOM element, and owned-channel
 * width/margin targets with the owning Scene. Returns an unregister
 * function. Called by SceneColumn in its own useLayoutEffect, every render
 * (S6 registration architecture) — this happens via React context + a DOM
 * ref, not by walking Scene's `children` prop tree, so it stays correct
 * regardless of Fragment wrapping or custom components that return a
 * SceneColumn.
 */
export type RegisterColumn = (
  name: string,
  registration: RegisteredColumn,
) => () => void;

/**
 * Provided by Scene to every descendant SceneColumn. `null` outside a Scene
 * (SceneColumn used standalone).
 */
export const ColumnRegistryContext = createContext<RegisterColumn | null>(null);
