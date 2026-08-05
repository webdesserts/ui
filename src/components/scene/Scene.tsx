import React, { createContext, isValidElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SceneColumn } from "./SceneColumn";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import { SceneConfigContext, useSceneConfig, DEFAULT_STIFFNESS, DEFAULT_DAMPING, DEFAULT_TOUCH_POWER, DEFAULT_TOUCH_TIME_CONSTANT, DEFAULT_COLUMN_GAP, DEFAULT_PERSPECTIVE, DEFAULT_PEEK_OFFSET } from "./useSceneConfig";
import { CameraContext, type CameraRect } from "./useCamera";
import { ViewportContext, type ViewportDimensions } from "./ViewportContext";
import { ColumnPositionContext } from "./ColumnPositionContext";
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
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import type { DebugColumnStackEntry } from "./debug/types";
import { StageBoundsOutline } from "./debug/StageBoundsOutline";
import { StrayChildFlags } from "./debug/StrayChildFlags";
import { PaintOrderBadges } from "./debug/PaintOrderBadges";
import { SceneObjectOutlines } from "./debug/SceneObjectOutlines";
import { SceneDebugOverlay } from "./debug/SceneDebugOverlay";
import { createDebugMotionRecorder, type DebugMotionRecorder } from "./debug/motionRecorder";
import {
  collectColumnFocusStates,
  deriveColumnStatesFromRegistry,
  computeColumnPositions,
  computeStackDepths,
} from "./sceneLayout";

