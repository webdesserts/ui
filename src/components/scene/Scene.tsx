import React, { createContext, isValidElement, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SceneColumn } from "./SceneColumn";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import { SceneConfigContext, useSceneConfig, DEFAULT_STIFFNESS, DEFAULT_DAMPING, DEFAULT_COLUMN_GAP, DEFAULT_PERSPECTIVE, DEFAULT_PEEK_OFFSET } from "./useSceneConfig";
import { CameraContext, type CameraRect } from "./useCamera";
import { ViewportContext, type ViewportDimensions } from "./ViewportContext";
import { ColumnPositionContext, type ColumnPosition } from "./ColumnPositionContext";
import { ColumnRegistryContext, type RegisteredColumn, type RegisterColumn } from "./ColumnRegistryContext";
import { DepthDeckContext } from "./DepthDeckContext";
import { StackDepthContext } from "./StackDepthContext";
import { ScrollOffsetStoreContext, type ScrollOffsetEntry } from "./ScrollOffsetStoreContext";
import { ScrollCommandRegistryContext } from "./ScrollCommandRegistryContext";
import { AnimationCallbackContext, type AnimationCallbacks } from "./AnimationCallbackContext";
import { SceneFirstPaintContext } from "./SceneFirstPaintContext";
import { useMotionSeam } from "./motionSeam";
import { normalizeWheelDelta, decideWheelTargetColumn, type ScrollCommand } from "./inputController";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";

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
 * Derives column focus-state entries from the column registry, sorted by
 * true DOM order via compareDocumentPosition — NOT registration/insertion
 * order, which can differ from DOM order (e.g. a column mounting later than
 * one it's rendered before). This is the registry-derived counterpart to
 * collectColumnFocusStates (the prop-walk seed): unlike the seed, it doesn't
 * depend on the shape of Scene's `children` prop, so it stays correct
 * through Fragment wrapping, custom components that return a SceneColumn,
 * etc. — see the S6 registration architecture (seed-then-correct) below.
 */
function deriveColumnStatesFromRegistry(
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
  /** Gap (in px) between focused columns in the stage flex row. Defaults to 8. */
  columnGap?: number;
  /** Padding (in px) around the stage content. Defaults to 0. */
  padding?: number;
  /** Slow-motion springs for animation snapshot testing. Same spring physics, much lazier parameters. */
  slowMo?: boolean;
  /** Spring stiffness for position/size animations. Defaults to DEFAULT_STIFFNESS (230). */
  stiffness?: number;
  /** Spring damping for position/size animations. Defaults to DEFAULT_DAMPING (45). */
  damping?: number;
  /** CSS perspective distance (in px) for depth deck 3D effect. Defaults to DEFAULT_PERSPECTIVE (800). */
  perspective?: number;
  /**
   * Per-depth-level peek offset (in px) for depth-deck cards — how far a
   * deck card peeks out in the direction it travels when pulled from the
   * deck (column decks peek left, within-column decks peek up), fanned by
   * depth. Defaults to DEFAULT_PEEK_OFFSET (12).
   */
  peekOffset?: number;
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
 * Reads the debug overlay's object list straight from the DOM — every
 * `[data-scene-id]` element under the viewport, with its `data-focused`
 * attribute — rather than walking Scene's `children` prop tree. DOM truth is
 * immune by construction to Fragment wrapping, custom components that return
 * a SceneObject/SceneColumn, or any other composition that a shallow prop
 * walk can be fooled by (the same rationale as the S6 column registry
 * below), and it's what actually rendered — the only thing worth debugging.
 */
function queryDebugObjects(viewport: HTMLElement): DebugObjectEntry[] {
  return Array.from(viewport.querySelectorAll<HTMLElement>("[data-scene-id]")).map((el) => ({
    name: el.getAttribute("data-scene-id") ?? "",
    focused: el.getAttribute("data-focused") === "true",
  }));
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
 *
 * Outline positions are updated in two ways:
 * 1. `useLayoutEffect` fires on every React render for initial/settled layout.
 * 2. A `requestAnimationFrame` loop runs while `animatingRef.current > 0`,
 *    measuring positions every frame and mutating outline div styles directly
 *    (no setState) so Motion animations are tracked without triggering re-renders.
 */
function SceneObjectOutlines({
  viewportRef,
  animatingRef,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  /** Counter incremented on animation start, decremented on end. rAF loop
   *  runs while this is > 0. Owned by SceneViewport. */
  animatingRef: React.RefObject<number>;
}) {
  // Outline div refs, keyed by object name. Direct DOM mutation during rAF.
  const outlineRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Track which objects (name + focused) we've rendered outlines for — DOM
  // truth via queryDebugObjects, re-derived every render by the layout
  // effect below. Used to detect when the object list (or its focus state)
  // changes and we need to re-render the outline divs.
  const [renderedObjects, setRenderedObjects] = useState<DebugObjectEntry[]>([]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const objects = queryDebugObjects(viewport);
    setRenderedObjects((prev) => {
      const same =
        prev.length === objects.length &&
        prev.every((p, i) => p.name === objects[i]?.name && p.focused === objects[i]?.focused);
      return same ? prev : objects;
    });
  });

  // Shared measurement helper: measure each object and mutate its outline
  // div. Re-queries the DOM directly (rather than reading renderedObjects
  // state) so it's always accurate for THIS pass, matching the old
  // always-fresh `objects` prop — renderedObjects itself lags by one commit
  // when it changes (the state-update-in-layout-effect pattern above).
  const measureAndUpdate = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const vpRect = viewport.getBoundingClientRect();

    for (const obj of queryDebugObjects(viewport)) {
      const el = viewport.querySelector<HTMLElement>(`[data-scene-id='${obj.name}']`);
      const outlineDiv = outlineRefs.current.get(obj.name);
      if (!el || !outlineDiv) continue;

      const rect = el.getBoundingClientRect();
      outlineDiv.style.left = `${rect.left - vpRect.left}px`;
      outlineDiv.style.top = `${rect.top - vpRect.top}px`;
      outlineDiv.style.width = `${rect.width}px`;
      outlineDiv.style.height = `${rect.height}px`;
    }
  }, [viewportRef]);

  // Measure on every React render (catches layout changes, focus state changes).
  useLayoutEffect(() => {
    measureAndUpdate();
  });

  // rAF loop: run while animations are in flight to track motion between renders.
  const rafIdRef = useRef<number | null>(null);

  const startRaf = useCallback(() => {
    if (rafIdRef.current !== null) return; // already running
    const loop = () => {
      measureAndUpdate();
      if (animatingRef.current > 0) {
        rafIdRef.current = requestAnimationFrame(loop);
      } else {
        // One final measurement after animations settle.
        measureAndUpdate();
        rafIdRef.current = null;
      }
    };
    rafIdRef.current = requestAnimationFrame(loop);
  }, [measureAndUpdate, animatingRef]);

  // Expose startRaf so SceneViewport can trigger it when animations start.
  // Store it on a stable ref so SceneViewport can call it without re-renders.
  const startRafRef = useRef(startRaf);
  useLayoutEffect(() => {
    startRafRef.current = startRaf;
  }, [startRaf]);

  // Clean up the rAF loop when the component unmounts.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  // Expose startRafRef to the parent via a side-channel ref. SceneViewport
  // passes an outlineStartRafRef that we populate here.
  const startRafCallbackRef = useContext(OutlineRafCallbackContext);
  useLayoutEffect(() => {
    if (startRafCallbackRef) {
      startRafCallbackRef.current = () => startRafRef.current();
    }
    return () => {
      if (startRafCallbackRef) {
        startRafCallbackRef.current = null;
      }
    };
  }, [startRafCallbackRef]);

  return (
    <>
      {renderedObjects.map(({ name, focused }) => {
        const borderColor = focused ? "green" : "gray";
        return (
          <div
            key={name}
            ref={(el) => {
              if (el) {
                outlineRefs.current.set(name, el);
              } else {
                outlineRefs.current.delete(name);
              }
            }}
            data-debug-object-outline={name}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 0,
              height: 0,
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
              {name}
            </span>
          </div>
        );
      })}
    </>
  );
}

