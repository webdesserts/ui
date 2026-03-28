import React, { isValidElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SceneColumn } from "./SceneColumn";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import { SceneConfigContext, useSceneConfig } from "./useSceneConfig";
import { CameraContext } from "./useCamera";
import { ViewportContext, type ViewportDimensions } from "./ViewportContext";
import { ColumnPositionContext, type ColumnPosition } from "./ColumnPositionContext";
import { DepthDeckContext } from "./DepthDeckContext";
import { StackDepthContext } from "./StackDepthContext";
import { motion } from "motion/react";

/**
 * Collects the focused state of each direct SceneColumn child (in order).
 * Returns an array of `{ name, focused }` entries for the columns.
 */
function collectColumnFocusStates(
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

export interface SceneProps {
  children: React.ReactNode;
  /**
   * Animation duration override (in ms). Set to 0 to disable all animations
   * in tests. When omitted, spring physics are used.
   */
  duration?: number;
  /** Enable debug overlays. */
  debug?: boolean;
  /** Gap (in px) between focused columns in the stage flex row. Defaults to 0. */
  columnGap?: number;
  /** Padding (in px) around the stage content. Defaults to 0. */
  padding?: number;
}

/** A snapshot of a SceneObject's state for the debug overlay. */
interface DebugObjectEntry {
  name: string;
  focused: boolean;
}

/**
 * Wraps a bare SceneObject child in an implicit SceneColumn using the
 * SceneObject's name as the column name. SceneColumn children pass through
 * unchanged.
 */
function wrapChild(child: React.ReactNode): React.ReactNode {
  if (!isValidElement(child)) return child;

  // SceneColumn passes through — already has a column wrapper.
  const type = child.type as { displayName?: string } | string;
  if (
    typeof type !== "string" &&
    (type === SceneColumn || type.displayName === "SceneColumn")
  ) {
    return child;
  }

  // Bare SceneObject: wrap in an implicit column using the SceneObject's name.
  if (child.type === SceneObject) {
    const objectProps = child.props as SceneObjectProps;
    return (
      <SceneColumn key={objectProps.name} name={objectProps.name}>
        {child}
      </SceneColumn>
    );
  }

  return child;
}

/**
 * Walks the children tree and collects all SceneObject name + focused pairs.
 * Used by the debug overlay to list all registered objects without needing a
 * separate registration context.
 */
function collectObjectEntries(children: React.ReactNode): DebugObjectEntry[] {
  const entries: DebugObjectEntry[] = [];

  React.Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;

    if (child.type === SceneObject) {
      const props = child.props as SceneObjectProps;
      entries.push({ name: props.name, focused: props.focused });
    } else if ((child.props as { children?: React.ReactNode }).children) {
      // Recurse into SceneColumns and other wrappers
      entries.push(
        ...collectObjectEntries(
          (child.props as { children?: React.ReactNode }).children,
        ),
      );
    }
  });

  return entries;
}

/** Per-column scroll state read from DOM data attributes for the debug overlay. */
interface DebugColumnScroll {
  name: string;
  scrollOffset: number;
  contentHeight: number;
  viewportHeight: number;
  scrollable: boolean;
}

