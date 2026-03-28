import React, {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { motion } from "motion/react";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import { useSceneConfig } from "./useSceneConfig";
import { ViewportContext } from "./ViewportContext";
import type { FrozenSize } from "./types";

// ---------------------------------------------------------------------------
// ColumnContext — lets SceneObjects register their elements and report their
// natural heights to the parent column.
// ---------------------------------------------------------------------------

interface ColumnRegistration {
  /** Register a SceneObject's outer element. Returns an unregister function. */
  register: (name: string, el: HTMLElement) => () => void;
  /**
   * Report the in-flow height of this object. Called by focused SceneObjects
   * after each render so the column has reliable height data for offset
   * computation — getBoundingClientRect on an absolute-positioned element
   * reports its intrinsic size, but we need to distinguish "was in flow"
   * heights from potentially-zero absolute heights.
   */
  reportHeight: (name: string, height: number) => void;
}

export const ColumnContext = createContext<ColumnRegistration | null>(null);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Derives all direct SceneObject children's focus state in DOM order.
 * Returns an array of `{ name, focused }` entries.
 */
function deriveObjectStates(
  children: React.ReactNode,
): Array<{ name: string; focused: boolean }> {
  const result: Array<{ name: string; focused: boolean }> = [];
  React.Children.forEach(children, (child) => {
    if (
      isValidElement<SceneObjectProps>(child) &&
      child.type === SceneObject
    ) {
      result.push({ name: child.props.name, focused: child.props.focused });
    }
  });
  return result;
}

/**
 * Computes the natural vertical offset (in px) that the content wrapper must
 * slide to bring the (single) focused object into view at the top of the
 * column. Returns 0 when multiple objects are focused (stacking — show from
 * top) or when no objects are focused.
 *
 * Uses saved natural heights (reported by focused SceneObjects) rather than
 * live getBoundingClientRect() to avoid misreading heights of
 * absolute-positioned elements.
 */
function computeTopOffset(
  objectStates: Array<{ name: string; focused: boolean }>,
  naturalHeights: Map<string, number>,
): number {
  const focusedNames = objectStates
    .filter((o) => o.focused)
    .map((o) => o.name);

  // Multi-focus stacking: show from top, no offset
  if (focusedNames.length !== 1) return 0;

  const focusedName = focusedNames[0]!;

  // Sum the natural heights of all objects that appear before the focused one
  // in DOM order. Objects that were never focused have no saved height and
  // contribute 0 (their natural position in the stack).
  let offset = 0;
  for (const { name } of objectStates) {
    if (name === focusedName) break;
    offset += naturalHeights.get(name) ?? 0;
  }
  return offset;
}

// ---------------------------------------------------------------------------
// SceneColumn
// ---------------------------------------------------------------------------

export interface SceneColumnProps {
  /** Stable name for this column. Shown in debug mode and used for implicit wrapping. */
  name: string;
  children: React.ReactNode;
  /** Gap (in px) between focused objects in this column's flex stack. Defaults to 0. */
  objectGap?: number;
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
 * Within a column, vertical swap is implemented by spring-animating the `top`
 * property on an inner content wrapper. When focus changes from object A to
 * object B, the column slides its content to bring B into view. Multiple
 * simultaneously focused objects stack vertically (no slide offset).
 *
 * @example
 * <SceneColumn name="nav">
 *   <SceneObject name="nav-panel" focused={view === "nav"}>
 *     <NavPanel />
 *   </SceneObject>
 * </SceneColumn>
 */
export function SceneColumn({ name, children, objectGap = 0 }: SceneColumnProps) {
  const columnFocused = deriveColumnFocused(children);
  const objectStates = deriveObjectStates(children);
  const { duration } = useSceneConfig();
  const { height: viewportHeight } = useContext(ViewportContext);

  // Registered SceneObject elements — populated via ColumnContext.
  const registeredEls = useRef<Map<string, HTMLElement>>(new Map());
  // Natural in-flow heights of each object, updated by focused SceneObjects via
  // useLayoutEffect. Heights from the previous render are available during the
  // current render — valid for computing swap offsets since object content
  // doesn't change during a focus-only re-render.
  const naturalHeights = useRef<Map<string, number>>(new Map());

  // The last measured size while the column was focused. Set to null while
  // focused (no freeze applied) and to a FrozenSize after losing focus.
  const [frozenSize, setFrozenSize] = useState<FrozenSize | null>(null);

  // Tracks the latest size observed via ResizeObserver while focused.
  const lastObservedSize = useRef<FrozenSize>({ width: 0, height: 0 });
  const colRef = useRef<HTMLDivElement | null>(null);

  // Focused content height tracked via ResizeObserver on the content wrapper.
  // Used to compute vertical centering margin-top.
  const [contentHeight, setContentHeight] = useState(0);
  const contentWrapperRef = useRef<HTMLDivElement | null>(null);

  // Compute the top offset during render using heights captured in the previous
  // render's useLayoutEffect. This is accurate for focus swaps (object content
  // doesn't change when only focus changes) and avoids a two-render cycle.
  const topOffset = computeTopOffset(objectStates, naturalHeights.current);

  // While the column is focused, snapshot its current dimensions synchronously
  // after each render (useLayoutEffect fires before the browser paints). This
  // ensures `lastObservedSize` is always fresh and doesn't depend on the async
  // ResizeObserver firing before focus is lost.
  useLayoutEffect(() => {
    if (columnFocused && colRef.current) {
      const { width, height } = colRef.current.getBoundingClientRect();
      if (width > 0 || height > 0) {
        lastObservedSize.current = { width, height };
      }
    }
  });

  // Track column focus state: set up a ResizeObserver for ongoing size changes
  // while focused, freeze the last size on focus loss, and clear on re-focus.
  useEffect(() => {
    if (columnFocused) {
      // Re-focusing — clear the frozen size so the column returns to flex flow.
      setFrozenSize(null);

      const el = colRef.current;
      if (!el) return;

      // ResizeObserver keeps lastObservedSize current during dynamic resizes.
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
      // Column just lost focus — freeze at the last captured dimensions.
      // lastObservedSize is kept current by the useLayoutEffect above, so this
      // should always have a reliable value.
      setFrozenSize({ ...lastObservedSize.current });
    }
  }, [columnFocused]);

  // Measure the content wrapper height synchronously after each render so that
  // the initial value is available immediately (useLayoutEffect fires before
  // the browser paints, before ResizeObserver callbacks). ResizeObserver keeps
  // it current for dynamic content changes.
  useLayoutEffect(() => {
    if (!columnFocused || !contentWrapperRef.current) return;
    const { height } = contentWrapperRef.current.getBoundingClientRect();
    setContentHeight(height);
  });

  // Track focused content height for ongoing dynamic resizes.
  // Only active when the column is focused — unfocused columns don't need centering.
  useEffect(() => {
    const el = contentWrapperRef.current;
    if (!el || !columnFocused) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContentHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [columnFocused]);

  // Vertical centering: center the focused content within the viewport when it
  // fits. When content overflows (contentHeight > viewportHeight), margin is 0
  // and content aligns to the top.
  const marginTop =
    viewportHeight > 0 && contentHeight > 0 && columnFocused
      ? Math.max(0, (viewportHeight - contentHeight) / 2)
      : 0;

  // Registration and height-reporting callbacks provided to child SceneObjects.
  const register = useCallback((objName: string, el: HTMLElement) => {
    registeredEls.current.set(objName, el);
    return () => {
      registeredEls.current.delete(objName);
      naturalHeights.current.delete(objName);
    };
  }, []);

  const reportHeight = useCallback((objName: string, height: number) => {
    naturalHeights.current.set(objName, height);
  }, []);

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
    // Clip sliding content during vertical swap so unfocused objects don't
    // peek above or below the column's visible area.
    overflow: "hidden",
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
    <ColumnContext.Provider value={{ register, reportHeight }}>
      <motion.div
        ref={colRef}
        layout
        data-column={name}
        data-column-focused={String(columnFocused)}
        animate={{ opacity: columnFocused ? 1 : 0 }}
        transition={transition}
        style={columnFocused ? focusedStyle : unfocusedStyle}
      >
        {/* Content wrapper: spring-animated top offset for vertical swap.
            margin-top centers focused content vertically when it fits the
            viewport. When content overflows, marginTop is 0 (top-aligned).
            display: flex + flex-direction: column lets gap apply between
            focused objects in multi-focus stacking. */}
        <motion.div
          ref={contentWrapperRef}
          data-column-content
          animate={{ top: -topOffset }}
          transition={transition}
          style={{
            position: "relative",
            top: -topOffset,
            marginTop,
            display: "flex",
            flexDirection: "column",
            gap: objectGap || undefined,
          }}
        >
          {children}
        </motion.div>
      </motion.div>
    </ColumnContext.Provider>
  );
}

// Explicit displayName allows Scene to detect SceneColumn children via
// child.type.displayName without importing SceneColumn directly (avoiding
// circular import issues).
SceneColumn.displayName = "SceneColumn";
