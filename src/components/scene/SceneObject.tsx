import React, { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useMotionValue } from "motion/react";
import { ColumnContext } from "./SceneColumn";
import { computeDepthTreatment, formatGrayscale } from "./depth";
import { useSceneConfig, computeSceneTransition } from "./useSceneConfig";
import { useIsSceneFirstPaint } from "./SceneFirstPaintContext";
import { useMotionSeam } from "./motionSeam";
import { useOwnedAnimation } from "./ownedAnimation";
import { cn } from "../../utils/cn";

export interface SceneObjectProps {
  /** Stable identifier for this object. Used as data-scene-id and for the implicit column name. */
  name: string;
  /** Whether this object is currently in focus. Focused objects participate in the flex layout. */
  focused: boolean;
  children: React.ReactNode;
  /**
   * Called when an unfocused SceneObject is clicked. The consumer should use
   * this to set `focused={true}` on this object, which triggers a Scene layout
   * transition. Not called when the object is already focused.
   */
  onActivate?: () => void;
  /**
   * Inline styles applied to the outer wrapper div. Useful for setting
   * explicit dimensions (width, height, minWidth) on the object. Stays on
   * the ANCHOR (ui#21 — mirrors ui#17's own placement for width) — see
   * inColumnStyle's own comment for why moving it to the nested panel
   * traces two real failure modes instead.
   */
  style?: React.CSSProperties;
  /**
   * className applied to the outer wrapper div, alongside `style` and
   * SceneObject's own in-column positioning styles — not in place of them.
   * An inline style always wins over a same-property class at React's
   * commit time (e.g. a `!`-marked Tailwind utility is required to visibly
   * override a property SceneObject sets inline, such as `position`).
   */
  className?: string;
  /**
   * How this column's scroll position resets when this object becomes the
   * newly-focused object after a within-column swap (the A2 swap-reset
   * model — a swap always resets deterministically, it never inherits the
   * previously-focused object's scroll position). "top" (default) shows
   * this object from the top of its content; "center" starts roughly
   * centered — e.g. an image viewer where the interesting content sits
   * mid-frame. Read by the parent SceneColumn via child prop introspection
   * (deriveObjectStates) — not used directly by this component.
   */
  resetAlignment?: "top" | "center";
}

/**
 * An individual focusable item within a SceneColumn. When unfocused, the inner
 * content wrapper receives the `inert` attribute, disabling all descendant
 * interaction. The outer wrapper stays interactive for click-to-focus (Phase 8).
 *
 * ui#21 anchor/panel split (the vertical, per-object port of ui#17's
 * anchor/panel pattern — see plans/ui#21 Within-Column Deck Rework Plan
 * (2026-07-31) for the full design): this component's own outer node is a
 * permanent in-flow ANCHOR whose HEIGHT footprint springs natural-height <->
 * 0 (never flips position mode — no flip-back, mirrors ui#17's column
 * anchor exactly). A nested PANEL (`data-scene-panel`) carries the actual
 * depth visual treatment (opacity/filter/z) and the peek-offset TRANSFORM
 * (`y`) — the panel is what flips position:relative <-> position:absolute,
 * with its own `top` held structurally constant (0) across that flip
 * (forecast E4 — the peek offset must live in a transform, never a layout
 * property, for the flip to be zero-pixel).
 *
 * Within a column, focused objects are in flow contributing their natural
 * height; an object sandwiched between two focused siblings contributes
 * ZERO height to flow (permanently, once settled) and is shown via its
 * panel's own depth-card visual treatment instead of being hidden. The
 * column's content wrapper slides vertically to bring the focused object
 * into view.
 *
 * @example
 * <SceneObject name="article" focused={currentView === "article"}>
 *   <ArticlePanel />
 * </SceneObject>
 */
