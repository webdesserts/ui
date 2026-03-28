import React, { isValidElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SceneColumn } from "./SceneColumn";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import { SceneConfigContext, useSceneConfig } from "./useSceneConfig";
import { CameraContext } from "./useCamera";
import { ViewportContext, type ViewportDimensions } from "./ViewportContext";
import { ColumnPositionContext, type ColumnPosition } from "./ColumnPositionContext";
import { DepthDeckContext } from "./DepthDeckContext";
import { StackDepthContext } from "./StackDepthContext";
import { ScrollOffsetStoreContext } from "./ScrollOffsetStoreContext";
import { motion, useReducedMotion } from "motion/react";

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

/** Position classification and depth for an unfocused column. */
interface DebugColumnStackEntry {
  name: string;
  /** "outer-left" | "in-between" | "outer-right" */
  classification: string;
  /** Stacking depth index (only meaningful for in-between columns). */
  depth: number;
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

/** Measured bounds of a SceneObject for the debug overlay. */
interface DebugObjectBounds {
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * Absolutely-positioned overlay elements that draw colored outlines around each
 * SceneObject. Rendered inside the viewport so positions are relative to it.
 * `pointer-events: none` ensures these overlays never interfere with interaction.
 */
function SceneObjectOutlines({
  objects,
  viewportRef,
}: {
  objects: DebugObjectEntry[];
  viewportRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [outlines, setOutlines] = useState<DebugObjectBounds[]>([]);

  // Measure each SceneObject's bounding rect relative to the viewport after
  // every render. Runs as useLayoutEffect to reflect current layout.
  // Compares values before calling setState to avoid infinite re-render loops.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const vpRect = viewport.getBoundingClientRect();
    const measured: DebugObjectBounds[] = [];

    for (const obj of objects) {
      const el = viewport.querySelector<HTMLElement>(`[data-scene-id='${obj.name}']`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      measured.push({
        name: obj.name,
        width: rect.width,
        height: rect.height,
        x: rect.left - vpRect.left,
        y: rect.top - vpRect.top,
      });
    }

    setOutlines((prev) => {
      // Avoid re-render if nothing changed — stable identity check via serialized key.
      const key = (arr: DebugObjectBounds[]) =>
        arr.map((o) => `${o.name}:${o.width}:${o.height}:${o.x}:${o.y}`).join(",");
      return key(prev) === key(measured) ? prev : measured;
    });
  });

  return (
    <>
      {outlines.map((obj) => {
        const focused = objects.find((o) => o.name === obj.name)?.focused ?? false;
        const borderColor = focused ? "green" : "gray";
        return (
          <div
            key={obj.name}
            data-debug-object-outline={obj.name}
            style={{
              position: "absolute",
              left: obj.x,
              top: obj.y,
              width: obj.width,
              height: obj.height,
              border: `1px solid ${borderColor}`,
              pointerEvents: "none",
              boxSizing: "border-box",
              zIndex: 9998,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                background: borderColor,
                color: "#fff",
                fontFamily: "monospace",
                fontSize: 10,
                padding: "0 2px",
                lineHeight: "14px",
                pointerEvents: "none",
              }}
            >
              {obj.name}
            </span>
          </div>
        );
      })}
    </>
  );
}

/** Debug overlay rendered inside the Scene when `debug` is enabled. */
function SceneDebugOverlay({
  objects,
  columnStacks,
  viewportRef,
  stageRef,
}: {
  objects: DebugObjectEntry[];
  columnStacks: DebugColumnStackEntry[];
  viewportRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
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

  // Detect offsetParent issues: a column's offsetParent should be the stage div
  // (which has position: relative). If it's anything else — whether an element
  // inside the stage or completely outside it — a positioned ancestor is
  // intercepting layout calculations.
  const stage = stageRef.current;
  const offsetParentWarnings: string[] = [];
  if (stage && viewport) {
    const columns = viewport.querySelectorAll<HTMLElement>("[data-column]");
    columns.forEach((col) => {
      const op = col.offsetParent;
      if (op && op !== stage) {
        const name = col.getAttribute("data-column") ?? "?";
        offsetParentWarnings.push(name);
      }
    });
  }

  // Measure object bounds for the overlay panel display.
  const objectBounds: DebugObjectBounds[] = [];
  if (viewport) {
    const vpRect = viewport.getBoundingClientRect();
    for (const obj of objects) {
      const el = viewport.querySelector<HTMLElement>(`[data-scene-id='${obj.name}']`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      objectBounds.push({
        name: obj.name,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        x: Math.round(rect.left - vpRect.left),
        y: Math.round(rect.top - vpRect.top),
      });
    }
  }

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
      {objects.map((obj) => {
        const bounds = objectBounds.find((b) => b.name === obj.name);
        return (
          <div key={obj.name}>
            <span style={{ color: obj.focused ? "#4ade80" : "#9ca3af" }}>
              {obj.name}
            </span>
            {" — "}
            <span style={{ color: obj.focused ? "#4ade80" : "#9ca3af" }}>
              {obj.focused ? "focused" : "unfocused"}
            </span>
            {bounds && (
              <span style={{ color: "#6b7280" }}>
                {" "}
                {bounds.width}×{bounds.height} @ {bounds.x},{bounds.y}
              </span>
            )}
          </div>
        );
      })}

      {offsetParentWarnings.length > 0 && (
        <>
          <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4, color: "#f87171" }}>
            ⚠ offsetParent warning
          </div>
          {offsetParentWarnings.map((name) => (
            <div key={name} style={{ color: "#f87171" }}>
              {name}: positioned ancestor breaks bounds
            </div>
          ))}
        </>
      )}

      {columnStacks.length > 0 && (
        <>
          <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4 }}>
            Column stacking
          </div>
          {columnStacks.map((col) => (
            <div key={col.name}>
              <span style={{ color: "#c4b5fd" }}>{col.name}</span>
              {": "}
              <span style={{ color: "#94a3b8" }}>{col.classification}</span>
              {col.classification === "in-between" && (
                <span style={{ color: "#94a3b8" }}>{" depth "}{col.depth}</span>
              )}
            </div>
          ))}
        </>
      )}

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
              {col.scrollable ? " (scrollable)" : " (fits)"}
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

