/** A snapshot of a SceneObject's state for the debug overlay. */
export interface DebugObjectEntry {
  name: string;
  focused: boolean;
}

/** Position classification and depth for an unfocused column. */
export interface DebugColumnStackEntry {
  name: string;
  /** "outer-left" | "in-between" | "outer-right" */
  classification: string;
  /** Stacking depth index (only meaningful for in-between columns). */
  depth: number;
}

/** Per-column scroll state read from DOM data attributes for the debug overlay. */
export interface DebugColumnScroll {
  name: string;
  scrollOffset: number;
  contentHeight: number;
  viewportHeight: number;
  scrollable: boolean;
}

/** Measured bounds of a SceneObject for the debug overlay. */
export interface DebugObjectBounds {
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
}