export function SceneObject({ name, focused, children, onActivate, style, className }: SceneObjectProps) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const column = useContext(ColumnContext);
  const { peekOffset, duration, stiffness, damping, slowMo } = useSceneConfig();
  const isFirstPaint = useIsSceneFirstPaint();
  const motionSeam = useMotionSeam();
  // computeSceneTransition (useSceneConfig.tsx) — shared with SceneColumn
  // (Scene F2 C2's DRY extraction).
  const transition = computeSceneTransition({ duration, slowMo, stiffness, damping });
  const objectGap = column?.objectGap ?? 0;

  // D3: an unfocused object with an onActivate handler doubles as a
  // keyboard-reachable activation control (Enter/Space), not just a mouse
  // click target — gated on onActivate presence so a plain non-activatable
  // unfocused object never becomes an unexpected tab stop.
  const activatable = !focused && Boolean(onActivate);

  // Within-column depth deck: this object is sandwiched between two focused
  // siblings. Instead of hiding it, its panel shows depth-card visual
  // treatment stacked behind the lower focused sibling.
  const withinDepthInfo = column?.withinColumnDepths.get(name);
  const withinDepth = withinDepthInfo ? computeDepthTreatment(withinDepthInfo.depth) : undefined;
  const sandwichedNow = Boolean(withinDepthInfo && withinDepth);

  // ---------------------------------------------------------------------
  // Height channel (ui#21 delta claim review ruling): mirrors ui#17's
  // widthMV/widthOverrideActive pattern exactly — pixel override mid-
  // spring, released to live CSS at rest while in-flow (focused or
  // otherwise not sandwiched), permanent 0-target while sandwiched (no
  // flip-back). Unlike width (whose channel lives on the COLUMN, one level
  // above where geometryStore measures the OBJECT — structurally immune to
  // circularity), this channel and geometryStore's own height measurement
  // would read the SAME node if geometryStore kept reading offsetHeight —
  // hence GeometryEntry's own `heightTarget` field, reported here via the
  // extended register() call rather than DOM-measured by the column.
  // ---------------------------------------------------------------------

  // Tracks whether this object has EVER been in-flow (not sandwiched) —
  // mirrors SceneColumn.tsx's own wasEverFocused semantics precisely (a
  // ref, synchronously current within the same commit's own effects).
  const wasEverInFlow = useRef(!sandwichedNow);
  useLayoutEffect(() => {
    if (!sandwichedNow) wasEverInFlow.current = true;
  });

  // Tracks whether this object has EVER been sandwiched — gates the WHOLE
  // height channel below to fully inert (heightTarget always undefined,
  // no override ever applied, no jump/animate ever fires) for an object
  // that has never needed it. Real regression found and fixed here (via
  // the F9 content-growth-anchoring suite breaking): without this gate,
  // heightTarget tracks naturalHeight for ANY in-flow object, including
  // one that's NEVER been sandwiched and never will be — an ordinary
  // content resize on a permanently-focused object (e.g. "top" growing
  // 300->500 while already settled) then reads as a "new target," and the
  // channel springs toward it — briefly holding the anchor at a pixel
  // override instead of letting it track the DOM's own instant auto-height
  // change, corrupting same-commit consumers like computeFocusedContentHeight
  // that expect an immediate, settled value. Mutated DURING RENDER
  // (synchronously, not in a layout effect) specifically to avoid the
  // one-render lag a layout-effect-driven ref update would introduce for
  // heightTarget's OWN computation just below, on the exact render an
  // object first becomes sandwiched — the same class of staleness this
  // file's own earlier iteration hit and had to fix twice. Safe as a
  // render-time ref mutation: monotonic (only ever flips false->true) and
  // idempotent under a double-invoke.
  const wasEverSandwichedRef = useRef(sandwichedNow);
  if (sandwichedNow) wasEverSandwichedRef.current = true;

  // Continuously captures this object's own natural (unconstrained) height
  // — but ONLY while the height override is inactive, i.e. genuinely safe
  // to read (nothing is currently overriding style.height on this same
  // node). Mirrors SceneColumn.tsx's own lastObservedSize "snapshot
  // continuously while safe" pattern — BUT state, not a ref: unlike
  // lastObservedSize (which only ever feeds an EFFECT's own later read,
  // e.g. frozenSize capture on unfocus), this value feeds `heightTarget`
  // BELOW, computed DURING RENDER. A ref update inside the measuring
  // layout effect doesn't itself trigger a re-render, so a plain ref left
  // heightTarget permanently stuck at its initial 0 for any object that
  // never independently re-renders for another reason (real regression,
  // caught empirically: the F9 content-growth-anchoring suite broke
  // wholesale — computeFocusedContentHeight summed 0 for every
  // never-otherwise-re-rendered focused object). Mirrors how
  // computeFocusedWidth's own ref-backed geometryStore reads stay fresh —
  // that mechanism has an explicit `setGeometryVersion` bump forcing a
  // re-render whenever the underlying (ref-stored) geometry actually
  // changes; state here is the direct equivalent for a single object's own
  // value, without needing a parallel version counter. Declared before
  // heightOverrideActive below (read there); the measuring effect itself
  // is declared after, once heightOverrideActive is known for this render.
  const [naturalHeight, setNaturalHeight] = useState(0);

  // Deferred natural-height capture (mirrors SceneColumn.tsx's own
  // neverFocusedNaturalWidth exactly) for an object that mounts already
  // sandwiched, having never been in-flow before — real scenario, not
  // hypothetical: MultiFocusDemo's own default state (dev/pages/
  // ScenePage.tsx) mounts exactly this way. No frozen/prior measurement
  // exists to spring from. Mechanism: heightTarget withholds the 0-target
  // until inFlowKnownHeight is true (below), so on the FIRST render this
  // object is sandwiched-and-never-in-flow, it paints at its natural,
  // un-collapsed height — this effect measures that right here, pre-paint,
  // and stores it, flipping inFlowKnownHeight true and triggering the
  // corrective re-render that applies the real 0-target.
  const [neverInFlowNaturalHeight, setNeverInFlowNaturalHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const neverInFlowSandwiched = sandwichedNow && !wasEverInFlow.current;
    if (neverInFlowSandwiched && neverInFlowNaturalHeight === undefined && contentRef.current) {
      // contentRef (the innermost, unstyled children wrapper), NOT
      // outerRef (the anchor) — the anchor's own offsetHeight is
      // STRUCTURALLY always 0 here regardless of any override: its only
      // child (the panel) is position:absolute the instant sandwichedNow
      // is true, contributing nothing to the anchor's own auto-height
      // flow calculation. Measured this the hard way first (a scratch
      // instrumentation trace showed anchorOffsetHeight: 0 even at a
      // fully-settled sandwiched rest state) before finding contentRef's
      // own auto height is unaffected by any ancestor's position mode.
      const measured = contentRef.current.offsetHeight;
      if (measured > 0) setNeverInFlowNaturalHeight(measured);
    }
  });

  const inFlowKnownHeight = wasEverInFlow.current || neverInFlowNaturalHeight !== undefined;
  // Fully inert (undefined, channel never engages) for an object that has
  // never been sandwiched — see wasEverSandwichedRef's own comment above.
  const heightTarget = !wasEverSandwichedRef.current
    ? undefined
    : sandwichedNow
      ? (inFlowKnownHeight ? 0 : undefined)
      : naturalHeight;

  const heightMV = useMotionValue(heightTarget ?? 0);
  useEffect(() => {
    motionSeam?.registerMotionValue(`height:${name}`, heightMV);
    return () => motionSeam?.unregisterMotionValue?.(`height:${name}`);
  }, [motionSeam, heightMV, name]);

  const heightTargetRef = useRef(heightTarget);
  // Whether the channel's most recent spring has FULLY settled — gates
  // releasing the literal height style override back to natural CSS sizing
  // once an in-flow object's transition completes (a sandwiched object
  // never releases — see the style binding below). Starts true so an
  // object that never transitions never applies an override to begin with.
  const [heightSettled, setHeightSettled] = useState(true);
  const heightOwnedAnimation = useOwnedAnimation();

  useLayoutEffect(() => {
    if (heightTarget === undefined || heightTarget === heightTargetRef.current) return;
    // Jump (not spring) ONLY when this object has never been in-flow
    // before — mirrors width's own isFirstTarget precedent, but keyed on
    // wasEverInFlow, NOT "has heightTarget itself ever been defined."
    // heightTarget starts undefined for EVERY object (the channel is
    // fully inert until the first sandwiching — see wasEverSandwichedRef's
    // own comment), but an object that started focused/in-flow (the
    // common case) already has a REAL rendered height to spring FROM the
    // first time it sandwiches — jumping there instead produces exactly
    // the instant-snap bug this slice exists to fix (real regression
    // found and fixed here: heightMV's own "keep synced while inactive"
    // fix above is the OTHER half of this same story — jump-vs-spring is
    // wrong without a real value to spring FROM, and a real value to
    // spring from is meaningless if the jump decision ignores it anyway).
    // Only an object that mounts already sandwiched, never having been
    // in-flow (wasEverInFlow starts false for that case, matching
    // width's own never-focused-column scenario) genuinely has nothing to
    // spring from — jump is correct there.
    const isFirstTarget = !wasEverInFlow.current;
    heightTargetRef.current = heightTarget;
    if (duration === 0 || isFirstTarget || isFirstPaint) {
      heightOwnedAnimation.jump(heightMV, heightTarget);
      setHeightSettled(true);
    } else {
      setHeightSettled(false);
      const controls = heightOwnedAnimation.animateTo(heightMV, heightTarget, transition, () => {
        setHeightSettled(true);
      });
      motionSeam?.registerControls(`height:${name}`, controls);
      motionSeam?.registerTarget?.(`height:${name}`, heightTarget);
    }
  });

  // Whether the literal height override is currently active: always while
  // sandwiched (an object stays pinned at 0 forever once settled there, it
  // never releases), or while in-flow AND still mid-spring (released once
  // settled — see above).
  //
  // An earlier version ALSO checked `heightTarget !== heightTargetRef.current`
  // in the in-flow branch, to close a one-render window on the FIRST render
  // of a leaving-sandwiched transition (heightSettled, a lagging state,
  // hadn't yet flipped false for THIS new transition — a real 96px
  // discontinuity the RED-FIRST layout-box flip test caught before the
  // contentRef/naturalHeight-as-state fixes existed). REVERTED (real
  // regression found and fixed here, via the F9 content-growth-anchoring
  // suite): that check fires for ANY heightTarget change, including a
  // permanently-in-flow, NEVER-sandwiched object's own ordinary content
  // resize (e.g. "top" growing 300->500 while already focused and
  // settled) — treating a normal auto-height change as an override-worthy
  // event, which then suppresses the SAME-COMMIT live-measurement fallback
  // computeFocusedContentHeight depends on (see the register() call's own
  // comment) for an object that was never supposed to be under this
  // channel's control at all. Retested against the layout-box flip tests
  // after the contentRef/naturalHeight-as-state fixes landed: those fixes
  // alone already close the original 96px window (naturalHeight, now real
  // state with an explicit setState, correctly propagates to a fresh
  // render before heightSettled's own lag ever becomes observable) — this
  // extra check was solving an already-solved problem while breaking an
  // unrelated one.
  const heightOverrideActive = sandwichedNow ? heightTarget !== undefined : !heightSettled;

  // The other half of naturalHeight's capture (declaration above,
  // measurement here): re-measures the object's own natural height on
  // every render the override is INACTIVE — the only time this read is
  // genuinely safe (nothing is currently writing style.height on this same
  // node). Keeps heightTarget's own "natural-height-at-spring-start"
  // value fresh for the NEXT time this object transitions into sandwiched.
  // contentRef, not outerRef — see the deferred-capture effect above for
  // why (the anchor's own offsetHeight is structurally unreliable here).
  // Conditional setState (not unconditional) avoids a render loop when the
  // measured value hasn't actually changed.
  //
  // ALSO keeps heightMV itself in sync via a plain .set() (not a spring)
  // while inactive — real regression found and fixed here: while the
  // channel is inert (heightTarget undefined, e.g. an object that's never
  // been sandwiched, or one that's simply been focused-and-settled since
  // mount), NOTHING was updating heightMV at all, so it stayed frozen at
  // its initial placeholder seed (0). The FIRST time this object becomes
  // sandwiched, the layout effect below springs heightMV toward 0 —
  // 0-to-0, invisibly, no-op — while the DOM instantly loses its natural-
  // height CSS the moment the override activates, an instant 72px-class
  // snap (RED-FIRST outlier detector caught it: exactly the SAME "instant
  // jump" bug this whole slice exists to fix, just relocated to the
  // channel's own bootstrap rather than the old top-reinterpretation). Not
  // gated by wasEverSandwichedRef — even an object that's never yet been
  // sandwiched needs heightMV ready with a real value the FIRST time it is.
  useLayoutEffect(() => {
    if (!heightOverrideActive && contentRef.current) {
      const measured = contentRef.current.offsetHeight;
      if (measured > 0) {
        if (measured !== naturalHeight) setNaturalHeight(measured);
        heightMV.set(measured);
      }
    }
  });

  // ---------------------------------------------------------------------
  // Margin-bottom gap-compensation channel — mirrors SceneColumn.tsx's own
  // marginMV/-columnGap channel vertically. A zero-height flex item (the
  // content wrapper is display:flex; flex-direction:column; gap:objectGap)
  // still inserts one full objectGap on either side of itself — for a
  // settled sandwiched anchor (footprint=0) that's one whole extra
  // objectGap the column wouldn't have if the object were genuinely out of
  // flow. marginBottom springs 0 -> -objectGap in lockstep with the
  // footprint spring (same transition, same trigger commit), canceling
  // that one extra gap. Permanent — never resets, since the anchor never
  // leaves this state once settled (no flip-back).
  // ---------------------------------------------------------------------
  const marginBottomTarget = sandwichedNow && inFlowKnownHeight ? -objectGap : 0;
  const marginBottomMV = useMotionValue(marginBottomTarget);
  useEffect(() => {
    motionSeam?.registerMotionValue(`marginBottom:${name}`, marginBottomMV);
    return () => motionSeam?.unregisterMotionValue?.(`marginBottom:${name}`);
  }, [motionSeam, marginBottomMV, name]);

  const marginBottomTargetRef = useRef(marginBottomTarget);
  const marginBottomOwnedAnimation = useOwnedAnimation();
  useLayoutEffect(() => {
    if (marginBottomTarget === marginBottomTargetRef.current) return;
    marginBottomTargetRef.current = marginBottomTarget;
    if (duration === 0 || isFirstPaint) {
      marginBottomOwnedAnimation.jump(marginBottomMV, marginBottomTarget);
    } else {
      const controls = marginBottomOwnedAnimation.animateTo(marginBottomMV, marginBottomTarget, transition);
      motionSeam?.registerControls(`marginBottom:${name}`, controls);
      motionSeam?.registerTarget?.(`marginBottom:${name}`, marginBottomTarget);
    }
  });

  // ---------------------------------------------------------------------
  // Depth visual treatment (opacity, filter) — moves to the PANEL below
  // (forecast E3+E4 tie-together), declarative (WAAPI-friendly). Gated on
  // `column` (standalone usage outside a Scene gets no depth treatment at
  // all, matching the pre-split behavior of `objectDepthAnimate` being
  // entirely omitted). z is NOT part of this — see the z-index channel
  // below, a separate, discrete (non-animated) mechanism.
  // ---------------------------------------------------------------------
  const depthTreatment = column
    ? focused
      ? { opacity: 1, grayscale: 0 }
      : withinDepthInfo && withinDepth
        ? { opacity: withinDepth.opacity, grayscale: withinDepth.grayscale }
        : { opacity: 0.8, grayscale: 0.25 }
    : undefined;

  // ---------------------------------------------------------------------
  // z-index channel (replaces the object-level translateZ/zMV channel a
  // prior iteration of this file used). Object-level 3D depth-sort never
  // actually reached the panel — a multi-round defeat-check investigation
  // (ui#o32, the D-series record) found three flat transform-style
  // intermediates between here and the nearest preserve-3d ancestor, and
  // even an isolated probe that forced the chain past that didn't restore
  // genuine cross-sibling z-sort. z-index sidesteps the whole 3D-context
  // question — ordinary 2D stacking rules, no preserve-3d chain required
  // anywhere in this component. Discrete, not sprung: there's no
  // meaningful "in-between" z-index value, so this is a plain conditional
  // style write, not a MotionValue — the real design question is flip
  // TIMING, not interpolation (see risingRef below).
  // ---------------------------------------------------------------------

  // Continuously captures the last known sandwiched depth — withinDepthInfo
  // disappears the instant this object is no longer sandwiched (recomputed
  // from the column's registry each render), but a just-risen object still
  // needs to know where it rose FROM until its own rise settles (see
  // risingRef below). Mirrors naturalHeight's own "continuously capture
  // while safe" pattern above.
  const lastSandwichedDepthRef = useRef<number | undefined>(withinDepthInfo?.depth);
  if (withinDepthInfo) lastSandwichedDepthRef.current = withinDepthInfo.depth;

  // Edge-detects the EXACT commit a (previously sandwiched) object becomes
  // focused (a "rise") and stays armed until that SAME rise's own height
  // spring settles. Keyed on `focused` transitioning, NOT on `sandwichedNow`
  // transitioning — real regression found and fixed here: `sandwichedNow`
  // derives from `column.withinColumnDepths`, a registry-derived value
  // that's one-commit-stale by construction (the same class of staleness
  // documented elsewhere in this file/SceneColumn.tsx's own `position`).
  // On the exact render `focused` first flips true, `sandwichedNow` can
  // still read stale-true — an edge condition keyed on `!sandwichedNow`
  // never fires on that render, so the derivation below's `focused ?`
  // branch already returns "auto" before risingRef ever gets armed (caught
  // via the interruption/settle-release test going red on unsevered code:
  // zIndex read "auto" from the very first sampled frame, not a timing
  // race). `focused` itself is a plain prop, not registry-derived, so it
  // has no such lag. `wasEverSandwichedRef` (declared above) excludes an
  // object that's never actually been sandwiched — such an object has
  // nothing to rise FROM, so it should jump straight to "auto", matching
  // wasEverSandwichedRef's own established exclusion for the height
  // channel. NOT gated on bare heightSettled alone — heightSettled ALSO
  // flips false for an unrelated content-resize on an already-settled,
  // long-focused object (heightTarget tracks naturalHeight even when never
  // recently sandwiched — see heightTarget's own declaration above), which
  // would otherwise incorrectly drop zIndex mid-resize. Render-time ref
  // mutation, same idiom as wasEverSandwichedRef above — re-arms cleanly
  // on every genuine re-rise, including one that interrupts an earlier
  // unsettled rise, since it's edge-triggered every render rather than a
  // one-shot latch.
  const wasFocusedLastRenderRef = useRef(focused);
  const risingRef = useRef(false);
  // Disarm check runs FIRST, against risingRef's value as of the END of
  // the PRIOR render — real regression found and fixed here: heightSettled
  // can ALSO still read stale-true on the exact render risingRef arms
  // (heightTarget's own computation depends on the same stale
  // sandwichedNow, so the height channel's layout effect hasn't detected a
  // new target yet either, and heightSettled hasn't flipped false for
  // THIS rise). Checking disarm before arm (rather than unconditionally
  // after) means a fresh arm on this render can never be immediately
  // undone by a heightSettled reading that predates this transition.
  if (risingRef.current && heightSettled) {
    risingRef.current = false;
  }
  if (!wasFocusedLastRenderRef.current && focused && wasEverSandwichedRef.current) {
    risingRef.current = true;
  }
  wasFocusedLastRenderRef.current = focused;

  // Sinking (focused -> sandwiched) is unconditional on focus state alone
  // — the object drops behind its neighbor from the very first commit, for
  // the WHOLE transition (Michael's o26 description: behind throughout,
  // not just at the end). This is also what makes an interrupted rise safe
  // with no special-case code: the moment `focused` flips back false, this
  // branch takes over regardless of risingRef's own state — a riser
  // interrupted mid-rise is never stranded on top.
  const zIndex: number | "auto" = focused
    ? risingRef.current
      ? -(lastSandwichedDepthRef.current ?? 1)
      : "auto"
    : withinDepthInfo && withinDepth
      ? -withinDepthInfo.depth
      : // Ordinary in-flow unfocused object with no depth info (no known
        // neighbor it needs to stay behind) — explicit "auto", a decision,
        // not an accidental fallthrough.
        "auto";

  // Peek offset (forecast E4 — required fix, not a toss-up): lives ENTIRELY
  // in the panel's own `y` TRANSFORM, never in a layout property (`top`/
  // `left`) — a layout property Motion can't reliably zero-pixel-flip the
  // way it can a transform, mirroring ui#17's own panelAnimateX/inBetweenY
  // precedent exactly. Only the DEPTH matters here, not a cross-object
  // measured anchor position: once every sandwiched object gets its own
  // zero-footprint in-flow anchor, its own local origin already converges
  // on "flush against the lower focused sibling" for free (the plan's own
  // reasoning that predicted `WithinColumnDepthInfo.anchorTop` — the
  // cross-object geometryStore read this component never consumed — was
  // vestigial; deleted at its own definition, ui#21 Slice 4 hygiene) — the
  // transform only needs to apply the peek itself.
  const peekY = sandwichedNow ? -peekOffset * withinDepthInfo!.depth : 0;

  // Register this object's DOM element, focus state, and height-channel
  // target with the parent SceneColumn so the column can track it (ui#21:
  // heightTarget added — see GeometryEntry's own doc comment for why this
  // must be REPORTED, not DOM-measured, by the column). useLayoutEffect
  // fires bottom-up (children before parent), ensuring registration
  // happens before the column's own useLayoutEffect reads the registered
  // elements.
  //
  // Reports heightTarget ONLY while heightOverrideActive — i.e. only when
  // el.offsetHeight (the column's OWN existing, already-synchronous live
  // measurement, GeometryEntry's `height` field, unchanged) would actually
  // be circular (this same node is what the override writes to). Real
  // regression found and fixed here (empirically, via the F9 content-
  // growth-anchoring suite breaking wholesale): reporting heightTarget
  // UNCONDITIONALLY introduces a one-render lag for the common
  // never-overridden case — naturalHeight is STATE, so a fresh DOM
  // measurement taken in this SAME commit's layout effect can't
  // retroactively update the ALREADY-COMPUTED heightTarget local this
  // render passes to register(); it only takes effect on the NEXT
  // re-render. computeFocusedContentHeight's own `heightTarget ?? height`
  // fallback already exists for exactly this handoff — reporting undefined
  // here when there's nothing to protect against lets same-commit
  // consumers keep reading the always-fresh live value, matching the
  // width channel's own zero-added-latency guarantee.
  //
  // Unconditional per-render (no deps array, S6 registration architecture,
  // Medium-2): a focus-only change must be reflected in the registry the
  // SAME commit — gating on [column, name] would only refire on remount,
  // leaving the column's registeredObjectFocusRef stale until some later,
  // unrelated re-render.
  useLayoutEffect(() => {
    if (!column || !outerRef.current) return;
    return column.register(name, outerRef.current, focused, heightOverrideActive ? heightTarget : undefined);
  });

  // When this object transitions from unfocused to focused, move keyboard
  // focus to the first focusable element inside it so keyboard users land
  // directly in the new content without needing to tab manually.
  //
  // We use useEffect (not useLayoutEffect) so the DOM has been painted and the
  // inner wrapper's `inert` attribute has been removed before we try to focus.
  // The dependency on `focused` ensures this only fires when focus state changes,
  // not on every render.
  const prevFocusedRef = useRef(focused);
  useEffect(() => {
    const justBecameFocused = focused && !prevFocusedRef.current;
    prevFocusedRef.current = focused;

    if (!justBecameFocused || !outerRef.current) return;

    const focusable = outerRef.current.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    // D5: preventScroll avoids the browser auto-scrolling an ancestor to
    // reveal the newly focused element — the camera owns horizontal
    // positioning itself (see Scene.tsx's DELTA-2 fix for the scrollLeft
    // corruption a native scroll-into-view causes when it isn't prevented).
    // Fallback: with no focusable descendant, focus the outer wrapper
    // itself — its permanent tabIndex={-1} baseline (below) makes it
    // programmatically focusable without adding a stray tab stop, and is
    // self-contained (no cross-component dependency on D2's conditional
    // content-wrapper tabindex).
    if (focusable) {
      focusable.focus({ preventScroll: true });
    } else {
      outerRef.current.focus({ preventScroll: true });
    }
  }, [focused]);

  // The anchor is ALWAYS in flow (position:relative) — no more flip to
  // position:absolute here (ui#21: that flip moves to the panel below).
  // Standalone usage (no column) gets the same single relative style it
  // always did.
  const inColumnStyle: React.CSSProperties | undefined = column ? { position: "relative" } : undefined;

  return (
    <motion.div
      ref={outerRef}
      data-scene-id={name}
      data-focused={String(focused)}
      {...(withinDepthInfo ? { "data-within-column-depth": String(withinDepthInfo.depth) } : {})}
      // D5 fallback focus target: -1 by default (programmatically focusable
      // via the effect above, never a Tab stop); D3 promotes it to a real
      // tab stop (0) when activatable.
      tabIndex={activatable ? 0 : -1}
      {...(activatable
        ? {
            role: "button" as const,
            onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              // preventDefault on Space so the page doesn't also scroll.
              if (e.key === " ") e.preventDefault();
              onActivate?.();
            },
          }
        : {})}
      className={cn(
        // Author-drawn :focus-visible ring (ui#21 delta claim review,
        // panel-placement ruling — Michael: "on the card makes sense").
        // FOCUS SEMANTICS live here (this is the tabIndex/actual DOM focus
        // target) — the ring itself now PAINTS on the panel below, via
        // Tailwind's `group`/`group-focus-visible:` pattern (this element
        // is the group; see the panel's own className for the paint side).
        // Originally drawn on the anchor itself (replacing the browser's
        // native outline:auto, which the anchor/panel split broke —
        // Michael's occlusion read, confirmed by direct measurement: the
        // native "auto" ring straddles the border edge rather than
        // drawing purely outside it, so any opaque descendant painting
        // inside the anchor's own border-box occludes roughly half of
        // it). Moving the PAINT to the panel fixes a second, related
        // problem the anchor-placed ring never solved: a SANDWICHED
        // object's anchor is a zero-footprint, invisible wrapper — a ring
        // drawn there was never visible on the actual (tucked) card a
        // keyboard user sees. `outline-none` still lives here — this
        // element is the real DOM focus target, so it's the one that
        // would otherwise show the browser's native outline:auto; `group`
        // has no visual effect of its own, it only makes this element a
        // valid `group-*:` target for the panel below.
        "outline-none group",
        className,
      )}
      style={{
        ...inColumnStyle,
        // Owned height channel — see its own doc comment above (heightMV
        // declaration) for the full design. Applied only while an override
        // is active (sandwiched, always; or in-flow and still mid-spring);
        // released to undefined once an in-flow object's transition
        // settles, restoring natural CSS sizing.
        ...(heightOverrideActive ? { height: duration === 0 ? heightTarget : heightMV } : {}),
        // Gap-compensation — see marginBottomMV's own declaration comment.
        marginBottom: duration === 0 ? marginBottomTarget : marginBottomMV,
        ...style,
      }}
      onClick={!focused ? onActivate : undefined}
    >
      {/* The glass PANEL (ui#21). ALWAYS rendered (never conditionally
          mounted/unmounted — conditionally wrapping children in an extra
          node would change the tree shape React reconciles against,
          remounting everything inside on every focus change) so its own
          position mode is a plain conditional STYLE, not a structural
          swap. Focused/in-flow: position:relative, a harmless pass-through.
          Sandwiched: position:absolute WITHIN the zero-footprint anchor
          above — its own untransformed ("static") position is (0,0) of the
          anchor's own content box, escaping the anchor's own collapsed box
          entirely so the full-size content paints regardless of the
          anchor's own height (mirrors SceneColumn's own data-column-panel
          exactly). Paint order at the depth-deck flip commit is driven by
          an explicit z-index channel (see its own declaration above), not
          3D-transform depth-sort — a multi-round defeat-check
          investigation (ui#o32, the D-series record) found object-level
          translateZ never actually reached the panel (three flat
          transform-style intermediates between here and the nearest
          preserve-3d ancestor), and even an isolated probe that forced
          the chain past that didn't restore genuine cross-sibling z-sort.
          z-index sidesteps the whole question — it works within ordinary
          2D stacking rules, no preserve-3d chain needed anywhere in this
          component. */}
      <motion.div
        data-scene-panel={name}
        className={cn(
          // Ring PAINT (the anchor above is the `group` — its own
          // className has the full design history). outline-offset-0 (see
          // below) — a non-"auto" style is spec-guaranteed to render
          // outward-only, so it still draws entirely outside THIS
          // element's (the panel's) own border edge, the same
          // descendant-occlusion immunity the original design required,
          // now measured against the panel's own box instead of the
          // anchor's.
          //
          // CUSTOMIZATION CONTRACT (Michael's ruling): consumers override
          // the ring by setting these four CSS custom properties on any
          // ancestor (they inherit) — --scene-focus-ring-color (default
          // rgb(153,200,255)), --scene-focus-ring-width (default 2px,
          // Michael's directive — was 1px on the anchor-placed original),
          // --scene-focus-ring-offset (default 0), and
          // --scene-focus-ring-radius (default 0 — square; the library
          // doesn't know a consumer's own card rounding, so it never
          // guesses one, mirroring ui#o28's overridable-default contract
          // — see the panel's own borderRadius style declaration below,
          // not gated on focus since the panel carries no background/
          // border/overflow of its own in any state, verified at source,
          // so an always-applied radius shapes ONLY the ring). Arbitrary
          // PROPERTY syntax (`[prop:value]`), not Tailwind's `outline-*`
          // scale utilities, since those can't target outline-width/
          // -offset/-color independently when the value is a var()
          // reference rather than a literal.
          "outline-none group-focus-visible:outline-solid group-focus-visible:[outline-width:var(--scene-focus-ring-width,2px)] group-focus-visible:[outline-offset:var(--scene-focus-ring-offset,0px)] group-focus-visible:[outline-color:var(--scene-focus-ring-color,rgb(153,200,255))]",
        )}
        {...(depthTreatment
          ? {
              animate: {
                opacity: depthTreatment.opacity,
                y: peekY,
                // Always emit a valid filter string — motion cannot
                // interpolate between undefined and a filter string, which
                // caused the unfocus pop (bug 2b, H8).
                filter: formatGrayscale(depthTreatment.grayscale),
              },
              transition,
            }
          : {})}
        style={{
          position: sandwichedNow ? "absolute" : "relative",
          top: 0,
          // Explicit width in BOTH position modes, mirroring the height
          // comment below — the anchor's own width (the consumer's `style`
          // prop, e.g. `width: 480`) is static, never sprung by this
          // rework, so the panel simply always fills it. Without this the
          // panel shrink-to-fits its own content width instead, a real
          // measured discontinuity at the flip (272px, caught by the
          // RED-FIRST layout-box flip test before this line existed).
          width: "100%",
          // Establishes a block formatting context in BOTH position modes
          // (mirrors SceneColumn's own data-column-panel exactly, same
          // ui#17 margin-collapse trap the plan explicitly carries forward
          // — a child's own top margin would otherwise collapse through
          // this panel while position:relative, shifting its own top-edge
          // position, then NOT collapse once position:absolute, a real
          // measured discontinuity at the flip).
          display: "flow-root",
          // Explicit height in BOTH position modes, not just while
          // sandwiched — without this the panel's own box SHAPE differs
          // structurally between modes, not just numerically (same ui#17
          // trap). Gated on !heightOverrideActive (settled), NOT
          // !sandwichedNow (flipped) — a first attempt gating on
          // sandwichedNow directly showed a real 96px height discontinuity
          // at the FOCUS-direction flip commit (RED-FIRST layout-box test
          // caught it): the anchor's own height spring starts EXACTLY at
          // its "from" value (0, mid-collapse) on the flip's own frame, so
          // "100%" of it at that instant is still ~0 — the panel must keep
          // using the STATIC natural-height snapshot through the WHOLE
          // transition (not just while sandwiched), only switching to
          // "100%" (tracking the anchor live) once the height channel has
          // actually released, mirroring SceneColumn's own "released once
          // settled, letting the panel's own object-level sizing take
          // over" precedent for its width channel.
          height: !heightOverrideActive ? "100%" : naturalHeight || undefined,
          // z-index channel — see its own declaration above for the full
          // flip-timing design. Always written explicitly ("auto" or a
          // depth-scaled negative integer), never omitted, matching this
          // file's established explicit-release convention elsewhere.
          zIndex,
          // Ring customization contract, radius half (see the panel's own
          // className comment above for the full four-var contract) —
          // shapes the outline (outline follows border-radius per spec),
          // not gated on focus-visible: the panel carries no background/
          // border/overflow of its own in any state (verified at source —
          // this style object and the className above are its ONLY visual
          // properties), so an always-applied radius has no effect except
          // shaping whatever outline gets drawn. Default 0 (square) — the
          // library never guesses a consumer's own card rounding.
          borderRadius: "var(--scene-focus-ring-radius,0px)",
        }}
      >
        {/* Inner wrapper: inert when unfocused to disable all descendant interaction.
            React 19 treats inert={true} as the attribute present, inert={false} as absent.
            Also the natural-height measurement source (ui#21) — see
            naturalHeight's own comment above for why: unlike the anchor
            or the panel (both circularly affected by the height channel's
            own override, either directly or via a percentage-height
            resolving against it), this plain, unstyled div's own auto
            height is governed purely by its CONTENT, regardless of
            whatever position mode or override its ancestors currently
            carry. */}
        <div ref={contentRef} inert={!focused}>
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}