      <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4 }}>
        Camera
      </div>
      <div data-debug-camera>
        <span style={{ color: "#93c5fd" }}>viewport</span>
        {": "}
        {Math.round(clientWidth)} × {Math.round(viewport?.clientHeight ?? 0)}
      </div>
    </div>
  );
}

/** Inner scene content — reads debug flag from config to apply outline. */
function SceneViewport({
  children,
  debugObjects,
  debugColumnStacks,
  reducedMotion,
  onTransitionStart,
  onTransitionComplete,
  onViewportSizeChange,
}: {
  children: React.ReactNode;
  debugObjects: DebugObjectEntry[] | null;
  /** Unfocused column stacking info for the debug overlay. */
  debugColumnStacks: DebugColumnStackEntry[] | null;
  /** Whether prefers-reduced-motion is active. */
  reducedMotion: boolean;
  /** Called when a layout animation starts. */
  onTransitionStart: () => void;
  /** Called when all layout animations complete. */
  onTransitionComplete: () => void;
  /** Called whenever the viewport dimensions change. */
  onViewportSizeChange: (size: ViewportDimensions) => void;
}) {
  const { debug, columnGap, padding, duration, stiffness, damping } = useSceneConfig();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportDimensions>({ width: 0, height: 0 });
  // stageLeft: the CSS `left` value of the absolutely-positioned stage div.
  // Adjusted each render to keep the focused region horizontally centered in
  // the viewport. When focused content overflows the viewport, stageLeft is
  // clamped so the focused region left-aligns at x=0 (and overflow-x: auto
  // enables native scrolling for the rest).
  const [stageLeft, setStageLeft] = useState(0);
  // When focused content overflows the viewport width, enable native horizontal
  // scroll on the viewport so the user can scroll to see all focused content.
  const [overflowsX, setOverflowsX] = useState(false);
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

  // Propagate viewport size to parent whenever it changes, so Scene can
  // update the CameraContext bounds for consumers of useCamera().
  useEffect(() => {
    onViewportSizeChange(viewportSize);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportSize.width, viewportSize.height]);

  // Center the focused region within the Camera viewport by computing stageLeft.
  //
  // The stage is absolutely positioned within the viewport. We measure the
  // focused columns' positions relative to the stage itself:
  //   focusedNaturalLeft = first.left - stageRect.left
  //
  // This is the column's offset within the stage's flex layout — it is invariant
  // regardless of where the stage is currently panned (both colRect.left and
  // stageRect.left shift together when stageLeft changes). This means consecutive
  // renders always compute the same target and the loop terminates after one
  // setState.
  //
  // Centering formula:
  //   - If focused region fits the viewport: stageLeft = (vpWidth - focusedWidth) / 2 - focusedNaturalLeft
  //   - If focused region overflows: stageLeft = -focusedNaturalLeft (left-aligned)
  //
  // This runs on every render so it stays in sync with column layout changes.
  // Runs as useLayoutEffect so the stage position is applied before paint,
  // avoiding a visible flash of mis-aligned content.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage) return;

    const focusedCols = Array.from(
      stage.querySelectorAll<HTMLElement>("[data-column-focused='true']"),
    );
    if (focusedCols.length === 0) {
      // No focused columns — keep stage at current position (camera stays still).
      return;
    }

    const stageRect = stage.getBoundingClientRect();
    const first = focusedCols[0]!.getBoundingClientRect();
    const last = focusedCols[focusedCols.length - 1]!.getBoundingClientRect();

    // Column's natural offset within the stage flex layout. Subtracting
    // stageRect.left cancels out the current stageLeft offset, giving a stable
    // value that doesn't change across renders as the stage pans.
    const focusedNaturalLeft = first.left - stageRect.left;
    const focusedNaturalRight = last.right - stageRect.left;
    const focusedWidth = focusedNaturalRight - focusedNaturalLeft;

    const vpWidth = viewport.clientWidth;

    let newStageLeft: number;
    let newOverflowsX: boolean;
    if (focusedWidth <= vpWidth) {
      // Center the focused region in the viewport.
      newStageLeft = (vpWidth - focusedWidth) / 2 - focusedNaturalLeft;
      newOverflowsX = false;
    } else {
      // Focused content overflows — left-align it at the viewport's left edge.
      newStageLeft = -focusedNaturalLeft;
      newOverflowsX = true;
    }

    setStageLeft((prev) => (prev === newStageLeft ? prev : newStageLeft));
    setOverflowsX((prev) => (prev === newOverflowsX ? prev : newOverflowsX));
  });

  // Measure the rightmost focused column's left edge relative to the stage
  // after each render so in-between columns can align to it. Runs on every
  // render so it stays current with focus changes.
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

    // Left edge of the rightmost focused column relative to the stage. This is
    // the in-stage x-offset used to position in-between (depth deck) columns so
    // they peek leftward from behind the rightmost focused column.
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

  const transition =
    duration === 0
      ? { duration: 0 }
      : { type: "spring" as const, stiffness, damping };

  return (
    <ViewportContext.Provider value={viewportSize}>
      <DepthDeckContext.Provider value={stackTargetLeft}>
        {/* Viewport: the clipping window. position:relative establishes the
            containing block for the absolutely-positioned stage.
            overflow-x: auto when focused content overflows, hidden otherwise —
            this enables native horizontal scroll without fighting the stage pan.
            overflow-y: hidden prevents vertical scroll at this level. */}
        <div
          ref={viewportRef}
          data-testid="scene"
          data-reduced-motion={reducedMotion ? "" : undefined}
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            overflowX: overflowsX ? "auto" : "hidden",
            overflowY: "hidden",
            outline: debug ? "2px solid cyan" : undefined,
            // Thin scrollbar with transparent track so it doesn't eat into content space.
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(128,128,128,0.4) transparent",
            // container-type: size lets consumers use cqw/cqh units to size
            // columns relative to the Camera viewport dimensions.
            containerType: "size",
          } as React.CSSProperties}
        >
          {/* Stage: absolutely positioned within the viewport. `left` pans the
              scene so the focused region stays horizontally centered. No CSS
              transforms are used for panning — direct `left` positioning
              preserves text rendering quality (no subpixel transform artifacts).

              perspective + transform-style: preserve-3d create the 3D stacking
              context for in-between unfocused columns (depth deck). position:
              relative (over the absolute base) is handled by `position: absolute`
              itself — it establishes the containing block for absolutely-positioned
              in-between columns.

              Focused columns have zIndex:200; in-between columns have lower z-index
              (100 - depth) so focused content always renders on top. */}
          <motion.div
            ref={stageRef}
            data-stage
            animate={{ left: stageLeft }}
            transition={transition}
            onLayoutAnimationStart={onTransitionStart}
            onLayoutAnimationComplete={onTransitionComplete}
            style={{
              position: "absolute",
              top: 0,
              left: stageLeft,
              height: "100%",
              display: "flex",
              flexDirection: "row",
              alignItems: "stretch",
              gap: columnGap || undefined,
              padding: padding || undefined,
              perspective: "1000px",
              transformStyle: "preserve-3d",
              // Debug: magenta outline on the stage to distinguish it from the
              // cyan viewport outline. Purely cosmetic — no layout effect.
              outline: debug ? "2px solid magenta" : undefined,
            }}
          >
            {children}
          </motion.div>
          {/* Object outlines: absolutely positioned colored borders for each
              SceneObject. Rendered outside the stage so positions are relative
              to the viewport, not the panning stage. */}
          {debug && debugObjects && (
            <SceneObjectOutlines
              objects={debugObjects}
              viewportRef={viewportRef}
            />
          )}
          {/* Overlay is inside the scene div so tests can find it via
              scene.querySelector('[data-debug-overlay]'). position:fixed
              ensures it doesn't participate in flex layout. */}
          {debug && debugObjects && (
            <SceneDebugOverlay
              objects={debugObjects}
              columnStacks={debugColumnStacks ?? []}
              viewportRef={viewportRef}
              stageRef={stageRef}
            />
          )}
        </div>
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

  // Detect prefers-reduced-motion. When active and no explicit duration prop
  // is provided, force duration=0 so all transitions are instant.
  const prefersReducedMotion = useReducedMotion() ?? false;
  const effectiveDuration = prefersReducedMotion && duration === undefined ? 0 : duration;

  // Track whether a layout animation is currently in flight.
  const [transitioning, setTransitioning] = useState(false);

  // Track viewport bounds for useCamera() consumers. Updated via callback from
  // SceneViewport whenever the viewport element is measured.
  const [viewportBounds, setViewportBounds] = useState({ top: 0, left: 0, width: 0, height: 0 });

  // Mutable map of saved scroll offsets per column name. SceneColumn saves its
  // scroll offset when losing focus and restores it when regaining focus.
  // Using useRef ensures the Map identity is stable — no re-renders on updates.
  const scrollOffsetStore = useRef<Map<string, number>>(new Map()).current;

  // Compute position classifications for all columns so SceneColumn can
  // animate unfocused columns offscreen or into a depth deck.
  const columnStates = collectColumnFocusStates(wrappedChildren ?? []);
  const columnPositions = computeColumnPositions(columnStates);
  const stackDepths = computeStackDepths(columnStates);

  // Build debug column stacking info from position and depth maps.
  const debugColumnStacks: DebugColumnStackEntry[] | null = debug
    ? columnStates
        .filter((col) => !col.focused)
        .map((col) => {
          const position = columnPositions.get(col.name);
          const depth = stackDepths.get(col.name) ?? 0;
          const classification =
            position === "outer-left"
              ? "outer-left"
              : position === "outer-right"
                ? "outer-right"
                : position === "in-between"
                  ? "in-between"
                  : "unfocused";
          return { name: col.name, classification, depth };
        })
    : null;

  return (
    <SceneConfigContext.Provider
      value={{ stiffness: 300, damping: 30, padding, columnGap, duration: effectiveDuration, debug }}
    >
      <CameraContext.Provider
        value={{
          bounds: viewportBounds,
          transitioning,
        }}
      >
        <ScrollOffsetStoreContext.Provider value={scrollOffsetStore}>
        <ColumnPositionContext.Provider value={columnPositions}>
          <StackDepthContext.Provider value={stackDepths}>
            <SceneViewport
              debugObjects={debugObjects}
              debugColumnStacks={debugColumnStacks}
              reducedMotion={prefersReducedMotion}
              onTransitionStart={() => setTransitioning(true)}
              onTransitionComplete={() => setTransitioning(false)}
              onViewportSizeChange={(size) =>
                setViewportBounds((prev) =>
                  prev.width === size.width && prev.height === size.height
                    ? prev
                    : { top: 0, left: 0, width: size.width, height: size.height },
                )
              }
            >
              {wrappedChildren}
            </SceneViewport>
          </StackDepthContext.Provider>
        </ColumnPositionContext.Provider>
        </ScrollOffsetStoreContext.Provider>
      </CameraContext.Provider>
    </SceneConfigContext.Provider>
  );
}
