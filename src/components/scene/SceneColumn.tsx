import React, { isValidElement, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import { useSceneConfig } from "./useSceneConfig";
import type { FrozenSize } from "./types";

export interface SceneColumnProps {
  /** Stable name for this column. Shown in debug mode and used for implicit wrapping. */
  name: string;
  children: React.ReactNode;
}

/** Derives whether any direct SceneObject child is currently focused. */
function deriveColumnFocused(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some(
    (child) =>
      isValidElement<SceneObjectProps>(child) &&
      child.type === SceneObject &&
      child.props.focused === true,
  );
}

/**
 * A vertical slot within a Scene. Objects inside a column share a horizontal
 * position and swap vertically when focus changes. A column is considered
 * focused if any of its children are focused.
 *
 * Focused columns participate in the Scene's flex row (`position: relative`,
 * `flex: 1 1 0`). Unfocused columns exit the flex flow — they capture their
 * last known size via ResizeObserver, then switch to `position: absolute` with
 * explicit inline width/height (the "freeze"). On re-focus, the frozen size is
 * cleared and motion's `layout` FLIP-animates the column back into flex.
 *
 * @example
 * <SceneColumn name="nav">
 *   <SceneObject name="nav-panel" focused={view === "nav"}>
 *     <NavPanel />
 *   </SceneObject>
 * </SceneColumn>
 */
export function SceneColumn({ name, children }: SceneColumnProps) {
  const columnFocused = deriveColumnFocused(children);
  const { duration } = useSceneConfig();

  // The last measured size while the column was focused. Set to null while
  // focused (no freeze applied) and to a FrozenSize after losing focus.
  const [frozenSize, setFrozenSize] = useState<FrozenSize | null>(null);

  // Tracks the latest size observed via ResizeObserver while focused.
  const lastObservedSize = useRef<FrozenSize>({ width: 0, height: 0 });
  const colRef = useRef<HTMLDivElement | null>(null);

  // Track column size via ResizeObserver while focused. On focus loss, read the
  // last observed size (or fall back to getBoundingClientRect) and freeze it as
  // explicit inline dimensions. On re-focus, clear the frozen size.
  useEffect(() => {
    if (columnFocused) {
      // Re-focusing — clear the frozen size so the column returns to flex flow.
      setFrozenSize(null);

      const el = colRef.current;
      if (!el) return;

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          lastObservedSize.current = {
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          };
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    } else {
      // Column just lost focus — capture current dimensions. Prefer the
      // ResizeObserver reading; fall back to getBoundingClientRect in case
      // the observer hasn't fired yet (e.g., first render then immediate
      // unfocus in tests with duration=0).
      const el = colRef.current;
      const fallback = el
        ? { width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }
        : { width: 0, height: 0 };

      const observed = lastObservedSize.current;
      const size = observed.width > 0 || observed.height > 0 ? observed : fallback;
      setFrozenSize({ ...size });
    }
  }, [columnFocused]);

  // duration=0 → instant transitions for tests; undefined → spring physics.
  const transition = duration === 0 ? { duration: 0 } : { type: "spring" as const };

  // position and flex must be in `style` (not `animate`) because motion only
  // animates transforms, opacity, and CSS custom properties — not layout properties.
  // flex: 1 1 0 → equal sharing of available viewport width among focused columns.
  const focusedStyle: React.CSSProperties = {
    position: "relative",
    flex: "1 1 0",
    minWidth: 0,
    opacity: 1,
    // Clear any inline width/height left over from the frozen state so flex
    // can recalculate the column size freely.
    width: "",
    height: "",
  };

  // Unfocused columns exit flex flow and are hidden. If we have a frozen size,
  // set explicit dimensions so the column preserves its footprint in the DOM
  // (needed for FLIP to animate from the correct position when re-focusing).
  // opacity is set here directly so the initial render doesn't flash before
  // motion applies the animate prop.
  const unfocusedStyle: React.CSSProperties = {
    position: "absolute",
    flex: "none",
    opacity: 0,
    ...(frozenSize
      ? { width: frozenSize.width, height: frozenSize.height }
      : {}),
  };

  return (
    <motion.div
      ref={colRef}
      layout
      data-column={name}
      data-column-focused={String(columnFocused)}
      animate={{ opacity: columnFocused ? 1 : 0 }}
      transition={transition}
      style={columnFocused ? focusedStyle : unfocusedStyle}
    >
      {children}
    </motion.div>
  );
}

// Explicit displayName allows Scene to detect SceneColumn children via
// child.type.displayName without importing SceneColumn directly (avoiding
// circular import issues).
SceneColumn.displayName = "SceneColumn";
