import React, { createContext, isValidElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SceneColumn } from "./SceneColumn";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import { SceneConfigContext, useSceneConfig, DEFAULT_STIFFNESS, DEFAULT_DAMPING, DEFAULT_TOUCH_POWER, DEFAULT_TOUCH_TIME_CONSTANT, DEFAULT_COLUMN_GAP, DEFAULT_PERSPECTIVE, DEFAULT_PEEK_OFFSET } from "./useSceneConfig";
import { CameraContext, type CameraRect } from "./useCamera";
import { ViewportContext, type ViewportDimensions } from "./ViewportContext";
import { ColumnPositionContext, type ColumnPosition } from "./ColumnPositionContext";
import { ColumnRegistryContext, type RegisteredColumn, type RegisterColumn } from "./ColumnRegistryContext";
import { SettleSignalContext, type SettleSignal } from "./SettleSignalContext";
import { TransitionPendingContext } from "./TransitionPendingContext";
import { TransitionPendingRefContext } from "./TransitionPendingRefContext";
import { useOwnedAnimation } from "./ownedAnimation";
import { useSettledValue } from "./useSettledValue";
import { StackDepthContext } from "./StackDepthContext";
import { ScrollOffsetStoreContext, type ScrollOffsetEntry } from "./ScrollOffsetStoreContext";
import { ScrollCommandRegistryContext } from "./ScrollCommandRegistryContext";
import { AnimationCallbackContext, type AnimationCallbacks } from "./AnimationCallbackContext";
import { SceneFirstPaintContext } from "./SceneFirstPaintContext";
import { MotionSeamContext, type MotionSeamRegistration } from "./motionSeam";
import {
  normalizeWheelDelta,
  normalizeWheelDeltaX,
  decideWheelTargetColumn,
  interiorCanConsume,
  computeReleaseVelocity,
  TOUCH_DIRECTION_SLOP_PX,
  isInteractiveElement,
  mapPanKeyToCommand,
  type ScrollCommand,
  type VelocitySample,
} from "./inputController";
import { PanControlContext, type PanControl } from "./PanControlContext";
import { animate, motion, useMotionValue, useReducedMotion, type AnimationPlaybackControls, type MotionValue } from "motion/react";

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
 *
 * Load-bearing invariant (D-series, ui#o32): because depth is assigned by
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

/**
 * A single SceneObject's name and focus state at the moment a focus
 * transition settled (ui#20) — the payload `onTransitionEnd` reports.
 */
export interface SceneFocusArrangementEntry {
  name: string;
  focused: boolean;
}

export interface SceneProps {
  children: React.ReactNode;
  /**
   * Set to 0 to disable all animations — every transition becomes
   * synchronous/instant, primarily useful in tests. Any OTHER value is
   * currently ignored: despite the numeric type, a non-zero duration is
   * NOT honored as an actual duration override — Scene always uses spring
   * physics (see `stiffness`/`damping`) for real animation regardless of
   * what non-zero number is passed. Omitting this prop (or passing
   * `undefined`) has the identical effect to passing any non-zero number.
   */
  duration?: number;
  /**
   * Fires exactly once per settled FOCUS transition (ui#20) — a change to
   * which SceneObjects are focused (including a within-column swap), once
   * the scene has genuinely gone quiet (the settle counter reaches zero
   * post-commit — the same crossing `data-scene-settled` flips true on).
   * Payload is the settled focus arrangement: every registered SceneObject
   * across every column, in DOM order, with its final `focused` state.
   *
   * Does NOT fire on the initial mount's pure-entrance settle (no focus
   * change occurred), and does NOT fire for a non-focus-driven settle
   * (e.g. an unrelated content-resize spring quieting down) — narrower
   * than `data-scene-settled`, which is mechanism-broad (see its own doc
   * comment). Reduced-motion / `duration={0}` focus changes DO fire
   * (synchronously, before the browser's next paint) — a silent no-fire
   * there would break every consumer on the accessibility path.
   *
   * Structurally excluded: SceneColumn's own vertical scroll inertia
   * (wheel/touch/keyboard scrolling within a focused column) never claims
   * through the settle-signal seam (a deliberate, pre-existing exclusion —
   * see SettleSignalContext's own doc comment) and is not a "focus
   * transition" in the first place, so it never triggers this callback.
   */
  onTransitionEnd?: (arrangement: SceneFocusArrangementEntry[]) => void;
  /** Enable debug overlays. */
  debug?: boolean;
  /** Gap (in px) between focused columns in the stage flex row. Defaults to 8. */
  columnGap?: number;
  /** Padding (in px) around the stage content. Defaults to 0. */
  padding?: number;
  /** Slow-motion springs for animation snapshot testing. Same spring physics, much lazier parameters. */
  slowMo?: boolean;
  /** Spring stiffness for position/size animations. Defaults to DEFAULT_STIFFNESS (300). */
  stiffness?: number;
  /** Spring damping for position/size animations. Defaults to DEFAULT_DAMPING (30). */
  damping?: number;
  /**
   * `power` for touch-release inertia (Motion's `type: "inertia"` decay).
   * Defaults to DEFAULT_TOUCH_POWER (0.4).
   */
  touchPower?: number;
  /**
   * `timeConstant` (ms) for touch-release inertia. Defaults to
   * DEFAULT_TOUCH_TIME_CONSTANT (325).
   */
  touchTimeConstant?: number;
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

// Module-level (not per-Scene-instance) — dev-warn dedup for warnStrayChild
// below, keyed by the child's own `type` (component reference, or the DOM
// tag string for a plain element). One warning per distinct offending type
// for the lifetime of the module, not once per render/mount — a demo that
// re-renders every frame (e.g. a live camera-pan readout) must not spam.
const warnedStrayChildTypes = new Set<unknown>();

/**
 * Dev warning (H10/small-batch item) for a Scene child that is neither a
 * SceneColumn nor a SceneObject: `wrapChild` below returns it UNCHANGED, so
 * it joins the stage's `display: flex` row as a real flex item — silently
 * widening the stage's scroll extent (scrollWidth) if it renders any actual
 * size. This bit us via the demos' `CameraDebug` (a plain `<p>` readout
 * rendered directly inside `<Scene>`) costing a diagnosis round before the
 * cause was traced to exactly this. Warns once per distinct child type.
 */
function warnStrayChild(type: unknown): void {
  if (warnedStrayChildTypes.has(type)) return;
  warnedStrayChildTypes.add(type);
  const typeName =
    typeof type === "string"
      ? type
      : (type as { displayName?: string; name?: string } | null)?.displayName ??
        (type as { displayName?: string; name?: string } | null)?.name ??
        "(anonymous)";
  console.warn(
    `Scene: child <${typeName}> is neither a SceneColumn nor a SceneObject — it will join the ` +
      "stage's flex row unchanged and can silently widen the scroll extent if it renders any " +
      "size. If this is an overlay/debug element (e.g. a camera readout), give it " +
      "`position: absolute` (or `fixed`) so it exits the flex flow, or render it outside <Scene> instead.",
  );
}

/**
 * ui#19 slice (d): mounting-contract warning. Scene's viewport is immune to
 * scrollLeft corruption ON ITSELF (overflow-x:clip, probe-confirmed
 * bulletproof — see the viewport style comment below) — but the browser
 * doesn't just give up when it can't scroll an immune element into view; it
 * walks UP the tree and scrolls the next REAL scroll container instead
 * (measured in the ui#19 clip probe: 0 -> 350px on a real overflow-x:auto
 * ancestor). If Scene itself is mounted inside a horizontally-scrollable
 * ancestor, the exact class of corruption this arc eliminates can resurface
 * one DOM level up, outside Scene's own control. Warns once per distinct
 * ancestor element (module-wide dedup, mirrors warnedStrayChildTypes above)
 * — a real app's layout doesn't usually change shape between renders, so a
 * per-render warning would just spam without adding information.
 */
const warnedChainableAncestors = new WeakSet<Element>();

function warnAncestorScrollChaining(viewport: Element): void {
  let el: Element | null = viewport.parentElement;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    const isHorizontalScrollContainer =
      (style.overflowX === "auto" || style.overflowX === "scroll") && el.scrollWidth > el.clientWidth;
    if (isHorizontalScrollContainer) {
      if (!warnedChainableAncestors.has(el)) {
        warnedChainableAncestors.add(el);
        console.warn(
          "Scene: mounted inside a horizontally-scrollable ancestor " +
            `(<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${
              el.className ? `.${String(el.className).split(" ").join(".")}` : ""
            }>). Scene's own viewport is immune to scrollLeft corruption ` +
            "(overflow-x:clip), but a browser focus-driven auto-scroll that can't move Scene's " +
            "viewport will chain to this ancestor instead — the same corruption class Scene " +
            "eliminates for itself can resurface here, outside Scene's control. Consider whether " +
            "this ancestor needs to be horizontally scrollable at all.",
        );
      }
      return; // one warning per mount is enough — stop at the first hit
    }
    el = el.parentElement;
  }
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

  warnStrayChild(child.type);
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

/** Measured stage-vs-focused-span bounds for StageBoundsOutline below. */
interface StageBoundsInfo {
  left: number;
  top: number;
  width: number;
  height: number;
  stageWidth: number;
  focusedWidth: number;
}

/**
 * Measures the stage's true rendered width against the union of currently
 * focused columns' width. Returns null when there's nothing focused (no
 * "focused span" to compare against) or when the stage doesn't exceed it
 * (the common case — most layouts have no frozen/parked columns extending
 * the stage beyond what's focused).
 */
function measureStageBounds(viewport: HTMLElement, stage: HTMLElement): StageBoundsInfo | null {
  const focusedCols = Array.from(stage.querySelectorAll<HTMLElement>("[data-column-focused='true']"));
  if (focusedCols.length === 0) return null;

  const focusedUnion = focusedCols.reduce(
    (acc, col) => {
      const rect = col.getBoundingClientRect();
      return { left: Math.min(acc.left, rect.left), right: Math.max(acc.right, rect.right) };
    },
    { left: Infinity, right: -Infinity },
  );
  const focusedWidth = focusedUnion.right - focusedUnion.left;

  const stageRect = stage.getBoundingClientRect();
  const stageWidth = stageRect.width;

  // 1px epsilon absorbs sub-pixel layout rounding noise, not real overflow.
  if (stageWidth <= focusedWidth + 1) return null;

  const vpRect = viewport.getBoundingClientRect();
  return {
    left: stageRect.left - vpRect.left,
    top: stageRect.top - vpRect.top,
    width: stageWidth,
    height: stageRect.height,
    stageWidth,
    focusedWidth,
  };
}

function stageBoundsEqual(a: StageBoundsInfo | null, b: StageBoundsInfo | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height &&
    a.stageWidth === b.stageWidth &&
    a.focusedWidth === b.focusedWidth
  );
}

/**
 * F4 feature (b): draws the stage's TRUE rendered bounds — the full flex
 * row, including any frozen/parked columns outside the focused span — with
 * a numeric label, but ONLY when that true width exceeds the focused span.
 * This is the CameraDebug-incident class made visible at a glance (see
 * warnStrayChild below): a wide-but-currently-hidden stage (overflowsX
 * false, so no scrollbar hints at it) is exactly the shape that widened
 * scrollWidth invisibly before the F4 commit-1 purity fix — this outline
 * exists so a developer can SEE that shape exists without needing to know
 * to check scrollWidth themselves. The existing permanent magenta stage
 * outline (SceneViewport's `outline: debug ? "2px solid magenta"` on the
 * stage element itself) already technically delineates these same bounds,
 * but it's clipped by the viewport's own overflow just like real content —
 * the far edge of a wide stage is invisible in the current scroll position
 * exactly when this matters most. Rendered inside the same viewport-pinned
 * overflow:hidden clipping layer SceneObjectOutlines uses (commit 1) — this
 * label is exactly as width-unconstrained as SceneObjectOutlines' name
 * labels were, so it MUST stay inside that clip to avoid reopening the same
 * purity bug.
 */
function StageBoundsOutline({
  viewportRef,
  stageRef,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [bounds, setBounds] = useState<StageBoundsInfo | null>(null);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    const fresh = viewport && stage ? measureStageBounds(viewport, stage) : null;
    setBounds((prev) => (stageBoundsEqual(prev, fresh) ? prev : fresh));
  }, [viewportRef, stageRef]);

  useLayoutEffect(() => {
    measure();
  });

  // F6 item 1 fix: same staleness class as SceneObjectOutlines above — a
  // React-render-only measurement misses the stage width shifting during a
  // Motion-driven (imperative, off-React) transition. `stageBoundsEqual`'s
  // bail-out keeps this from re-rendering every frame once settled.
  useEffect(() => {
    let rafId = requestAnimationFrame(function loop() {
      measure();
      rafId = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(rafId);
  }, [measure]);

  if (!bounds) return null;

  const hidden = Math.round(bounds.stageWidth - bounds.focusedWidth);

  return (
    <div
      data-debug-stage-bounds
      style={{
        position: "absolute",
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        border: "2px dashed orange",
        pointerEvents: "none",
        boxSizing: "border-box",
        zIndex: 9997,
      }}
    >
      <span
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          background: "orange",
          color: "#000",
          fontFamily: "monospace",
          fontSize: 10,
          padding: "0 2px",
          lineHeight: "14px",
        }}
      >
        stage {Math.round(bounds.stageWidth)}px (focused {Math.round(bounds.focusedWidth)}px, +{hidden}px hidden)
      </span>
    </div>
  );
}

