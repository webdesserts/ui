import React, { forwardRef, useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../utils/cn";
import { ColumnContext, useSceneContext } from "./Scene";

type FrozenStyle = { left: number; top: number; width: number; height: number };

export interface SceneColumnProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional stable name for this column. Auto-generated via useId() if omitted. */
  name?: string;
  children: React.ReactNode;
}

/**
 * A vertical slot within a Scene. Objects inside a column share a horizontal
 * position and swap vertically. The column itself is the flex item that
 * participates in Scene's horizontal layout — focused columns get `flex: 0 1 auto`
 * while unfocused columns are positioned absolutely at their last known bounds.
 *
 * @example
 * <Scene>
 *   <SceneColumn name="nav">
 *     <SceneObject focused={view === "nav"}><NavPanel /></SceneObject>
 *   </SceneColumn>
 *   <SceneColumn name="content">
 *     <SceneObject focused={view !== "nav"}><ContentPanel /></SceneObject>
 *   </SceneColumn>
 * </Scene>
 */
export const SceneColumn = forwardRef<HTMLDivElement, SceneColumnProps>(
  function SceneColumn({ name, children, className, ...htmlProps }, forwardedRef) {
    const generatedId = useId();
    const id = name ?? generatedId;
    const internalRef = useRef<HTMLDivElement>(null);
    const { entries } = useSceneContext();

    // Track which SceneObject IDs belong to this column.
    const [childIds, setChildIds] = useState<Set<string>>(new Set());

    const [frozenStyle, setFrozenStyle] = useState<FrozenStyle | null>(null);

    // Stable callbacks passed to SceneObject children via ColumnContext.
    const registerChild = useCallback((childId: string) => {
      setChildIds((prev) => {
        if (prev.has(childId)) return prev;
        const next = new Set(prev);
        next.add(childId);
        return next;
      });
    }, []);

    const unregisterChild = useCallback((childId: string) => {
      setChildIds((prev) => {
        if (!prev.has(childId)) return prev;
        const next = new Set(prev);
        next.delete(childId);
        return next;
      });
    }, []);

    // Determine if any child object is currently focused.
    const hasAnyFocusedChild = Array.from(childIds).some((childId) => {
      const entry = entries.get(childId);
      return entry?.focused === true;
    });

    const prevFocusedRef = useRef(hasAnyFocusedChild);

    // Track the last dimensions while focused so we can freeze accurately.
    // We can't read offsetWidth/offsetHeight after going unfocused because the
    // column's children exit flow (position:absolute) simultaneously, making
    // the column shrink to zero before our effect can read it.
    const lastFocusedDimensionsRef = useRef<FrozenStyle | null>(null);

    // Snapshot dimensions whenever the column is focused. We guard on offsetWidth
    // being positive because during a focused→unfocused transition, layout effects
    // may fire after SceneObject children have already switched to position:absolute
    // (collapsing the column's intrinsic width to 0). Skipping zero-width snapshots
    // ensures we always freeze at the last real rendered dimensions.
    useLayoutEffect(() => {
      if (hasAnyFocusedChild && internalRef.current) {
        const el = internalRef.current;
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        if (width > 0) {
          lastFocusedDimensionsRef.current = {
            left: el.offsetLeft,
            top: el.offsetTop,
            width,
            height,
          };
        }
      }
    });

    // Freeze at last known dimensions when all children lose focus.
    useLayoutEffect(() => {
      const wasFocused = prevFocusedRef.current;
      prevFocusedRef.current = hasAnyFocusedChild;

      if (wasFocused && !hasAnyFocusedChild && lastFocusedDimensionsRef.current) {
        setFrozenStyle(lastFocusedDimensionsRef.current);
      }
    }, [hasAnyFocusedChild]);

    // Focused columns are flex items that grow/shrink in the horizontal layout.
    const focusedStyle: React.CSSProperties = {
      flex: "0 1 auto",
      minWidth: 0,
      position: "relative",
      display: "flex",
      flexDirection: "column",
    };

    // Unfocused columns exit the flex layout. If previously focused, pin at
    // frozen dimensions so they appear stationary as they leave. If never
    // focused, hide with opacity 0 until first focus.
    const unfocusedStyle: React.CSSProperties = frozenStyle
      ? {
          position: "absolute",
          left: frozenStyle.left,
          top: frozenStyle.top,
          width: frozenStyle.width,
          height: frozenStyle.height,
          display: "flex",
          flexDirection: "column",
        }
      : { position: "absolute", opacity: 0, display: "flex", flexDirection: "column" };

    return (
      <ColumnContext.Provider value={{ columnId: id, registerChild, unregisterChild }}>
        <div
          ref={(node) => {
            (internalRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
            if (typeof forwardedRef === "function") forwardedRef(node);
            else if (forwardedRef) forwardedRef.current = node;
          }}
          data-column={id}
          data-column-focused={hasAnyFocusedChild}
          {...htmlProps}
          className={cn(className)}
          style={{
            ...htmlProps.style,
            ...(hasAnyFocusedChild ? focusedStyle : unfocusedStyle),
          }}
        >
          {children}
        </div>
      </ColumnContext.Provider>
    );
  },
);
