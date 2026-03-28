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
import { ScrollOffsetStoreContext } from "./ScrollOffsetStoreContext";
import { Scrollbar } from "./Scrollbar";
import type { FrozenSize } from "./types";

// ---------------------------------------------------------------------------
// ColumnContext — lets SceneObjects register their elements and report their
// natural heights to the parent column.
// ---------------------------------------------------------------------------

/**
 * Depth info for an unfocused SceneObject that is sandwiched between two
 * focused siblings within the same column. These objects receive depth-deck
 * visual treatment (opacity, greyscale, scale) and are positioned to peek
 * above the lower focused sibling rather than being hidden.
 */
export interface WithinColumnDepthInfo {
  /** Depth index: 1 = adjacent to the lower focused sibling, increasing outward. */
  depth: number;
  /**
   * Content-wrapper-relative top position (px) of the lower focused sibling.
   * The SceneObject uses this to position itself peeking above that sibling.
   */
  anchorTop: number;
}

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
  /**
   * Depth info for unfocused SceneObjects sandwiched between two focused
   * siblings. Objects not in this map receive normal (hidden) treatment.
   */
  withinColumnDepths: Map<string, WithinColumnDepthInfo>;
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

/**
 * Identifies unfocused SceneObjects that are sandwiched between two focused
 * siblings in DOM order and computes depth info for each. These objects will
 * peek out above the lower focused sibling rather than being hidden.
 *
 * Depth index counts from the lower focused sibling outward: the unfocused
 * object immediately above the lower focused object is depth-1, the next one
 * is depth-2, and so on.
 *
 * Returns a Map from object name → `{ depth, anchorTop }` for every between-
 * unfocused object. Objects that are not sandwiched are absent from the map.
 */