/**
 * Side-channel context that lets SceneObjectOutlines hand its `startRaf`
 * function up to SceneViewport without prop drilling through debug conditionals.
 */
const OutlineRafCallbackContext = createContext<React.MutableRefObject<(() => void) | null> | null>(null);

/** Debug overlay rendered inside the Scene when `debug` is enabled. */
function SceneDebugOverlay({
  columnStacks,
  viewportRef,
  stageRef,
}: {
  columnStacks: DebugColumnStackEntry[];
  viewportRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Read current scroll state from column DOM attributes. This is debug-only
  // so reading from the DOM directly is acceptable.
  const columnScrollStates: DebugColumnScroll[] = [];
  const viewport = viewportRef.current;
  // Object list — DOM truth (queryDebugObjects), same rationale as
  // SceneObjectOutlines above.
  const objects: DebugObjectEntry[] = viewport ? queryDebugObjects(viewport) : [];
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
  debugColumnStacks,
  reducedMotion,
  onTransitionStart,
  onTransitionComplete,
  onViewportSizeChange,
  onTargetChange,
}: {
  children: React.ReactNode;
  /** Unfocused column stacking info for the debug overlay. */
  debugColumnStacks: DebugColumnStackEntry[] | null;
  /** Whether prefers-reduced-motion is active. */
  reducedMotion: boolean;
  /** Called when the camera pan (cameraX animate() call) starts. */
  onTransitionStart: () => void;
  /** Called when the camera pan completes (guarded against stale completions
   *  from a superseded animate() call — see cameraTransitionTokenRef below). */
  onTransitionComplete: () => void;
  /** Called whenever the viewport dimensions change. */
  onViewportSizeChange: (size: ViewportDimensions) => void;
  /** Called whenever the focused content's target bounds are (re)measured. */
  onTargetChange: (target: CameraRect) => void;
}) {
  const { debug, columnGap, padding, duration, stiffness, damping, perspective, slowMo } = useSceneConfig();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportDimensions>({ top: 0, left: 0, width: 0, height: 0 });
  const scrollCommandRegistry = useContext(ScrollCommandRegistryContext);

  // Counter tracking how many Motion animations are currently in flight.
  // The debug outline rAF loop runs while this is > 0. Using a ref (not state)
  // so increment/decrement don't trigger React re-renders.
  const animatingRef = useRef(0);

  // Side-channel ref populated by SceneObjectOutlines with its startRaf function.
  // Calling this kicks off the rAF loop when an animation starts.
  const outlineStartRafRef = useRef<(() => void) | null>(null);

  // Stable animation callbacks provided to the stage and (via context) to
  // SceneColumns. Only active in debug mode — callbacks are a no-op when
  // the context value is null.
  const animationCallbacks: AnimationCallbacks | null = debug
    ? {
        onStart: () => {
          animatingRef.current += 1;
          outlineStartRafRef.current?.();
        },
        onEnd: () => {
          animatingRef.current = Math.max(0, animatingRef.current - 1);
        },
      }
    : null;
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

  // duration=0 → instant transitions for tests; otherwise use configured spring.
  // slowMo → lazier spring parameters for animation snapshot testing. Declared
  // early (rather than inline near its original JSX use) so the stageLeft
  // effect below can drive cameraX with it.
  const transition =
    duration === 0
      ? { duration: 0 }
      : slowMo
        ? { type: "spring" as const, stiffness: 30, damping: 8 }
        : { type: "spring" as const, stiffness, damping };

  // S3 motion pipeline: cameraX mirrors stageLeft (above) as a MotionValue so
  // the stage's `left` (camera pan) can be driven off React's render cycle,
  // matching SceneColumn's scrollY/composedTop seam.
  const cameraX = useMotionValue(0);
  const motionSeam = useMotionSeam();
  useEffect(() => {
    motionSeam?.registerMotionValue("cameraX", cameraX);
  }, [motionSeam, cameraX]);

  // useCamera() `transitioning` (S6 reshape, forecast-gate adjudication #5c):
  // a monotonic token identifying the CURRENT cameraX animate() call. Each
  // new invocation increments it and captures its own value; the returned
  // controls' `.then()` only fires onTransitionComplete if its captured
  // token still matches the current one — guarding against a superseded
  // animation's completion firing AFTER a newer retarget has already
  // started (a rapid re-focus mid-pan must not report transitioning=false
  // while the newer pan is still in flight).
  const cameraTransitionTokenRef = useRef(0);

  // Tracks the previous focused-column-name set (joined, DOM order) so the
  // stageLeft effect below can detect when the focused layout actually
  // changes — the trigger for resetting native horizontal scroll (B1).
  const prevFocusedNamesRef = useRef("");

  // Measure viewport dimensions (and page-relative position) synchronously
  // on first render so columns have valid values immediately (useLayoutEffect
  // fires before paint, before ResizeObserver callbacks). ResizeObserver
  // keeps the values current for dynamic viewport resizes.
  //
  // Position ALWAYS comes from getBoundingClientRect() (forecast-gate
  // adjudication #2) — ResizeObserverEntry.contentRect.top/left are
  // padding-box-relative (≈0 always), not page-relative, and would silently
  // corrupt useCamera()'s `viewport` rect. contentRect stays as the
  // width/height source in the ResizeObserver callback (content-box,
  // excluding border/padding) — unchanged from before this reshape.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const { top, left, width, height } = el.getBoundingClientRect();
    setViewportSize((prev) =>
      prev.top === top && prev.left === left && prev.width === width && prev.height === height
        ? prev
        : { top, left, width, height },
    );
  });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        const { top, left } = el.getBoundingClientRect();
        setViewportSize((prev) =>
          prev.top === top && prev.left === left && prev.width === width && prev.height === height
            ? prev
            : { top, left, width, height },
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

    // Single camera owner also owns the native horizontal scroll reset: any
    // time the SET of focused column names changes (DOM order is stable, so
    // a plain joined-names comparison is enough), reset scrollLeft to 0
    // synchronously, before paint. This is a separate concern from stageLeft
    // (base alignment) — a still-overflowing newly-focused region needs
    // native scroll to reach the parts stageLeft alone doesn't cover, and a
    // stale scrollLeft calibrated to the OLD focused region would otherwise
    // permanently offset the new content (B1). Runs even when transitioning
    // to/from "nothing focused" so a later return to the same set isn't
    // mistaken for "unchanged".
    const focusedNames = focusedCols
      .map((col) => col.getAttribute("data-column") ?? "")
      .join(",");
    if (focusedNames !== prevFocusedNamesRef.current) {
      prevFocusedNamesRef.current = focusedNames;
      viewport.scrollLeft = 0;
    }

    if (focusedCols.length === 0) {
      // No focused columns — keep stage at current position (camera stays
      // still), and leave the useCamera() target at its last measured value.
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

    const stageLeftChanged = stageLeft !== newStageLeft;
    setStageLeft((prev) => (prev === newStageLeft ? prev : newStageLeft));
    setOverflowsX((prev) => (prev === newOverflowsX ? prev : newOverflowsX));

    // useCamera() target rect (S6 reshape): the union of every focused
    // column's page-relative bounds, inflated by Scene's padding on every
    // side — matches the "focused object dimensions plus padding" target
    // definition. Unions ALL focusedCols (not just first/last, which are
    // stage-relative horizontal extremes only) so top/bottom are correct
    // even if a future change breaks the current align-items: stretch
    // assumption that every focused column already spans the full stage
    // height.
    const focusedUnion = focusedCols.reduce(
      (acc, col) => {
        const rect = col.getBoundingClientRect();
        return {
          top: Math.min(acc.top, rect.top),
          left: Math.min(acc.left, rect.left),
          right: Math.max(acc.right, rect.right),
          bottom: Math.max(acc.bottom, rect.bottom),
        };
      },
      { top: Infinity, left: Infinity, right: -Infinity, bottom: -Infinity },
    );
    onTargetChange({
      top: focusedUnion.top - padding,
      left: focusedUnion.left - padding,
      width: focusedUnion.right - focusedUnion.left + padding * 2,
      height: focusedUnion.bottom - focusedUnion.top + padding * 2,
    });

    // Drive cameraX in parallel (S3 motion pipeline seam), gated on an actual
    // change to avoid restarting a spring toward its own current target on
    // every render (this effect runs unconditionally every render). duration=0
    // uses `.set()` directly (forecast-gate adjudication #1 — async completion
    // semantics differ from animate(...,{duration:0})); otherwise `animate()`
    // retargets the in-flight spring, matching the old animate={{left}} prop's
    // per-render retarget behavior.
    //
    // useCamera() transitioning (forecast-gate adjudication #5c): the token
    // captured at invocation guards onTransitionComplete against a
    // superseded animation's `.then()` firing after a newer retarget has
    // already started (e.g. a rapid re-focus mid-pan).
    if (stageLeftChanged) {
      if (duration === 0) {
        cameraX.set(newStageLeft);
      } else {
        const token = ++cameraTransitionTokenRef.current;
        onTransitionStart();
        const controls = animate(cameraX, newStageLeft, transition);
        motionSeam?.registerControls("cameraX", controls);
        controls.then(() => {
          if (cameraTransitionTokenRef.current === token) {
            onTransitionComplete();
          }
        });
      }
    }
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

  // Route wheel input to a target column's registered command applier
  // (S5 — replaces the old `columnscroll` CustomEvent bridge). deltaX is left
  // to the native horizontal scroll on the viewport. Registered as
  // non-passive so preventDefault() is allowed — normalize -> decide ->
  // apply all run synchronously within the same event so preventDefault()
  // timing is preserved exactly as before.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      if (e.deltaY === 0) return;

      // ctrlKey (pinch-zoom) -> null: never routed, never preventDefault-ed,
      // letting the browser's native pinch-zoom pass through untouched.
      const scaledDeltaY = normalizeWheelDelta(e, el.clientHeight);
      if (scaledDeltaY === null) return;

      const column = decideWheelTargetColumn(el, e.clientX, e.clientY);
      if (!column) return;

      const name = column.getAttribute("data-column");
      if (!name) return;
      const applyScrollCommand = scrollCommandRegistry.get(name);
      if (!applyScrollCommand) return;

      // Prevent the viewport from scrolling vertically. When the event also has
      // deltaX (diagonal trackpad gesture), only prevent default if there's no
      // horizontal scroll needed — otherwise the browser needs the event to
      // execute its native horizontal scroll via overflow-x: auto. Since the
      // viewport has overflow-y: hidden, not preventing default is safe for
      // the vertical axis in that case.
      if (e.deltaX === 0) {
        e.preventDefault();
      }

      applyScrollCommand({ type: "scrollBy", delta: scaledDeltaY });
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [scrollCommandRegistry]);

  // DELTA-2 (S5 a11y probe): the browser auto-scrolls the viewport
  // horizontally to bring a newly tab-focused element into view — this
  // bypasses the camera's own stageLeft pan entirely and corrupts scrollLeft
  // (probe-confirmed: tab-focusing a parked column's D3 activation wrapper
  // jumped scrollLeft from 0 to 782 with the stage's own `left` unchanged).
  // When the viewport is NOT natively scrollable (overflowsX === false — the
  // camera is the sole horizontal-position owner via stageLeft), scrollLeft
  // must always be 0; re-assert it on every focusin to undo the browser's
  // own scroll-into-view. Scoped to overflowsX === false: when the viewport
  // IS natively scrollable (focused content itself overflows), the user's
  // scroll position is legitimately under their own control and this effect
  // intentionally leaves it alone — see the worker report's Noticed section
  // for the known residual gap where a parked column sits beyond an
  // ALREADY-overflowing focused region.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || overflowsX) return;

    const handler = () => {
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
    };

    el.addEventListener("focusin", handler);
    return () => el.removeEventListener("focusin", handler);
  }, [overflowsX]);

  return (
    <AnimationCallbackContext.Provider value={animationCallbacks}>
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
            // Preserves native horizontal pan + pinch-zoom (bare "pan-x"
            // would disable pinch-zoom — touch-action keywords are
            // exclusive of anything not listed) while excluding vertical pan
            // from the browser's own gesture recognition, so a vertical
            // finger drag anywhere in this subtree is delivered as regular
            // pointer events for SceneColumn's own 1:1 touch handlers to
            // consume instead (spec: scene-scroll.feature "Horizontal camera
            // pan continues to work via native scroll on touch").
            touchAction: "pan-x pinch-zoom",
            outline: debug ? "2px solid cyan" : undefined,
            // Thin scrollbar with transparent track so it doesn't eat into content space.
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(128,128,128,0.4) transparent",
            // container-type: size lets consumers use cqw/cqh units to size
            // columns relative to the Camera viewport dimensions.
            containerType: "size",
            // Perspective + preserve-3d establish the 3D stacking context for
            // depth deck columns. Placing this on the viewport (rather than the
            // stage) means the perspective origin is expressed relative to the
            // visible window, so depth projection stays stable as the stage pans.
            // CSS defaults perspective-origin to "50% 50%" (center), which works
            // well for our use case without dynamic tracking.
            perspective: `${perspective}px`,
            transformStyle: "preserve-3d",
          } as React.CSSProperties}
        >
          {/* Stage: absolutely positioned within the viewport. `left` pans the
              scene so the focused region stays horizontally centered. No CSS
              transforms are used for panning — direct `left` positioning
              preserves text rendering quality (no subpixel transform artifacts).
              3D context lives on the viewport div above, not here. */}
          <motion.div
            ref={stageRef}
            data-stage
            initial={false}
            // onTransitionStart/onTransitionComplete (useCamera()
            // `transitioning`) are wired directly to the cameraX animate()
            // call in the stageLeft effect above, not to Motion's own
            // onLayoutAnimationStart/onLayoutAnimationComplete — those only
            // fire for a `layout`-prop-driven FLIP animation, which this
            // element doesn't have (S6 reshape; the props were already dead
            // wiring for the camera pan specifically since S3 moved `left`
            // off the `animate` prop — see motionSeam.ts).
            onAnimationStart={debug ? animationCallbacks?.onStart : undefined}
            onAnimationComplete={debug ? animationCallbacks?.onEnd : undefined}
            style={{
              position: "absolute",
              top: 0,
              // Instant mode (duration=0): the synchronous plain-number
              // write, unchanged from before S3 (forecast-gate adjudication
              // #1) — left is NOT MotionValue-driven here.
              // Real animation: left is the cameraX MotionValue, driven by
              // the stageLeft effect above off React's render cycle (no more
              // `animate` prop on this element — onAnimationStart/Complete
              // above are now dead wiring for the camera pan specifically;
              // debug-overlay staleness is accepted, see motionSeam.ts).
              ...(duration === 0 ? { left: stageLeft } : { left: cameraX }),
              height: "100%",
              display: "flex",
              flexDirection: "row",
              alignItems: "stretch",
              gap: columnGap || undefined,
              padding: padding || undefined,
              // preserve-3d propagates the viewport's 3D context through to
              // column children. Without this, translateZ on columns has no
              // visible perspective effect — elements render flat.
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
          {debug && (
            <OutlineRafCallbackContext.Provider value={outlineStartRafRef}>
              <SceneObjectOutlines
                viewportRef={viewportRef}
                animatingRef={animatingRef}
              />
            </OutlineRafCallbackContext.Provider>
          )}
          {/* Overlay is inside the scene div so tests can find it via
              scene.querySelector('[data-debug-overlay]'). position:fixed
              ensures it doesn't participate in flex layout. */}
          {debug && (
            <SceneDebugOverlay
              columnStacks={debugColumnStacks ?? []}
              viewportRef={viewportRef}
              stageRef={stageRef}
            />
          )}
        </div>
      </DepthDeckContext.Provider>
    </ViewportContext.Provider>
    </AnimationCallbackContext.Provider>
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
  columnGap = DEFAULT_COLUMN_GAP,
  padding = 0,
  slowMo = false,
  stiffness = DEFAULT_STIFFNESS,
  damping = DEFAULT_DAMPING,
  perspective = DEFAULT_PERSPECTIVE,
  peekOffset = DEFAULT_PEEK_OFFSET,
}: SceneProps) {
  const wrappedChildren = React.Children.map(children, wrapChild);

  // Detect prefers-reduced-motion. When active and no explicit duration prop
  // is provided, force duration=0 so all transitions are instant.
  const prefersReducedMotion = useReducedMotion() ?? false;
  const effectiveDuration = prefersReducedMotion && duration === undefined ? 0 : duration;

  // Track whether the camera pan is currently in flight (useCamera()
  // `transitioning`). Set via callbacks wired to the cameraX animate() call
  // in SceneViewport's stageLeft effect.
  const [transitioning, setTransitioning] = useState(false);

  // Track the camera viewport's rect for useCamera() consumers. Updated via
  // callback from SceneViewport whenever the viewport element is measured.
  const [viewportBounds, setViewportBounds] = useState<CameraRect>({ top: 0, left: 0, width: 0, height: 0 });

  // Track the focused content's target bounds for useCamera() consumers.
  // Updated via callback from SceneViewport's stageLeft effect; retains its
  // last value when nothing is focused (see useCamera.tsx's CameraState doc).
  const [targetBounds, setTargetBounds] = useState<CameraRect>({ top: 0, left: 0, width: 0, height: 0 });

  // Mutable map of saved scroll offsets per column name. SceneColumn saves its
  // scroll offset when losing focus and restores it when regaining focus.
  // Using useRef ensures the Map identity is stable — no re-renders on updates.
  const scrollOffsetStore = useRef<Map<string, ScrollOffsetEntry>>(new Map()).current;

  // Mutable map of column name -> command applier. SceneColumn registers its
  // applyScrollCommand closure here; SceneViewport's wheel handler looks up
  // the decided target column's applier and calls it directly (S5 — replaces
  // the old `columnscroll` CustomEvent bridge). Same stable-identity rationale
  // as scrollOffsetStore above.
  const scrollCommandRegistry = useRef<Map<string, (cmd: ScrollCommand) => void>>(new Map()).current;

  // True during Scene's first paint; false from the commit after first paint onward.
  // Read synchronously during render by SceneColumn to suppress the Phase 7c
  // slide-in-from-right on first mount (every column looks like it's "late-mounting"
  // before the initial effect fires — the ref distinguishes them).
  const firstPaintRef = useRef(true);
  useEffect(() => {
    firstPaintRef.current = false;
  }, []);

  // S6 registration architecture: columns self-register their aggregate
  // focus state and DOM element here, bottom-up (object -> column -> scene,
  // all pre-paint via useLayoutEffect — see SceneColumn's own registration
  // effect), instead of relying purely on walking the `children` prop tree.
  // The prop walk breaks for Fragment-wrapped columns, columns returned from
  // a custom component, or objects nested inside a plain wrapper div —
  // registration doesn't depend on tree shape, only on the DOM elements that
  // actually mount (context/refs resolve regardless of wrapping).
  const columnRegistryRef = useRef<Map<string, RegisteredColumn>>(new Map());
  // Forces a synchronous pre-paint re-render when the registry disagrees
  // with what the just-committed render used (see the correction effect
  // below). The value itself is never read.
  const [, forceRegistryCorrection] = useState(0);

  const registerColumn = useCallback<RegisterColumn>((name, registration) => {
    const existing = columnRegistryRef.current.get(name);
    // Warns unconditionally (no NODE_ENV gate — this package has no Node
    // types dependency and ships a single build) whenever a DIFFERENT
    // element claims an already-registered name; a consumer error (two
    // SceneColumns sharing a name), not something that fires from this
    // component's own unregister+reregister churn (cleanup always deletes
    // its own entry before the next registration call for the same name).
    if (existing && existing.element !== registration.element) {
      console.warn(
        `Scene: duplicate column name "${name}" — a different element already registered under this name.`,
      );
    }
    columnRegistryRef.current.set(name, registration);
    return () => {
      if (columnRegistryRef.current.get(name) === registration) {
        columnRegistryRef.current.delete(name);
      }
    };
  }, []);

  // Seed-then-correct (forecast-gate adjudication #1): the prop-walk seed is
  // used ONLY before any column has ever registered (the very first render).
  // After bootstrap, render always derives from the registry — re-seeding
  // from the prop walk on every render would infinite-loop on the wrapper
  // cases the registry exists to fix (the seed is PERMANENTLY wrong for
  // them, so re-deriving it every render never converges).
  const columnStates =
    columnRegistryRef.current.size > 0
      ? deriveColumnStatesFromRegistry(columnRegistryRef.current)
      : collectColumnFocusStates(wrappedChildren ?? []);
  const columnPositions = computeColumnPositions(columnStates);
  const stackDepths = computeStackDepths(columnStates);

  // Fingerprint of the column states THIS render actually used, captured
  // during render (mirrors SceneColumn's lastActiveFocusedKeyRef pattern) so
  // the correction effect below can compare against it after all descendant
  // SceneColumns have re-registered for this commit.
  const columnStatesFingerprintRef = useRef("");
  columnStatesFingerprintRef.current = columnStates.map((c) => `${c.name}:${c.focused}`).join(",");

  // Post-commit correction (forecast-gate adjudication #1): runs after every
  // descendant SceneColumn has registered for this commit (useLayoutEffect
  // ordering is bottom-up — children's effects fire before this one, since
  // this is declared in the outermost Scene component). If the registry
  // disagrees with what this render used, bump state to force a synchronous
  // re-render before paint, this time reading the now-fresh registry.
  // Ordinary case: registry already matches what this render used -> no
  // bump, no extra render. Wrapper case: pass-1 is wrong (matching today's
  // pre-fix behavior), pass-2 corrects invisibly before paint.
  useLayoutEffect(() => {
    const derived = deriveColumnStatesFromRegistry(columnRegistryRef.current);
    const fingerprint = derived.map((c) => `${c.name}:${c.focused}`).join(",");
    if (fingerprint !== columnStatesFingerprintRef.current) {
      forceRegistryCorrection((v) => v + 1);
    }
  });

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
    <SceneFirstPaintContext.Provider value={firstPaintRef}>
    <SceneConfigContext.Provider
      value={{ stiffness, damping, perspective, padding, columnGap, peekOffset, duration: effectiveDuration, debug, slowMo }}
    >
      <CameraContext.Provider
        value={{
          viewport: viewportBounds,
          target: targetBounds,
          transitioning,
        }}
      >
        <ScrollOffsetStoreContext.Provider value={scrollOffsetStore}>
        <ScrollCommandRegistryContext.Provider value={scrollCommandRegistry}>
        <ColumnRegistryContext.Provider value={registerColumn}>
        <ColumnPositionContext.Provider value={columnPositions}>
          <StackDepthContext.Provider value={stackDepths}>
            <SceneViewport
              debugColumnStacks={debugColumnStacks}
              reducedMotion={prefersReducedMotion}
              onTransitionStart={() => setTransitioning(true)}
              onTransitionComplete={() => setTransitioning(false)}
              onViewportSizeChange={(size) =>
                setViewportBounds((prev) =>
                  prev.top === size.top && prev.left === size.left && prev.width === size.width && prev.height === size.height
                    ? prev
                    : { top: size.top, left: size.left, width: size.width, height: size.height },
                )
              }
              onTargetChange={(target) =>
                setTargetBounds((prev) =>
                  prev.top === target.top && prev.left === target.left && prev.width === target.width && prev.height === target.height
                    ? prev
                    : target,
                )
              }
            >
              {wrappedChildren}
            </SceneViewport>
          </StackDepthContext.Provider>
        </ColumnPositionContext.Provider>
        </ColumnRegistryContext.Provider>
        </ScrollCommandRegistryContext.Provider>
        </ScrollOffsetStoreContext.Provider>
      </CameraContext.Provider>
    </SceneConfigContext.Provider>
    </SceneFirstPaintContext.Provider>
  );
}