/** Debug overlay rendered inside the Scene when `debug` is enabled. */
function SceneDebugOverlay({
  objects,
  viewportRef,
}: {
  objects: DebugObjectEntry[];
  viewportRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Read current scroll state from column DOM attributes. This is debug-only
  // so reading from the DOM directly is acceptable.
  const columnScrollStates: DebugColumnScroll[] = [];
  const viewport = viewportRef.current;
  if (viewport) {
    const columns = viewport.querySelectorAll("[data-column]");
    columns.forEach((col) => {
      const name = col.getAttribute("data-column") ?? "?";
      const focused = col.getAttribute("data-column-focused") === "true";
      if (!focused) return;
      const scrollOffset = parseFloat(col.getAttribute("data-scroll-offset") ?? "0");
      const contentHeight = parseFloat(col.getAttribute("data-content-height") ?? "0");
      const maxScroll = parseFloat(col.getAttribute("data-max-scroll") ?? "0");
      const viewportHeight = contentHeight - maxScroll; // viewport = content - maxScroll
      columnScrollStates.push({
        name,
        scrollOffset,
        contentHeight,
        viewportHeight,
        scrollable: maxScroll > 0,
      });
    });
  }

  const scrollLeft = viewport?.scrollLeft ?? 0;
  const scrollWidth = viewport?.scrollWidth ?? 0;
  const clientWidth = viewport?.clientWidth ?? 0;

  return (
    <div
      data-debug-overlay
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        zIndex: 9999,
        background: "rgba(0,0,0,0.8)",
        color: "#fff",
        fontFamily: "monospace",
        fontSize: 11,
        padding: "6px 10px",
        borderRadius: 4,
        pointerEvents: "none",
      }}
    >
      <div style={{ fontWeight: "bold", marginBottom: 4 }}>Scene objects</div>
      {objects.map((obj) => (
        <div key={obj.name}>
          <span style={{ color: obj.focused ? "#4ade80" : "#9ca3af" }}>
            {obj.name}
          </span>
          {" — "}
          <span style={{ color: obj.focused ? "#4ade80" : "#9ca3af" }}>
            {obj.focused ? "focused" : "unfocused"}
          </span>
        </div>
      ))}

      {columnScrollStates.length > 0 && (
        <>
          <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4 }}>
            Vertical scroll
          </div>
          {columnScrollStates.map((col) => (
            <div key={col.name} data-debug-scroll-column={col.name}>
              <span style={{ color: col.scrollable ? "#facc15" : "#9ca3af" }}>
                {col.name}
              </span>
              {": "}
              <span>{Math.round(col.scrollOffset)}</span>
              {" / "}
              <span>{Math.round(col.contentHeight - col.viewportHeight)}</span>
              {col.scrollable ? " 📜" : " ✓"}
            </div>
          ))}
        </>
      )}

      <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4 }}>
        Horizontal scroll
      </div>
      <div data-debug-h-scroll>
        {Math.round(scrollLeft)} / {Math.round(scrollWidth - clientWidth)} (vp:{" "}
        {Math.round(clientWidth)})
      </div>
    </div>
  );
}

/** Inner scene content — reads debug flag from config to apply outline. */
function SceneViewport({
  children,
  debugObjects,
  focusKey,
}: {
  children: React.ReactNode;
  debugObjects: DebugObjectEntry[] | null;
  /** Changes whenever the focused column layout changes, triggering a scroll reset. */
  focusKey: string;
}) {
  const { debug, columnGap, padding } = useSceneConfig();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportDimensions>({ width: 0, height: 0 });
  // stackTargetLeft: left edge of the rightmost focused column relative to the
  // stage. Starts at 0 and is updated after each layout measurement.
  const [stackTargetLeft, setStackTargetLeft] = useState(0);

  // Measure viewport dimensions synchronously on first render so columns have
  // valid values immediately (useLayoutEffect fires before paint, before
  // ResizeObserver callbacks). ResizeObserver keeps the values current for
  // dynamic viewport resizes.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setViewportSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setViewportSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Reset horizontal scroll position whenever the focused column layout changes.
  // This ensures the user always sees from the left edge after a navigation change.
  // focusKey is intentionally omitted from the deps array for the initial run
  // (we only want to reset on changes, not on mount).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (viewportRef.current) {
      viewportRef.current.scrollLeft = 0;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // Measure the rightmost focused column's left edge relative to the stage
  // after each render so in-between columns can align to it. Runs on every
  // render (like the viewport size measurement) so it stays current.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const focusedCols = Array.from(
      stage.querySelectorAll<HTMLElement>("[data-column-focused='true']"),
    );
    if (focusedCols.length === 0) return;

    const rightmostFocused = focusedCols[focusedCols.length - 1]!;
    const stageRect = stage.getBoundingClientRect();
    const colRect = rightmostFocused.getBoundingClientRect();

    // left edge of the rightmost focused column, relative to the stage.
    const newTargetLeft = colRect.left - stageRect.left;
    setStackTargetLeft((prev) => (prev === newTargetLeft ? prev : newTargetLeft));
  });

  // Route wheel deltaY to the column under the cursor as a custom 'columnscroll'
  // event. deltaX is left to the native horizontal scroll on the viewport.
  // Registered as non-passive so preventDefault() is allowed.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      if (e.deltaY === 0) return;

      // Find which [data-column] element is under the cursor.
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const column = target?.closest("[data-column]");
      if (!column) return;

      // Only route to focused columns that can scroll.
      if (column.getAttribute("data-column-focused") !== "true") return;
      if (!column.hasAttribute("data-max-scroll")) return;

      // Prevent the viewport from scrolling vertically. When the event also has
      // deltaX (diagonal trackpad gesture), only prevent default if there's no
      // horizontal scroll needed — otherwise the browser needs the event to
      // execute its native horizontal scroll via overflow-x: auto. Since the
      // viewport has overflow-y: hidden, not preventing default is safe for
      // the vertical axis in that case.
      if (e.deltaX === 0) {
        e.preventDefault();
      }

      column.dispatchEvent(
        new CustomEvent("columnscroll", {
          detail: { deltaY: e.deltaY },
          bubbles: false,
        }),
      );
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  return (
    <ViewportContext.Provider value={viewportSize}>
      <DepthDeckContext.Provider value={stackTargetLeft}>
        {/* layoutScroll tells motion to account for scroll offset when measuring
            FLIP positions inside this overflow-x: auto container.
            overflow-x: auto enables horizontal scrolling when focused columns
            exceed the viewport width. overflow-y: hidden prevents vertical
            scroll at this level — each column handles vertical scroll independently
            (Phase 5). */}
        <motion.div
          ref={viewportRef}
          layoutScroll
          data-testid="scene"
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "stretch",
            width: "100%",
            height: "100%",
            overflowX: "auto",
            overflowY: "hidden",
            outline: debug ? "2px solid cyan" : undefined,
            // Thin scrollbar with transparent track so it doesn't eat into content space.
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(128,128,128,0.4) transparent",
          } as React.CSSProperties}
        >
          {/* Stage: the flex row of focused columns. width: fit-content allows the
              stage to shrink to content width. margin-inline: auto centers the
              stage within the viewport when it's narrower. When it overflows (or
              all columns are flexible and fill the stage), margins collapse to 0
              and content left-aligns naturally.

              Flexible (flex: 1 1 0) columns grow to fill the stage width, which
              is their own intrinsic content size — they share that width equally.
              Columns with explicit minimum widths (e.g. minWidth: 300px) determine
              the stage's width directly.

              perspective + transform-style: preserve-3d create the 3D stacking
              context for in-between unfocused columns (depth deck). Perspective
              origin is set dynamically near the right focused column so pushed-back
              columns appear to recede toward it. position: relative establishes
              the containing block for absolutely-positioned in-between columns. */}
          <div
            ref={stageRef}
            data-stage
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "row",
              alignItems: "stretch",
              width: "fit-content",
              marginInline: "auto",
              gap: columnGap || undefined,
              padding: padding || undefined,
              perspective: "1000px",
              transformStyle: "preserve-3d",
            }}
          >
            {children}
          </div>
          {/* Overlay is inside the scene div so tests can find it via
              scene.querySelector('[data-debug-overlay]'). position:fixed
              ensures it doesn't participate in flex layout. */}
          {debug && debugObjects && (
            <SceneDebugOverlay objects={debugObjects} viewportRef={viewportRef} />
          )}
        </motion.div>
      </DepthDeckContext.Provider>
    </ViewportContext.Provider>
  );
}

