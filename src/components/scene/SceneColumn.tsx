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
import { ColumnPositionContext } from "./ColumnPositionContext";
import { DepthDeckContext } from "./DepthDeckContext";
import { StackDepthContext } from "./StackDepthContext";
import { Scrollbar } from "./Scrollbar";
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
  /**
   * Whether the parent column is in the depth deck (in-between, unfocused).
   * When true, unfocused SceneObjects stay in flow (position: relative) so the
   * column sizes to its content — necessary for perspective-depth width comparison.
   */
  isInDepthDeck: boolean;
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
  const { duration, stiffness, damping } = useSceneConfig();
  const { width: viewportWidth, height: viewportHeight } = useContext(ViewportContext);
  const columnPositions = useContext(ColumnPositionContext);
  const position = columnPositions.get(name) ?? null;
  const stackTargetLeft = useContext(DepthDeckContext);
  const stackDepths = useContext(StackDepthContext);
  const stackDepth = stackDepths.get(name) ?? 0;

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
  // Used to compute vertical centering margin-top and scroll bounds.
  const [contentHeight, setContentHeight] = useState(0);
  const contentWrapperRef = useRef<HTMLDivElement | null>(null);

  // -------------------------------------------------------------------------
  // Vertical scroll state (pure JS — no overflow-y, no proxy divs)
  //
  // scrollOffset drives `top: -scrollOffset` on the content wrapper.
  // maxScroll = contentHeight - viewportHeight (clamped to 0 when content fits).
  // The viewport's wheel handler dispatches a custom 'columnscroll' event on
  // the column element with a deltaY payload, and we update scrollOffset here.
  // -------------------------------------------------------------------------

  const [scrollOffset, setScrollOffset] = useState(0);
  const scrollOffsetRef = useRef(0);

  const maxScroll = Math.max(
    0,
    columnFocused && viewportHeight > 0 ? contentHeight - viewportHeight : 0,
  );
  const maxScrollRef = useRef(maxScroll);
  maxScrollRef.current = maxScroll;

  // Clamp scrollOffset to [0, maxScroll] whenever maxScroll changes (e.g. on
  // content resize or viewport resize).
  useEffect(() => {
    if (scrollOffsetRef.current > maxScroll) {
      const clamped = Math.min(scrollOffsetRef.current, maxScroll);
      scrollOffsetRef.current = clamped;
      setScrollOffset(clamped);
    }
  }, [maxScroll]);

  // Listen for custom 'columnscroll' events dispatched by the Scene viewport's
  // wheel handler. The event carries a `deltaY` detail value; we add it to the
  // current scrollOffset and clamp to [0, maxScroll].
  useEffect(() => {
    const el = colRef.current;
    if (!el) return;

    const handler = (e: Event) => {
      const { deltaY } = (e as CustomEvent<{ deltaY: number }>).detail;
      const newOffset = Math.max(
        0,
        Math.min(maxScrollRef.current, scrollOffsetRef.current + deltaY),
      );
      scrollOffsetRef.current = newOffset;
      setScrollOffset(newOffset);
    };

    el.addEventListener("columnscroll", handler);
    return () => el.removeEventListener("columnscroll", handler);
  }, []); // colRef is stable; maxScrollRef and scrollOffsetRef are mutable refs

  // Ref to the latest viewport height for use in the keyboard handler (avoids
  // stale closure — we want the current value at the time of the keypress).
  const viewportHeightRef = useRef(viewportHeight);
  viewportHeightRef.current = viewportHeight;

  // Keyboard scroll: intercept arrow/page/home/end keys when keyboard focus is
  // inside this column. Standard scroll amounts match browser conventions.
  useEffect(() => {
    const el = colRef.current;
    if (!el) return;

    const handler = (e: KeyboardEvent) => {
      // Only handle when this column has focused content to scroll.
      if (maxScrollRef.current <= 0) return;

      // Don't intercept keys when focus is in an editable element.
      const target = e.target as HTMLElement;
      const tagName = target.tagName;
      if (
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      let delta = 0;
      const pageSize = viewportHeightRef.current;

      switch (e.key) {
        case "ArrowDown":
          delta = 40;
          break;
        case "ArrowUp":
          delta = -40;
          break;
        case "PageDown":
        case " ":
          if (e.key === " " && e.shiftKey) {
            delta = -pageSize;
          } else {
            delta = pageSize;
          }
          break;
        case "PageUp":
          delta = -pageSize;
          break;
        case "Home":
          // Scroll to top: set offset to 0
          scrollOffsetRef.current = 0;
          setScrollOffset(0);
          e.preventDefault();
          return;
        case "End":
          // Scroll to bottom
          scrollOffsetRef.current = maxScrollRef.current;
          setScrollOffset(maxScrollRef.current);
          e.preventDefault();
          return;
        default:
          return; // Not a scroll key — don't intercept
      }

      if (delta !== 0) {
        const newOffset = Math.max(
          0,
          Math.min(maxScrollRef.current, scrollOffsetRef.current + delta),
        );
        scrollOffsetRef.current = newOffset;
        setScrollOffset(newOffset);
        e.preventDefault();
      }
    };

    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, []);

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

  // Whether this column has ever been focused. Only columns that were
  // previously focused need a frozen size — never-focused columns size to
  // their content naturally (position: absolute, no explicit dimensions).
  const wasEverFocused = useRef(columnFocused);

  // True only on the very first render. Used to detect a freshly mounted
  // column so it can animate in from offscreen rather than appearing at rest.
  const isMountingRef = useRef(true);
  useEffect(() => {
    isMountingRef.current = false;
  }, []);

  // Track column focus state: set up a ResizeObserver for ongoing size changes
  // while focused, freeze the last size on focus loss, and clear on re-focus.
  useEffect(() => {
    if (columnFocused) {
      wasEverFocused.current = true;
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
    } else if (wasEverFocused.current) {
      // Column just lost focus — freeze at the last captured dimensions.
      // lastObservedSize is kept current by the useLayoutEffect above, so this
      // should always have a reliable value.
      //
      // Only freeze when transitioning from focused to unfocused. A column that
      // was never focused doesn't need a frozen size — it sizes to its content.
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

  // duration=0 → instant transitions for tests; otherwise use configured spring.
  const transition =
    duration === 0
      ? { duration: 0 }
      : { type: "spring" as const, stiffness, damping };

  // The combined vertical offset applied to the content wrapper:
  // - topOffset: vertical swap offset (bring focused object into view)
  // - scrollOffset: JS scroll state (driven by wheel events)
  // Both are subtracted so positive values slide the content up.
  const combinedTop = -(topOffset + scrollOffset);

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

  // Compute the x offset for outer unfocused columns. Outer-left slides fully
  // offscreen left; outer-right slides fully offscreen right. We use the
  // viewport width (from ViewportContext) to guarantee the column clears the
  // visible area regardless of its current DOM position.
  //
  // In-between columns target the left edge of the rightmost focused column
  // (stackTargetLeft) so they appear to stack behind it in the depth deck.
  //
  // Using `viewportWidth` (rather than exact column bounds) for outer columns
  // is intentional:
  // - Outer-left: `-viewportWidth` always moves the right edge past x=0.
  // - Outer-right: `viewportWidth` always moves the left edge past the right edge.
  // When all columns are unfocused, x stays at 0 (camera stays still).
  const outerX =
    position === "outer-left"
      ? -viewportWidth
      : position === "outer-right"
        ? viewportWidth
        : position === "in-between"
          ? stackTargetLeft
          : 0;

  // Depth deck visual values for in-between columns. Deeper columns appear
  // smaller (via scale), more transparent, and stacked lower (z-index).
  const isInBetween = position === "in-between" && stackDepth > 0;
  // Scale shrinks each deeper column by 10% per depth level, creating the
  // visual impression of receding layers. Scale is used instead of translateZ
  // so getBoundingClientRect() returns the actual displayed (scaled) dimensions,
  // which lets tests and layout logic compare apparent sizes across depths.
  const depthScale = isInBetween ? Math.max(0.1, 1 - stackDepth * 0.1) : 1;
  const depthOpacity = isInBetween ? Math.max(0, 1 - stackDepth * 0.2) : columnFocused ? 1 : 0;
  const depthZIndex = isInBetween ? 100 - stackDepth : undefined;

  // Outer columns use animate-only (no layout FLIP). Focused columns use layout
  // FLIP so they animate smoothly in and out of the flex row.
  const usesLayout = columnFocused;

  // A column that mounts for the first time already focused should enter from
  // the right (depth-forward navigation). motion will animate from this initial
  // position to the flex layout position via the layout FLIP mechanism.
  // When duration=0 (tests), motion skips the initial state immediately.
  const mountInitial =
    isMountingRef.current && columnFocused && viewportWidth > 0
      ? { x: viewportWidth }
      : undefined;

  const isScrollable = columnFocused && maxScroll > 0;

  return (
    <ColumnContext.Provider value={{ register, reportHeight, isInDepthDeck: isInBetween }}>
      <motion.div
        ref={colRef}
        {...(usesLayout ? { layout: true } : {})}
        {...(mountInitial ? { initial: mountInitial } : {})}
        data-column={name}
        data-column-focused={String(columnFocused)}
        data-column-position={position ?? undefined}
        data-stack-depth={isInBetween ? String(stackDepth) : undefined}
        data-max-scroll={isScrollable ? String(maxScroll) : undefined}
        data-scroll-offset={columnFocused ? String(scrollOffset) : undefined}
        data-content-height={columnFocused ? String(contentHeight) : undefined}
        animate={{ opacity: depthOpacity, x: outerX, scale: depthScale }}
        transition={transition}
        style={{
          ...(columnFocused ? focusedStyle : unfocusedStyle),
          ...(depthZIndex !== undefined ? { zIndex: depthZIndex } : {}),
        }}
      >
        {/* Content wrapper: spring-animated top offset for vertical swap.
            margin-top centers focused content vertically when it fits the
            viewport. When content overflows, marginTop is 0 (top-aligned).
            display: flex + flex-direction: column lets gap apply between
            focused objects in multi-focus stacking.
            role="region" + tabindex=0 + aria-label mark this as a navigable
            scrollable landmark for screen reader and keyboard users. */}
        <motion.div
          ref={contentWrapperRef}
          data-column-content
          role="region"
          aria-label={`${name} content${isScrollable ? ", scrollable" : ""}`}
          tabIndex={0}
          animate={{ top: combinedTop }}
          transition={transition}
          style={{
            position: "relative",
            top: combinedTop,
            marginTop,
            display: "flex",
            flexDirection: "column",
            gap: objectGap || undefined,
          }}
        >
          {children}
        </motion.div>

        {/* Custom scrollbar — only rendered when focused content overflows. */}
        {isScrollable && viewportHeight > 0 && (
          <Scrollbar
            scrollOffset={scrollOffset}
            maxScroll={maxScroll}
            trackHeight={viewportHeight}
            onScroll={(newOffset) => {
              scrollOffsetRef.current = newOffset;
              setScrollOffset(newOffset);
            }}
          />
        )}
      </motion.div>
    </ColumnContext.Provider>
  );
}

// Explicit displayName allows Scene to detect SceneColumn children via
// child.type.displayName without importing SceneColumn directly (avoiding
// circular import issues).
SceneColumn.displayName = "SceneColumn";