// Re-exported for module-surface stability: these were `export function`
// declarations directly in this file before the sceneLayout.ts extraction.
export { computeColumnPositions, computeStackDepths } from "./sceneLayout";

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
   * post-commit — the same crossing `data-ui-scene-settled` flips true on).
   * Payload is the settled focus arrangement: every registered SceneObject
   * across every column, in DOM order, with its final `focused` state.
   *
   * Does NOT fire on the initial mount's pure-entrance settle (no focus
   * change occurred), and does NOT fire for a non-focus-driven settle
   * (e.g. an unrelated content-resize spring quieting down) — narrower
   * than `data-ui-scene-settled`, which is mechanism-broad (false while ANY
   * owned animation channel is claimed, focus-driven or not). Reduced-motion
   * / `duration={0}` focus changes DO fire (synchronously, before the
   * browser's next paint) — a silent no-fire there would break every
   * consumer on the accessibility path.
   *
   * Structurally excluded: SceneColumn's own vertical scroll inertia
   * (wheel/touch/keyboard scrolling within a focused column) never claims
   * through the settle-signal seam and is not a "focus transition" in the
   * first place, so it never triggers this callback.
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
  /** ui#20: renders as `data-ui-scene-settled` on the viewport element — see
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
  // Mirrors stageLeft every render (precedent idiom: SceneColumn.tsx's
  // maxScrollRef/contentHeightRef) — stable event-listener/input-handler
  // closures need the CURRENT canonical camera target at invocation time,
  // not whatever was captured when an effect last (re-)subscribed.
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
  // F5 item 5 (H10 wobble): width/height must be CONTENT-BOX (matching the
  // ResizeObserver callback below), not getBoundingClientRect()'s
  // BORDER-BOX — this viewport toggles its own `overflowX` between
  // "auto"/"hidden" (see the stageLeft effect below), and a showing
  // horizontal scrollbar shrinks content-box height but not border-box.
  // Reading border-box here on every render (no deps, by design) used to
  // fight the ResizeObserver's correct content-box measurement and always
  // win, silently miscentering content by the scrollbar's thickness. Full
  // regression history: tests/scene-column-transitions.test.tsx's
  // "content-box, not scrollbar-oblivious border-box" test. Computed as
  // the border-box rect's own float-precise width/height minus the
  // (integer) offset-vs-client delta, rather than clientWidth/clientHeight
  // directly, to avoid a NEW oscillation from clientHeight's integer
  // rounding disagreeing with contentRect's subpixel float on every render.
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
      stage.querySelectorAll<HTMLElement>("[data-ui-scene-column-focused='true']"),
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
      .map((col) => col.getAttribute("data-ui-scene-column-anchor") ?? "")
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
    const allColumnEls = Array.from(stage.querySelectorAll<HTMLElement>("[data-ui-scene-column-anchor]"));
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
      const colName = allColumnEls[i]!.getAttribute("data-ui-scene-column-anchor") ?? "";
      if (registry.get(colName)?.focused) lastFocusedIndex = i;
    }

    let cursor = padding;
    let targetLeft: number | undefined;
    let targetRight: number | undefined;
    let missingTargetColumn: string | undefined;
    for (let i = 0; i < allColumnEls.length; i++) {
      const colName = allColumnEls[i]!.getAttribute("data-ui-scene-column-anchor") ?? "";
      const registered = registry.get(colName);
      if (registered === undefined || registered.widthTarget === undefined) {
        // Past the last focused column (see the pre-pass's own invariant
        // above): this column's own resolution status can never affect
        // targetLeft/targetRight, so stop silently — no fallback needed. AT
        // OR BEFORE it: this column (or a later one still to come) could
        // still be the span's own left/right edge, so an unresolved target
        // here forces the fallback — exact, not over- or under-triggered.
        // Full regression history (two related bugs this exact gate fixes):
        // tests/scene-glass-stack-deck.test.tsx's "camera-recentering
        // commit-aim pins" describe block header.
        if (i > lastFocusedIndex) break;
        missingTargetColumn = colName;
        break;
      }
      if (registered.focused && targetLeft === undefined) targetLeft = cursor;
      cursor += registered.widthTarget;
      // Every focused column keeps extending targetRight — a contiguous
      // multi-column focused span (or, matching the fallback's own
      // first-to-last semantics, a non-contiguous one) needs its RIGHTMOST
      // focused column's cursor, not its first (full regression history:
      // same test header as the fallback gate's comment above).
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
    // overflow (focusedWidth - vpWidth) — see the "both edges are inset by
    // exactly padding" test in tests/scene-scroll-restore.test.tsx for the
    // full derivation and the regression this formula fixes. 0 when
    // content fits (no pan range at all). Sign convention documented at
    // panOffsetRef's declaration.
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
  // one write per wheel event — removes the near-zero-Δt retarget pairing
  // that made Motion's velocity estimate numerically unstable under a dense
  // wheel stream, and is a straightforward perf win besides (one spring
  // retarget instead of two-plus per frame). Full history/measurements:
  // tests/scene-wheel-coalescing.test.tsx's own header.
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
        // ui#27: the ONLY call site that ever sets `source: "wheel"` — the
        // allowlist tag SceneColumn's wheel catch-stop detector and
        // counter-rebase key off of (see ScrollCommand's own doc comment
        // in inputController.ts). Every other scrollBy emitter (keyboard,
        // scrollbar thumb-drag, the scrollbar thumb's own keydown handler)
        // is excluded by construction, never touching this field.
        applyScrollCommand?.({ type: "scrollBy", delta, source: "wheel" });
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
          const eventColumn = (e.target as Element | null)?.closest("[data-ui-scene-column-anchor]") ?? null;
          const yConsumedByInterior =
            eventColumn && interiorCanConsume(e.target as Element, eventColumn, "y", scaledDeltaY);
          if (!yConsumedByInterior) {
            const column = decideWheelTargetColumn(el, e.clientX, e.clientY);
            const name = column?.getAttribute("data-ui-scene-column-anchor");
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
          const eventColumn = (e.target as Element | null)?.closest("[data-ui-scene-column-anchor]") ?? null;
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

  // The viewport is unconditionally `overflow: clip` on both axes (see the
  // style block below) — no native scrollLeft mutation can ever corrupt the
  // camera's pan, so no correction handler is needed at all. The camera
  // (stageLeft + the panOffset layer) is the SOLE horizontal-position
  // writer. Standing rule for every cameraX-driving function: no
  // Promise/`.then()`-tracked "already animating" guards, ever — idempotent
  // re-issue instead (SceneColumn.tsx F17's driveBoundedSpring pattern).
  // Full history (DELTA-2 -> absorb-and-re-pan -> ui#19 single-writer): see
  // tests/scene-lifecycle-navigation.test.tsx's own header, "Scene
  // horizontal scrollLeft immunity (ui#19)".

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
        data-ui-scene-reduced-motion={reducedMotion ? "" : undefined}
        data-ui-scene-settled={String(settled)}
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
          // [data-ui-scene-column-content]), scoped to that column being
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
          data-ui-scene-stage
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
            scene.querySelector('[data-ui-scene-debug-overlay]'). position:fixed
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
 * Scene and its children expose all consumer-facing state through
 * `data-ui-scene-*` attributes on their rendered DOM nodes — no render prop,
 * no hook (this is the designed surface, not an oversight). The scene
 * viewport carries `data-ui-scene-settled` (`"true"`/`"false"`; false while
 * any owned animation channel is claimed, focus-driven or not). Each
 * SceneObject carries `data-ui-scene-id` (its `name`) and
 * `data-ui-scene-focused` (`"true"`/`"false"`). Each SceneColumn's anchor
 * element carries `data-ui-scene-column-anchor` (its `name`),
 * `data-ui-scene-column-focused`, `data-ui-scene-column-position`
 * (`"in-between"` or `"outer"`), `data-ui-scene-max-scroll`, plus
 * `data-ui-scene-content-height` and `data-ui-scene-scroll-offset` (the
 * latter written imperatively) — both present only while that column is
 * focused, not permanent attributes a consumer can poll unconditionally.
 * A SceneColumn's
 * content wrapper is a separate element carrying its own bare presence
 * marker, `data-ui-scene-column-content`.
 *
 * Real-input tests (Playwright, Testing Library, etc.) that drive a
 * focus-changing action and then write into the newly-focused content
 * should wait for `data-ui-scene-settled` to read `"true"` first: the
 * newly-focused object's content is `inert` for the whole in-transition
 * window, and a runner that doesn't understand `inert` will report a
 * successful write that was actually silently dropped. Poll the attribute
 * via your runner's own native retry primitive — for example, in
 * Playwright, `await expect(locator).toHaveAttribute("data-ui-scene-settled", "true")`.
 * A future change (tracked as "Option A") may narrow this inert window;
 * this contract reflects current behavior.
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
  // `data-ui-scene-settled` (ui#20, criterion 1): true iff no owned animation
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
  // is the RAW GLOBAL zero-crossing, shared with `data-ui-scene-settled` —
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
