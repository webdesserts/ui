import React, { isValidElement } from "react";
import { SceneColumn } from "./SceneColumn";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import type { ColumnPosition } from "./ColumnPositionContext";
import type { RegisteredColumn } from "./ColumnRegistryContext";

/**
 * Collects the focused state of each direct SceneColumn child (in order).
 * Returns an array of `{ name, focused }` entries for the columns.
 */
export function collectColumnFocusStates(
  children: React.ReactNode,
): Array<{ name: string; focused: boolean }> {
  const result: Array<{ name: string; focused: boolean }> = [];

  React.Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;

    const type = child.type as { displayName?: string } | string;
    const isColumn =
      typeof type !== "string" &&
      (type === SceneColumn || type.displayName === "SceneColumn");

    if (!isColumn) return;

    const props = child.props as { name?: string; children?: React.ReactNode };
    const name = props.name ?? "";

    // A column is focused if any of its SceneObject children are focused.
    const columnFocused = React.Children.toArray(
      props.children,
    ).some(
      (c) =>
        isValidElement<SceneObjectProps>(c) &&
        c.type === SceneObject &&
        c.props.focused === true,
    );

    result.push({ name, focused: columnFocused });
  });

  return result;
}

/**
 * Derives column focus-state entries from the column registry, sorted by
 * true DOM order via compareDocumentPosition — NOT registration/insertion
 * order, which can differ from DOM order (e.g. a column mounting later than
 * one it's rendered before). This is the registry-derived counterpart to
 * collectColumnFocusStates (the prop-walk seed): unlike the seed, it doesn't
 * depend on the shape of Scene's `children` prop, so it stays correct
 * through Fragment wrapping, custom components that return a SceneColumn,
 * etc. — see Scene.tsx's own S6 registration architecture (seed-then-correct).
 */
export function deriveColumnStatesFromRegistry(
  registry: Map<string, RegisteredColumn>,
): Array<{ name: string; focused: boolean }> {
  return Array.from(registry.entries())
    .sort(([, a], [, b]) => {
      const position = a.element.compareDocumentPosition(b.element);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    })
    .map(([name, { focused }]) => ({ name, focused }));
}

/**
 * Computes a position classification for each column based on which columns
 * are focused. Outer-left columns slide offscreen left, outer-right slide
 * right, in-between stack as a depth deck.
 *
 * When no columns are focused, all positions are null (camera stays still).
 */
export function computeColumnPositions(
  columns: Array<{ name: string; focused: boolean }>,
): Map<string, ColumnPosition> {
  const positions = new Map<string, ColumnPosition>();

  const focusedIndices = columns
    .map((c, i) => ({ i, focused: c.focused }))
    .filter((x) => x.focused)
    .map((x) => x.i);

  // When nothing is focused, columns stay at last position — don't slide offscreen.
  if (focusedIndices.length === 0) {
    columns.forEach((c) => positions.set(c.name, null));
    return positions;
  }

  const leftmostFocused = focusedIndices[0]!;
  const rightmostFocused = focusedIndices[focusedIndices.length - 1]!;

  columns.forEach((col, i) => {
    if (col.focused) {
      positions.set(col.name, null); // focused — in flex flow
    } else if (i < leftmostFocused) {
      positions.set(col.name, "outer-left");
    } else if (i > rightmostFocused) {
      positions.set(col.name, "outer-right");
    } else {
      positions.set(col.name, "in-between");
    }
  });

  return positions;
}

/**
 * Computes the depth index for each in-between column. Depth 1 is adjacent to
 * the rightmost focused column, depth 2 is the next one further left, etc.
 * Columns that are not in-between get depth 0 (unused sentinel value).
 *
 * Load-bearing invariant (D-series, ui/o:32): because depth is assigned by
 * walking backward through DOM order from the rightmost focused column,
 * depth is structurally guaranteed to equal reverse DOM order for every
 * state this function can produce. Column-level paint order (SceneColumn.tsx,
 * depthZ's own comment) relies on this — translateZ there is paint-INERT
 * (confirmed: z-sort doesn't work across sibling column anchors even with a
 * genuinely intact preserve-3d chain, and z-index is separately suppressed
 * inside preserve-3d entirely), so it's really ordinary DOM-order stacking
 * that keeps deeper columns visually behind shallower ones — this function's
 * own definition of "depth" is the ONLY reason that happens to be correct.
 * If a future change ever computes depth independent of DOM position (or
 * reorders columns independent of depth), column-level paint order breaks
 * silently and needs an explicit mechanism, mirroring the z-index channel
 * SceneObject.tsx already has for exactly this reason.
 */
export function computeStackDepths(
  columns: Array<{ name: string; focused: boolean }>,
): Map<string, number> {
  const depths = new Map<string, number>();
  const focusedIndices = columns
    .map((c, i) => ({ i, focused: c.focused }))
    .filter((x) => x.focused)
    .map((x) => x.i);

  if (focusedIndices.length === 0) return depths;

  const rightmostFocused = focusedIndices[focusedIndices.length - 1]!;

  // Walk backwards from the rightmost focused column — each in-between column
  // gets increasing depth (1 = adjacent to right, 2 = next further, etc.).
  let depth = 1;
  for (let i = rightmostFocused - 1; i >= 0; i--) {
    const col = columns[i]!;
    if (!col.focused) {
      depths.set(col.name, depth);
      depth++;
    }
  }

  return depths;
}