/** A stage child that joined the flex row without going through a SceneColumn. */
interface StrayChildEntry {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  typeName: string;
}

/**
 * Finds every DIRECT DOM child of the stage lacking `data-column` — the
 * attribute every legitimately-rendered SceneColumn carries. wrapChild
 * (below) already folds bare SceneObjects into an implicit SceneColumn, so
 * anything reaching the stage without `data-column` is exactly
 * warnStrayChild's trigger condition: a child that is neither a SceneColumn
 * nor a SceneObject, silently joining the flex row unchanged.
 */
function measureStrayChildren(viewport: HTMLElement, stage: HTMLElement): StrayChildEntry[] {
  const vpRect = viewport.getBoundingClientRect();
  const entries: StrayChildEntry[] = [];
  Array.from(stage.children).forEach((child, i) => {
    if (!(child instanceof HTMLElement)) return;
    if (child.hasAttribute("data-column")) return;
    const rect = child.getBoundingClientRect();
    entries.push({
      key: `stray-${i}-${child.tagName}`,
      left: rect.left - vpRect.left,
      top: rect.top - vpRect.top,
      width: rect.width,
      height: rect.height,
      typeName: child.tagName.toLowerCase(),
    });
  });
  return entries;
}

function strayChildrenEqual(a: StrayChildEntry[], b: StrayChildEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, i) =>
        entry.key === b[i]?.key &&
        entry.left === b[i]?.left &&
        entry.top === b[i]?.top &&
        entry.width === b[i]?.width &&
        entry.height === b[i]?.height,
    )
  );
}

/**
 * F4 feature (b): paints a red outline + label on every stray stage child
 * (see measureStrayChildren above) — the CameraDebug-incident class made
 * visible at a glance, pairing with warnStrayChild's console warning above.
 * Rendered inside the same viewport-pinned clipping layer as
 * SceneObjectOutlines/StageBoundsOutline (commit 1's purity fix) — a stray
 * child is by definition NOT position-managed by Scene, so nothing bounds
 * where it might render.
 */
function StrayChildFlags({
  viewportRef,
  stageRef,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [entries, setEntries] = useState<StrayChildEntry[]>([]);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    const fresh = viewport && stage ? measureStrayChildren(viewport, stage) : [];
    setEntries((prev) => (strayChildrenEqual(prev, fresh) ? prev : fresh));
  }, [viewportRef, stageRef]);

  useLayoutEffect(() => {
    measure();
  });

  // F6 item 1 fix: same staleness class as SceneObjectOutlines above.
  // strayChildrenEqual's bail-out keeps this from re-rendering every frame
  // once settled.
  useEffect(() => {
    let rafId = requestAnimationFrame(function loop() {
      measure();
      rafId = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(rafId);
  }, [measure]);

  return (
    <>
      {entries.map((entry) => (
        <div
          key={entry.key}
          data-debug-stray-child={entry.typeName}
          style={{
            position: "absolute",
            left: entry.left,
            top: entry.top,
            width: entry.width,
            height: entry.height,
            border: "2px solid red",
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
              background: "red",
              color: "#fff",
              fontFamily: "monospace",
              fontSize: 10,
              padding: "0 2px",
              lineHeight: "14px",
            }}
          >
            stray &lt;{entry.typeName}&gt;
          </span>
        </div>
      ))}
    </>
  );
}

/** Identifies one deck card (column-level in-between, or within-column depth object). */
interface DeckCardKey {
  /** React key + badge-ref key. */
  key: string;
  kind: "column" | "object";
  /** The data-column name (kind "column") or data-scene-id name (kind
   *  "object") used to re-find the live DOM element on every frame. */
  domId: string;
}

/**
 * Finds every current deck card: columns classified in-between (F1/H8's
 * `data-stack-depth`, only ever set for in-between columns) and
 * within-column depth-deck objects (`data-within-column-depth`, only ever
 * set when an object is sandwiched between two focused siblings — see
 * SceneObject's withinDepthInfo). Focused cards and outer-left/outer-right
 * columns carry neither attribute and are correctly excluded — badges are
 * for deck cards specifically, matching the paint-order invariant they
 * exist to visually check (Michael's ruled invariant: two objects
 * overlapping in 2D screen space must never change which one paints on top
 * — see tests/utils/animation.ts's assertPaintOrderInvariant).
 */
function findDeckCardKeys(stage: HTMLElement): DeckCardKey[] {
  const keys: DeckCardKey[] = [];
  stage.querySelectorAll<HTMLElement>("[data-stack-depth]").forEach((el) => {
    const name = el.getAttribute("data-column") ?? "";
    keys.push({ key: `column:${name}`, kind: "column", domId: name });
  });
  stage.querySelectorAll<HTMLElement>("[data-within-column-depth]").forEach((el) => {
    const name = el.getAttribute("data-scene-id") ?? "";
    keys.push({ key: `object:${name}`, kind: "object", domId: name });
  });
  return keys;
}

function deckCardKeysEqual(a: DeckCardKey[], b: DeckCardKey[]): boolean {
  return a.length === b.length && a.every((k, i) => k.key === b[i]?.key);
}

/**
 * Reads the live translateZ a card is CURRENTLY rendered at, straight off
 * its computed `transform` — not off a MotionValue, because only
 * SceneColumn's column-level z is one (zMV, registered on the motion seam
 * for feature (a)'s active-springs panel); a within-column depth object's z
 * lives in Motion's declarative `animate` prop (WAAPI-driven — see
 * SceneObject's own comment on why opacity/filter/z go there instead of a
 * MotionValue). getComputedStyle reflects whichever mechanism is driving a
 * given card, uniformly, so one read path covers both card kinds. Any 3D
 * transform (translateZ specifically) resolves to `matrix3d(...)` (16
 * comma-separated values, column-major) — tz is the 15th value (index 14).
 * A 2D `matrix(...)` or `none` has no z component (0).
 */
function parseTranslateZ(transform: string): number {
  const match = transform.match(/matrix3d\(([^)]+)\)/);
  if (!match) return 0;
  const values = match[1]!.split(",").map((v) => parseFloat(v.trim()));
  return values[14] ?? 0;
}

/**
 * F4 feature (d): a small badge on every deck card (column-level and
 * within-column) showing its current live paint-order value — the visual
 * check for the paint-order invariant (do cards nearer the front actually
 * paint in front of cards behind them, at a glance, without pausing a
 * transition and inspecting devtools). Updates continuously via
 * requestAnimationFrame while mounted (i.e. while `debug` is enabled) —
 * same rationale and pattern as ActiveSpringsSection above: the underlying
 * value can change every frame mid-spring, off React's own render cycle, so
 * reading it only at commit time would show it stale throughout a
 * transition.
 *
 * Two DIFFERENT mechanisms drive paint order depending on card kind (ui#21
 * z-index paint-order channel amendment) — column-level cards still use
 * translateZ (SceneColumn.tsx:~2856's own comment: paint-INERT there,
 * DOM-order actually governs, translateZ is kept for the perspective
 * foreshortening visual cue only); within-column object cards use a
 * discrete zIndex write instead (SceneObject's own zIndex comment —
 * object-level translateZ never actually reached the object and was removed
 * entirely). The badge reads whichever channel is real for that card kind.
 */
