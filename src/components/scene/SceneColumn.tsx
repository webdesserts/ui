import React, {
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { motion, useMotionValue, useTransform } from "motion/react";
import { useSceneConfig, computeSceneTransition } from "./useSceneConfig";
import { ViewportContext } from "./ViewportContext";
import { ColumnPositionContext } from "./ColumnPositionContext";
import { ColumnRegistryContext } from "./ColumnRegistryContext";
import { useOwnedAnimation } from "./ownedAnimation";
import { useSettledValue } from "./useSettledValue";
import { StackDepthContext } from "./StackDepthContext";
import { ScrollOffsetStoreContext } from "./ScrollOffsetStoreContext";
import { ScrollCommandRegistryContext } from "./ScrollCommandRegistryContext";
import { useAnimationCallbacks } from "./AnimationCallbackContext";
import { SceneFirstPaintContext } from "./SceneFirstPaintContext";
import { PanControlContext } from "./PanControlContext";
import { useMotionSeam } from "./motionSeam";
import { useMotionSeamRegistration } from "./useMotionSeamRegistration";
import { computeDepthTreatment } from "./depth";
import { useDepthFilterChannel } from "./useDepthFilterChannel";
import { Scrollbar } from "./Scrollbar";
import { useColumnAnchoring } from "./useColumnAnchoring";
import { useColumnScroll } from "./useColumnScroll";
import type { FrozenSize } from "./types";
import type { SceneScrollMetrics } from "./scrollMetrics";
import {
  classifyTouchGestureDirection,
  shouldPreventTouchMove,
  computeReleaseVelocity,
  type TouchGestureOwnership,
  type VelocitySample,
} from "./inputController";
import { ColumnContext } from "./ColumnContext";
import {
  deriveColumnFocused,
  deriveObjectStates,
  computeFocusedObjectKey,
  computeTopOffset,
  computeFocusedWidth,
  computeMeasuredWidth,
  computeWithinColumnDepths,
  computeFocusedContentHeight,
  type ObjectState,
  type GeometryEntry,
} from "./columnGeometry";

// Re-exported for module-surface stability: these were declared directly in
// this file before the ColumnContext.tsx extraction.
export { ColumnContext } from "./ColumnContext";
export type { WithinColumnDepthInfo } from "./ColumnContext";

// ---------------------------------------------------------------------------
// SceneColumn
// ---------------------------------------------------------------------------

export interface SceneColumnProps {
  /** Stable name for this column. Shown in debug mode and used for implicit wrapping. */
  name: string;
  children: React.ReactNode;
  /** Gap (in px) between focused objects in this column's flex stack. Defaults to 0. */
  objectGap?: number;
  /**
   * className applied to the column's outer element (the same element
   * SceneColumn's own layout/animation styles are applied to). Merged
   * alongside those inline styles, not in place of them — an inline style
   * always wins over a same-property class at React's commit time (e.g. a
   * `!`-marked Tailwind utility is required to visibly override an
   * animatable property SceneColumn sets inline, such as `opacity` or
   * `transform`).
   */
  className?: string;
  /**
   * Follow-the-end pin mode (F9 commit 2 — the chat/log pattern). Default
   * `"none"`: plain anchoring-stabilized scroll (F9 commit 1). `"end"`:
   * the column starts pinned at maxScroll on first focus and on any
   * within-column swap (composes with A2's swap-reset), stays pinned to
   * maxScroll as new content arrives (same-frame, no animation — a
   * content-driven change, not a navigation), releases the moment the
   * user scrolls away from the end, and re-engages once the user scrolls
   * back within a small threshold of maxScroll.
   */
  anchor?: "none" | "end";
  /**
   * Fires on every scroll offset change (F9 commit 3) — user-initiated
   * (wheel/keyboard/scrollbar/touch) AND content-driven (F9 commit 1's
   * anchoring compensation, commit 2's pin-follow) alike, since both flow
   * through the same underlying scroll value. rAF-batched, matching
   * data-ui-scene-scroll-offset's own write cadence (a scrollY.on("change", ...)
   * subscription — NOT a new rAF loop, and never forces a React
   * re-render on its own). See SceneScrollMetrics' own doc comment for
   * the cadence-staleness contract on maxScroll/contentHeight.
   */
  onScroll?: (metrics: SceneScrollMetrics) => void;
  /**
   * Declarative scroll-to-element (F11 commit 2): when this VALUE CHANGES
   * to a non-null string, the column navigates to bring the element with
   * that standard DOM `id` (the interior contract again — a normal HTML
   * id on the consumer's own content, no Scene-specific naming) fully into
   * view, nearest-edge (already-visible → no movement; above → align its
   * top with the viewport's top; below → align its bottom with the
   * viewport's bottom — matches `element.scrollIntoView({ block:
   * "nearest" })`).
   *
   * One-shot: fires once per value CHANGE, not per render — setting the
   * SAME id again while it's already the current value does not re-fire
   * (React's own effect-dependency comparison on a primitive string
   * handles this for free). `null` is inert (no navigation, and clears
   * the "current" value so a later re-set of the same id DOES fire again).
   * An id with no matching element inside the column is a documented
   * no-op with a loud dev console.warn (never a thrown error).
   *
   * This is an INTENT-driven navigation, not a content-driven correction —
   * it springs (goes through the same write path as wheel/keyboard/
   * scrollbar), never the F9/F10 compensation jump path. On an
   * `anchor="end"` column, if the navigation's target offset lands within
   * the re-pin threshold of maxScroll, the column RE-PINS (the same
   * updatePinnedState check every other command already runs) — completing
   * a declarative "send and jump to the new message" flow:
   * `scrollTo={newMessageId}` on send.
   */
  scrollTo?: string | null;
}

/**
 * The SceneColumn component is composed of the anchor, the column itself,
 * and its contents.
 *
 * A vertical slot within a Scene. Objects inside a column share a horizontal
 * position and swap vertically when focus changes. A column is considered
 * focused if any of its children are focused.
 *
 * Every column stays IN the Scene's flex row regardless of focus state
 * (ui#17 never-leave-the-flow — no `position: absolute` anywhere in this
 * component, and no Motion `layout` FLIP prop either). Focused columns are
 * `flex: 0 1 auto`, sized to content. Unfocused columns capture their last
 * known size via ResizeObserver and freeze it as an explicit inline width
 * (an owned MotionValue channel, sprung imperatively — never a transform),
 * clearing on re-focus. Unfocused columns sandwiched between two focused
 * columns ("in-between") additionally shrink to a narrow peek-width
 * footprint and clip their content, forming the depth-deck stacking visual
 * — see widthTarget's and inBetweenStyle's own comments further down.
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
function SceneColumnImpl({
  name,
  children,
  objectGap = 0,
  className,
  anchor = "none",
  onScroll,
  scrollTo = null,
}: SceneColumnProps) {
  const columnFocused = deriveColumnFocused(children);
  const objectStates = deriveObjectStates(children);
  const { duration, stiffness, damping, touchPower, touchTimeConstant, padding, slowMo, peekOffset, columnGap } =
    useSceneConfig();
  const { width: viewportWidth, height: viewportHeight } = useContext(ViewportContext);
  const columnPositions = useContext(ColumnPositionContext);
  const scrollOffsetStore = useContext(ScrollOffsetStoreContext);
  const scrollCommandRegistry = useContext(ScrollCommandRegistryContext);
  const position = columnPositions.get(name) ?? null;
  const stackDepths = useContext(StackDepthContext);
  const stackDepth = stackDepths.get(name) ?? 0;
  const firstPaintRef = useContext(SceneFirstPaintContext);
  // ui#19 slice (c), A2 column-first-claim: null only if this column somehow
  // rendered outside a Scene (shouldn't happen in practice) — guarded
  // defensively at each call site below rather than assumed non-null.
  const panControl = useContext(PanControlContext);
  // Read here (rather than inside useColumnScroll) because width/margin/z
  // channel registration further down (topOffsetMV, widthMV, marginMV,
  // columnWidthMV, zMV) needs the SAME instance — a context read, so calling
  // it twice would be harmless but redundant; threaded through as a param
  // instead (ui#24 Cluster C extraction).
  const motionSeam = useMotionSeam();

  // duration=0 → instant transitions for tests; otherwise use configured spring.
  // slowMo → lazier spring parameters for animation snapshot testing.
  // Declared early (rather than inline near its original JSX use) so the
  // motion pipeline below (driveScrollYRef) can close over it.
  // computeSceneTransition (useSceneConfig.tsx) — shared with SceneObject,
  // was duplicated inline here before Scene F2 C2's DRY extraction.
  const transition = computeSceneTransition({ duration, slowMo, stiffness, damping });

  // A4 first-paint gate: tracks whether this column instance has EVER seen a
  // real (nonzero) effectiveViewportHeight — the LAST-arriving piece of a
  // column's initial geometry settling (SceneViewport's viewport measurement
  // is a layout effect in an ANCESTOR component, so it lands a render after
  // this column's own content-height/geometryStore corrections settle in the
  // same commit — the render where effectiveViewportHeight first becomes
  // real already has firstPaintRef.current === false). columnGeometryWasSettled
  // captures the PRE-mutation value (read below, right after
  // effectiveViewportHeight is computed) so marginTop, the topOffsetMV/
  // width-channel/zMV drive gates all reflect whether settling had ALREADY
  // happened as of the PREVIOUS render — the render where it first happens
  // must still count as "not yet settled" so its own value commits instantly
  // rather than springing from a placeholder. ui#17 criterion 5: columnTransition
  // (marginTopTransition's own sibling) no longer consumes this — see its own
  // declaration comment for why.
  //
  // Requires TWO consecutive equal, nonzero commits, not one — see
  // useSettledValue's own doc comment for the full rationale and the
  // measured regression this closes.
  const [columnGeometryWasSettled, checkColumnGeometrySettled] = useSettledValue();

  // Registered SceneObject elements — populated via ColumnContext.
  const registeredEls = useRef<Map<string, HTMLElement>>(new Map());
  // Registered SceneObjects' focus state — parallel to registeredEls,
  // populated via the SAME register() call (S6 registration architecture).
  // Used ONLY to compute this column's aggregate focused state for its own
  // registration with Scene below; the existing geometry/freeze pipeline
  // (deriveColumnFocused/deriveObjectStates prop walk) is untouched.
  const registeredObjectFocusRef = useRef<Map<string, boolean>>(new Map());
  // Registered SceneObjects' own height-channel targets (ui#21) — parallel
  // to registeredEls, REPORTED by each SceneObject (not DOM-measured here —
  // see GeometryEntry's own `heightTarget` doc comment for why remeasureGeometry
  // must consume this rather than reading offsetHeight on the same node the
  // height channel writes to).
  const registeredHeightTargetsRef = useRef<Map<string, number | undefined>>(new Map());
  // Single measurement layer: every registered object's offsetTop/height,
  // relative to the content wrapper. Bulk-remeasured (a) synchronously after
  // every render via useLayoutEffect and (b) asynchronously by a shared
  // ResizeObserver that catches content growth with no accompanying render.
  // Values from the previous render's remeasure are available during the
  // current render — valid for computing swap offsets since object content
  // doesn't change during a focus-only re-render.
  const geometryStore = useRef<Map<string, GeometryEntry>>(new Map());
  // The ResizeObserver instance shared by every registered object element
  // plus colRef itself. Created once on mount; membership (join/leave) is
  // driven by SceneObject's own callback ref via observeElement/
  // unobserveElement below (ui#32 Cluster 2) — keyed to genuine DOM
  // attach/detach, not to register()'s per-render invocation.
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // The last measured size while the column was focused. Set to null while
  // focused (no freeze applied) and to a FrozenSize after losing focus.
  const [frozenSize, setFrozenSize] = useState<FrozenSize | null>(null);
  // Content height at the time the column lost focus, used for vertical
  // centering of unfocused columns (so they maintain consistent positioning).
  const [frozenContentHeight, setFrozenContentHeight] = useState(0);
  // ui#17 never-leave-the-flow: a column that mounts already in-between
  // (never focused — frozenSize is only ever set on a genuine focus-loss
  // transition, see wasEverFocused below) has no frozen width to pin its
  // content wrapper to. Captured by a deferred-measurement effect further
  // down — see that effect's own comment for the full mechanism.
  const [neverFocusedNaturalWidth, setNeverFocusedNaturalWidth] = useState<number | undefined>(undefined);

  // Tracks the latest size observed via ResizeObserver while focused.
  const lastObservedSize = useRef<FrozenSize>({ width: 0, height: 0 });
  const colRef = useRef<HTMLDivElement | null>(null);

  // Focused content height tracked via ResizeObserver on the content wrapper.
  // Used to compute vertical centering margin-top and scroll bounds.
  const [contentHeight, setContentHeight] = useState(0);
  const contentWrapperRef = useRef<HTMLDivElement | null>(null);

  // Effective viewport height accounts for Scene padding applied to the stage.
  // Padding reduces the usable height, so the scroll range grows accordingly.
  const effectiveViewportHeight = viewportHeight - padding * 2;

  // A4 first-paint gate (continued from columnGeometryWasSettled's decl
  // above, ui#20 criterion 6: useSettledValue) — the StrictMode double-
  // invocation rationale for reading the PRE-mutation value here and only
  // ever calling checkColumnGeometrySettled from a layout effect now lives
  // on that hook's own doc comment.
  useLayoutEffect(() => {
    checkColumnGeometrySettled(effectiveViewportHeight);
  });

  // Vertical scroll: the full wheel/keyboard/scrollbar/fling write path,
  // maxScroll/pin-state tracking, and the declarative scrollTo effect —
  // extracted to useColumnScroll (ui#24 Cluster C). Called here, before the
  // focus/frozen-size cluster and useColumnAnchoring's own call below, so
  // this hook's internal effects (registry, keyboard, scrollTo — all
  // passive) register in the SAME relative position (before those two) they
  // held prior to the extraction. Returns an interface object rather than
  // writing through passed-in refs — see that hook's own doc comment for
  // why (the swap-reset effect, touch's pointer handlers, and rendering
  // below all consume pieces of it).
  const {
    scrollY,
    scrollOffset,
    setScrollOffset,
    scrollOffsetRef,
    maxScroll,
    maxScrollRef,
    viewportHeightRef,
    contentHeightRef,
    pinnedRef,
    updatePinnedState,
    driveScrollYRef,
    applyScrollYDeltaRef,
    applyScrollCommand,
    scrollYSpringTargetRef,
    flingActiveRef,
    wheelCliffTimerRef,
    wheelStreamPairedRef,
    lastWheelEventAtRef,
    resyncScrollMetricsRef,
  } = useColumnScroll({
    name,
    anchor,
    duration,
    transition,
    stiffness,
    damping,
    touchPower,
    touchTimeConstant,
    motionSeam,
    columnFocused,
    contentHeight,
    effectiveViewportHeight,
    scrollCommandRegistry,
    colRef,
    contentWrapperRef,
    scrollTo,
  });

  // Touch pan drag state (moved up from its original declaration point,
  // right before the touch pointer handlers below, so F9's content-growth
  // compensation wrapper — declared before those handlers — can read
  // isDragging/dragStartOffset too; see that wrapper's own comment on the
  // mid-drag rebase). dragStartY/dragStartOffset capture the gesture's
  // starting pointer position and scroll offset at handleContentPointerDown
  // time; isDragging gates handleContentPointerMove. dragStartX (F13 commit
  // 1) was originally needed only for direction disambiguation
  // (classifyTouchGestureDirection) — ui#19 slice (c) ALSO uses it as the
  // 1:1 tracking origin once a gesture is decided "horizontal" (A2
  // column-first-claim: this column's own triad keeps tracking instead of
  // releasing to native, see handleContentPointerMove below).
  const dragStartY = useRef(0);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  const isDragging = useRef(false);
  // ui#19 slice (c): panOffsetRef's value (read via PanControlContext's
  // getPanOffset) at handleContentPointerDown time — the 1:1 horizontal
  // tracking origin, mirroring dragStartOffset's own role for the vertical
  // axis exactly.
  const dragStartPanOffset = useRef(0);

  // F13 commit 1: this gesture's decided touch ownership (undecided until
  // cumulative movement clears the slop — see classifyTouchGestureDirection's
  // own doc comment). Reset to "undecided" at every handleContentPointerDown;
  // decided once, permanently, by handleContentPointerMove; read by the
  // native (non-passive) touchmove listener below to decide whether to
  // preventDefault.
  const touchOwnershipRef = useRef<TouchGestureOwnership>("undecided");

  // F13 commit 2: ring buffer of (timestamp, offset) samples from the
  // active drag, own-tracked so release velocity doesn't depend on
  // scrollY.getVelocity() at release time — see computeReleaseVelocity's
  // own doc comment for why that read is unreliable exactly when it
  // matters. Reset at every handleContentPointerDown; pushed to by every
  // handleContentPointerMove; consumed once, at release, by
  // handleContentPointerUp. Vertical-axis samples only (`offset` =
  // scrollOffset) — ui#19 slice (c) adds a SEPARATE ring buffer for
  // horizontal panning below, since mixing the two axes' offsets in one
  // buffer would corrupt computeReleaseVelocity's delta/dt math for
  // whichever axis didn't actually move.
  const velocitySamplesRef = useRef<VelocitySample[]>([]);
  // ui#19 slice (c): horizontal twin of velocitySamplesRef — `offset` here
  // is panOffsetRef's value, not scrollOffset. Same reset/push/consume
  // lifecycle, scoped to gestures touchOwnershipRef decides "horizontal".
  const panVelocitySamplesRef = useRef<VelocitySample[]>([]);

  // Compute the top offset during render using geometry captured in the
  // previous render's useLayoutEffect. This is accurate for focus swaps
  // (object content doesn't change when only focus changes) and avoids a
  // two-render cycle.
  const topOffset = computeTopOffset(objectStates, geometryStore.current);

  // Compute depth info for unfocused objects sandwiched between focused siblings.
  // Used to give them peekable depth-card treatment instead of hiding them.
  // NOT memoized (ui#32): an early memoization attempt (a name:focused
  // fingerprint of objectStates, matching what computeWithinColumnDepths
  // itself reads) broke within-column-deck-after-focus-toggle
  // (tests/visual/scene-animation.test.tsx) and was reverted out of
  // caution. The claim review's independent re-derivation with the same,
  // verified-correct fingerprint did NOT reproduce the break — re-attempting
  // with a verified-correct fingerprint is a candidate follow-up, possibly
  // connected to the unresolved memo short-circuit (see the rising-edge doc
  // at SceneObject.tsx:417-460 for what any attempt must preserve).
  const withinColumnDepths = computeWithinColumnDepths(objectStates);

  // Joined focused-object-name key for this render (see computeFocusedObjectKey).
  // Drives the swap-reset scroll model (A2) below.
  const focusedObjectKey = computeFocusedObjectKey(objectStates);

  // Tracks the key from the last render where this column WAS focused. The
  // save-on-unfocus effect below runs on the render where columnFocused just
  // became false — by then objectStates already reflects "nothing focused"
  // (focusedObjectKey === ""), so this ref preserves what was actually
  // active right before the park. Plain render-time ref mutation (like
  // maxScrollRef above) — safe, no setState involved.
  const lastActiveFocusedKeyRef = useRef("");
  if (columnFocused) {
    lastActiveFocusedKeyRef.current = focusedObjectKey;
  }

  // While the column is focused, snapshot its current dimensions synchronously
  // after each render (useLayoutEffect fires before the browser paints). This
  // ensures `lastObservedSize` is always fresh and doesn't depend on the async
  // ResizeObserver firing before focus is lost.
  //
  // F7 item 1 fix (a third missed gBCR site in the same H11 projection-
  // contamination class — see remeasureGeometry's own comment for the
  // established rule): offsetWidth/offsetHeight, NOT
  // getBoundingClientRect(). `columnFocused` (a plain prop) flips the
  // instant React processes the focus click, but the column's own zMV
  // (depth-deck translateZ) is a MotionValue — it hasn't moved yet on this
  // exact commit, the very first one where columnFocused is newly true, so
  // getBoundingClientRect() here still reads the column under its OLD,
  // fully-settled depth-deck perspective projection (probe-confirmed: a
  // column previously frozen at depth-1 read 226.34px here instead of its
  // true 254px — the exact depth-1 projection factor). That wrong value
  // gets frozen via setFrozenSize below, and if the column later re-enters
  // the depth deck (e.g. a quick focus/unfocus double-click, interrupting
  // before the real spring finishes), the frozen size is PROJECTED AGAIN by
  // the depth-deck transform on render — a compounding foreshortening,
  // observed as the column settling ~12px too high.
  useLayoutEffect(() => {
    if (columnFocused && colRef.current) {
      const width = colRef.current.offsetWidth;
      const height = colRef.current.offsetHeight;
      if (width > 0 || height > 0) {
        lastObservedSize.current = { width, height };
      }
    }
  });

  // Whether this column has ever been focused. Columns that were previously
  // focused need a frozen size (frozenSize below). A never-focused, never-
  // in-between column sizes to its content naturally (no width override —
  // widthTarget's frozenSize?.width branch stays undefined). A never-focused
  // IN-BETWEEN column is the one exception that still needs sizing without
  // ever having been focused — see neverFocusedNaturalWidth's own comment
  // (ui#17) for that deferred-measurement mechanism.
  const wasEverFocused = useRef(columnFocused);

  // True only on the very first render. Used to detect a freshly mounted
  // column so it can animate in from offscreen rather than appearing at rest.
  const isMountingRef = useRef(true);
  useEffect(() => {
    isMountingRef.current = false;
  }, []);

  // Save scroll offset, focused-object key, and content height when the
  // column transitions to unfocused. Using useLayoutEffect ensures this runs
  // before the useEffect clamping logic — clamping (tied to maxScroll) would
  // zero the ref before we could save it. All three fields live together on
  // the STORE entry (keyed by column name, owned by the parent Scene) rather
  // than a per-instance ref — this is the B7 fix: contentHeightAtSave
  // survives an unmount/remount of a same-named column, where a fresh
  // component instance's own ref would otherwise reset to 0 and defeat the
  // drastic-resize guard below.
  useLayoutEffect(() => {
    if (!columnFocused && wasEverFocused.current) {
      scrollOffsetStore.set(name, {
        offset: scrollOffsetRef.current,
        focusedKey: lastActiveFocusedKeyRef.current,
        // F7 item 1 fix: offsetHeight, not getBoundingClientRect() — same
        // projection-contamination class as the lastObservedSize snapshot
        // sites above. This runs on the FIRST commit where columnFocused
        // just went false; if that unfocus interrupts a still-in-flight
        // refocus (Michael's quick focus/unfocus repro), the column's zMV
        // hasn't yet settled back to its unfocused target and this read
        // would otherwise capture a partially-projected height.
        contentHeightAtSave: contentWrapperRef.current?.offsetHeight ?? 0,
      });
    }
  }, [columnFocused]);

  // Track column focus state: freeze the last size on focus loss, and clear
  // on re-focus. Scroll offset restore/reset lives in the swap-reset effect
  // below (A2) — it needs to react to focusedObjectKey too, to also catch a
  // within-column swap (columnFocused stays true throughout a swap, so a
  // [columnFocused]-only effect like this one would never see it — probe-
  // confirmed: a swap left the prior scroll offset untouched).
  //
  // B14: useLayoutEffect, NOT useEffect. A plain passive effect fires one
  // paint AFTER the commit that flips columnFocused — so on unfocus, the
  // column briefly renders at its NATURAL (unfrozen) size for one real
  // frame before collapsing/freezing; on rapid re-toggling, this can also
  // freeze mid-FLIP projected dimensions (the same class of transform-
  // distortion H11 fixed for content height, but for the frozen width/
  // height snapshot itself). useLayoutEffect fires synchronously pre-paint,
  // closing that one-frame gap.
  //
  // A dedicated useEffect-vs-useLayoutEffect regression test was
  // investigated and not added — Scene's own S6 registration architecture
  // always triggers a synchronous, layout-effect-driven corrective
  // re-render on every focus change, which masks the difference between
  // the two hooks (probe-verified across four independent trigger
  // mechanisms), so such a test would be vacuous. Kept useLayoutEffect
  // anyway: correct hook, zero cost, defense-in-depth against a future
  // architecture change that removes the masking correction pass.
  useLayoutEffect(() => {
    if (columnFocused) {
      wasEverFocused.current = true;
      // Re-focusing — clear the frozen size so the column returns to flex flow.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronizes frozen-size state with the focus-transition condition inside this layout effect — deliberate, restructuring the effect body is out of this dispatch's scope.
      setFrozenSize(null);
      // lastObservedSize while focused is now kept current by the shared
      // geometry ResizeObserver below (single measurement layer) — no
      // per-focus observer needed here.
    } else if (wasEverFocused.current) {
      // Freeze at the last captured dimensions so the column doesn't collapse.
      setFrozenSize({ ...lastObservedSize.current });
      // Save content height for vertical centering of unfocused columns.
      setFrozenContentHeight(contentHeight);
    }
  }, [columnFocused]);

  // ui#17 never-leave-the-flow: deferred natural-width capture for a
  // column that mounts already in-between and has never been focused (no
  // frozenSize to pin its content wrapper to — see neverFocusedNaturalWidth's
  // own declaration comment; real scenario, not hypothetical — mirrors
  // dev/pages/ScenePage.tsx's own Depth deck stacking demo, whose middle
  // columns mount with focused=false and are never toggled by default).
  //
  // Mechanism: widthTarget withholds the peek-width override until
  // inBetweenKnownWidth is true (see its own comment), so on the FIRST
  // render where this column is in-between and never-focused, it paints at
  // its natural, un-narrowed width — this effect (running every render, no
  // deps) measures that natural width right here, pre-paint, and stores
  // it, which flips inBetweenKnownWidth true and triggers the corrective
  // re-render that applies both the peek-shrink and this same measured
  // value as the content wrapper's pin. React flushes a layout-effect-
  // triggered update synchronously before paint (the same guarantee this
  // file already relies on for the wasEverFocused effect above — see its
  // own comment's probe-verified finding), so there is no visible "natural
  // size" flash, just one extra render.
  //
  // Guarded on wasEverFocused.current (a ref, synchronously current within
  // this same commit's effects), NOT frozenSize !== null — frozenSize
  // reads stale (still null) on the exact commit a genuine focus-loss
  // transition schedules its own setFrozenSize update above, since a state
  // setter doesn't retroactively change what THIS render's closure sees.
  // Using frozenSize here would spuriously fire this capture for a column
  // that WAS just focused and is only one commit away from getting its
  // real frozenSize, not just for the genuinely-never-focused case.
  useLayoutEffect(() => {
    const neverFocusedInBetween =
      !columnFocused && position === "in-between" && stackDepth > 0 && !wasEverFocused.current;
    if (neverFocusedInBetween && neverFocusedNaturalWidth === undefined && contentWrapperRef.current) {
      const measured = contentWrapperRef.current.offsetWidth;
      if (measured > 0) setNeverFocusedNaturalWidth(measured);
    }
  });

  // Geometry remeasurement, F9/F10/F12 scroll-anchoring compensation, and
  // the shared ResizeObserver + per-render remeasure effects that drive
  // them — extracted to useColumnAnchoring (ui#24 Cluster E). Called here,
  // after the focus/frozen-size cluster above and before the swap-reset
  // effect below, so this hook's two internal effects (the ResizeObserver
  // useEffect and the per-render useLayoutEffect) register in the SAME
  // relative order they ran in before the extraction — React schedules a
  // component's effects in hook-call order, and a custom hook's internal
  // hooks are inserted at its call site.
  //
  // isInBetweenForAnchoring duplicates inBetweenNow/isInBetween's own
  // expression (declared later in this file, ui#32) rather than reordering
  // those declarations up here — same tradeoff F5 item 2's columnAnimateX
  // comment and inBetweenNow's own comment already document for this file.
  const isInBetweenForAnchoring = !columnFocused && position === "in-between" && stackDepth > 0;
  useColumnAnchoring({
    objectStates,
    objectGap,
    columnFocused,
    inBetweenNow: isInBetweenForAnchoring,
    anchor,
    geometryStore,
    registeredEls,
    registeredHeightTargetsRef,
    contentWrapperRef,
    colRef,
    resizeObserverRef,
    lastObservedSize,
    scrollOffsetRef,
    viewportHeightRef,
    applyScrollYDeltaRef,
    dragStartOffset,
    isDragging,
    setScrollOffset,
    setContentHeight,
  });

  // Swap-reset scroll model (A2): decides this column's scroll offset
  // whenever it is focused AND its inner focus arrangement (focusedObjectKey)
  // settles to a new value. [columnFocused, focusedObjectKey] as deps is
  // what unifies BOTH triggers with one mechanism — park→return (columnFocused
  // flips true, same key as when parked) and a within-column swap
  // (columnFocused stays true, key changes) — while a re-render where
  // NEITHER changed (e.g. from unrelated content updates) correctly does not
  // re-run this and clobber active user scrolling.
  //
  // Declared AFTER the remeasure effect above so geometryStore.current is
  // already fresh for THIS commit — reading the still-stale `contentHeight`/
  // `maxScroll` REACT STATE here (which only updates a render later, since
  // state updates don't retroactively affect an already-captured closure)
  // would corrupt resetAlignment:"center"'s maxScroll read at swap time
  // (forecast-gate adjudication #4/riskiest-unknown #2). Computing a fresh
  // value directly from the just-remeasured geometry store sidesteps that
  // lag entirely.
  useLayoutEffect(() => {
    if (!columnFocused) return;

    const freshContentHeight = computeFocusedContentHeight(objectStates, geometryStore.current, objectGap);
    const freshMaxScroll = Math.max(
      0,
      effectiveViewportHeight > 0 ? freshContentHeight - effectiveViewportHeight : 0,
    );
    const entry = scrollOffsetStore.get(name);
    let nextOffset: number;

    if (entry && entry.focusedKey === focusedObjectKey) {
      // Unchanged arrangement (park/return with the same object(s) focused).
      // Drastic-resize guard: a saved offset from before a >50% content
      // change is meaningless — fall back to top. Compares against the
      // STORE's persisted contentHeightAtSave (B7), not a per-instance ref.
      const prevHeight = entry.contentHeightAtSave;
      const isDrasticResize =
        prevHeight > 0 &&
        freshContentHeight > 0 &&
        Math.abs(freshContentHeight - prevHeight) / prevHeight > 0.5;

      nextOffset = isDrasticResize
        ? 0
        // B6: clamp the restored offset to the current maxScroll — a saved
        // position must not outlive a resize that shrank the scrollable
        // range while parked. This clamp is NOT redundant with the
        // pre-existing generic [maxScroll] clamp effect elsewhere in this
        // file: that one is a passive useEffect (runs post-paint), while
        // this swap-reset decision is a useLayoutEffect (runs pre-paint).
        // Without this clamp, the DOM commits and paints one real frame at
        // the raw unclamped offset before the passive effect corrects it —
        // verified via a MutationObserver on data-ui-scene-scroll-offset showing the
        // commit sequence null→0→380→200 with this clamp removed, vs
        // null→0→200 with it present (380 was the saved pre-resize offset,
        // 200 the correct post-resize maxScroll). Do not remove this as a
        // "simplification" on the theory that the passive effect already
        // covers it — no settled-state test can catch that regression,
        // since both paths converge to the same final value; only the
        // transient unclamped frame is observably different.
        : Math.max(0, Math.min(entry.offset, freshMaxScroll));
    } else {
      // A swap (or first-ever focus, or a mismatched/absent entry): reset
      // deterministically per the newly-focused object's resetAlignment.
      // Tie-break (forecast-gate adjudication #2): when 2+ objects become
      // newly focused simultaneously, the FIRST newly-focused one in DOM
      // order governs — objectStates is already in DOM order, so the first
      // match is exactly that.
      //
      // F9 commit 2: anchor="end" overrides resetAlignment on a swap or
      // first-ever focus — reset-to-end unless overridden, per the design
      // doc. In practice this branch's own freshMaxScroll is 0 (a
      // harmless no-op) on a column's TRUE first-ever render, since
      // geometryStore hasn't been measured yet at that instant — see
      // pinnedRef's own comment for why the growth-while-pinned effect,
      // not this branch, is what actually delivers "starts pinned at
      // mount." This branch is what uniquely matters for a GENUINE
      // within-column swap, where geometryStore already holds real
      // measurements from a prior commit. Deliberately NOT applied to the
      // "unchanged arrangement, restore saved position" branch above — a
      // park/return with the pin already released before parking should
      // restore where the user actually left it, not force them back to
      // the bottom.
      const newlyFocused = objectStates.find((o) => o.focused);
      nextOffset =
        anchor === "end"
          ? freshMaxScroll
          : newlyFocused?.resetAlignment === "center"
            ? freshMaxScroll / 2
            : 0;
    }

    scrollOffsetRef.current = nextOffset;
    setScrollOffset(nextOffset);
    // F9 commit 3: ordered BEFORE driveScrollYRef below — see the
    // scrollBy/page/toTop/toBottom branch's identical comment above.
    updatePinnedState(nextOffset, freshMaxScroll);
    driveScrollYRef.current(nextOffset);
    // Keep the store's offset/key in sync so a LATER swap within the same
    // focused session compares against the truly-latest arrangement, not a
    // stale entry from before this column was even refocused (contentHeightAtSave
    // is deliberately NOT touched here — it must only change at the moment
    // of an actual park, so a later drastic-resize check has something
    // meaningful to compare against).
    scrollOffsetStore.set(name, {
      offset: nextOffset,
      focusedKey: focusedObjectKey,
      contentHeightAtSave: entry?.contentHeightAtSave ?? 0,
    });
  }, [columnFocused, focusedObjectKey]);

  // Imperative data-ui-scene-scroll-offset attribute writer (forecast-gate adjudication
  // #2): mirrors SceneObjectOutlines' direct-DOM-mutation pattern rather than
  // React-rendering the attribute from scrollOffset state — scrollY changes
  // per-frame during a fling/wheel chase and must not force a re-render on
  // every tick just to keep this debug/overlay-read attribute current. Syncs
  // immediately on mount and on every columnFocused flip (re-subscribing with
  // a fresh closure), then stays current via the scrollY change subscription.
  useEffect(() => {
    const el = colRef.current;
    if (!el) return;

    const sync = (latest: number) => {
      if (columnFocused) {
        el.setAttribute("data-ui-scene-scroll-offset", String(latest));
      } else {
        el.removeAttribute("data-ui-scene-scroll-offset");
      }
    };

    sync(scrollY.get());
    return scrollY.on("change", sync);
  }, [columnFocused, scrollY]);

  // F9 commit 3: onScroll fires SceneScrollMetrics on every scrollY change
  // — reuses the SAME subscription cadence as data-ui-scene-scroll-offset above
  // (scrollY.on("change", ...), not a new rAF loop — per-tick, without
  // forcing a React re-render). Fires uniformly for BOTH user-initiated
  // writes (wheel/keyboard/scrollbar/touch) AND content-driven ones (F9
  // commit 1's anchoring compensation, commit 2's pin-follow) — a natural
  // consequence of subscribing to the single underlying scrollY value all
  // of them flow through, and useful to the stated v1 consumer (a chat/
  // log column wants to know the CURRENT offset for windowing thresholds
  // regardless of why it changed).
  //
  // Cadence-staleness contract (forecast Finding 5): maxScroll/
  // contentHeight are read from their own ref mirrors at CALLBACK time,
  // not recomputed fresh. If ONLY those change with no accompanying
  // scrollY movement (e.g. content grows BELOW the current window — F9
  // commit 1's own documented no-op case), onScroll does not fire, and a
  // consumer's last-received metrics can go stale on those two fields
  // until the next scroll event. Accepted, not an oversight: the stated
  // v1 consumer's windowing thresholds re-check on the next scroll
  // anyway, so engineering an extra change-source to keep those two
  // fields always-fresh isn't warranted.
  useEffect(() => {
    if (!onScroll) {
      resyncScrollMetricsRef.current = null;
      return;
    }
    const syncMetrics = (latest: number) => {
      onScroll({
        offset: latest,
        maxScroll: maxScrollRef.current,
        contentHeight: contentHeightRef.current,
        viewportHeight: viewportHeightRef.current,
        anchored: pinnedRef.current ? "end" : "none",
      });
    };
    // See resyncScrollMetricsRef's own declaration comment — the inertia
    // settle callback needs to force a resync after its own
    // updatePinnedState call, since no further scrollY change event will
    // fire on its own to carry the correction.
    resyncScrollMetricsRef.current = () => syncMetrics(scrollY.get());
    syncMetrics(scrollY.get());
    return scrollY.on("change", syncMetrics);
  }, [
    onScroll,
    scrollY,
    contentHeightRef,
    maxScrollRef,
    pinnedRef,
    resyncScrollMetricsRef,
    viewportHeightRef,
  ]);

  // Vertical centering: center the focused content within the viewport when it
  // fits. When content overflows (contentHeight > viewportHeight), margin is 0
  // and content aligns to the top.
  // Vertical centering for all columns. Focused columns use their live
  // contentHeight. Previously-focused columns use frozenContentHeight.
  // Never-focused columns measure their content wrapper directly.
  let effectiveContentHeight = columnFocused ? contentHeight : frozenContentHeight;
  if (effectiveContentHeight === 0 && contentWrapperRef.current) {
    // offsetHeight (not getBoundingClientRect(), H11) — defensive-only: this
    // wrapper sits inside the outer column's own translateZ/scale depth-deck
    // transform, so getBoundingClientRect() COULD in principle report a
    // projected/scaled size here. In practice, extensively probe-verified
    // that this branch never observably reaches paint with a distorted
    // value — Motion applies the transform via its own post-commit update
    // cycle, so any React render that synchronously reads this DOM always
    // sees the NOT-YET-(re)applied state. No defeat-check pin is possible
    // here (no reachable interaction path makes reverting this line
    // observable) — kept anyway: zero marginal cost, and correct if this
    // timing relationship ever changes.
    effectiveContentHeight = contentWrapperRef.current.offsetHeight;
  }
  // Centers within effectiveViewportHeight (padding-subtracted, same basis
  // as maxScroll above) — not the raw viewportHeight, which overshoots by
  // Scene's padding (S6 padding cluster).
  const marginTop =
    effectiveViewportHeight > 0 && effectiveContentHeight > 0
      ? Math.max(0, (effectiveViewportHeight - effectiveContentHeight) / 2)
      : 0;

  // A4 first-paint gate for marginTop: `animate={{marginTop}}` below springs
  // between whatever value it was PREVIOUSLY committed with and the new one,
  // even across renders the browser never actually painted — see
  // columnGeometryWasSettled's declaration above for why firstPaintRef alone
  // doesn't cover this gap.
  const marginTopTransition =
    firstPaintRef.current || !columnGeometryWasSettled ? { duration: 0 } : transition;

  // ui#17 criterion 5 (re-derived, not copied — Motion's `layout` prop is
  // gone from this node): F7 item 2's original documented reason for this
  // gate — Motion's `layout` prop snapshotting a stale, mid-settle
  // getBoundingClientRect() and FLIP-animating a spurious correction once
  // geometry settled a commit later — is now structurally impossible; there
  // is no `layout` prop anywhere on this element for that mechanism to fire
  // from. Re-checked whether `columnTransition`'s OTHER role (governing
  // `animate={{opacity, x, y, filter}}`'s spring config below) has its own,
  // independent reason to need this gate: full scene family run with the
  // `!columnGeometryWasSettled` clause severed — 448/449 unaffected (this
  // check is structurally uninformative on its own: computeSceneTransition
  // already collapses to {duration:0} whenever config.duration===0, which
  // is every test in this suite, gate or no gate). A targeted real-duration
  // probe (a column mounting already in-between, sandwiched between two
  // always-focused siblings, never itself focused — dev/pages/
  // ScenePage.tsx's own Depth deck stacking demo shape) sampled its
  // rendered Y position across the settling window: flat throughout, zero
  // discontinuity with or without the clause. Root cause of the flatness,
  // traced via a settle-state trace on the same probe: a stable never-
  // focused in-between column simply never receives another render after
  // its geometry first settles (nothing else about it changes), so its
  // `animate` targets never get a chance to differ before vs. after
  // settling either way — the springing-vs-jumping distinction this gate
  // draws is moot for that config specifically, gate or no gate. Simplified
  // accordingly (dropped `!columnGeometryWasSettled` here only —
  // marginTopTransition above and the topOffsetMV/width-channel/zMV drive
  // gates below all keep it; their own reasons are independent of `layout`
  // and unaffected by this). Not exhaustively proven: a column whose
  // stack-depth/position changes DURING the not-yet-settled window (an
  // untested, more complex scenario) could in principle still exercise a
  // real spring-from-wrong-target here — same honest boundary this file's
  // own zMV z-clearance decision documents for a structurally similar
  // question (2 probe attempts, no reproducible case found).
  const columnTransition = firstPaintRef.current ? { duration: 0 } : transition;

  // Registration callback provided to child SceneObjects — records this
  // object's DOM element, focus state, and height-channel target in the
  // maps below every render (unconditional-per-render, mirrors the
  // useLayoutEffect that calls this in SceneObject.tsx). Does NOT touch the
  // shared ResizeObserver (ui#32 Cluster 2) — RO membership is keyed to
  // genuine DOM attach/detach via observeElement/unobserveElement below,
  // called from SceneObject's own callback ref, not from this per-render
  // effect. Calling observe()/unobserve() here on every render (the pre-fix
  // shape) reset the RO's lastReportedSize tracking even when the element
  // never actually moved, queuing a spurious delivery each time.
  const register = useCallback((objName: string, el: HTMLElement, focused: boolean, heightTarget: number | undefined) => {
    registeredEls.current.set(objName, el);
    registeredObjectFocusRef.current.set(objName, focused);
    registeredHeightTargetsRef.current.set(objName, heightTarget);
    return () => {
      registeredEls.current.delete(objName);
      registeredObjectFocusRef.current.delete(objName);
      registeredHeightTargetsRef.current.delete(objName);
      geometryStore.current.delete(objName);
    };
  }, []);

  // Shared ResizeObserver membership (ui#32 Cluster 2) — keyed to genuine
  // DOM element identity via SceneObject's own callback ref, which fires
  // exactly on attach (mount, or an element swap) and detach (unmount),
  // never on an ordinary re-render. A freshly mounted column's own initial
  // elements are instead picked up by the mount effect's own sweep (the
  // shared ResizeObserver doesn't exist yet when the very first commit's
  // callback refs fire) — these two functions only matter for elements that
  // attach/detach after the observer already exists.
  const observeElement = useCallback((el: HTMLElement) => {
    resizeObserverRef.current?.observe(el);
  }, []);
  const unobserveElement = useCallback((el: HTMLElement) => {
    resizeObserverRef.current?.unobserve(el);
  }, []);

  // This column's own registration with Scene's column registry (S6
  // registration architecture) — reports its aggregate focused state
  // (derived from registeredObjectFocusRef, which reflects EVERY registered
  // SceneObject regardless of intermediate div wrapping) and DOM element.
  // Unconditional per-render (no deps): must reflect a focus-only toggle on
  // a registered object in the SAME commit, and by the time this runs,
  // registeredObjectFocusRef is already fresh — SceneObject's own
  // registration effect (bottom-up, children before parents) has already
  // run for this commit.
  const registerColumnWithScene = useContext(ColumnRegistryContext);
  useLayoutEffect(() => {
    const el = colRef.current;
    if (!el || !registerColumnWithScene) return;
    const focused = Array.from(registeredObjectFocusRef.current.values()).some(Boolean);
    // ui#20: registry-derived (registeredObjectFocusRef), not the top-level
    // prop-walk `objectStates` — same S6 registration-architecture reason
    // `focused` above uses the registry: this stays correct regardless of
    // Fragment-wrapping or a custom component returning a SceneObject.
    const reportedObjectStates = Array.from(registeredObjectFocusRef.current.entries()).map(
      ([objName, objFocused]) => ({ name: objName, focused: objFocused }),
    );
    // eslint-disable-next-line react-hooks/immutability -- widthTarget/marginTarget are const bindings declared later in this function but only read inside a useLayoutEffect callback, which never executes until after the full render body completes — valid JS (effects run post-render); reordering the effect below its dependencies' declarations is a real structural change, deferred.
    return registerColumnWithScene(name, { focused, element: el, widthTarget, marginTarget, objectStates: reportedObjectStates });
  });

  // Debug outline tracking: notify the animation counter in SceneViewport when
  // this column's motion animations start or end. The rAF loop in
  // SceneObjectOutlines runs while the counter is > 0. Only active in debug
  // mode — context is null otherwise so callbacks are never called.
  const animCallbacks = useAnimationCallbacks();

  // The combined vertical offset applied to the content wrapper:
  // - topOffset: vertical swap offset (bring focused object into view)
  // - scrollOffset: JS scroll state (driven by wheel events)
  // Both are subtracted so positive values slide the content up. Used only
  // for the instant-mode (duration=0) synchronous style write below — see
  // composedTop for the real-animation equivalent.
  const combinedTop = -(topOffset + scrollOffset);

  // topOffsetMV: a MotionValue channel for the swap-offset component of
  // `top`, paired with scrollY in composedTop below (S3-regression fix).
  // topOffset (above) is a plain per-render TARGET, recomputed synchronously
  // from fresh geometry on every render — it does not itself spring. Before
  // this MotionValue existed, composedTop recombined directly with that raw
  // number, so a vertical swap changed `top` in a single frame (teleport)
  // instead of springing through intermediate values the way it did pre-S3
  // (when `top` was driven via motion's `animate={{top}}` prop). Seeded to
  // this render's topOffset so the very first commit needs no drive.
  const topOffsetMV = useMotionValue(topOffset);
  useMotionSeamRegistration(motionSeam, `topOffset:${name}`, topOffsetMV);
  // The last target actually driven into topOffsetMV — compared against the
  // fresh per-render topOffset below to detect a real swap (vs. an unrelated
  // re-render where topOffset is unchanged).
  const topOffsetTargetRef = useRef(topOffset);

  // Drives topOffsetMV toward this render's topOffset whenever it changed.
  // Mirrors driveScrollYRef's instant-vs-real branching: duration===0 uses a
  // synchronous `.set()` (composedTop isn't even used in that mode, but
  // keeping the MotionValue's own value consistent is cheap and avoids a
  // stale target if duration toggles at runtime). Gated to `.jump()` rather
  // than animate() during firstPaintRef.current OR before
  // columnGeometryWasSettled — the same first-paint suppression
  // SceneColumn's mountInitial already applies to the slide-in: without it,
  // a column's topOffset can differ from its useMotionValue seed by the time
  // geometry settles a render or two into Scene's first paint, and springing
  // from 0 there would look identical to the entrance jank first-paint
  // suppression exists to prevent. columnGeometryWasSettled is required in
  // ADDITION to firstPaintRef.current (not redundant with it) — probe-
  // confirmed the render where topOffset's underlying geometry first
  // settles already has firstPaintRef.current === false (see
  // columnGeometryWasSettled's declaration above).
  const topOffsetOwnedAnimation = useOwnedAnimation(duration);
  useLayoutEffect(() => {
    if (topOffset === topOffsetTargetRef.current && !topOffsetOwnedAnimation.durationJustBecameZero) return;
    topOffsetTargetRef.current = topOffset;
    // ui#33: duration===0 now shares the jump() branch below instead of a
    // raw .set() — .set() never calls .stop() (probe-confirmed at source),
    // so a live duration flip to 0 mid-spring never stopped the in-flight
    // animate() call or retired the settle counter, leaving both stuck.
    if (duration === 0 || firstPaintRef.current || !columnGeometryWasSettled) {
      topOffsetOwnedAnimation.jump(topOffsetMV, topOffset);
    } else {
      const controls = topOffsetOwnedAnimation.animateTo(topOffsetMV, topOffset, transition);
      motionSeam?.registerControls(`topOffset:${name}`, controls);
      motionSeam?.registerTarget?.(`topOffset:${name}`, topOffset);
    }
  });

  // Real-animation equivalent of combinedTop: a MotionValue derived from
  // BOTH scrollY (the live, per-tick JS scroll value) and topOffsetMV (the
  // swap offset, now itself a springing MotionValue — see above). NOT used
  // in instant mode — forecast-gate adjudication #1: relying on motion's
  // rAF-batched style binding for a synchronous instant-mode write would
  // depend on undocumented same-frame-ordering internals.
  const composedTop = useTransform<number, number>([topOffsetMV, scrollY], ([t, s]) => -(t + s));

  // ---------------------------------------------------------------------
  // ui#17: owned WIDTH channel, replacing Motion's `layout` FLIP for this
  // dimension. `layout` faked width changes via a `transform: scale()`
  // interpolation — proven (probe round, 2026-07-30) to re-snapshot
  // incorrectly whenever a second layout-affecting commit interrupts an
  // in-flight correction, independent of composition with anything else (a
  // bare, animate-free, sibling-free element reproduced the identical
  // signature). This channel writes a real `width` px value instead,
  // springing it the SAME way topOffsetMV springs `top` above — single
  // writer, idempotent re-issue (no Promise/.then()-tracked "already
  // animating" guard, matching driveCameraX's own precedent — a NEW
  // animate() call always safely retargets, using the MotionValue's
  // current value+velocity as its starting point, not a fresh box
  // snapshot).
  //
  // HEIGHT has no equivalent channel (deliberate, not an oversight): a
  // focused column's height is externally imposed by Scene's own
  // `alignItems: "stretch"` on the row, never content-driven the way width
  // is — `frozenSize.height` (captured while stretched-focused) equals
  // `effectiveViewportHeight` (the stretch target) by construction in the
  // common case, so there is nothing to interpolate. An owned height
  // channel was built, measured, and deliberately deleted (ui#17 gate,
  // 2026-07-30) once this was confirmed — see outerStyle/inBetweenStyle
  // below for where the frozen height is applied instead (a static value,
  // matching the pre-ui#17 mechanism, unchanged for this one dimension).
  //
  // Target while FOCUSED: the widest focused object's own measured width
  // (geometryStore, computeFocusedWidth). Target while UNFOCUSED: the
  // frozen dims captured on losing focus (frozenSize, unchanged
  // mechanism) — an unfocused column always wants its frozen size, it
  // never "releases" to natural sizing.
  // ---------------------------------------------------------------------
  const focusedWidthTarget = computeFocusedWidth(objectStates, geometryStore.current);
  // Glass-stack deck (ui#17): this OUTER node is a PERMANENT zero-footprint
  // in-flow ANCHOR for an in-between column, not a visually-narrowed
  // sliver. Its footprint springs naturalWidth -> 0 and STAYS at 0 forever
  // once settled — there is no flip back to full width anywhere in this
  // design. The full-size glass COLUMN (a nested node, see its own JSX
  // comment further down) is position:absolute WITHIN this anchor and
  // carries the actual visual rendering, so the anchor's own footprint
  // being invisible/zero doesn't crush anything. Computed inline
  // (duplicating isInBetween's own condition, declared later in this file)
  // rather than reordering — same tradeoff F5 item 2's `columnAnimateX`
  // comment already documents for this file.
  const inBetweenNow = !columnFocused && position === "in-between" && stackDepth > 0;
  // Deferred shrink for a never-focused deck column (no frozenSize, no
  // captured neverFocusedNaturalWidth yet — see that state's own comment):
  // withhold the footprint override for exactly one render so this commit
  // paints at the column's natural width, giving the deferred-measurement
  // effect further down something real to measure. wasEverFocused.current
  // (not frozenSize !== null) is the correct discriminator here — frozenSize
  // reads stale (still null) on the SAME commit a focus-loss transition
  // schedules its own update, since a state setter doesn't retroactively
  // change what this render's closure sees; wasEverFocused.current is a
  // ref, already true by the time that same commit's effects run.
  const inBetweenKnownWidth = wasEverFocused.current || neverFocusedNaturalWidth !== undefined;
  const widthTarget = columnFocused
    ? focusedWidthTarget
    : inBetweenNow
      ? (inBetweenKnownWidth ? 0 : undefined)
      : frozenSize?.width;

  const widthMV = useMotionValue(widthTarget ?? 0);
  useMotionSeamRegistration(motionSeam, `width:${name}`, widthMV);

  const widthTargetRef = useRef(widthTarget);
  // Whether this channel has EVER driven a real (defined) target — false
  // only for a column that mounted unfocused and has never been focused
  // (frozenSize stays null, per wasEverFocused's own established
  // semantics: "never-focused columns size to their content naturally").
  // The FIRST real target such a column gets has no valid "from" value to
  // spring from (widthMV was seeded at 0, a placeholder never rendered
  // while the target stayed undefined) — jump straight to it rather than
  // springing from that placeholder.
  const widthHasHadTargetRef = useRef(widthTarget !== undefined);
  // Whether the channel's most recent spring has FULLY settled — gates
  // releasing the literal width style override back to natural CSS sizing
  // once a FOCUSED column's transition completes (preserves full
  // cqw/container-query responsiveness at rest — an UNFOCUSED column never
  // releases; see the style binding below). Starts true so a column that
  // never transitions never applies an override to begin with.
  const [widthSettled, setWidthSettled] = useState(true);
  const widthOwnedAnimation = useOwnedAnimation(duration);

  useLayoutEffect(() => {
    if (
      widthTarget === undefined ||
      (widthTarget === widthTargetRef.current && !widthOwnedAnimation.durationJustBecameZero)
    )
      return;
    const isFirstTarget = !widthHasHadTargetRef.current;
    widthHasHadTargetRef.current = true;
    widthTargetRef.current = widthTarget;
    if (duration === 0 || isFirstTarget || firstPaintRef.current || !columnGeometryWasSettled) {
      widthOwnedAnimation.jump(widthMV, widthTarget);
      setWidthSettled(true);
    } else {
      setWidthSettled(false);
      const controls = widthOwnedAnimation.animateTo(widthMV, widthTarget, transition, () => {
        setWidthSettled(true);
      });
      motionSeam?.registerControls(`width:${name}`, controls);
      motionSeam?.registerTarget?.(`width:${name}`, widthTarget);
    }
  });

  // Whether the literal width override is currently active: always while
  // unfocused (an unfocused column stays pinned to its frozen dims
  // forever, it never releases), or while focused AND still mid-spring
  // (released once settled — see above).
  const widthOverrideActive = !columnFocused ? widthTarget !== undefined : !widthSettled;

  // Gap-compensation channel. A zero-width flex item still inserts one
  // full columnGap on either side of itself — for a settled in-between
  // anchor (footprint=0) that's one whole extra columnGap the row
  // wouldn't have if the column were genuinely out of flow. marginRight
  // springs 0 -> -columnGap in lockstep with the footprint spring (same
  // transition config, same trigger commit — see inBetweenNow's own
  // gate), canceling that one extra gap so the gap between two focused
  // neighbors never varies with how many decked columns sit between them
  // (Michael's ruling). This channel is PERMANENT — it never resets,
  // since the anchor never leaves this state once settled (no flip). No
  // isFirstTarget/jump-vs-placeholder handling needed the way widthMV
  // has — margin's own "from" value (0) is always genuinely what's
  // currently rendered.
  const marginTarget = inBetweenNow && inBetweenKnownWidth ? -columnGap : 0;
  const marginMV = useMotionValue(marginTarget);
  useMotionSeamRegistration(motionSeam, `margin:${name}`, marginMV);

  const marginTargetRef = useRef(marginTarget);
  const marginOwnedAnimation = useOwnedAnimation(duration);
  useLayoutEffect(() => {
    if (marginTarget === marginTargetRef.current && !marginOwnedAnimation.durationJustBecameZero) return;
    marginTargetRef.current = marginTarget;
    if (duration === 0 || firstPaintRef.current || !columnGeometryWasSettled) {
      marginOwnedAnimation.jump(marginMV, marginTarget);
    } else {
      const controls = marginOwnedAnimation.animateTo(marginMV, marginTarget, transition);
      motionSeam?.registerControls(`margin:${name}`, controls);
      motionSeam?.registerTarget?.(`margin:${name}`, marginTarget);
    }
  });

  // The deck COLUMN's own width: pixels ONLY mid-spring, live CSS at rest,
  // on BOTH sides — mirroring what the FOCUSED side already does
  // (widthOverrideActive/widthSettled above). A pixel override drives the
  // transition, then releases once settled, handing off to the column's
  // own object-level cqw-derived width (cqw resolves against the stage's
  // container-query context, so it tracks viewport resize with zero JS
  // re-measurement, same mechanism the focused side already relies on).
  // Target: computeMeasuredWidth (regardless of focus — a deck column's
  // own object is never itself focused). Also defined during a REFOCUS
  // transition (columnFocused && !widthSettled, mirroring the anchor's
  // own widthOverrideActive condition for that side) — see
  // columnWidthOverrideActive's own comment for why the refocus side needs
  // this too. computeMeasuredWidth gives the SAME value on both sides of
  // the flip (the column's natural width doesn't depend on focus), so this
  // typically doesn't change the target across the commit at all — the
  // override just stays continuously active through it, which is the
  // whole point (a target that never changes needs no animation, only to
  // not be released prematurely).
  const columnWidthTarget =
    inBetweenNow || (columnFocused && !widthSettled)
      ? computeMeasuredWidth(objectStates, geometryStore.current)
      : undefined;
  const columnWidthMV = useMotionValue(columnWidthTarget ?? 0);
  useMotionSeamRegistration(motionSeam, `columnWidth:${name}`, columnWidthMV);

  const columnWidthTargetRef = useRef(columnWidthTarget);
  const columnWidthHasHadTargetRef = useRef(columnWidthTarget !== undefined);
  const [columnWidthSettled, setColumnWidthSettled] = useState(true);
  const columnWidthOwnedAnimation = useOwnedAnimation(duration);

  useLayoutEffect(() => {
    if (
      columnWidthTarget === undefined ||
      (columnWidthTarget === columnWidthTargetRef.current && !columnWidthOwnedAnimation.durationJustBecameZero)
    )
      return;
    const isFirstTarget = !columnWidthHasHadTargetRef.current;
    columnWidthHasHadTargetRef.current = true;
    columnWidthTargetRef.current = columnWidthTarget;
    if (duration === 0 || isFirstTarget || firstPaintRef.current || !columnGeometryWasSettled) {
      columnWidthOwnedAnimation.jump(columnWidthMV, columnWidthTarget);
      setColumnWidthSettled(true);
    } else {
      setColumnWidthSettled(false);
      const controls = columnWidthOwnedAnimation.animateTo(columnWidthMV, columnWidthTarget, transition, () => {
        setColumnWidthSettled(true);
      });
      motionSeam?.registerControls(`columnWidth:${name}`, controls);
      motionSeam?.registerTarget?.(`columnWidth:${name}`, columnWidthTarget);
    }
  });

  // Whether the column's own pixel width override is active. Two windows,
  // matching the two directions a flip can happen:
  //   - Unfocus (permanent once decked): while in-between AND still
  //     mid-spring (released once columnWidthSettled, letting the column's
  //     own cqw sizing take over at rest — unchanged from before).
  //   - Refocus (transient): while focused AND the ANCHOR's OWN width
  //     channel is still mid-spring (widthOverrideActive's own condition
  //     for the focused side, !widthSettled) — this is the fix for the
  //     refocus-direction width-source asymmetry (ui#17 Slice 1 close-
  //     out): without this, the column had NO override at all on refocus
  //     and fell back to filling an anchor still springing from its
  //     decked 0 footprint, producing a real (measured ~175px) width
  //     discontinuity at the flip commit — the invariant this design
  //     depends on (the column never visually resizes; only the anchor's
  //     footprint animates) was only actually upheld on the unfocus side.
  //     Gated on the ANCHOR's widthSettled, not columnWidthSettled — the
  //     column isn't itself springing to a new value on this side (see
  //     columnWidthTarget's own comment: the target typically doesn't even
  //     change across the commit), it's holding its already-correct value
  //     for exactly as long as the anchor's footprint is still growing
  //     back, then releasing.
  const columnWidthOverrideActive = inBetweenNow ? !columnWidthSettled : columnFocused && !widthSettled;

  // position and flex must be in `style` (not `animate`) because motion only
  // animates transforms, opacity, and CSS custom properties — not layout properties.
  // flex: 0 1 auto → columns size to their content by default. Consumers can
  // override via className (e.g. adding flex:1 for equal-share or a fixed width).
  const focusedStyle: React.CSSProperties = {
    position: "relative",
    flex: "0 1 auto",
  };

  // Unfocused in-between columns stay IN flex flow (never-leave-the-flow)
  // as a PERMANENT zero-footprint in-flow ANCHOR, not a visually-narrowed
  // sliver container. Staying position:relative — rather than exiting
  // flow via position:absolute — is what lets the owned footprint-width
  // channel spring this column's flow contribution down to zero frame by
  // frame, so a sibling reflowing past it (the ui#o9 bystander problem)
  // sees a smooth reshape instead of the column vanishing from flow in a
  // single commit. Deliberately NO overflow:clip (and no explicit width
  // binding here at all, see the style prop below) — the actual glass
  // COLUMN (a nested node, see its own JSX comment further down) is
  // position:absolute WITHIN this anchor and paints its own full-size
  // content escaping this anchor's own (invisible, zero-width-at-rest)
  // box entirely; clipping here would hide the whole column. marginRight
  // (marginMV) compensates the one extra columnGap a zero-width-but-
  // still-in-flow item would otherwise leave behind — see that channel's
  // own comment.
  const inBetweenStyle: React.CSSProperties = {
    position: "relative",
    flex: "0 0 auto",
    ...(frozenSize ? { height: frozenSize.height } : {}),
  };

  // Outer unfocused columns stay in the flex row with their frozen size so the
  // Camera can pan past them. No opacity:0 — the viewport clips visibility.
  // Frozen width is applied by the owned width channel below (ui#17) —
  // single-writer rule, not written here directly. Frozen height stays a
  // static value here — see inBetweenStyle's comment above.
  const outerStyle: React.CSSProperties = {
    position: "relative",
    flex: "0 0 auto",
    ...(frozenSize ? { height: frozenSize.height } : {}),
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
  //
  // F5 item 2 fix: gated on `!columnFocused` IN ADDITION to `position ===
  // "in-between"` — `position` is registry-derived and one-commit-stale by
  // construction (see the S6 registration architecture comments elsewhere in
  // this file), while `columnFocused` is a plain prop-walk read, fresh every
  // render with no cross-component lag. On the exact commit where a
  // never-focused deck card's `focused` prop first flips true, `position`
  // can still read "in-between" from before the click for that one render —
  // probe-confirmed on the dev app's Depth deck stacking demo (clicking a
  // depth-2 card): that single mismatched render already uses `focusedStyle`
  // (position: relative, in the flex row — `columnStyle` above already
  // prioritizes `columnFocused` first) while STILL computing real depth-deck
  // `animate` values (reduced opacity, translateZ, and a nonzero
  // `columnAnimateX` offset) from the stale `position`/`stackDepth` — a transform offset
  // applied on top of an already-in-flex-flow element, which paints as a
  // visible jump before the next commit (Scene's registry-correction pass)
  // resets the offset to 0 and the zMV/opacity spring proceeds normally. A
  // column that's genuinely focused (`columnFocused === true`) can NEVER
  // legitimately be "in-between" — `computeColumnPositions` itself always
  // assigns `null` to a focused column — so this guard has zero false-
  // negative risk, it only closes the stale-registry window.
  const isInBetween = !columnFocused && position === "in-between" && stackDepth > 0;

  // This is the COLUMN's own transform (the column is a nested node,
  // position:absolute WITHIN the zero-footprint anchor — see its own JSX
  // comment further down), not the anchor's. Closed-form and
  // anchor-relative — no globally-measured stack-anchor position (that
  // mechanism needed per-render Scene-level re-measurement to stay fresh,
  // exactly the staleness class this design eliminates).
  //
  // The column's own untransformed ("static") position, being
  // position:absolute with no explicit `left` inside a position:relative
  // anchor with no other siblings, is (0,0) of the anchor's own content
  // box — and the anchor's own natural flow LEFT EDGE, once footprint=0
  // and margin=-columnGap fully cancel its net flow contribution, sits
  // flush with whatever follows it (the next focused/in-between sibling)
  // — verified by the flex-gap-plus-negative-margin math: with width=0,
  // the anchor's left edge equals its right edge, and gap(columnGap) +
  // marginRight(-columnGap) = 0 between it and its next sibling, so that
  // sibling's own left edge lands exactly where the anchor already is.
  // So a translateX of -peekOffset*stackDepth (A5 — the pull-out-
  // direction principle: a deck card peeks in the direction it travels
  // when pulled from the deck, so a column deck anchored under the right
  // focused column peeks left, fanned by stackDepth so every deeper
  // card's left edge stays visible past its shallower neighbors) lands
  // the column's own left edge exactly peekOffset*stackDepth px to the
  // left of that anchor point — no absolute coordinate needed anywhere.
  // Outer columns stay at x:0 — they're in the natural flex row position.
  // Same `!columnFocused` guard as isInBetween above, and for the same
  // reason (F5 item 2).
  const columnAnimateX = isInBetween ? -peekOffset * stackDepth : 0;
  // translateZ pushes in-between columns back in 3D space. The stage's
  // perspective (800px) projects them smaller: depth-1 → 800/900 ≈ 0.89×,
  // depth-2 → 800/1000 = 0.80×, depth-3 → 800/1100 ≈ 0.73×.
  // Focused columns explicitly sit at translateZ(0) to participate in the 3D
  // stacking context and always render in front of in-between columns.
  // columnDepth must be declared AFTER isInBetween (variable ordering).
  const columnDepth = isInBetween ? computeDepthTreatment(stackDepth) : { opacity: 1, grayscale: 0, translateZ: 0 };
  // Only in-between columns get depth-scaled opacity. Outer columns are fully
  // opaque — the viewport clips their visibility, not opacity:0.
  const depthOpacity = columnDepth.opacity;
  // Greyscale increases with depth: depth-1 → 25%, depth-2 → 50%, etc.
  // Reinforces the sense of receding into the background.
  const depthGreyscale = columnDepth.grayscale;
  const depthZ = columnDepth.translateZ;
  // Owned greyscale channel — released to no filter at all once settled at
  // identity, so a focused column never roots the backdrop of a glass
  // surface a consumer renders inside it (ui/t:18). See
  // useDepthFilterChannel's own doc comment for the backdrop-root mechanism
  // and for the three cheaper shapes that were measured and rejected.
  const depthFilter = useDepthFilterChannel({
    grayscale: depthGreyscale,
    duration,
    transition: columnTransition,
    motionSeam,
    seamKey: `depthFilter:${name}`,
  });
  // Column-level paint order is DOM-order-driven in practice, and that's
  // design-correct: computeStackDepths (Scene.tsx) assigns depth by
  // walking backward from the rightmost focused column, so depth is
  // structurally guaranteed to equal reverse DOM order for every
  // reachable production state (see that function's own comment — the
  // invariant is load-bearing). translateZ here is paint-INERT, not
  // paint-driving — a multi-round discriminator investigation (ui#o32,
  // the D-series record) forced a genuinely-transformed sibling into an
  // intact preserve-3d chain and it still lost to DOM order; z-index was
  // also tried directly (forced positive, confirmed applied via computed
  // style) and was EQUALLY inert, consistent with the well-documented CSS
  // behavior that z-index has no effect on children of a
  // transform-style:preserve-3d element — actual 3D depth governs there,
  // and that 3D depth-sort is itself the thing the D-series found broken
  // (isolated per-anchor subtrees don't compare against each other).
  // translateZ is retained purely for the perspective-projection
  // foreshortening visual cue (depth-1 → 0.89×, etc.), not for paint
  // order. If a future feature ever breaks the depth ≡ reverse-DOM-order
  // invariant (e.g. reordering columns independent of focus/depth),
  // column-level paint order needs an explicit mechanism — object level
  // (SceneObject.tsx) already has this via its own z-index channel,
  // built for exactly this reason (an object's own inner node sits outside any
  // column's preserve-3d chain, so DOM order there does NOT structurally
  // guarantee correctness the way it does at column level).

  // z-clearance coupling (Michael's ruled invariant, Scene F2 spike 2):
  // objects overlapping in 2D screen space must never change relative paint
  // order — a z-crossing (moving from "behind" toward "in front") is only
  // legal once the pair is disjoint. The invariant is enforced structurally
  // by DOM order today (see computeStackDepths), not by any gating here —
  // an RAF-poll-based front-ward-retarget gate was tried and reverted:
  // unsafe under concurrent test-suite load (see commit history for the
  // full investigation). zMV below is kept only for its debug-observability
  // value (pinnable/observable motion-seam treatment, same as
  // topOffset/scrollY/cameraX).
  const zMV = useMotionValue(depthZ);
  useMotionSeamRegistration(motionSeam, `z:${name}`, zMV);
  const zTargetRef = useRef(depthZ);
  const zOwnedAnimation = useOwnedAnimation(duration);

  useLayoutEffect(() => {
    if (depthZ === zTargetRef.current && !zOwnedAnimation.durationJustBecameZero) return;
    zTargetRef.current = depthZ;

    // ui#33: duration===0 now shares the jump() branch below instead of a
    // raw .set() — see topOffsetMV's identical fix above for the rationale
    // (.set() never calls .stop(), so a live flip mid-spring never stopped
    // the in-flight animation or retired the settle counter).
    if (duration === 0 || firstPaintRef.current || !columnGeometryWasSettled) {
      zOwnedAnimation.jump(zMV, depthZ);
    } else {
      const controls = zOwnedAnimation.animateTo(zMV, depthZ, transition);
      motionSeam?.registerControls(`z:${name}`, controls);
      motionSeam?.registerTarget?.(`z:${name}`, depthZ);
    }
  });

  // In-between columns stay top-aligned at the stage row's own top edge
  // (align-items:stretch's default alignment for a flex item with its own
  // explicit height — see inBetweenStyle's comment). To visually align
  // them with the focused content (which is centered via marginTop), we
  // translate them down to the vertical center of the viewport.
  // colHeight is the column's frozen or natural height — used for centering.
  // For in-between columns without a frozenSize, skip centering (top-aligned)
  // rather than calling getBoundingClientRect which returns projected sizes
  // inside the preserve-3d context.
  const colHeight = frozenSize?.height ?? (isInBetween ? 0 : (colRef.current?.getBoundingClientRect().height ?? 0));
  // Centers within effectiveViewportHeight, not the raw viewportHeight (S6
  // padding cluster — same fix as marginTop above).
  const inBetweenY =
    isInBetween && effectiveViewportHeight > 0 && colHeight > 0
      ? (effectiveViewportHeight - colHeight) / 2
      : 0;

  // A column that mounts for the first time already focused should enter from
  // the right (depth-forward navigation). Motion's `initial`/`animate` props
  // spring `x` from this off-screen starting value to the anchor's own
  // `x` target (always 0 — the anchor never otherwise translates, only
  // the column does, via `columnAnimateX`) — the same x transform channel
  // `animate` always drives, not Motion's `layout` FLIP prop (removed
  // from this node entirely, ui#17; this entrance slide never depended on
  // it).
  // When duration=0 (tests), motion skips the initial state immediately.
  //
  // Gated on !firstPaintRef.current: during Scene's very first paint every
  // focused column looks like it's "mounting" because isMountingRef.current
  // hasn't been cleared yet. The first-paint ref distinguishes a true
  // mid-session late-mount (slide-in wanted) from first paint (no slide-in).
  const mountInitial =
    isMountingRef.current && !firstPaintRef.current && columnFocused && viewportWidth > 0
      ? { x: viewportWidth }
      : undefined;

  const isScrollable = columnFocused && maxScroll > 0;

  // D2/D4: stable id for the content wrapper, unconditional (not gated on
  // focus/scrollability) so the Scrollbar thumb (D4) always has a valid
  // aria-controls target to reference regardless of when it renders.
  const contentWrapperId = `scene-column-content-${name}`;

  // -------------------------------------------------------------------------
  // Touch pan (1:1 finger tracking + release inertia)
  //
  // Mirrors Scrollbar.tsx's setPointerCapture idiom rather than motion's
  // `drag` prop (transform-based; would abandon the deliberate top/left-not-
  // transform text-quality architecture — see the module doc). Gated on
  // columnFocused && isScrollable (mirrors Scrollbar's conditional render)
  // AND pointerType touch/pen only — mouse drag stays native (text selection
  // preserved; the spec's Touch scenarios are finger-only).
  // -------------------------------------------------------------------------

  const handleContentPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!columnFocused || !isScrollable) return;
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      // ui#19 slice (c), A2 column-first-claim: this column's own triad is
      // now the sole consumer for this gesture, on EITHER axis (it decides
      // vertical-vs-horizontal itself below, and never hands off mid-
      // gesture) — stopPropagation so Scene's net-new viewport-level touch
      // triad (which covers ONLY pointers no column claimed) never sees
      // this pointerdown. One classifier decision per gesture.
      e.stopPropagation();
      isDragging.current = true;
      dragStartY.current = e.clientY;
      dragStartX.current = e.clientX;
      // F13 commit 1: fresh gesture — ownership is decided anew by
      // handleContentPointerMove below (classifyTouchGestureDirection).
      touchOwnershipRef.current = "undecided";
      // F13 commit 2: fresh gesture — the velocity tracker must never see
      // samples left over from a PRIOR drag (computeReleaseVelocity has no
      // other way to know they're stale).
      velocitySamplesRef.current = [];
      // ui#19 slice (c): horizontal twin — same rationale, and the 1:1
      // tracking origin for whichever axis this gesture decides.
      panVelocitySamplesRef.current = [];
      dragStartPanOffset.current = panControl?.getPanOffset() ?? 0;
      // A bare .set() does NOT stop an in-flight animate()-driven animation
      // (its own rAF loop keeps overwriting the value — probe-confirmed at
      // source: MotionValue.set() never calls .stop()). A coasting inertia
      // fling from a prior release could still be running here, so it must
      // be stopped explicitly before 1:1 tracking begins.
      // jump() (not stop()) — .stop() halts the animation but leaves
      // scrollY's internal velocity-tracking state untouched, which would
      // let a same-tick grab->release still read the fling's PRE-GRAB
      // velocity and re-fling despite no finger movement; jump() resets
      // that state too (a strict superset of .stop() — its endAnimation
      // default calls .stop() internally). Full regression history:
      // tests/scene-touch.test.tsx's "residual-velocity regression" test.
      scrollY.jump(scrollY.get());
      // F9: this jump can interrupt a still-in-flight wheel/keyboard/
      // scrollbar-driven spring (e.g. a PageDown mid-spring, grabbed
      // before it settles) — .jump()'s stop() doesn't fire onComplete (an
      // interruption, not a completion), so the tracked spring target
      // must be cleared explicitly here too, or a later content-growth
      // compensation event could retarget toward a now-meaningless stale
      // destination instead of correctly falling back to a plain jump.
      scrollYSpringTargetRef.current = null;
      // F13 commit 4: same interruption — a re-grab stops a coasting fling
      // too (the jump() above already halts its animation; this just marks
      // it no-longer-active so a LATER compensation event doesn't try to
      // re-fling something that's no longer running).
      flingActiveRef.current = false;
      // ui#27: same interruption — a touch grab supersedes any wheel stream
      // a pending cliff timer was watching (the jump above already resyncs
      // the model this handler's own way); a stale timer must not fire a
      // later jump into whatever this touch gesture leaves behind. Resets
      // the pairing ratchet too (orchestrator-ruled amendment) — a wheel
      // command arriving after this grab starts a fresh stream.
      if (wheelCliffTimerRef.current !== null) {
        clearTimeout(wheelCliffTimerRef.current);
        wheelCliffTimerRef.current = null;
      }
      wheelStreamPairedRef.current = false;
      lastWheelEventAtRef.current = 0;
      // F15 fix: resync the model from scrollY AFTER the jump above, not
      // before — a coasting fling's own onUpdate keeps scrollOffsetRef
      // synced every animation frame, but this handler runs inside a
      // pointer event, not necessarily aligned to a fresh tick. Deriving
      // dragStartOffset from a guaranteed-fresh scrollY.get() read (the
      // exact value the jump above just re-affirmed) removes any
      // dependency on onUpdate's frame timing, and is correct for EVERY
      // interruption this jump can cause (fling coast OR a mid-spring
      // wheel/keyboard/scrollbar chase, per the jump's own comment above)
      // — either way, once jump() halts it, 1:1 tracking should start from
      // wherever the visual truly is now, not a stale queued destination.
      const resynced = scrollY.get();
      scrollOffsetRef.current = resynced;
      setScrollOffset(resynced);
      dragStartOffset.current = resynced;
      (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    },
    [
      columnFocused,
      isScrollable,
      scrollY,
      panControl,
      flingActiveRef,
      lastWheelEventAtRef,
      scrollOffsetRef,
      scrollYSpringTargetRef,
      setScrollOffset,
      wheelCliffTimerRef,
      wheelStreamPairedRef,
    ],
  );

  const handleContentPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;

      // F13 commit 1: direction disambiguation. Still within the slop on
      // both axes — do nothing yet; classifyTouchGestureDirection's own
      // doc comment covers why waiting costs nothing (the offset math
      // below always measures from the FIXED drag start, so deciding
      // either axis on a later move still applies the full accumulated
      // delta in one step, with no lag).
      if (touchOwnershipRef.current === "undecided") {
        const dx = e.clientX - dragStartX.current;
        const dy = e.clientY - dragStartY.current;
        const decision = classifyTouchGestureDirection(dx, dy);
        if (decision === "undecided") {
          return; // still ambiguous — nothing to apply yet
        }
        touchOwnershipRef.current = decision;
        // Both branches below fall through and apply THIS move's full
        // accumulated delta immediately, same as every subsequent move.
      }

      // ui#19 slice (c), A2 column-first-claim: horizontal ownership keeps
      // tracking (an X-variant of the 1:1 finger tracking below) and drives
      // panOffset through the shared clamp+drive path, on EVERY move this
      // gesture decided "horizontal" (not just the one that decided it) —
      // this column's own triad never releases to native anymore (the
      // pre-ui#19 behavior; there is no native horizontal scroll left to
      // release to under overflow-x:clip).
      if (touchOwnershipRef.current === "horizontal") {
        if (!panControl) return;
        const dx = e.clientX - dragStartX.current;
        // Same sign convention as Scene's own wheel/viewport-triad
        // handling: finger moves left (dx negative) -> content attached to
        // the finger moves left -> panOffset decreases (reveals
        // further-right content).
        panControl.setPanOffset(dragStartPanOffset.current + dx);
        panVelocitySamplesRef.current.push({ t: performance.now(), offset: panControl.getPanOffset() });
        return;
      }

      // touchOwnershipRef.current === "vertical" — 1:1 finger tracking: the
      // finger moving down (deltaY positive) should move the content down
      // too (content "attached" to the finger), which means scrollOffset
      // DECREASES — content top = -(topOffset+scrollOffset).
      const deltaY = e.clientY - dragStartY.current;
      const newOffset = Math.max(
        0,
        Math.min(maxScrollRef.current, dragStartOffset.current - deltaY),
      );
      scrollOffsetRef.current = newOffset;
      // F13 commit 2: own release-velocity tracker — see
      // computeReleaseVelocity's own doc comment. Pushed every move
      // regardless of duration; instant mode never reads the buffer (see
      // handleContentPointerUp below), so this is harmless there.
      velocitySamplesRef.current.push({ t: performance.now(), offset: newOffset });
      // F9 commit 2: the one entry point that bypasses applyScrollCommand
      // entirely (§2c) — release/re-pin evaluated live, every tick, same
      // as every other user-initiated write site. F9 commit 3: ordered
      // BEFORE scrollY.set below — see the scrollBy/page/toTop/toBottom
      // branch's identical comment above.
      updatePinnedState(newOffset, maxScrollRef.current);
      scrollY.set(newOffset);
      // React state (setScrollOffset) is skipped per-tick in real mode — the
      // content wrapper's visual position there is driven entirely by the
      // composedTop MotionValue (see the style branch below), so forcing a
      // re-render on every pointermove tick would be pure overhead (the
      // whole reason this pipeline exists). Instant mode DOES need it: its
      // style write is the synchronous plain-number path (combinedTop),
      // derived from scrollOffset state, so it wouldn't move without this.
      if (duration === 0) {
        setScrollOffset(newOffset);
      }
    },
    [duration, scrollY, anchor, panControl],
  );

  const handleContentPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);

      // ui#19 slice (c), A2 column-first-claim: a gesture this column's
      // triad decided "horizontal" releases through the shared pan fling
      // path instead of the column's own vertical applyScrollCommand —
      // never both (one classifier decision per gesture, per axis).
      if (touchOwnershipRef.current === "horizontal") {
        // Skipped in instant mode — inertia has no meaningful instant
        // equivalent (mirrors the vertical release path's own identical
        // rationale below).
        const velocity =
          duration === 0 ? 0 : computeReleaseVelocity(panVelocitySamplesRef.current, performance.now());
        panControl?.startPanFling(velocity);
        return;
      }

      const releaseOffset = scrollOffsetRef.current;
      // Always sync React state at release (regardless of duration) — keeps
      // the Scrollbar prop and instant-mode style path consistent with the
      // final drag position even though real mode skipped per-tick renders.
      setScrollOffset(releaseOffset);

      // F13 commit 2: own release-velocity tracker (computeReleaseVelocity,
      // inputController.ts) rather than scrollY.getVelocity() at release —
      // see that function's own doc comment for why a MotionValue read here
      // is unreliable exactly when it matters (a 30ms internal cache window
      // a fast release can land just outside of, and — since commit 4 — a
      // value a mid-coast compensation event may have just jumped with no
      // real finger movement behind it). Skipped in instant mode — inertia
      // has no meaningful instant equivalent (forecast-gate plan §2) and
      // applyScrollCommand's fling branch never reads velocity in that case
      // anyway.
      const velocity =
        duration === 0 ? 0 : computeReleaseVelocity(velocitySamplesRef.current, performance.now());
      applyScrollCommand({ type: "fling", velocity });
    },
    [duration, applyScrollCommand, panControl, scrollOffsetRef, setScrollOffset],
  );

  // F13 commit 1: native (non-passive) touchmove listener. React's
  // synthetic pointer/touch event system can't reliably do passive:false
  // (events are delegated at the ROOT, and React special-cases touch
  // listeners as passive by default for scroll-perf reasons) — a
  // preventDefault() that actually blocks the browser's native page-pan
  // requires a listener attached directly to the DOM node, {passive:
  // false}. Device-confirmed necessary even though touch-action computes
  // correctly (see the touchAction style below): Safari's gesture engine
  // doesn't reliably honor it over Scene's transformed subtree, so
  // preventDefault is the load-bearing layer, touch-action the (correct,
  // but insufficient alone) belt.
  //
  // Reads touchOwnershipRef rather than deciding direction itself — per
  // the Pointer Events spec, pointermove always fires before the
  // corresponding native touchmove for the same physical sample, so by
  // the time this listener runs, handleContentPointerMove above has
  // already made this move's ownership decision (shouldPreventTouchMove,
  // inputController.ts, also folds in the multi-touch/pinch exemption —
  // see its own doc comment). Gated the same as the touchAction style
  // below (only meaningful when Scene owns this column's vertical scroll).
  useEffect(() => {
    const el = contentWrapperRef.current;
    if (!el || !columnFocused || !isScrollable) return;

    const handleNativeTouchMove = (e: TouchEvent) => {
      if (shouldPreventTouchMove(touchOwnershipRef.current, e.touches.length)) {
        e.preventDefault();
      }
    };
    el.addEventListener("touchmove", handleNativeTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", handleNativeTouchMove);
  }, [columnFocused, isScrollable]);

  // NOT stabilized (ui#32): `register`/`observeElement`/`unobserveElement`
  // are already useCallback([])-stable and `objectGap` is a primitive, but
  // `withinColumnDepths` above is currently left unmemoized (its own
  // comment explains the caution and the reviewed non-reproduction), so
  // wrapping this in useMemo would never hit its cache — dead weight, not a
  // real stabilization. Revisit alongside `withinColumnDepths`'s own
  // candidate follow-up.
  return (
    <ColumnContext.Provider value={{ register, withinColumnDepths, objectGap, observeElement, unobserveElement }}>
      {/* Invariant: animatable properties (opacity, transform, filter) must only be
          set via animate={}, never inline style. Inline style wins at React commit
          time and silently shadows the spring. See depth.ts for the no-shadow rule.
          `width` is the deliberate exception on THIS node: a real CSS layout
          property, which `animate` cannot touch at all — driven by the owned
          width channel above (widthMV), the same imperative-drive pattern,
          replacing Motion's `layout` FLIP prop entirely (removed from this
          node — see the width channel's own doc comment for why). This node
          is the zero-footprint in-flow ANCHOR — opacity/y/z/filter (the
          depth-deck visual) live on the COLUMN node below instead. `x` stays
          here ONLY for mountInitial's own entrance-slide purpose (a focused
          column's first-mount slide-in from off-screen) — always 0
          otherwise. */}
      <motion.div
        ref={colRef}
        {...(mountInitial ? { initial: mountInitial } : firstPaintRef.current ? { initial: false } : {})}
        data-ui-scene-column-anchor={name}
        data-ui-scene-column-focused={String(columnFocused)}
        data-ui-scene-column-position={position ?? undefined}
        data-ui-scene-stack-depth={isInBetween ? String(stackDepth) : undefined}
        data-ui-scene-max-scroll={isScrollable ? String(maxScroll) : undefined}
        /* data-ui-scene-scroll-offset is written imperatively via the scrollY
           subscription effect below (forecast-gate adjudication #2), not
           React-rendered — per-tick MotionValue changes during a fling must
           not force a re-render just to update this attribute. */
        data-ui-scene-content-height={columnFocused ? String(contentHeight) : undefined}
        animate={{
          x: 0,
        }}
        transition={columnTransition}
        onAnimationStart={animCallbacks?.onStart}
        onAnimationComplete={animCallbacks?.onEnd}
        className={className}
        style={{
          ...columnStyle,
          // Owned width channel — see its own doc comment above (widthMV
          // declaration) for the full design. Applied only while an
          // override is active (unfocused, always; or focused and still
          // mid-spring); released to undefined once a focused column's
          // transition settles, restoring natural cqw/container-query
          // sizing. For an in-between column this is the ANCHOR's own
          // footprint (permanently targeting 0 once known — see
          // widthTarget's own comment), not a visual sliver width.
          ...(widthOverrideActive ? { width: duration === 0 ? widthTarget : widthMV } : {}),
          // Gap-compensation — see marginMV's own declaration comment.
          marginRight: duration === 0 ? marginTarget : marginMV,
          // The anchor itself carries a transform (the `x: 0` above), and a
          // transformed element defaults to transform-style:flat — which
          // flattens ANY descendant's own 3D transform into the anchor's
          // own 2D plane, discarding it visually even though it's still
          // present in that descendant's own computed style. The column's
          // z-transform (the depth-deck perspective projection) needs to
          // keep participating in the viewport/stage's shared 3D context
          // (both already preserve-3d — see their own comments) all the
          // way down to the column, so the anchor has to preserve it too.
          transformStyle: "preserve-3d",
        }}
      >
        {/* The glass COLUMN. ALWAYS rendered (never conditionally
            mounted/unmounted — conditionally wrapping children in an extra
            node would change the tree shape React reconciles against,
            remounting everything inside on every focus change) so its own
            position mode is a plain conditional STYLE, not a structural
            swap. Focused/outer: position:relative, a harmless pass-through
            (a plain block child of a block anchor). In-between:
            position:absolute WITHIN the zero-footprint anchor above — its
            own untransformed ("static") position is (0,0) of the anchor's
            own content box (see columnAnimateX's own comment for the
            geometry this enables), escaping the anchor's own collapsed box
            entirely so the full-size content paints regardless of the
            anchor's own width. This is what makes viewport/container/
            sibling-width changes reach the column via pure CSS reflow of
            the anchor — zero JS re-measurement. */}
        <motion.div
          data-ui-scene-column
          animate={{
            opacity: depthOpacity,
            // z is NOT here, see zMV's declaration above (z-clearance
            // coupling) and the style prop below.
            // filter is NOT here either — it is an owned channel now, bound
            // through the style prop below so it can be RELEASED at rest
            // (ui/t:18). The anti-snap invariant that put it here in the
            // first place (motion cannot interpolate between undefined and a
            // filter string — the unfocus pop, bug 2b) still holds and is
            // still what the owned channel exists to satisfy: it carries a
            // live numeric greyscale across the release rather than handing
            // Motion a keyword to re-parse.
            x: columnAnimateX,
            y: inBetweenY,
          }}
          transition={columnTransition}
          style={{
            position: isInBetween ? "absolute" : "relative",
            top: 0,
            // Establishes a block formatting context in BOTH position
            // modes (position:absolute already does this on its own —
            // this specifically covers position:relative, which
            // otherwise participates in normal margin collapsing).
            // Without it, the content wrapper's own marginTop (see the
            // height comment below) collapses through the column while
            // position:relative, shifting the COLUMN's own top-edge
            // position down by the margin amount — a real, measured
            // discontinuity when the column later flips to
            // position:absolute (where collapsing no longer applies at
            // all): the column's own top edge jumps from a margin-shifted
            // position back to its true (0) one. display:flow-root is the
            // purpose-built way to opt out of collapsing without side
            // effects like clipping.
            display: "flow-root",
            // Explicit height in BOTH position modes, not just when
            // decked — without this, the column's own box shape differs
            // structurally between modes, not just numerically. While
            // position:relative (focused), a shrink-to-fit block's own
            // height normally collapses its first child's marginTop
            // through itself rather than counting it (the content
            // wrapper's own marginTop — the vertical-centering offset for
            // short focused content, computed unconditionally, not gated
            // on focus, since it's meant to hold its value across a focus
            // change — pushes the COLUMN down instead of growing it). Once
            // position:absolute (decked), the column establishes a new
            // block formatting context, margin collapsing no longer
            // applies, and that same marginTop instead balloons the
            // column's own shrink-to-fit height (measured: a 300px column
            // with marginTop:250px shrink-wrapped to 550px, top-shifted by
            // 250px the instant the column flips). The old sliver design's
            // single flex-stretched, clipped node never exposed this — a
            // flex-stretched box's own height comes from the row, not
            // shrink-to-fit, in EITHER mode. height:100% while focused
            // (matching the anchor's own flex-stretch, since the column
            // isn't itself a flex item and doesn't inherit that stretch
            // automatically) and the frozen height once decked keeps the
            // column's own box the same full-column shape in both modes,
            // eliminating the discontinuity rather than just resizing it.
            height: !isInBetween ? "100%" : frozenSize ? frozenSize.height : undefined,
            // Instant mode (duration=0): synchronous plain-number write,
            // same rationale as the content wrapper's `top` below
            // (forecast-gate adjudication #1) — relying on motion's
            // rAF-batched style binding for a synchronous instant-mode
            // write would depend on undocumented same-frame-ordering
            // internals.
            z: duration === 0 ? depthZ : zMV,
            // Owned greyscale channel — a real filter string only while the
            // depth treatment is live, and NO filter property at all once it
            // settles back at identity, so a focused column stops rooting
            // the backdrop of any glass surface inside it. Same
            // pixels-mid-spring/live-CSS-at-rest release shape as `width`
            // below, and released the same way it is: an explicit written
            // value ("none"), never an omitted key. See
            // useDepthFilterChannel's own doc comment.
            filter: depthFilter,
            // Michael's ruling — pixels only mid-spring, live CSS at rest.
            // Active while the column's own override is active (see
            // columnWidthOverrideActive's own comment); released once
            // settled, letting the column's own object-level cqw sizing
            // take over so it tracks viewport resize with zero JS from
            // that point on. The release is an explicit "auto" write, not
            // an omitted key — `width` was bound to a live MotionValue
            // (columnWidthMV) moments earlier, and Motion does not clear a
            // previously MotionValue-bound style key on its own when that
            // key stops appearing in the style object; the last pixel
            // value it wrote stays stuck in the DOM forever (found and
            // reference-fixed in an earlier ui#17 spike investigation of
            // this exact width-channel family). Writing "auto" explicitly
            // is a real style write Motion still applies, so it actually
            // overwrites the stale pixel rather than silently leaving it.
            width: columnWidthOverrideActive ? (duration === 0 ? columnWidthTarget : columnWidthMV) : "auto",
          }}
        >
        {/* Content wrapper: spring-animated top offset for vertical swap.
            margin-top centers focused content vertically when it fits the
            viewport. When content overflows, marginTop is 0 (top-aligned).
            display: flex + flex-direction: column lets gap apply between
            focused objects in multi-focus stacking.
            D2: role="region" + aria-label mark this as a navigable landmark
            only while focused (an offscreen/frozen column has nothing a
            screen reader should announce as a region); tabIndex={0} is
            added ADDITIONALLY only when scrollable — a focused-but-fitting
            column has no keyboard scroll behavior to offer, so it isn't a
            tab stop. Every column content wrapper still gets a stable id
            (D4's aria-controls target) regardless of focus/scrollability. */}
        <motion.div
          ref={contentWrapperRef}
          data-ui-scene-column-content
          id={contentWrapperId}
          {...(columnFocused
            ? { role: "region" as const, "aria-label": `${name} content${isScrollable ? ", scrollable" : ""}` }
            : {})}
          {...(isScrollable ? { tabIndex: 0 } : {})}
          initial={false}
          animate={{ marginTop }}
          transition={marginTopTransition}
          onAnimationStart={animCallbacks?.onStart}
          onAnimationComplete={animCallbacks?.onEnd}
          onPointerDown={handleContentPointerDown}
          onPointerMove={handleContentPointerMove}
          onPointerUp={handleContentPointerUp}
          onPointerCancel={handleContentPointerUp}
          style={{
            position: "relative",
            // Instant mode (duration=0): the synchronous plain-number write,
            // unchanged from before S3 (forecast-gate adjudication #1) — top
            // is NOT MotionValue-driven here.
            // Real animation: top is the composedTop MotionValue, updated
            // off React's render cycle. marginTop still springs via animate
            // above (unchanged) — only its own instant-mode style mirror
            // moves with `duration === 0` here, same as before.
            ...(duration === 0 ? { top: combinedTop, marginTop } : { top: composedTop }),
            // While the column's own width channel is mid-spring, this
            // wrapper stays pinned to a full-size width so `children`
            // never re-lays-out at a narrow/in-flight width — the column
            // never resizes to something narrower than the true content
            // once settled, so this pin is a transition-only guard, not a
            // permanent narrowing (criterion 6, no text distortion).
            // Gated on columnWidthOverrideActive, NOT isInBetween — this is
            // load-bearing, not cosmetic: pinning it for the ENTIRE
            // in-between duration (rather than just mid-spring) would
            // permanently stick the wrapper at its frozen/never-focused
            // width even once the column's own live-cqw sizing should take
            // over at rest. Prefers frozenSize.width (a column that WAS
            // focused, then lost it); falls back to neverFocusedNaturalWidth
            // for a column that mounts already in-between and has no
            // frozenSize at all (see that state's own comment — the
            // deferred-measurement effect further down is what populates
            // it, in lockstep with widthTarget's own inBetweenKnownWidth
            // gate, so this fallback is never consulted before it has a
            // real value to give).
            ...(columnWidthOverrideActive ? { width: frozenSize?.width ?? neverFocusedNaturalWidth } : {}),
            display: "flex",
            flexDirection: "column",
            gap: objectGap || undefined,
            // F8b interior contract: touch-action lives HERE now, not on
            // the viewport (Scene.tsx) — scoped to exactly the same
            // condition the pointer handlers below already gate on
            // (columnFocused && isScrollable), so it restricts only a
            // column that Scene itself needs to own vertical touch drag
            // for. "pan-x pinch-zoom" (not bare "pan-x" — touch-action
            // keywords are exclusive of anything not listed, so a bare
            // "pan-x" would silently disable pinch-zoom too) excludes only
            // vertical pan, handing it to handleContentPointerDown's own
            // 1:1 drag below. When NOT Scene-scrollable (e.g. a focused
            // SceneObject containing its own overflow-y:auto scroll
            // island that fills the column), "auto" imposes nothing —
            // combined with the viewport's own now-unrestricted
            // touch-action, the island's interior vertical touch-pan is
            // no longer blocked by any Scene-owned ancestor.
            touchAction: columnFocused && isScrollable ? "pan-x pinch-zoom" : "auto",
            // CLICK-TARGETING FIX: makes this element ITS OWN
            // stacking-context root, so a sandwiched object's own
            // negative-z-index inner node paints ABOVE this element's own
            // box (a root's background paints first) and stays the real
            // hit-test target for its own exclusive peek sliver — full
            // history: tests/scene-within-column-deck.test.tsx's
            // "sandwiched card click-targeting" describe block. Deliberately
            // `isolation: isolate`, not an explicit z-index or a transform —
            // isolation has no grouping/3D side effects and sits BELOW the
            // column's own preserve-3d participation (SceneColumn's own
            // anchor, above this element), so column-level 3D/paint-order
            // behavior is untouched by construction.
            isolation: "isolate",
          }}
        >
          {children}
        </motion.div>

        {/* Custom scrollbar — only rendered when focused content overflows.
            trackHeight uses effectiveViewportHeight (padding-subtracted,
            same basis as maxScroll) — S6 padding cluster: the raw
            viewportHeight overshot both the thumb size/position math and
            the thumb's own keyboard paging (mapScrollKeyToCommand). */}
        {isScrollable && effectiveViewportHeight > 0 && (
          <Scrollbar
            scrollOffset={scrollOffset}
            scrollY={scrollY}
            maxScroll={maxScroll}
            trackHeight={effectiveViewportHeight}
            controlsId={contentWrapperId}
            onScroll={(newOffset) => {
              // Pointer-drag reports an absolute target offset (computed from
              // track/thumb geometry), not a delta — expressed as a scrollBy
              // command via the delta from the current offset so it goes
              // through the same applyScrollCommand write path as every
              // other scroll source.
              applyScrollCommand({ type: "scrollBy", delta: newOffset - scrollOffsetRef.current });
            }}
            onCommand={applyScrollCommand}
          />
        )}
        </motion.div>
      </motion.div>
    </ColumnContext.Provider>
  );
}

// React.memo (ui#32): protects against prop-driven re-renders now that
// Scene.tsx's context values are stabilized (§2/§4 of the plan — memo alone
// does nothing for context-driven re-renders, and context stabilization
// alone doesn't stop prop-identical re-renders, so both land together).
export const SceneColumn = memo(SceneColumnImpl);

// Explicit displayName allows Scene to detect SceneColumn children via
// child.type.displayName without importing SceneColumn directly (avoiding
// circular import issues). Assigned on the memo wrapper, not the inner
// impl — React.memo doesn't inherit the wrapped component's displayName,
// and sceneLayout.ts's collectColumnFocusStates checks child.type.displayName
// on its first-render prop-walk path.
SceneColumn.displayName = "SceneColumn";