/**
 * The top-level spatial navigation container. Renders a horizontal flex row of
 * SceneColumns. Bare SceneObjects placed directly inside Scene are automatically
 * wrapped in implicit SceneColumns using the object's name.
 *
 * @example
 * <Scene>
 *   <SceneColumn name="nav">
 *     <SceneObject name="nav-panel" focused={view === "nav"}>
 *       <NavPanel />
 *     </SceneObject>
 *   </SceneColumn>
 *   <SceneColumn name="content">
 *     <SceneObject name="article" focused={view !== "nav"}>
 *       <Article />
 *     </SceneObject>
 *   </SceneColumn>
 * </Scene>
 */
export function Scene({
  children,
  duration,
  debug = false,
  columnGap = 0,
  padding = 0,
}: SceneProps) {
  const wrappedChildren = React.Children.map(children, wrapChild);
  const debugObjects = debug ? collectObjectEntries(children) : null;

  // Compute a key that changes whenever the set of focused objects changes.
  // SceneViewport uses this to reset horizontal scroll on navigation changes.
  const allObjects = collectObjectEntries(children);
  const focusKey = allObjects
    .filter((o) => o.focused)
    .map((o) => o.name)
    .join(",");

  // Compute position classifications for all columns so SceneColumn can
  // animate unfocused columns offscreen or into a depth deck.
  const columnStates = collectColumnFocusStates(wrappedChildren ?? []);
  const columnPositions = computeColumnPositions(columnStates);
  const stackDepths = computeStackDepths(columnStates);

  return (
    <SceneConfigContext.Provider
      value={{ stiffness: 300, damping: 30, padding, columnGap, duration, debug }}
    >
      <CameraContext.Provider
        value={{
          bounds: { top: 0, left: 0, width: 0, height: 0 },
          transitioning: false,
        }}
      >
        <ColumnPositionContext.Provider value={columnPositions}>
          <StackDepthContext.Provider value={stackDepths}>
            <SceneViewport debugObjects={debugObjects} focusKey={focusKey}>
              {wrappedChildren}
            </SceneViewport>
          </StackDepthContext.Provider>
        </ColumnPositionContext.Provider>
      </CameraContext.Provider>
    </SceneConfigContext.Provider>
  );
}