function PaintOrderBadges({
  viewportRef,
  stageRef,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [cards, setCards] = useState<DeckCardKey[]>([]);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const fresh = stage ? findDeckCardKeys(stage) : [];
    setCards((prev) => (deckCardKeysEqual(prev, fresh) ? prev : fresh));
  });

  const badgeRefs = useRef<Map<string, HTMLElement>>(new Map());

  const updateBadges = useCallback(() => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage) return;
    const vpRect = viewport.getBoundingClientRect();
    for (const card of cards) {
      const el =
        card.kind === "column"
          ? stage.querySelector<HTMLElement>(`[data-column='${card.domId}']`)
          : stage.querySelector<HTMLElement>(`[data-scene-id='${card.domId}']`);
      const badge = badgeRefs.current.get(card.key);
      if (!el || !badge) continue;
      const rect = el.getBoundingClientRect();
      badge.style.left = `${rect.left - vpRect.left}px`;
      badge.style.top = `${rect.top - vpRect.top}px`;
      if (card.kind === "column") {
        // ui#17 anchor/column split: the depth translateZ lives on the column's
        // inner column node now, not the outer flex anchor `el` itself — read
        // z from the column node when one exists (every column has one; this
        // falls back to `el` defensively, which has no column child to begin
        // with).
        const zSource = el.querySelector<HTMLElement>("[data-scene-column]") ?? el;
        const z = parseTranslateZ(getComputedStyle(zSource).transform);
        badge.textContent = `z:${Math.round(z)}`;
      } else {
        // ui#21 z-index paint-order channel amendment: object-level depth
        // cards no longer carry translateZ at all (removed entirely — see
        // SceneObject's own zIndex comment) — paint order is a discrete
        // zIndex write on the object instead. parseTranslateZ would always
        // read 0 here now; read the real channel directly.
        const zSource = el.querySelector<HTMLElement>("[data-scene-object]") ?? el;
        badge.textContent = `z:${getComputedStyle(zSource).zIndex}`;
      }
    }
  }, [cards]);

  // Paint-synchronous pass so the first frame isn't blank before the first
  // rAF tick (mirrors ActiveSpringsSection/SceneObjectOutlines).
  useLayoutEffect(() => {
    updateBadges();
  });

  useEffect(() => {
    let rafId = requestAnimationFrame(function loop() {
      updateBadges();
      rafId = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(rafId);
  }, [updateBadges]);

  return (
    <>
      {cards.map((card) => (
        <div
          key={card.key}
          ref={(el) => {
            if (el) badgeRefs.current.set(card.key, el);
            else badgeRefs.current.delete(card.key);
          }}
          data-debug-paint-badge={card.key}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            background: card.kind === "column" ? "#7c3aed" : "#0891b2",
            color: "#fff",
            fontFamily: "monospace",
            fontSize: 9,
            padding: "0 2px",
            lineHeight: "12px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        />
      ))}
    </>
  );
}

/**
 * Absolutely-positioned overlay elements that draw colored outlines around each
 * SceneObject. Rendered inside the viewport so positions are relative to it.
 * `pointer-events: none` ensures these overlays never interfere with interaction.
 *
 * Outline positions are updated in two ways:
 * 1. `useLayoutEffect` fires on every React render for initial/settled layout.
 * 2. A `requestAnimationFrame` loop runs continuously for as long as this
 *    component is mounted (i.e. for as long as `debug` is enabled — F6 item
 *    1 fix), measuring positions every frame and mutating outline div styles
 *    directly (no setState) so Motion animations are tracked without
 *    triggering re-renders. Previously gated on a `animatingRef.current > 0`
 *    counter fed by `onAnimationStart`/`onLayoutAnimationStart` callbacks —
 *    those only fire for DECLARATIVE `animate`-prop transitions with the
 *    callback actually wired up (SceneColumn's opacity/x/y/filter + layout
 *    FLIP + marginTop), never for the S3+ imperative motion pipeline
 *    (topOffsetMV, zMV, scrollY, cameraX, SceneObject's within-column
 *    heightMV/marginBottomMV, replacing the retired topMV) or for
 *    SceneObject's own declarative opacity/filter animate (z moved to a
 *    discrete, non-animated zIndex channel — ui#21's z-index paint-order
 *    channel amendment) — none of these were ever wired to any
 *    onAnimationStart callback at all.
 *    Probe-confirmed on the dev app's Debug mode demo: an object's outline
 *    froze at its pre-transition position for an entire ~330ms swap and
 *    never caught up even after the real object settled, because nothing
 *    ever incremented the counter for that transition. ActiveSpringsSection
 *    below already reaches this same conclusion for its own per-frame
 *    readouts and runs continuously for exactly this reason — this mirrors
 *    that established pattern rather than inventing a new one.
 */
function SceneObjectOutlines({
  viewportRef,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
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

  // F6 item 1 fix: rAF loop runs continuously for as long as this component
  // is mounted (i.e. for as long as `debug` is enabled), mirroring
  // ActiveSpringsSection's own established continuous pattern below —
  // matches Motion's per-frame imperative writes with no external trigger
  // needed. Debug-only, so the per-frame cost never reaches the production
  // path; it doesn't mutate React state or the scene's own layout (only
  // this overlay div's own style, pointer-events: none), so it doesn't
  // reopen the "debug does not affect layout" bar (F4 commit 1).
  useEffect(() => {
    let rafId = requestAnimationFrame(function loop() {
      measureAndUpdate();
      rafId = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(rafId);
  }, [measureAndUpdate]);

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
 * Debug overlay section listing every currently-registered MotionValue on
 * Scene's motion seam (cameraX, scrollY/topOffset/z per column,
 * height/marginBottom per within-column depth-deck object — ui#21's
 * height/margin channels, replacing the retired withinColumnTop key) with
 * its live
 * value, target (when the driving animate() call reported one — an
 * inertia/fling deceleration has no fixed target and reads "—"), and
 * velocity. Registered keys are corrected via a useLayoutEffect (same
 * commit-stale rationale as SceneDebugOverlay's own `objects` list above —
 * a brand new key registering elsewhere doesn't otherwise trigger a
 * re-render here) but the per-row NUMBERS are updated via a continuously
 * running requestAnimationFrame loop that mutates each row's text nodes
 * directly (SceneObjectOutlines' pattern) — a MotionValue changes every
 * frame off React's own render cycle, so reading it only at commit time
 * would show it permanently stale mid-spring. Runs for as long as this
 * component is mounted (i.e. for as long as `debug` is enabled) rather than
 * gating on SceneViewport's animatingRef counter, which only tracks the
 * stage/column motion.div's own WAAPI animations — not these imperative
 * animate(motionValue, ...) calls, which have no such correlated signal.
 */
function ActiveSpringsSection({ recorder }: { recorder: DebugMotionRecorder }) {
  const [keys, setKeys] = useState<string[]>([]);
  useLayoutEffect(() => {
    const fresh = Array.from(recorder.values.keys());
    setKeys((prev) => {
      const same = prev.length === fresh.length && prev.every((k, i) => k === fresh[i]);
      return same ? prev : fresh;
    });
  });

  const valueRefs = useRef<Map<string, HTMLElement>>(new Map());
  const targetRefs = useRef<Map<string, HTMLElement>>(new Map());
  const velocityRefs = useRef<Map<string, HTMLElement>>(new Map());

  const updateRows = useCallback(() => {
    for (const key of keys) {
      const mv = recorder.values.get(key);
      if (!mv) continue;
      const valueEl = valueRefs.current.get(key);
      const targetEl = targetRefs.current.get(key);
      const velocityEl = velocityRefs.current.get(key);
      const target = recorder.targets.get(key);
      if (valueEl) valueEl.textContent = mv.get().toFixed(1);
      if (targetEl) targetEl.textContent = target === undefined ? "—" : target.toFixed(1);
      if (velocityEl) velocityEl.textContent = mv.getVelocity().toFixed(1);
    }
  }, [keys, recorder]);

  // Paint-synchronous pass so the very first frame isn't blank before the
  // first rAF tick below (mirrors SceneObjectOutlines' equivalent
  // useLayoutEffect measureAndUpdate pass).
  useLayoutEffect(() => {
    updateRows();
  });

  useEffect(() => {
    let rafId = requestAnimationFrame(function loop() {
      updateRows();
      rafId = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(rafId);
  }, [updateRows]);

  if (keys.length === 0) return null;

  return (
    <>
      <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4 }}>
        Active springs
      </div>
      {keys.map((key) => (
        <div key={key} data-debug-spring={key}>
          <span style={{ color: "#fbbf24" }}>{key}</span>
          {": "}
          <span
            ref={(el) => {
              if (el) valueRefs.current.set(key, el);
              else valueRefs.current.delete(key);
            }}
            data-debug-spring-value
          />
          {" → "}
          <span
            ref={(el) => {
              if (el) targetRefs.current.set(key, el);
              else targetRefs.current.delete(key);
            }}
            data-debug-spring-target
          />
          {" (v="}
          <span
            ref={(el) => {
              if (el) velocityRefs.current.set(key, el);
              else velocityRefs.current.delete(key);
            }}
            data-debug-spring-velocity
          />
          {")"}
        </div>
      ))}
    </>
  );
}

/** Debug overlay rendered inside the Scene when `debug` is enabled. */
function SceneDebugOverlay({
  columnStacks,
  viewportRef,
  stageRef,
  motionRecorder,
  slowMo,
  onToggleSlowMo,
}: {
  columnStacks: DebugColumnStackEntry[];
  viewportRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
  /** Scene's own motion-seam recorder (see createDebugMotionRecorder below),
   *  or null when a test harness supplied its own MotionSeamContext.Provider
   *  instead (motionSeam.ts) — in that case the active-springs section below
   *  simply has nothing of Scene's own to read and renders nothing. */
  motionRecorder: DebugMotionRecorder | null;
  /** F4 feature (e): the currently-effective slowMo (prop or override). */
  slowMo: boolean;
  /** F4 feature (e): flips Scene's internal slowMo override. */
  onToggleSlowMo: () => void;
}) {
  // Object list — DOM truth (queryDebugObjects), same rationale as
  // SceneObjectOutlines above. Corrected via a useLayoutEffect (mirroring
  // SceneObjectOutlines' renderedObjects pattern), NOT computed inline
  // during render: a during-render query reads the DOM as of the END of
  // the PREVIOUS commit (React applies THIS commit's mutations only after
  // the whole tree has rendered), and unlike SceneObjectOutlines — whose
  // own state update triggers its own self-correcting re-render —
  // SceneDebugOverlay has no other re-render trigger of its own, so an
  // idle scene would otherwise show a mount/unmount stale by exactly one
  // commit indefinitely.
  const [objects, setObjects] = useState<DebugObjectEntry[]>([]);
  useLayoutEffect(() => {
    const currentViewport = viewportRef.current;
    if (!currentViewport) return;
    const fresh = queryDebugObjects(currentViewport);
    setObjects((prev) => {
      const same =
        prev.length === fresh.length &&
        prev.every((p, i) => p.name === fresh[i]?.name && p.focused === fresh[i]?.focused);
      return same ? prev : fresh;
    });
  });

  // F4 purity audit finding: everything below (columnScrollStates,
  // scrollLeft/scrollWidth/clientWidth, offsetParentWarnings, objectBounds)
  // is still computed via RENDER-TIME reads of viewportRef.current/
  // stageRef.current — the exact one-commit-stale hazard `objects` above was
  // moved off of (see its comment). These are lower-stakes than `objects`
  // (no self-correcting re-render loop existed for them either way, and an
  // idle scene's stale display corrects on the next unrelated re-render), and
  // — same rationale as SceneObjectOutlines' pure DOM reads — reading here is
  // observationally pure: it only feeds the overlay's OWN displayed text, and
  // is never written back into Scene's actual layout/scroll decisions, so it
  // doesn't threaten "Debug does not affect layout" (scene-debug.feature).
  // Left as pre-existing behavior (out of scope for this purity fix, which is
  // about Scene's real behavior, not the overlay's internal display
  // freshness) — a future pass could apply the same layout-effect+state
  // treatment `objects` already got, purely to reduce staleness in what's
  // shown.
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

  // F4 feature (c) geometry-store inspector: reads SceneColumn's per-object
  // data-geometry-offset-top/height mirror (written by remeasureGeometry —
  // see SceneColumn.tsx), grouped by parent column. No provenance tag
  // (seeded-at-registration vs remeasured, as originally scoped) — SceneColumn
  // has exactly ONE write site into its geometryStore (remeasureGeometry's
  // bulk pass; verified at source, no separate registration-time seed
  // exists), so a provenance boolean would have nothing real to distinguish.
  const geometryByColumn = new Map<string, Array<{ name: string; offsetTop: number; height: number }>>();
  if (viewport) {
    viewport.querySelectorAll<HTMLElement>("[data-geometry-offset-top]").forEach((el) => {
      const name = el.getAttribute("data-scene-id") ?? "?";
      const columnName = el.closest<HTMLElement>("[data-column]")?.getAttribute("data-column") ?? "?";
      const entries = geometryByColumn.get(columnName) ?? [];
      entries.push({
        name,
        offsetTop: parseFloat(el.getAttribute("data-geometry-offset-top") ?? "0"),
        height: parseFloat(el.getAttribute("data-geometry-height") ?? "0"),
      });
      geometryByColumn.set(columnName, entries);
    });
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
        // F4 feature (e) tradeoff, taken deliberately and documented rather
        // than left as a silent side effect: every OTHER debug element
        // (outlines, badges, stage bounds, stray-child flags) stays
        // pointerEvents:"none" — pure observation, exactly what F4 commit 1
        // guarantees ("Debug does not affect layout"). This ONE panel
        // becomes pointerEvents:"auto" so its slowMo checkbox below is
        // actually clickable, which means debug mode's bottom-right corner
        // becomes click-opaque (mouse/touch events over the panel hit it,
        // not whatever Scene content happens to sit underneath) — an
        // inherent, accepted cost of having ANY interactive debug chrome at
        // all. This does not reopen the purity bar: that bar is about
        // layout/scroll METRICS (scrollWidth/clientWidth/rects) being
        // identical debug on vs off, which pointer-events has zero bearing
        // on — nothing here changes what gets MEASURED or LAID OUT, only
        // what a click in this specific screen region hits.
        pointerEvents: "auto",
      }}
    >
      <label
        data-debug-slowmo-toggle
        style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4, cursor: "pointer" }}
      >
        <input type="checkbox" checked={slowMo} onChange={onToggleSlowMo} />
        slow motion
      </label>

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

      {geometryByColumn.size > 0 && (
        <>
          <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4 }}>
            Geometry store
          </div>
          {Array.from(geometryByColumn.entries()).map(([columnName, entries]) => (
            <div key={columnName} data-debug-geometry-column={columnName}>
              <span style={{ color: "#c4b5fd" }}>{columnName}</span>
              {entries.map((entry) => (
                <div key={entry.name} style={{ paddingLeft: 8 }} data-debug-geometry-object={entry.name}>
                  <span style={{ color: "#9ca3af" }}>{entry.name}</span>
                  {": top="}
                  {Math.round(entry.offsetTop)}
                  {" h="}
                  {Math.round(entry.height)}
                </div>
              ))}
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

      {motionRecorder && <ActiveSpringsSection recorder={motionRecorder} />}
    </div>
  );
}

/**
 * A MotionSeamRegistration recorder Scene creates for ITSELF when `debug` is
 * enabled and no test harness has already wrapped a MotionSeamContext.Provider
 * around the tree (see SceneViewport's `motionSeam` derivation below) — powers
 * the debug overlay's active-springs panel. Registration-only and
 * observationally pure: it never drives/mutates the values or controls it
 * receives, only stores references for later reads.
 */
interface DebugMotionRecorder extends MotionSeamRegistration {
  values: Map<string, MotionValue<number>>;
  controls: Map<string, AnimationPlaybackControls | undefined>;
  targets: Map<string, number>;
}

function createDebugMotionRecorder(): DebugMotionRecorder {
  const values = new Map<string, MotionValue<number>>();
  const controls = new Map<string, AnimationPlaybackControls | undefined>();
  const targets = new Map<string, number>();
  return {
    values,
    controls,
    targets,
    registerMotionValue(key, value) {
      values.set(key, value);
    },
    registerControls(key, playbackControls) {
      controls.set(key, playbackControls);
    },
    registerTarget(key, target) {
      targets.set(key, target);
    },
    unregisterMotionValue(key) {
      values.delete(key);
      controls.delete(key);
      targets.delete(key);
    },
  };
}

/** Inner scene content — reads debug flag from config to apply outline. */
function SceneViewport({
  children,
  debugColumnStacks,
  reducedMotion,
  settled,
  onToggleSlowMo,
  onTransitionStart,
  onTransitionComplete,
  onViewportSizeChange,
  onTargetChange,
  columnRegistryRef,
}: {
  children: React.ReactNode;
  /** Unfocused column stacking info for the debug overlay. */
  debugColumnStacks: DebugColumnStackEntry[] | null;
  /** Whether prefers-reduced-motion is active. */
  reducedMotion: boolean;
  /** ui#20: renders as `data-scene-settled` on the viewport element — see
   *  Scene's own `settled` state doc comment for the full mechanism. */
  settled: boolean;
  /** F4 feature (e): flips Scene's internal slowMo override (debug overlay
   *  toggle only — see Scene's slowMoOverride state). */
  onToggleSlowMo: () => void;
  /** Called when the camera pan (cameraX animate() call) starts. */
  onTransitionStart: () => void;
  /** Called when the camera pan completes (guarded against stale completions
   *  from a superseded animate() call — see cameraTransitionTokenRef below). */
  onTransitionComplete: () => void;
  /** Called whenever the viewport dimensions change. */
  onViewportSizeChange: (size: ViewportDimensions) => void;
  /** Called whenever the focused content's target bounds are (re)measured. */
  onTargetChange: (target: CameraRect) => void;
  /**
   * Scene's own column registry (ui#17 target-derived camera aiming) —
   * the same Map registerColumn writes into, keyed by column name. Read
   * by the camera-recentering effect below to compute the focused span's
   * final left/width from each column's own owned-channel width/margin
   * TARGETS (known synchronously at the focus-change commit) instead of
   * measuring the DOM (which mid-transition reflects a layout about to
   * stop existing, not the one the camera needs to aim at). Passed as a
   * ref, not a snapshot — SceneViewport reads its CURRENT contents at
   * the moment the effect runs, same "always current, never stale" shape
   * every other ref-based measurement in this file already uses.
   */
  columnRegistryRef: React.RefObject<Map<string, RegisteredColumn>>;
}) {
  const { debug, columnGap, padding, duration, stiffness, damping, perspective, slowMo, touchPower, touchTimeConstant } = useSceneConfig();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportDimensions>({ top: 0, left: 0, width: 0, height: 0 });
  const scrollCommandRegistry = useContext(ScrollCommandRegistryContext);
  // A4: distinguishes Scene's true first paint from a later re-render, so the
  // stageLeft effect below can gate its FIRST drive of cameraX to a `.jump()`
  // instead of an animate() spring — mirrors SceneColumn's own mountInitial/
  // topOffsetMV first-paint gating (see SceneColumn.tsx).
  const firstPaintRef = useContext(SceneFirstPaintContext);

  // Counter tracking how many Motion animations are currently in flight.
  // Tracks in-flight DECLARATIVE `animate`-prop transitions on SceneColumn's
  // own divs (opacity/x/y/filter, marginTop) via onStart/onEnd below — ui#17
  // removed Motion's `layout` FLIP prop entirely, so it's no longer one of
  // these. NOT used to gate the debug outline rAF loop anymore (F6 item 1
  // fix — SceneObjectOutlines now runs continuously while mounted; this
  // counter never covered the S3+ imperative motion pipeline in the first
  // place, which is why the outline went stale). Using a ref (not state) so
  // increment/decrement don't trigger React re-renders.
  const animatingRef = useRef(0);

  // motionSeam: reads whatever a TEST harness has already wrapped
  // MotionSeamContext.Provider with (S7 pinning seam — see motionSeam.ts),
  // falling back to a Scene-owned recorder when `debug` is enabled and no
  // test recorder is present. This powers the debug overlay's active-springs
  // panel below without disturbing the test-pinning use case: a test's own
  // recorder always wins when present, and production (debug=false) always
  // resolves to null exactly as before this feature existed. The combined
  // value is re-provided via MotionSeamContext.Provider around this
  // component's return so descendant SceneColumns/SceneObjects (which read
  // it via their own useMotionSeam() calls) see the same recorder Scene
  // itself registers cameraX into, below.
  const outerMotionSeam = useContext(MotionSeamContext);
  const debugMotionRecorderRef = useRef<DebugMotionRecorder | null>(null);
  if (debug && !outerMotionSeam && !debugMotionRecorderRef.current) {
    debugMotionRecorderRef.current = createDebugMotionRecorder();
  }
  const motionSeam: MotionSeamRegistration | null =
    outerMotionSeam ?? (debug ? debugMotionRecorderRef.current : null);

  // Stable animation callbacks provided to the stage and (via context) to
  // SceneColumns. Only active in debug mode — callbacks are a no-op when
  // the context value is null.
  const animationCallbacks: AnimationCallbacks | null = debug
    ? {
        onStart: () => {
          animatingRef.current += 1;
        },
        onEnd: () => {
          animatingRef.current = Math.max(0, animatingRef.current - 1);
        },
      }
    : null;
  // stageLeft: the CSS `left` value of the absolutely-positioned stage div.
  // Adjusted each render to keep the focused region horizontally centered in
  // the viewport. When focused content overflows the viewport, stageLeft is
  // clamped so the focused region left-aligns at x=0 (padding-inset) — this
  // is the canonical/default camera target; ui#19's panOffset layer (below)
  // composes on top of it for user-driven panning.
  const [stageLeft, setStageLeft] = useState(0);
  // Mirrors stageLeft every render (precedent idiom: SceneColumn.tsx
  // maxScrollRef/contentHeightRef, ~793-794) — stable event-listener/input-
  // handler closures need the CURRENT canonical camera target at invocation
  // time, not whatever was captured when an effect last (re-)subscribed.
  const stageLeftRef = useRef(stageLeft);
  stageLeftRef.current = stageLeft;
  // ui#19 single-writer horizontal channel: panOffset is the user-driven pan
  // layer, owned entirely by JS input handlers (wheel/touch/keyboard — added
  // in later slices of this arc), composed as `cameraX = stageLeft +
  // clamp(panOffset, bounds)`. panOffset === 0 IS the "not currently panned"
  // state — no separate boolean, no arbitration state. Sign convention:
  // panOffset ranges [-range, 0], where 0 is the canonical (left-aligned in
  // overflow mode) position and -range is fully panned to reveal the
  // rightmost edge of the overflowing content — derived from the overflow
  // branch's `newStageLeft = -focusedNaturalLeft + padding` formula (moving
  // stageLeft further NEGATIVE reveals content further to the right), and
  // matches the `-focusedNaturalLeft` sign the position formula already
  // uses. A ref (not state) — panOffset changes on every drag/wheel tick,
  // far too often for a re-render.
  const panOffsetRef = useRef(0);
  // The valid panOffset range for the CURRENT focused layout — `{min, max}`
  // matching the sign convention above (min = -range, max = 0). Written at
  // the end of the recentering effect below (mirrors stageLeftRef's
  // declaration-site idiom), gated by the settling latch (vpWidthWasSettled,
  // declared further below, useSettledValue) exactly like the retired
  // overflowsX classification write used to be — see that latch's own
  // comment for why.
  const panBoundsRef = useRef({ min: 0, max: 0 });

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
  useEffect(() => {
    motionSeam?.registerMotionValue("cameraX", cameraX);
    return () => motionSeam?.unregisterMotionValue?.("cameraX");
  }, [motionSeam, cameraX]);

  // Routes every cameraX.jump()/animate() call site in this component
  // (driveCameraX's own recentering below, the touch-fling inertia, the
  // drag-start stop-jump — all driving the SAME MotionValue, sharing ONE
  // claim state) through Scene's aggregate settle counter, read here via
  // context since SceneViewport is a descendant of Scene's own
  // <SettleSignalContext.Provider> (below, in Scene's own JSX). This is
  // the specific fix for this round's named late mover: cameraX's own
  // corrective retarget (triggered BY the zero-crossing once width/
  // margin/columnWidth settle) previously wasn't itself tracked, so the
  // counter reached zero — and Scene re-measured — before the camera had
  // actually finished springing to the value that re-measurement
  // produced. See ownedAnimation.ts's own doc comment for the full
  // rationale.
  const ownedCameraAnimation = useOwnedAnimation();

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

  // Settling latch (ui#20 criterion 6: useSettledValue, shared with
  // SceneColumn's columnGeometryWasSettled), applied to viewport.clientWidth.
  // Originally gated the (now-retired) overflowsX classification write;
  // ui#19 repoints it to gate the panBoundsRef write below instead —
  // clientWidth can arrive across more than one real commit during
  // mount/resize settling (the content-box correction above,
  // ResizeObserver's own async callback), and a transient pan-bounds
  // miscalculation mid-settle would flap the clamp range a user could be
  // actively panning against. Position math (newStageLeft) is NOT gated by
  // this — it stays live every render. `checkVpWidthSettled` is called
  // below, inside the recentering effect, at the point `viewport.clientWidth`
  // is actually measured (a live DOM read, not a render-time value — see
  // useSettledValue's own doc comment for why this hook exposes a manual
  // check function rather than owning its own effect).
  const [vpWidthWasSettled, checkVpWidthSettled] = useSettledValue();

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
  //
  // F5 item 5 fix (H10 wobble, root cause found): width/height must be
  // CONTENT-BOX (matching the ResizeObserver callback below), not
  // getBoundingClientRect()'s BORDER-BOX. This viewport element toggles its
  // own `overflowX` between "auto"/"hidden" (see the stageLeft effect
  // below) — when a horizontal scrollbar is showing, border-box height
  // stays the element's full CSS height (a scrollbar doesn't shrink the
  // border box), while content-box height shrinks by the scrollbar's
  // thickness. This effect runs on EVERY render (no deps, by design, so a
  // dynamic resize is picked up as fast as possible) — probe-confirmed
  // (real classic/space-reserving scrollbars, which headless Chromium
  // normally suppresses via Playwright's own `--hide-scrollbars` default
  // arg): the ResizeObserver below correctly detects the scrollbar's
  // content-box shrinkage and calls setViewportSize with the smaller
  // (correct) height, but that state update itself triggers a re-render,
  // and THIS effect — reading the unchanged, scrollbar-oblivious
  // border-box height on every render — immediately overwrote the
  // correction back to the larger (wrong) value within the same commit
  // pair. The two measurement paths were fighting over two different box
  // models faster than any per-frame sampling could catch, and the
  // scrollbar-oblivious value always won (this effect runs on every
  // subsequent render; the observer only fires again on a genuine future
  // resize) — silently miscentering content (marginTop, maxScroll, and any
  // other effectiveViewportHeight-derived value) by the scrollbar's
  // thickness whenever one is showing. clientWidth/clientHeight are
  // content-box by definition (matching contentRect) — computed here as
  // the border-box rect's own float-precise width/height minus the
  // (integer) offset-vs-client delta, rather than clientWidth/clientHeight
  // directly, to avoid introducing a NEW, smaller oscillation from
  // clientHeight's own integer rounding disagreeing with contentRect's
  // subpixel-precise float on every render.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const { top, left, width, height } = el.getBoundingClientRect();
    const contentWidth = width - (el.offsetWidth - el.clientWidth);
    const contentHeight = height - (el.offsetHeight - el.clientHeight);
    setViewportSize((prev) =>
      prev.top === top && prev.left === left && prev.width === contentWidth && prev.height === contentHeight
        ? prev
        : { top, left, width: contentWidth, height: contentHeight },
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

  // ui#19: shared cameraX drive — the ONLY place any code should move
  // cameraX. Used below by the recentering effect (composed canonical +
  // pan target) AND by every input handler this arc adds (wheel/touch/
  // keyboard — each composes its own target from stageLeftRef + its
  // updated panOffsetRef and calls this). Deliberately UNGUARDED — no
  // "already animating toward this target" check, ever (cross-cutting ban;
  // see this file's viewport style comment for the regression this
  // shipped when a prior version of this codebase's absorb-and-re-pan
  // mechanism had exactly such a guard). Retargeting an in-flight spring
  // to the same destination is a stable no-op — motion's spring generator
  // inherits the live value's current velocity — matching SceneColumn.tsx
  // F17's driveBoundedSpring precedent.
  //
  // duration===0 raw DOM write (probe-caught while building the panOffset
  // layer): the stage JSX below binds `left` to the `stageLeft` REACT STATE
  // number under duration===0 (not the cameraX MotionValue, which only
  // backs `left` when duration!==0 — see the JSX). The recentering effect
  // ALSO calls setStageLeft alongside driveCameraX, so for canonical-only
  // moves this write is redundant with React's own re-render (harmless).
  // But pan-only calls (wheel/touch/keyboard, added later in this arc)
  // never touch stageLeft state at all — panning only moves panOffsetRef —
  // so without this write, `stage.style.left` would never visually reflect
  // a pan under duration===0 at all. Mirrors the (now-deleted) absorb-and-
  // re-pan correction handler's own identical duration===0 raw write.
  const driveCameraX = useCallback(
    (target: number) => {
      if (duration === 0) {
        cameraX.set(target);
        const stage = stageRef.current;
        if (stage) stage.style.left = `${target}px`;
      } else if (firstPaintRef.current) {
        ownedCameraAnimation.jump(cameraX, target);
      } else {
        const token = ++cameraTransitionTokenRef.current;
        onTransitionStart();
        const controls = ownedCameraAnimation.animateTo(cameraX, target, transition);
        motionSeam?.registerControls("cameraX", controls);
        motionSeam?.registerTarget?.("cameraX", target);
        controls.then(() => {
          if (cameraTransitionTokenRef.current === token) {
            onTransitionComplete();
          }
        });
      }
    },
    [duration, firstPaintRef, transition, motionSeam, onTransitionStart, onTransitionComplete, cameraX, ownedCameraAnimation],
  );

  // ui#19 slice (c): the ONE write path for panOffset (A2 — "panOffset has
  // one write path even with two event sources"). Every pan-driving input
  // handler in this arc (wheel, both touch triads added below) routes
  // through this — never writes panOffsetRef directly. Sets an ABSOLUTE
  // value (clamped against the live bounds), matching how 1:1 touch drag
  // naturally computes its target (drag-start baseline + total movement),
  // and how the wheel handler's own flush computes its next value before
  // calling this.
  const setPanOffset = useCallback(
    (value: number) => {
      const bounds = panBoundsRef.current;
      const clamped = Math.max(bounds.min, Math.min(bounds.max, value));
      if (clamped !== panOffsetRef.current) {
        panOffsetRef.current = clamped;
        driveCameraX(stageLeftRef.current + clamped);
      }
    },
    [driveCameraX],
  );

  // ui#19 slice (c): touch-release inertia fling for panning — scoped-down
  // horizontal analog of SceneColumn's startInertiaFlingRef (F13 commit 4);
  // no anchor="end" pinning or content-growth compensation concepts apply
  // to panning, so this is considerably simpler. Deliberately UNGUARDED
  // (cross-cutting ban) — re-issuing animate() on cameraX while a previous
  // fling/spring is still in flight is safe: motion's MotionValue.start()
  // stops any prior animation on the SAME value before starting the new
  // one (confirmed at source, motion-dom's value/index.mjs).
  const startPanFling = useCallback(
    (velocity: number) => {
      // Under duration===0 (test/instant mode), inertia has no meaningful
      // instant equivalent (mirrors SceneColumn's own vertical fling —
      // velocity is forced to 0 there under duration===0, an effective
      // no-op) — panOffset already sits wherever the drag left it (already
      // clamped via setPanOffset during the drag), so there's nothing
      // further to do.
      if (duration === 0 || velocity === 0) return;

      const bounds = panBoundsRef.current;
      const base = stageLeftRef.current;
      const token = ++cameraTransitionTokenRef.current;
      onTransitionStart();
      // A8 / F13 commit 4 precedent: deviates from a literal
      // animate(cameraX, undefined, {type:"inertia",...}) — probe-confirmed
      // (mirroring SceneColumn's own finding) that resolves internally to
      // keyframes=[null, undefined], finishing instantly without ever
      // running. An explicit single-element keyframes array with the
      // current value is required for inertia to actually decelerate.
      const controls = ownedCameraAnimation.animateTo(cameraX, [cameraX.get()], {
        type: "inertia",
        velocity,
        min: base + bounds.min,
        max: base + bounds.max,
        power: touchPower,
        timeConstant: touchTimeConstant,
        // Reuses Scene's configured spring constants for the boundary
        // bounce, matching SceneColumn's own rationale for its vertical
        // fling — a single consistent touch-release feel, not a third
        // unrelated set of magic numbers.
        bounceStiffness: stiffness,
        bounceDamping: damping,
        onUpdate: (latest) => {
          panOffsetRef.current = latest - stageLeftRef.current;
        },
      });
      motionSeam?.registerControls("cameraX", controls);
      controls.then(() => {
        if (cameraTransitionTokenRef.current === token) {
          onTransitionComplete();
        }
      });
    },
    [duration, cameraX, touchPower, touchTimeConstant, stiffness, damping, motionSeam, onTransitionStart, onTransitionComplete, ownedCameraAnimation],
  );

  const getPanOffset = useCallback(() => panOffsetRef.current, []);
  const getPanBounds = useCallback(() => panBoundsRef.current, []);
  const panControl = useMemo<PanControl>(
    () => ({ getPanOffset, getPanBounds, setPanOffset, startPanFling }),
    [getPanOffset, getPanBounds, setPanOffset, startPanFling],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage) return;

    const focusedCols = Array.from(
      stage.querySelectorAll<HTMLElement>("[data-column-focused='true']"),
    );

    // Single camera owner also owns the pan reset: any time the SET of
    // focused column names changes (DOM order is stable, so a plain
    // joined-names comparison is enough), reset panOffset to 0
    // synchronously, before paint (ui#19 — was `viewport.scrollLeft = 0`
    // pre-single-writer; the BEHAVIOR is unchanged, only the mechanism:
    // panOffset is now the sole horizontal user-pan channel, so resetting
    // IT is what "a still-overflowing newly-focused region starts at its
    // canonical left-aligned position, not wherever the user last panned
    // the OLD region to" means now). A stale panOffset calibrated to the
    // OLD focused region would otherwise permanently offset the new
    // content (B1). Runs even when transitioning to/from "nothing focused"
    // so a later return to the same set isn't mistaken for "unchanged".
    const focusedNames = focusedCols
      .map((col) => col.getAttribute("data-column") ?? "")
      .join(",");
    if (focusedNames !== prevFocusedNamesRef.current) {
      prevFocusedNamesRef.current = focusedNames;
      panOffsetRef.current = 0;
    }

    if (focusedCols.length === 0) {
      // No focused columns — keep stage at current position (camera stays
      // still), and leave the useCamera() target at its last measured value.
      return;
    }

    // Target-derived aiming (ui#17 cascade-fix round, ruled): a focus
    // commit collapses/grows column footprints by hundreds of px in one
    // step — geometry measured from the DOM at that exact commit is a
    // faithful read of a layout that's about to stop existing, not a
    // stale one (probe-confirmed: the DOM attribute driving this query
    // was already correct at the same commit; the WIDTH was the thing
    // mid-transition). Every owned channel already knows its OWN final
    // target synchronously at this same commit — computeFocusedWidth's
    // result for a focused column, the permanent zero-footprint target
    // (with its -columnGap margin compensation) for a decked one — so
    // walking the row's own targets, in DOM order, with the same flex
    // arithmetic the gap-math tests hand-verify (width, then margin
    // compensation, then one columnGap between adjacent columns, starting
    // from the stage's own left padding), gives the camera the TRUE final
    // left/width without ever measuring a mid-transition box. One retarget
    // per commit, aimed at the truth from the start, instead of a wrong
    // early measurement corrected later by the zero-crossing re-measure
    // below (which stays as the verification pass, not the primary aim).
    const allColumnEls = Array.from(stage.querySelectorAll<HTMLElement>("[data-column]"));
    const registry = columnRegistryRef.current;

    // Pre-pass (delta claim review, 2026-07-31): the index of the LAST
    // focused column, needed below to tell "an unresolved column that
    // might still matter" from "one that provably can't." INVARIANT: the
    // main walk only ever assigns targetLeft/targetRight from a FOCUSED
    // column's own cursor position — so no column past the last focused
    // one can change either value, and an unresolved widthTarget there is
    // safe to ignore rather than forcing a fallback for a rendering detail
    // the result will never read. One max-index scan; doesn't need
    // widthTarget to be resolved, only `.focused`.
    let lastFocusedIndex = -1;
    for (let i = 0; i < allColumnEls.length; i++) {
      const colName = allColumnEls[i]!.getAttribute("data-column") ?? "";
      if (registry.get(colName)?.focused) lastFocusedIndex = i;
    }

    let cursor = padding;
    let targetLeft: number | undefined;
    let targetRight: number | undefined;
    let missingTargetColumn: string | undefined;
    for (let i = 0; i < allColumnEls.length; i++) {
      const colName = allColumnEls[i]!.getAttribute("data-column") ?? "";
      const registered = registry.get(colName);
      if (registered === undefined || registered.widthTarget === undefined) {
        // Past the last focused column (see the pre-pass's own invariant
        // above): this column's own resolution status can never affect
        // targetLeft/targetRight, so stop silently — no fallback needed.
        // AT OR BEFORE it: this column (or a later one still to come)
        // could still be the span's own left/right edge, so an unresolved
        // target here forces the fallback. A prior version of this line
        // fell back (or didn't) based only on whether targetRight already
        // happened to be defined, which breaks when a LATER column is
        // ALSO focused and hasn't been walked yet (delta claim review,
        // 2026-07-31 — reproduced on a plain 3-column left/middle/right
        // toggle, unfocus direction: "right" stays focused throughout, but
        // "middle"'s own widthTarget is transiently unresolved the render
        // its focus state changes; the old shortcut broke immediately
        // after "left," computing targetRight=200 instead of the true
        // 416 — a 108px wrong first aim, self-correcting one render later
        // once "middle" resolves). A version that fell back UNCONDITIONALLY
        // on any unresolved target fixed that, but over-triggered the
        // fallback for an unresolved-but-irrelevant column past the last
        // focused one (e.g. an unfocused sibling with nothing focused
        // after it) — reintroducing the gBCR-measurement sub-pixel
        // discrepancy the already-regenerated visual baselines don't
        // expect, on fixtures that never needed the fallback for
        // correctness in the first place. The last-focused-index check is
        // exact: fall back only when it could possibly matter.
        if (i > lastFocusedIndex) break;
        missingTargetColumn = colName;
        break;
      }
      if (registered.focused && targetLeft === undefined) targetLeft = cursor;
      cursor += registered.widthTarget;
      // Every focused column keeps extending targetRight — a contiguous
      // multi-column focused span (or, matching the fallback's own
      // first-to-last semantics, a non-contiguous one) needs its RIGHTMOST
      // focused column's cursor, not its first. Fixed 2026-07-31: an
      // earlier version broke immediately after the FIRST focused column,
      // silently dropping every subsequent column of a multi-focus span.
      if (registered.focused) targetRight = cursor;
      cursor += registered.marginTarget;
      if (i < allColumnEls.length - 1) cursor += columnGap;
    }

    const stageRect = stage.getBoundingClientRect();
    let focusedNaturalLeft: number;
    let focusedWidth: number;
    // `missingTargetColumn` must also gate this branch, not just
    // targetLeft/targetRight's own definedness — a walk that broke early on
    // an unresolved column can ALREADY have both defined (e.g. a leading
    // focused column set them before the walk ever reached the hole),
    // which used to take this branch anyway with an incomplete span. See
    // the walk's own comment above for the reproduction this fixes.
    if (missingTargetColumn === undefined && targetLeft !== undefined && targetRight !== undefined) {
      focusedNaturalLeft = targetLeft;
      focusedWidth = targetRight - targetLeft;
    } else {
      // Fallback to measurement: a column between the stage's start and
      // the last focused one hasn't had its width target resolved yet
      // (the one-render "deferred measurement" window a never-focused
      // deck column's own first commit goes through — see
      // computeMeasuredWidth's own doc comment in SceneColumn). Self-
      // correcting (the NEXT render has a real target) — but empirically
      // this is ROUTINE, not rare: it fires on essentially every scene's
      // true first commit (geometryStore hasn't measured anything yet),
      // so it's worth being able to find without being noisy. console.warn
      // was tried first and reverted (gate-table round, 2026-07-31): it
      // fired often enough to pollute unrelated tests that spy on
      // console.warn for their OWN warnings (shadowing the expected
      // message, inflating unrelated call counts) — console.debug keeps
      // the same "named here, not silently absorbed" property without
      // that collision.
      if (missingTargetColumn !== undefined) {
        console.debug(
          `Scene: camera-recentering fell back to DOM measurement — column "${missingTargetColumn}" has no resolved width target yet.`,
        );
      }
      const first = focusedCols[0]!.getBoundingClientRect();
      const last = focusedCols[focusedCols.length - 1]!.getBoundingClientRect();
      // Column's natural offset within the stage flex layout. Subtracting
      // stageRect.left cancels out the current stageLeft offset, giving a
      // stable value that doesn't change across renders as the stage pans.
      focusedNaturalLeft = first.left - stageRect.left;
      focusedWidth = last.right - stageRect.left - focusedNaturalLeft;
    }

    const vpWidth = viewport.clientWidth;

    // Settling latch (see vpWidthWasSettled's declaration above,
    // useSettledValue): `vpWidthWasSettled` (captured at render time, before
    // this effect ran) reflects whether vpWidth was ALREADY settled entering
    // this commit — the render where clientWidth first repeats still counts
    // as not-yet-settled for ITS OWN panBoundsRef write below (same
    // one-render delay as SceneColumn's columnGeometryWasSettled), settling
    // takes effect starting next render. checkVpWidthSettled updates the
    // latch for the CURRENT value, for the NEXT render to see.
    checkVpWidthSettled(vpWidth);

    let newStageLeft: number;
    // Local branch decision only (ui#19 retired the overflowsX STATE this
    // used to drive — CSS overflow is now unconditionally clip; this still
    // decides which position formula applies, and (below) whether there's
    // any pan range to compute).
    let contentOverflows: boolean;
    if (focusedWidth <= vpWidth) {
      // Center the focused region in the viewport.
      newStageLeft = (vpWidth - focusedWidth) / 2 - focusedNaturalLeft;
      contentOverflows = false;
    } else {
      // Focused content overflows — inset it from the viewport's left edge
      // by exactly `padding` (Michael's symmetric-padding ruling: both
      // edges inset by the same amount, flush/flush at padding=0, a mix is
      // never valid). `focusedNaturalLeft` already includes the stage's own
      // CSS left padding (the flex column sits inside the padded content
      // box, so its rect is offset from the stage's border-box edge by that
      // padding) — a bare `-focusedNaturalLeft` cancels the padding
      // contribution entirely, landing the column flush at the viewport's
      // left edge instead of inset. Adding `padding` back re-establishes
      // the same inset the right edge already gets for free from the
      // stage's own CSS padding surviving into native scrollWidth.
      newStageLeft = -focusedNaturalLeft + padding;
      contentOverflows = true;
    }

    const stageLeftChanged = stageLeft !== newStageLeft;
    setStageLeft((prev) => (prev === newStageLeft ? prev : newStageLeft));

    // ui#19: fresh pan bounds for THIS render — used to clamp panOffsetRef
    // immediately below regardless of the settling latch (the latch only
    // governs panBoundsRef's own WRITE, for input handlers reading it
    // between renders; the camera's own immediate positioning this render
    // uses live geometry, matching how newStageLeft itself is never
    // latch-gated). Range must include `2 * padding`, not just the raw
    // overflow (focusedWidth - vpWidth) — probe-caught while restoring the
    // padding-cluster inset tests: at panOffset=0, newStageLeft's own
    // `+padding` already insets the LEFT edge by padding (leftInset =
    // padding, independent of range); reaching the symmetric RIGHT-edge
    // inset at full pan needs panOffset to travel the raw overflow amount
    // PLUS both paddings (the left inset the camera starts already holding,
    // and the right inset it still needs to gain) — omitting `2 * padding`
    // overshot the right inset by exactly that amount (measured: -4px
    // instead of +4px at padding=4, an 8px = 2×4 error; padding=0 masked it
    // entirely, which is why that case alone passed before this fix). 0
    // when content fits (no pan range at all). Sign convention documented
    // at panOffsetRef's declaration.
    const range = contentOverflows ? Math.max(0, focusedWidth - vpWidth + 2 * padding) : 0;
    const bounds = { min: -range, max: 0 };
    if (vpWidthWasSettled) {
      panBoundsRef.current = bounds;
    }

    // A1: a geometry-driven bounds shrink (e.g. a resize, or a sibling
    // column's content changing height, while the user is actively panned)
    // must clamp panOffsetRef itself, not just the drive target below —
    // otherwise the ref keeps pointing outside its own valid range, and a
    // LATER pan delta layered on top of it (wheel/touch, both compute
    // relative to the current panOffsetRef value) would compound from a
    // stale, out-of-range base. Without this, any stageLeftChanged-free
    // geometry re-measure mid-pan would silently discard the clamp and
    // leave the camera showing content past its own overflow bounds — the
    // exact "a resize/reflow discards the user's pan" bug class this
    // effect exists to prevent (see driveCameraX's own call below).
    const clampedPanOffset = Math.max(bounds.min, Math.min(bounds.max, panOffsetRef.current));
    const panWasClamped = clampedPanOffset !== panOffsetRef.current;
    panOffsetRef.current = clampedPanOffset;

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

    // Drive cameraX (via the shared driveCameraX above) whenever the
    // COMPOSED target — canonical stageLeft + the clamped pan layer — needs
    // to move: either the canonical position itself changed (stageLeftChanged,
    // same trigger as before ui#19: focus/layout changes), or panOffsetRef
    // was JUST clamped above (a bounds shrink discarding part of an active
    // pan — A1). Gated on one of those two, not on every render, for the
    // same reason as before ui#19: avoid restarting a spring toward its own
    // current target every render (this effect runs unconditionally every
    // render). Pan-driven target changes (wheel/touch/keyboard input, added
    // later in this arc) are NOT this effect's concern — those handlers
    // compose their own target and call driveCameraX directly; this effect
    // only reacts to LAYOUT-driven changes.
    //
    // A4 first-paint gate (inside driveCameraX): cameraX is seeded to 0
    // (useMotionValue(0) below), so on Scene's true first commit
    // stageLeftChanged is (almost) always true even though there is
    // nothing to actually TRANSIT from — the camera was never at 0, it
    // just hasn't been positioned yet. `.jump()` snaps it straight to rest
    // instead, mirroring SceneColumn's mountInitial/topOffsetMV first-paint
    // gating.
    if (stageLeftChanged || panWasClamped) {
      driveCameraX(newStageLeft + panOffsetRef.current);
    }
  });

  // Route wheel input: deltaY to a target column's registered command
  // applier (S5 — replaces the old `columnscroll` CustomEvent bridge),
  // deltaX to the camera's panOffset (ui#19 slice (b) — was left to native
  // overflow-x:auto scroll pre-single-writer; now JS-owned end to end, same
  // as deltaY always has been). Registered as non-passive so
  // preventDefault() is allowed — normalize -> decide -> apply all run
  // synchronously within the same event so preventDefault() timing is
  // preserved exactly as before. The two axes are independent: either can
  // be claimed, declined (interior island first refusal), or (deltaX only)
  // range-exhausted, and each decision is made separately per axis.
  //
  // F17 commit 2: wheel-driven deltas are BUFFERED (per column for deltaY,
  // as a single accumulator for deltaX — one pan target for the whole
  // Scene) and flushed as ONE write per real animation frame, rather than
  // one write per wheel event. Mechanism this closes (F17 commit 1's own
  // investigation, pinned at source): a real trackpad/wheel stream fires
  // MULTIPLE events per animation frame, and applying each one immediately
  // calls a spring-chase animate() call synchronously per event — so pairs
  // of retargets can land with ~0ms elapsed between them (measured: 72 of
  // 143 inter-retarget gaps were <1ms, in a 72-event stream, on the
  // deltaY/vertical path this pattern originates from). Motion's spring
  // generator inherits the CURRENT velocity as each retarget's starting
  // condition; a near-zero elapsed time between two retargets is exactly
  // the numerically unstable case for a velocity estimate
  // (Δvalue/Δtime, Δtime→0). Buffering to one retarget per real frame
  // removes the near-zero-Δt pairing at its source AND is a straightforward
  // perf win (one spring retarget instead of two-plus per frame during a
  // dense stream) — applies identically to the new deltaX/panOffset path.
  const pendingWheelDeltaRef = useRef<Map<string, number>>(new Map());
  const pendingPanDeltaRef = useRef(0);
  const wheelFlushScheduledRef = useRef(false);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const flushWheelDeltas = () => {
      wheelFlushScheduledRef.current = false;
      for (const [name, delta] of pendingWheelDeltaRef.current) {
        if (delta === 0) continue;
        const applyScrollCommand = scrollCommandRegistry.get(name);
        applyScrollCommand?.({ type: "scrollBy", delta });
      }
      pendingWheelDeltaRef.current.clear();

      const panDelta = pendingPanDeltaRef.current;
      pendingPanDeltaRef.current = 0;
      if (panDelta !== 0) {
        // Positive deltaX (native "scroll right" convention) reveals
        // content further to the right — panOffset moves toward its
        // negative end (bounds.min = -range; sign convention documented at
        // panOffsetRef's declaration), hence the subtraction.
        const bounds = panBoundsRef.current;
        const next = Math.max(bounds.min, Math.min(bounds.max, panOffsetRef.current - panDelta));
        if (next !== panOffsetRef.current) {
          panOffsetRef.current = next;
          driveCameraX(stageLeftRef.current + next);
        }
      }
    };

    const handler = (e: WheelEvent) => {
      if (e.deltaY === 0 && e.deltaX === 0) return;

      let claimedAnyAxis = false;

      if (e.deltaY !== 0) {
        // ctrlKey (pinch-zoom) -> null: never routed, never preventDefault-ed,
        // letting the browser's native pinch-zoom pass through untouched.
        const scaledDeltaY = normalizeWheelDelta(e, el.clientHeight);
        if (scaledDeltaY !== null) {
          // F8a interior claim gate: give a real interior scroll container
          // (e.g. a consumer's own overflow-y: auto island) first refusal
          // on the delta before Scene claims the event for column routing.
          // e.target is already the innermost element (the listener
          // bubbles from the viewport), so no elementFromPoint hit-test is
          // needed here.
          const eventColumn = (e.target as Element | null)?.closest("[data-column]") ?? null;
          const yConsumedByInterior =
            eventColumn && interiorCanConsume(e.target as Element, eventColumn, "y", scaledDeltaY);
          if (!yConsumedByInterior) {
            const column = decideWheelTargetColumn(el, e.clientX, e.clientY);
            const name = column?.getAttribute("data-column");
            const applyScrollCommand = name ? scrollCommandRegistry.get(name) : undefined;
            if (name && applyScrollCommand) {
              claimedAnyAxis = true;
              // F17 commit 2: buffer instead of applying immediately —
              // only the actual write is deferred to the next real
              // animation frame, coalescing however many wheel events land
              // in that frame into a single delta per column.
              const prevDelta = pendingWheelDeltaRef.current.get(name) ?? 0;
              pendingWheelDeltaRef.current.set(name, prevDelta + scaledDeltaY);
            }
          }
        }
      }

      if (e.deltaX !== 0) {
        const scaledDeltaX = normalizeWheelDeltaX(e, el.clientWidth);
        if (scaledDeltaX !== null) {
          // F8a horizontal twin (ui#19 slice (b), A4): same first-refusal
          // as deltaY, on the same eventColumn boundary — a consumer's own
          // overflow-x: auto island (e.g. a wide table/code block) gets to
          // consume its own horizontal wheel input before the camera does.
          const eventColumn = (e.target as Element | null)?.closest("[data-column]") ?? null;
          const xConsumedByInterior =
            eventColumn && interiorCanConsume(e.target as Element, eventColumn, "x", scaledDeltaX);
          if (!xConsumedByInterior) {
            // Range-exhaustion check: preventDefault semantics flip (ui#19
            // slice (b)) — JS now owns deltaX end to end, so claiming it
            // means preventDefault; but if panOffset is ALREADY at the
            // bound this delta would push further past, decline instead —
            // preserving today's observable native-scroll-chaining
            // behavior (the old overflow-x:auto viewport let the event
            // chain to a scrollable ancestor once scrollLeft maxed out;
            // there is no reason for this migration to newly dead-stop
            // that). Positive deltaX pushes toward bounds.min (see
            // flushWheelDeltas' own comment on the sign convention).
            const bounds = panBoundsRef.current;
            const atBound = scaledDeltaX > 0 ? panOffsetRef.current <= bounds.min : panOffsetRef.current >= bounds.max;
            if (!atBound) {
              claimedAnyAxis = true;
              pendingPanDeltaRef.current += scaledDeltaX;
            }
          }
        }
      }

      if (claimedAnyAxis) {
        e.preventDefault();
        if (!wheelFlushScheduledRef.current) {
          wheelFlushScheduledRef.current = true;
          requestAnimationFrame(flushWheelDeltas);
        }
      }
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [scrollCommandRegistry, driveCameraX]);

  // ui#19 slice (c): Scene-level touch pan triad (A2 architecture — covers
  // ONLY pointers no column's own triad claimed: stage background, parked
  // columns, non-scrollable focused columns). A column that DOES claim a
  // gesture calls stopPropagation() at pointerdown (see SceneColumn's
  // handleContentPointerDown), so this triad never sees those — ONE
  // classifier decision per gesture, no mid-gesture handoff, no second
  // independent classification of the same stream (A2's explicit
  // requirement). No vertical/horizontal disambiguation needed here (unlike
  // the column's own triad) — anything reaching this level has no
  // competing vertical interpretation, so TOUCH_DIRECTION_SLOP_PX gates
  // "is this a real pan gesture, not a tap", not an axis choice.
  const panDragStartX = useRef(0);
  const panDragStartOffset = useRef(0);
  const panIsDraggingRef = useRef(false);
  const panCommittedRef = useRef(false);
  const panVelocitySamplesRef = useRef<VelocitySample[]>([]);

  const handleViewportPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      panIsDraggingRef.current = true;
      panCommittedRef.current = false;
      panDragStartX.current = e.clientX;
      // Stop any in-flight fling/spring before 1:1 tracking begins, so
      // tracking starts from wherever the camera visually IS — mirrors
      // SceneColumn's handleContentPointerDown rationale for the vertical
      // axis (jump(), not stop() — resets Motion's internal velocity
      // tracking too, not just the animation, avoiding a residual-velocity
      // re-fling defect on a quick re-grab).
      ownedCameraAnimation.jump(cameraX, cameraX.get());
      panDragStartOffset.current = panOffsetRef.current;
      panVelocitySamplesRef.current = [];
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [cameraX, ownedCameraAnimation],
  );

  const handleViewportPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!panIsDraggingRef.current) return;
      const dx = e.clientX - panDragStartX.current;
      if (!panCommittedRef.current) {
        if (Math.abs(dx) < TOUCH_DIRECTION_SLOP_PX) return;
        panCommittedRef.current = true;
      }
      // 1:1 finger tracking: finger moves left (dx negative) -> content
      // attached to finger moves left -> panOffset decreases (reveals
      // further-right content) — same sign convention as the wheel
      // handler's own deltaX handling.
      setPanOffset(panDragStartOffset.current + dx);
      panVelocitySamplesRef.current.push({ t: performance.now(), offset: panOffsetRef.current });
    },
    [setPanOffset],
  );

  const handleViewportPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!panIsDraggingRef.current) return;
      panIsDraggingRef.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      // Skipped in instant mode — inertia has no meaningful instant
      // equivalent (mirrors SceneColumn's own vertical release handling).
      const velocity =
        duration === 0 ? 0 : computeReleaseVelocity(panVelocitySamplesRef.current, performance.now());
      startPanFling(velocity);
    },
    [duration, startPanFling],
  );

  // Native (non-passive) touchmove listener — React's synthetic pointer/
  // touch event system can't reliably do passive:false (mirrors
  // SceneColumn's own F13 commit 1 rationale exactly: a preventDefault()
  // that actually blocks the browser's native page-pan requires a listener
  // attached directly to the DOM node). Blocks the browser's native
  // horizontal page-pan once a gesture has committed to panning; multi-
  // touch (pinch) is never blocked, mirroring shouldPreventTouchMove's own
  // exemption for the vertical axis.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleNativeTouchMove = (e: TouchEvent) => {
      if (panCommittedRef.current && e.touches.length === 1) {
        e.preventDefault();
      }
    };
    el.addEventListener("touchmove", handleNativeTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", handleNativeTouchMove);
  }, []);

  // ui#19 slice (d): keyboard parity for horizontal panning — replaces the
  // implicit browser freebie (a focused native overflow-x:auto container
  // responding to ArrowLeft/ArrowRight/Home/End) that died under
  // overflow-x:clip (slice (a)). Mirrors SceneColumn's own vertical
  // keyboard handler shape exactly (mapScrollKeyToCommand/
  // isInteractiveElement — DELTA-1's curated exemption gate, reused as-is
  // rather than re-derived), gated on there being any pan range at all
  // (mirrors that handler's own maxScrollRef.current <= 0 early return).
  // Judged a11y criterion per the spec — this is DELIBERATELY minimal
  // parity, not new UX: no PageUp/PageDown/Space equivalent (the design
  // only calls for ArrowLeft/ArrowRight/Home/End). Home/End can ALSO fire
  // a column's own vertical Home/End handler for the same keydown (no
  // stopPropagation on either side) — accepted as consistent with native
  // browsers' own inconsistent multi-axis Home/End behavior, not a new
  // conflict this migration introduces.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handler = (e: KeyboardEvent) => {
      if (panBoundsRef.current.min === 0) return; // no pan range to speak of
      if (isInteractiveElement(e.target as Element)) return;

      const cmd = mapPanKeyToCommand(e.key);
      if (!cmd) return; // Not a pan key — don't intercept

      if (cmd.type === "panBy") {
        setPanOffset(panOffsetRef.current + cmd.delta);
      } else if (cmd.type === "panToHome") {
        setPanOffset(0);
      } else {
        setPanOffset(panBoundsRef.current.min);
      }
      e.preventDefault();
    };

    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [setPanOffset]);

  // ui#19 slice (d): mount-time-only ancestor-chaining check (see
  // warnAncestorScrollChaining's own doc comment above for the full
  // rationale). Deliberately unconditional (not gated on a dev/prod
  // env check) — mirrors this file's own warnStrayChild precedent, which
  // has no such gate either; both are cheap, one-shot, developer-facing
  // structural warnings, not a hot-path concern.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    warnAncestorScrollChaining(el);
  }, []);

  // History (DELTA-2 -> absorb-and-re-pan -> ui#19 single-writer): the
  // browser's native focus-driven auto-scroll (and other native scrollLeft
  // mutations) used to bypass the camera's own stageLeft pan and corrupt
  // scrollLeft (DELTA-2, probe-confirmed: tab-focusing a parked column
  // jumped scrollLeft 0 -> 782 with stage.left unchanged). A bare
  // `el.scrollLeft = 0` reset-on-focusin fix (DELTA-2) restored the correct
  // final position but, being itself a native scroll mutation landing
  // mid-click-gesture, measurably ate clicks in the consuming app (21/21 +
  // 27/27 + 24/24 across three N=20 loops). An interim "absorb-and-re-pan"
  // fix (reset scrollLeft to 0 while simultaneously compensating stage.left
  // by the same delta, then explicitly re-pan via Motion) closed that but
  // remained a two-writer system — native scrollLeft AND the camera both
  // able to move the viewport horizontally, correction code needed to keep
  // them reconciled, and a Promise/`.then()`-tracked in-flight guard in
  // that reconciliation shipped a real regression (the camera permanently
  // stranded ~450px off canonical when a second correction jump()-cancelled
  // the first's still-in-flight re-pan spring before its `.then()` could
  // fire and clear the guard).
  //
  // ui#19 removes the SECOND writer entirely instead of reconciling it: the
  // viewport is unconditionally `overflow: clip` on both axes (see the
  // style block below) — probe-confirmed bulletproof against every native
  // scrollLeft mutation technique (direct writes, scrollIntoView, focus-
  // driven auto-scroll, mid-gesture corruption attempts all no-op, read-
  // back stays 0, zero visual shift) — so there is no corrupted scrollLeft
  // to ever reconcile, and no correction handler is needed at all. The
  // camera (stageLeft + the panOffset layer, added later in this arc) is
  // now the SOLE horizontal-position writer. The cross-cutting lesson from
  // the stranded-camera regression — no Promise/`.then()`-tracked "already
  // animating" guards; idempotent re-issue instead (SceneColumn.tsx F17's
  // driveBoundedSpring pattern) — carries forward as a standing rule for
  // every cameraX-driving function this arc adds.

  return (
    <MotionSeamContext.Provider value={motionSeam}>
    <AnimationCallbackContext.Provider value={animationCallbacks}>
    <ViewportContext.Provider value={viewportSize}>
    <PanControlContext.Provider value={panControl}>
      {/* Viewport: the clipping window. position:relative establishes the
          containing block for the absolutely-positioned stage.
          ui#19 single-writer horizontal channel: overflow is
          unconditionally clip on BOTH axes — never auto, never hidden.
          This is a HARD requirement, not a style preference: CSS Overflow
          3's degradation rule collapses `clip` back to `hidden` (silently
          resurrecting the old scroll-container bug) whenever the OTHER
          axis is anything but `visible` or `clip` itself — probe-verified
          (ui#19 spike): overflow-x:clip + overflow-y:hidden computed to
          hidden/hidden, not clip/clip. Both axes must change together, in
          the same edit, forever. Native scrollLeft/scrollTop are now
          structurally impossible (probe-confirmed bulletproof: direct
          writes, scrollIntoView, focus-driven auto-scroll, and mid-
          gesture corruption attempts all no-op, read-back stays 0, zero
          visual shift) — the camera (stageLeft + panOffset) is the SOLE
          horizontal-position writer. See :3594's test for the regression
          pin on this exact computed-style pair.

          MOUNTING CONTRACT: this immunity is local to Scene's own
          viewport element — it says nothing about ancestors. A consumer
          that mounts Scene inside its own horizontally-scrollable
          container reopens the identical corruption class one DOM level
          up (a browser focus-driven auto-scroll that can't move Scene's
          clipped viewport chains to the next real scroll container
          instead), just outside Scene's control. See
          warnAncestorScrollChaining above for the dev-mode mount-time
          check of this assumption. */}
      <div
        ref={viewportRef}
        data-testid="scene"
        data-reduced-motion={reducedMotion ? "" : undefined}
        data-scene-settled={String(settled)}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onPointerCancel={handleViewportPointerUp}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          overflowX: "clip",
          overflowY: "clip",
          // F8b interior contract: NO touch-action restriction at this
          // level. touch-action resolves as the INTERSECTION of an
          // element's own value and every ancestor's up to the nearest
          // gesture-owning ancestor — a descendant can never LOOSEN a
          // restriction declared here, so a blanket declaration on this
          // element (as it used to be: "pan-x pinch-zoom") permanently
          // blocked vertical touch-pan for every descendant in the whole
          // scene, including a consumer's own interior overflow-y:auto
          // scroll island (the F8b bug — the touch-side twin of F8a's
          // wheel bug). "auto" here means this element imposes nothing;
          // the vertical-pan exclusion that used to live here now lives
          // on each column's own content wrapper (SceneColumn.tsx,
          // [data-column-content]), scoped to that column being
          // Scene-scrollable — so it restricts only the column that
          // needs to own vertical drag, never anything else in the tree.
          // Horizontal camera pan note (ui#19 slices (c)/(d), settled):
          // "auto" here is not stale — it never needs to change for
          // horizontal panning. touch-action only governs the browser's
          // OWN native scroll gesture; ui#19 blocks that gesture the same
          // way SceneColumn's F13 vertical drag does (not via touch-
          // action), with a non-passive `touchmove` listener below that
          // calls preventDefault() once a horizontal drag commits (see
          // handleNativeTouchMove). The actual panning motion is driven
          // entirely by this file's own pointer-event triad
          // (handleViewportPointerDown/Move/Up) writing panOffset — touch-
          // action plays no role in producing the pan itself, only in
          // suppressing the browser's competing native one.
          touchAction: "auto",
          outline: debug ? "2px solid cyan" : undefined,
          // ui#19: scrollbarWidth/scrollbarColor and the H10 scrollbar-
          // gutter investigation both REMOVED — both were about styling
          // and clientHeight-wobble concerns for a horizontal scrollbar
          // that toggled on/off with the old overflow-x:auto/hidden
          // scheme. Under unconditional overflow-x:clip, this element can
          // never have ANY scrollbar under any circumstance (clip never
          // establishes a scroll container, full stop) — both concerns
          // are now structurally moot, not just empirically rejected. The
          // full H10 writeup (the historical record of why
          // scrollbar-gutter:stable was tried and rejected) lived in this
          // comment block pre-ui#19; see git history if that
          // investigation is ever relevant again.
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
            to the viewport, not the panning stage.
            Wrapped in a clipping layer pinned exactly to the viewport's own
            box (F4 purity fix): each outline's name label is a
            width-unconstrained <span> that can overflow its own outline
            box when the object's name is long/unbreakable — and since
            scrollWidth/scrollHeight report the full overflow extent even
            under overflow:hidden (only the visible scrollbar is
            suppressed, not the JS-observable metric), an unclipped label
            widened the viewport's own scroll extent in debug mode only —
            the "Debug does not affect layout" scenario (spec:
            scene-debug.feature) is violated by real content, the same
            CameraDebug-incident class documented on warnStrayChild above,
            just via a different mechanism (an overflowing debug-only
            child, not a stray flex-row child). overflow: hidden here
            clips ANY debug-only overflow (label text, or a future outline
            rendering change) at the viewport's own edge, so it can never
            propagate to the viewport's own scrollWidth/scrollHeight —
            structurally closing the whole class, not just the label case
            this was caught by. */}
        {debug && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            <SceneObjectOutlines viewportRef={viewportRef} />
            <StageBoundsOutline viewportRef={viewportRef} stageRef={stageRef} />
            <StrayChildFlags viewportRef={viewportRef} stageRef={stageRef} />
            <PaintOrderBadges viewportRef={viewportRef} stageRef={stageRef} />
          </div>
        )}
        {/* Overlay is inside the scene div so tests can find it via
            scene.querySelector('[data-debug-overlay]'). position:fixed
            ensures it doesn't participate in flex layout. */}
        {debug && (
          <SceneDebugOverlay
            columnStacks={debugColumnStacks ?? []}
            viewportRef={viewportRef}
            stageRef={stageRef}
            motionRecorder={debugMotionRecorderRef.current}
            slowMo={slowMo}
            onToggleSlowMo={onToggleSlowMo}
          />
        )}
      </div>
    </PanControlContext.Provider>
    </ViewportContext.Provider>
    </AnimationCallbackContext.Provider>
    </MotionSeamContext.Provider>
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
  touchPower = DEFAULT_TOUCH_POWER,
  touchTimeConstant = DEFAULT_TOUCH_TIME_CONSTANT,
  perspective = DEFAULT_PERSPECTIVE,
  peekOffset = DEFAULT_PEEK_OFFSET,
  onTransitionEnd,
}: SceneProps) {
  const wrappedChildren = React.Children.map(children, wrapChild);

  // Detect prefers-reduced-motion. When active and no explicit duration prop
  // is provided, force duration=0 so all transitions are instant.
  const prefersReducedMotion = useReducedMotion() ?? false;
  const effectiveDuration = prefersReducedMotion && duration === undefined ? 0 : duration;

  // F4 feature (e) live slowMo toggle: an internal override the debug
  // overlay can flip without the consumer changing the `slowMo` prop. null
  // means "no override, defer to the prop" — the toggle flips whatever is
  // CURRENTLY effective, so a consumer already passing slowMo=true sees the
  // panel start in the "on" state and can still toggle it off. Only ever
  // read by SceneViewport/SceneColumn/SceneObject via useSceneConfig()'s
  // `slowMo` field below (computeSceneTransition, the shared spring-params
  // helper) — it composes for free: the transition object is recomputed
  // every render from whatever `slowMo` currently resolves to, and Motion's
  // animate() captures its transition argument at CALL time, so flipping
  // this only ever affects the NEXT transition a component starts — nothing
  // needs to reach into and retarget an in-flight spring's parameters.
  const [slowMoOverride, setSlowMoOverride] = useState<boolean | null>(null);
  const effectiveSlowMo = slowMoOverride ?? slowMo;

  // Track whether the camera pan is currently in flight (useCamera()
  // `transitioning`). Set via callbacks wired to the cameraX animate() call
  // in SceneViewport's stageLeft effect.
  const [transitioning, setTransitioning] = useState(false);

  // Aggregate settle-signal counter (see SettleSignalContext's own doc
  // comment for the full rationale, including why this replaced a
  // fire-per-settle-event version). activeAnimationCountRef is the number
  // of owned channels (across every column, AND SceneViewport's own
  // cameraX — see ownedCameraAnimation there) currently mid-transition;
  // only the transition INTO zero bumps the render-triggering state below
  // — a re-render while the count is still positive would re-measure
  // geometry that hasn't actually reached its final state yet. The count
  // itself is never rendered (a ref, not state) — bumpSettleSignal's own
  // value is never read anywhere either; bumping it is the entire
  // mechanism (React re-renders Scene, which re-renders SceneViewport as
  // a plain child, which re-runs its own no-deps camera-recentering
  // effect against the now-truly-settled geometry). useMemo keeps the
  // context value referentially stable across renders that don't touch
  // it, avoiding a spurious re-provide on every unrelated Scene render.
  const activeAnimationCountRef = useRef(0);
  const [, bumpSettleSignal] = useState(0);
  // `data-scene-settled` (ui#20, criterion 1): true iff no owned animation
  // is currently active — genuine React state (not just the ref above),
  // flipping false the instant a channel claims (the ref's 0->1 crossing)
  // and true again on the existing zero-crossing. Mechanism-broad by
  // design: ANY owned channel claiming flips this, including a non-focus-
  // driven settle (e.g. an unrelated content-resize spring) — see
  // `transitionPending` below for the narrower, focus-transition-scoped
  // signal `onTransitionEnd` actually gates on. Never flips false at
  // duration=0 (jump() never claims — see ownedAnimation.ts's `ownedJump`),
  // which is vacuously correct per this attribute's own "no animation
  // active" wording. Structurally excludes SceneColumn's own vertical
  // scroll inertia (scrollY never routes through this seam — a deliberate,
  // pre-existing exclusion, see SettleSignalContext's own doc comment).
  const [settled, setSettled] = useState(true);
  // `transitionPending` (ui#20, criteria 3/4/8/9): true from mount
  // (entrance) or any FOCUS-arrangement change, cleared on the same
  // zero-crossing `settled` above uses. Deliberately a DIFFERENT signal
  // from `settled` on the SET side (this only goes true for a focus-
  // arrangement change or mount, not any owned-channel claim) while
  // SHARING the clear side (both clear on the raw global zero-crossing) —
  // see the ACCEPTED TRADEOFF paragraph on the settle effect below for why
  // a per-transition claim tag was rejected in favor of this. Drives
  // inertness scene-wide via TransitionPendingContext (SceneObject.tsx):
  // in-transition = fully inert, matching Michael's ruled three-state
  // contract. `pendingIsFocusTransitionRef` tracks whether the CURRENT
  // pending window was armed by an actual focus change (vs. pure mount
  // entrance) — only that case fires `onTransitionEnd` on clear.
  const [transitionPending, setTransitionPending] = useState(true);
  // Ref mirror of `transitionPending`, kept in lockstep at the top of every
  // render (mirrors this file's own stageLeftRef/columnStatesFingerprintRef
  // idiom) — the settle effect below needs a synchronous, same-commit read
  // of "is pending" that doesn't wait for a re-render, since it may both
  // ARM and CLEAR pending within the very same commit (the duration=0 path
  // — see F3's unified fire rule). ALSO re-provided via
  // TransitionPendingRefContext — probe-confirmed real race (not a
  // precaution): SceneObject's two-phase focus effect can observe
  // TransitionPendingContext's own reactive boolean mid-stale, one render
  // generation behind this ref, because a state update from inside a
  // layout effect (this one arming `transitionPending` true) forces React
  // to flush a descendant's PASSIVE effect for the pre-correction commit
  // before the corrective re-render's own layout phase runs — see
  // TransitionPendingRefContext's own doc comment for the full trace.
  const transitionPendingRef = useRef(transitionPending);
  transitionPendingRef.current = transitionPending;
  const pendingIsFocusTransitionRef = useRef(false);
  // The last object-level focus-arrangement fingerprint this Scene instance
  // has SEEN (not necessarily fired on) — `null` until the first commit's
  // fingerprint is captured, so mount never misreads as "the arrangement
  // changed" (there is no prior arrangement to diff against yet).
  const focusArrangementFingerprintRef = useRef<string | null>(null);
  const onTransitionEndRef = useRef<SceneProps["onTransitionEnd"]>(undefined);
  const onColumnGeometrySettled = useMemo<SettleSignal>(
    () => ({
      animationStarted: () => {
        if (activeAnimationCountRef.current === 0) {
          setSettled(false);
        }
        activeAnimationCountRef.current++;
      },
      animationEnded: () => {
        // Floored at 0, never negative: an unmatched extra `animationEnded`
        // call (a bug elsewhere — every real call site is paired 1:1 with
        // its own `animationStarted`, audited in SceneColumn/SceneObject/
        // SceneViewport) would otherwise push the count below zero, and
        // the NEXT genuine start+end pair would then land on -1/0 forever
        // instead of 1/0 — silently and PERMANENTLY wedging the camera's
        // own re-measure, the exact failure this counter exists to avoid.
        // The warning keeps that bug visible without letting it wedge
        // anything at runtime.
        if (activeAnimationCountRef.current <= 0) {
          console.warn("SettleSignalContext: animationEnded called with no matching animationStarted — a channel's start/end pair is unbalanced.");
          activeAnimationCountRef.current = 0;
          return;
        }
        activeAnimationCountRef.current--;
        if (activeAnimationCountRef.current === 0) {
          bumpSettleSignal((c) => c + 1);
          setSettled(true);
        }
      },
    }),
    [],
  );

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

  onTransitionEndRef.current = onTransitionEnd;

  // ui#20 settle-transition tracking: arms `transitionPending` on a focus-
  // arrangement change, clears it (and fires `onTransitionEnd`) on the
  // scene's true global quiet point. Runs every commit (no deps), AFTER
  // every descendant SceneColumn/SceneObject has registered/claimed for
  // this commit (useLayoutEffect ordering is bottom-up) — so by the time
  // this runs, `columnRegistryRef` already reflects this commit's fresh
  // per-object focus states, and `activeAnimationCountRef` already
  // reflects whatever channels this commit's own focus change claimed
  // (the animate() path) or didn't (the duration=0/jump path, F3).
  //
  // Object-level, not column-level (deliberate fork from the plan's own
  // "reuse columnStatesFingerprintRef literally" recommendation): a
  // within-column swap (ui#21's whole feature) never changes a column's
  // own aggregate `focused` boolean, so a column-level fingerprint would
  // silently miss it — RegisteredColumn.objectStates (ColumnRegistryContext,
  // registry-derived, Fragment-safe) is what makes the finer-grained
  // fingerprint possible without a DOM query.
  //
  // ACCEPTED TRADEOFF (F4 REVISION v3): transitionPending's CLEAR condition
  // is the RAW GLOBAL zero-crossing, shared with `data-scene-settled` —
  // NOT a per-transition claim tag. A focus change landing while an
  // unrelated ambient channel (e.g. a sibling's content-growth spring) is
  // still mid-flight extends the pending window until the true global
  // quiet point, delaying `onTransitionEnd` and the settle-edge descendant
  // focus (SceneObject's own two-phase focus effect) until then. Accepted
  // rather than fixed with per-transition claim tracking: distinguishing
  // transition-caused claims from ambient ones needs an arming window
  // spanning the multi-commit re-layout cascade — exactly the class of
  // fragile-tag race that produced the ui#17 cascade fix this mechanism
  // reuses; the overlap is self-limiting (touch flings — the only
  // long-tail ambient channel — die at pointerdown before a click-to-focus
  // can land, and mouse ambient motion is sub-second keyboard-pan/
  // content-growth), and the scene is scene-wide inert during any focus
  // transition regardless, so the tradeoff only extends the settle TAIL.
  useLayoutEffect(() => {
    const arrangement: SceneFocusArrangementEntry[] = columnStates.flatMap(
      (c) => columnRegistryRef.current.get(c.name)?.objectStates ?? [],
    );
    const fingerprint = arrangement.map((o) => `${o.name}:${o.focused}`).join(",");

    if (focusArrangementFingerprintRef.current !== null && fingerprint !== focusArrangementFingerprintRef.current) {
      pendingIsFocusTransitionRef.current = true;
      if (!transitionPendingRef.current) {
        transitionPendingRef.current = true;
        setTransitionPending(true);
      }
    }
    focusArrangementFingerprintRef.current = fingerprint;

    if (transitionPendingRef.current && activeAnimationCountRef.current === 0) {
      transitionPendingRef.current = false;
      setTransitionPending(false);
      if (pendingIsFocusTransitionRef.current) {
        // Defensive only, not load-bearing: the only other write site is
        // the arm block above, which always freshly sets this true
        // immediately before it's read again — reaching this fire branch a
        // second time requires transitionPendingRef.current to be true
        // again first, which (given the line above resets it false on
        // every pass through this block) only happens via a fresh arm.
        // Kept for clarity/resilience against a future refactor that
        // decouples the two refs, not because removing it changes
        // observable behavior today.
        pendingIsFocusTransitionRef.current = false;
        onTransitionEndRef.current?.(arrangement);
      }
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
      value={{ stiffness, damping, touchPower, touchTimeConstant, perspective, padding, columnGap, peekOffset, duration: effectiveDuration, debug, slowMo: effectiveSlowMo }}
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
          <SettleSignalContext.Provider value={onColumnGeometrySettled}>
          <TransitionPendingContext.Provider value={transitionPending}>
          <TransitionPendingRefContext.Provider value={transitionPendingRef}>
            <SceneViewport
              debugColumnStacks={debugColumnStacks}
              reducedMotion={prefersReducedMotion}
              columnRegistryRef={columnRegistryRef}
              settled={settled}
              onToggleSlowMo={() => setSlowMoOverride((prev) => !(prev ?? slowMo))}
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
          </TransitionPendingRefContext.Provider>
          </TransitionPendingContext.Provider>
          </SettleSignalContext.Provider>
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
