import React, { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../utils/cn";
import { ColumnContext, useSceneContext, type SwapState } from "./Scene";

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
    const { entries, duration } = useSceneContext();

    // Track which SceneObject IDs belong to this column.
    const [childIds, setChildIds] = useState<Set<string>>(new Set());

    const [frozenStyle, setFrozenStyle] = useState<FrozenStyle | null>(null);

    // Active vertical swap animation state. null when no swap is running.
    const [swapState, setSwapState] = useState<SwapState | null>(null);

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

    // Derive the set of all currently focused child IDs from the registry.
    const focusedChildIds = Array.from(childIds).filter((childId) => {
      return entries.get(childId)?.focused === true;
    });

    // Determine if any child object is currently focused.
    const hasAnyFocusedChild = focusedChildIds.length > 0;

    // The single focused child ID — only meaningful when exactly one child is focused.
    // Used by swap detection to identify clean 1→1 focus transitions.
    const focusedChildId = focusedChildIds.length === 1 ? focusedChildIds[0] : null;

    const prevFocusedRef = useRef(hasAnyFocusedChild);

    // Track which child was focused in the previous render for swap detection.
    // Only meaningful when there was exactly one focused child.
    const prevFocusedChildRef = useRef<string | null>(focusedChildId);

    // Track the last dimensions while focused so we can freeze accurately.
    // We can't read offsetWidth/offsetHeight after going unfocused because the
    // column's children exit flow (position:absolute) simultaneously, making
    // the column shrink to zero before our effect can read it.
    const lastFocusedDimensionsRef = useRef<FrozenStyle | null>(null);

    // Track in-flight RAF and timer IDs so we can cancel them on rapid focus changes.
    const rafIdRef = useRef<number | null>(null);
    const timerIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // Detect focus swaps within the column and start the animation.
    useLayoutEffect(() => {
      const prevId = prevFocusedChildRef.current;
      prevFocusedChildRef.current = focusedChildId;

      // A swap occurs when both the previous and current focused child are known
      // and they are different objects within this column.
      if (
        prevId !== null &&
        focusedChildId !== null &&
        prevId !== focusedChildId &&
        childIds.has(prevId) &&
        childIds.has(focusedChildId)
      ) {
        // Cancel any in-flight swap to avoid state accumulation.
        if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
        if (timerIdRef.current !== null) clearTimeout(timerIdRef.current);

        // Query the column DOM to determine the visual order of these two objects.
        const columnEl = internalRef.current;
        const columnHeight = lastFocusedDimensionsRef.current?.height ?? 300;

        let incomingIndex = 0;
        let outgoingIndex = 0;
        if (columnEl) {
          const elements = Array.from(
            columnEl.querySelectorAll<HTMLElement>("[data-scene-id]"),
          );
          incomingIndex = elements.findIndex(
            (el) => el.dataset.sceneId === focusedChildId,
          );
          outgoingIndex = elements.findIndex(
            (el) => el.dataset.sceneId === prevId,
          );
        }

        // Ascending: incoming is after outgoing in DOM (slides up from below).
        // Descending: incoming is before outgoing (slides down from above).
        const ascending = incomingIndex > outgoingIndex;

        // Init offsets: incoming placed off-screen, outgoing stays in place.
        // Settle offsets: incoming slides to 0, outgoing exits the other way.
        const children = new Map<string, { init: number; settle: number }>();
        children.set(focusedChildId, {
          init: ascending ? columnHeight : -columnHeight,
          settle: 0,
        });
        children.set(prevId, {
          init: 0,
          settle: ascending ? -columnHeight : columnHeight,
        });

        // When duration is 0, skip the animation phases entirely — let the
        // normal freeze path handle the transition instantly.
        if (duration === 0) {
          // No swap state needed; freeze fires immediately in SceneObject.
        } else {
          // Phase 1 — init: place objects at starting positions with no transition.
          setSwapState({ children, phase: "init" });

          // Phase 2 — settle: enable CSS transition and animate to final positions.
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null;
            setSwapState((prev) =>
              prev ? { children: prev.children, phase: "settle" } : null,
            );

            // Phase 3 — done: clear swap state so the freeze can fire.
            timerIdRef.current = setTimeout(() => {
              timerIdRef.current = null;
              setSwapState(null);
            }, duration ?? 300);
          });
        }
      }
    }, [focusedChildId, childIds, duration]);

    // Clean up pending RAF and timers on unmount.
    useEffect(() => {
      return () => {
        if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
        if (timerIdRef.current !== null) clearTimeout(timerIdRef.current);
      };
    }, []);

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
      <ColumnContext.Provider value={{ columnId: id, registerChild, unregisterChild, swapState }}>
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