function computeWithinColumnDepths(
  objectStates: Array<{ name: string; focused: boolean }>,
  naturalHeights: Map<string, number>,
): Map<string, WithinColumnDepthInfo> {
  const result = new Map<string, WithinColumnDepthInfo>();
  const n = objectStates.length;

  // For each unfocused object, check whether there is a focused object both
  // before it and after it in DOM order.
  for (let i = 0; i < n; i++) {
    if (objectStates[i]!.focused) continue;

    const hasFocusedBefore = objectStates.slice(0, i).some((o) => o.focused);
    const focusedAfterIndex = objectStates.slice(i + 1).findIndex((o) => o.focused);
    if (!hasFocusedBefore || focusedAfterIndex === -1) continue;

    // This object is between two focused objects. Find the lower focused sibling
    // (the first focused object after this one in DOM order).
    const lowerFocusedIndex = i + 1 + focusedAfterIndex;

    // Depth: how many unfocused between-objects are between this one and the
    // lower focused sibling? Objects closer to the lower focused sibling have
    // lower depth indices.
    let depth = 1;
    for (let j = i + 1; j < lowerFocusedIndex; j++) {
      if (!objectStates[j]!.focused) depth++;
    }
    // The object immediately above lowerFocused is depth-1, so re-count from
    // the other direction: depth = number of between-unfocused objects from
    // this object to the lower focused sibling (exclusive), + 1.
    depth = lowerFocusedIndex - i;

    // anchorTop = cumulative height of all objects before the lower focused sibling.
    let anchorTop = 0;
    for (let j = 0; j < lowerFocusedIndex; j++) {
      anchorTop += naturalHeights.get(objectStates[j]!.name) ?? 0;
    }

    result.set(objectStates[i]!.name, { depth, anchorTop });
  }

  return result;
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
  const { duration, stiffness, damping, padding } = useSceneConfig();
  const { width: viewportWidth, height: viewportHeight } = useContext(ViewportContext);
  const columnPositions = useContext(ColumnPositionContext);
  const scrollOffsetStore = useContext(ScrollOffsetStoreContext);
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
  // Content height at the time the column lost focus, used for vertical
  // centering of unfocused columns (so they maintain consistent positioning).
  const [frozenContentHeight, setFrozenContentHeight] = useState(0);

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

  // Effective viewport height accounts for Scene padding applied to the stage.
  // Padding reduces the usable height, so the scroll range grows accordingly.
  const effectiveViewportHeight = viewportHeight - padding * 2;
  const maxScroll = Math.max(
    0,
    columnFocused && effectiveViewportHeight > 0
      ? contentHeight - effectiveViewportHeight
      : 0,
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

  // Compute depth info for unfocused objects sandwiched between focused siblings.
  // Used to give them peekable depth-card treatment instead of hiding them.
  const withinColumnDepths = computeWithinColumnDepths(objectStates, naturalHeights.current);

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

  // Tracks the content height at the time the column last lost focus. Used to
  // detect drastic resizes between unfocus and refocus — if the content has
  // changed by more than 50%, the saved scroll position is discarded.
  const savedContentHeight = useRef<number>(0);

  // Save scroll offset and content height when the column transitions to unfocused.
  // Using useLayoutEffect ensures this runs before the useEffect clamping logic —
  // clamping (tied to maxScroll) would zero the ref before we could save it.
  useLayoutEffect(() => {
    if (!columnFocused && wasEverFocused.current) {
      scrollOffsetStore.set(name, scrollOffsetRef.current);
      savedContentHeight.current =
        contentWrapperRef.current?.getBoundingClientRect().height ?? 0;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFocused]);

  // Track column focus state: set up a ResizeObserver for ongoing size changes
  // while focused, freeze the last size on focus loss, and clear on re-focus.
  useEffect(() => {
    if (columnFocused) {
      wasEverFocused.current = true;
      // Re-focusing — clear the frozen size so the column returns to flex flow.
      setFrozenSize(null);

      // Restore the previously saved scroll position for this column, unless
      // the content has drastically resized since last focused (>50% change).
      // A drastic resize makes the saved position meaningless — fall back to top.
      const savedOffset = scrollOffsetStore.get(name);
      if (savedOffset !== undefined && savedOffset > 0) {
        const currentHeight = contentWrapperRef.current?.getBoundingClientRect().height ?? 0;
        const prevHeight = savedContentHeight.current;
        const isDrasticResize =
          prevHeight > 0 &&
          currentHeight > 0 &&
          Math.abs(currentHeight - prevHeight) / prevHeight > 0.5;

        if (!isDrasticResize) {
          scrollOffsetRef.current = savedOffset;
          setScrollOffset(savedOffset);
        } else {
          // Content changed too much — start from top.
          scrollOffsetRef.current = 0;
          setScrollOffset(0);
        }
      }

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
      // Freeze at the last captured dimensions so the column doesn't collapse.
      setFrozenSize({ ...lastObservedSize.current });
      // Save content height for vertical centering of unfocused columns.
      setFrozenContentHeight(contentHeight);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Vertical centering for all columns. Focused columns use their live
  // contentHeight. Previously-focused columns use frozenContentHeight.
  // Never-focused columns measure their content wrapper directly.
  let effectiveContentHeight = columnFocused ? contentHeight : frozenContentHeight;
  if (effectiveContentHeight === 0 && contentWrapperRef.current) {
    effectiveContentHeight = contentWrapperRef.current.getBoundingClientRect().height;
  }
  const marginTop =
    viewportHeight > 0 && effectiveContentHeight > 0
      ? Math.max(0, (viewportHeight - effectiveContentHeight) / 2)
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
  // flex: 0 1 auto → columns size to their content by default. Consumers can
  // override via className (e.g. adding flex:1 for equal-share or a fixed width).
  const focusedStyle: React.CSSProperties = {
    position: "relative",
    flex: "0 1 auto",
    opacity: 1,
  };

  // Unfocused in-between columns exit flex flow and stack as a depth deck,
  // positioned behind the rightmost focused column. top:0 anchors them to the
  // stage top so they align with the focused row; x-translation (via animate)
  // slides them to the left edge of the rightmost focused column.
  const inBetweenStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    flex: "none",
    ...(frozenSize ? { width: frozenSize.width, height: frozenSize.height } : {}),
  };

  // Outer unfocused columns stay in the flex row with their frozen size so the
  // Camera can pan past them. No opacity:0 — the viewport clips visibility.
  const outerStyle: React.CSSProperties = {
    position: "relative",
    flex: "0 0 auto",
    ...(frozenSize ? { width: frozenSize.width, height: frozenSize.height } : {}),
  };

  // Select which style applies. Focused columns use focusedStyle; in-between
  // unfocused columns use inBetweenStyle; all other unfocused use outerStyle.
  const columnStyle = columnFocused
    ? focusedStyle
    : position === "in-between"
      ? inBetweenStyle
      : outerStyle;

  // Depth deck visual values for in-between columns. Deeper columns appear
  // smaller (via perspective + translateZ), more transparent, more greyscale,
  // and stacked lower (z-index).
  const isInBetween = position === "in-between" && stackDepth > 0;

  // In-between columns animate toward the rightmost focused column's left edge
  // minus a peek offset per depth, so deeper columns peek further left.
  // Outer columns stay at x:0 — they're in the natural flex row position.
  const peekOffsetPx = isInBetween ? stackDepth * 20 : 0;
  const animateX = position === "in-between" ? stackTargetLeft - peekOffsetPx : 0;
  // Scale creates the visual depth effect: deeper columns appear smaller.
  // Using scale instead of translateZ because preserve-3d breaks z-index
  // ordering (depth deck renders on top of focused columns).
  const depthScale = isInBetween ? Math.max(0.5, 1 - stackDepth * 0.08) : 1;
  // Only in-between columns get depth-scaled opacity. Outer columns are fully
  // opaque — the viewport clips their visibility, not opacity:0.
  const depthOpacity = isInBetween ? Math.max(0, 1 - stackDepth * 0.2) : 1;
  // Greyscale increases with depth: depth-1 → 25%, depth-2 → 50%, etc.
  // Reinforces the sense of receding into the background.
  const depthGreyscale = isInBetween ? stackDepth * 0.25 : 0;
  // Focused columns render on top of the depth deck — their z-index must
  // exceed the highest possible in-between depth index (100 - 1 = 99).
  const depthZIndex = columnFocused ? 200 : isInBetween ? 100 - stackDepth : undefined;

  // In-between columns are position:absolute from the stage top. To visually
  // align them with the focused content (which is centered via marginTop),
  // we translate them down to the vertical center of the viewport.
  // colHeight is the column's frozen or natural height — used for centering.
  const colHeight = frozenSize?.height ?? (colRef.current?.getBoundingClientRect().height ?? 0);
  const inBetweenY =
    isInBetween && viewportHeight > 0 && colHeight > 0
      ? (viewportHeight - colHeight) / 2
      : 0;

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
    // isInDepthDeck is true for ALL unfocused columns, not just in-between ones.
    // Outer unfocused columns also need their SceneObjects in flow so the column
    // has natural dimensions (otherwise position: absolute children yield a
    // zero-width column that overlaps with adjacent focused columns).
    <ColumnContext.Provider value={{ register, reportHeight, isInDepthDeck: !columnFocused, withinColumnDepths }}>
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
        animate={{
          opacity: depthOpacity,
          x: animateX,
          y: inBetweenY,
          scale: depthScale,
        }}
        transition={transition}
        style={{
          ...columnStyle,
          ...(depthZIndex !== undefined ? { zIndex: depthZIndex } : {}),
          opacity: depthOpacity,
          scale: depthScale,
          filter: depthGreyscale > 0 ? `grayscale(${depthGreyscale})` : undefined,
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
