import { createContext } from "react";

/**
 * How an unfocused column is positioned relative to the focused columns.
 * - "outer-left": left of the leftmost focused column — slides offscreen left
 * - "outer-right": right of the rightmost focused column — slides offscreen right
 * - "in-between": between two focused columns — stacks as a depth deck
 * - null: focused (in normal flex flow)
 */
export type ColumnPosition = "outer-left" | "outer-right" | "in-between" | null;

/**
 * Maps column name → its current ColumnPosition classification.
 * Provided by Scene, consumed by each SceneColumn to drive its animation.
 */
export const ColumnPositionContext = createContext<Map<string, ColumnPosition>>(
  new Map(),
);
