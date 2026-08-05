import { useCallback, useEffect, useRef, useState } from "react";
import { animate, useMotionValue, type MotionValue } from "motion/react";
import type { Transition } from "motion/react";
import type { MotionSeamRegistration } from "./motionSeam";
import {
  isInteractiveElement,
  mapScrollKeyToCommand,
  isAtScrollEnd,
  findScrollToTarget,
  computeNearestEdgeScrollOffset,
  clampSpringRetargetVelocity,
  SPRING_RUBBER_BAND_MARGIN_PX,
  shouldCliffStop,
  opposesOutstandingDebt,
  WHEEL_CLIFF_SILENCE_MS,
  WHEEL_CLIFF_DELTA_FLOOR_PX,
  WHEEL_CLIFF_OUTSTANDING_FLOOR_PX,
  WHEEL_STREAM_PAIRING_MS,
  type ScrollCommand,
} from "./inputController";

/**
 * SceneColumn's scroll/wheel/keyboard/scrollTo/pin/inertia pipeline (ui#24
 * Cluster C extraction, riding the ui#24+28 arc per Michael's ruling, feed
 * #2626): the full write-path for vertical scroll — the scrollY MotionValue
 * and its driving refs, maxScroll/pin-state tracking, applyScrollCommand
 * (wheel/keyboard/scrollbar/fling dispatch, including the ui#27 wheel-cliff
 * detector and pairing gate), the keyboard scroll listener, and the
 * declarative scrollTo effect.
 *
 * A HUB, not a sink: unlike useColumnAnchoring (which takes params and
 * returns void), this hook's internals are consumed by code that stays in
 * SceneColumn.tsx — the swap-reset (A2) effect, touch's pointer handlers,
 * useColumnAnchoring's own call site, and rendering/JSX (Scrollbar,
 * scrollOffset reads). It therefore RETURNS an interface object rather than
 * writing through passed-in refs the way useColumnAnchoring does.
 *
 * Shared-refs manifest (mirrors useColumnAnchoring.ts's own manifest
 * convention) — every returned ref/value below is the SAME INSTANCE
 * SceneColumn's staying code reads or writes; a caller must never re-declare
 * a local stand-in for any of them:
 * - `scrollOffsetRef` / `setScrollOffset` — 3-domain writer set: this hook
 *   internally (×6 sites), the swap-reset (A2) effect, and touch's pointer
 *   handlers. `scrollOffset` (the React-state mirror) is also read directly
 *   by rendering (combinedTop) and the Scrollbar prop.
 * - `maxScrollRef` / `maxScroll` — single writer here; read by touch
 *   (bounds clamping), the onScroll effect, `isScrollable`, and rendering
 *   (the max-scroll data attribute, Scrollbar prop).
 * - `viewportHeightRef` — single writer here; read by useColumnAnchoring
 *   (an inverted seam — this hook owns it, useColumnAnchoring only reads
 *   it) and the onScroll effect.
 * - `contentHeightRef` — mirrors the `contentHeight` param; read only by
 *   the onScroll effect (stale-closure avoidance for its change-event
 *   callback).
 * - `pinnedRef` / `updatePinnedState` — written at every user-initiated
 *   write site (here and in touch); read by the onScroll effect
 *   (`anchored` field).
 * - `driveScrollYRef` — the standard-chase scrollY driver; called by the
 *   swap-reset (A2) effect in addition to this hook's own write paths.
 * - `applyScrollYDeltaRef` — assigned here, called by useColumnAnchoring's
 *   content-growth/prepend compensation (the literal geometry→scroll seam;
 *   unchanged from before this extraction).
 * - `applyScrollCommand` — this hook's single write-path closure; called
 *   externally by touch's release (fling) handler and the Scrollbar's
 *   pointer-drag/keyboard callbacks.
 * - `scrollYSpringTargetRef` / `flingActiveRef` / the wheel-cliff timer and
 *   pairing refs (`wheelCliffTimerRef`, `wheelStreamPairedRef`,
 *   `lastWheelEventAtRef`) — cleared by touch's `handleContentPointerDown`
 *   on every grab (a touch grab supersedes any in-flight spring or wheel
 *   stream this hook was tracking).
 * - `resyncScrollMetricsRef` — populated by the onScroll effect; called
 *   here (the inertia settle callback) to force a metrics resync after a
 *   re-pin decision no scrollY change event will otherwise carry.
 * - `scrollY` itself — the MotionValue driving `top`; read by touch, the
 *   `data-ui-scene-scroll-offset` writer effect, the onScroll effect, and
 *   rendering (`composedTop`).
 */
export interface UseColumnScrollParams {
  name: string;
  anchor: "none" | "end";
  duration: number | undefined;
  transition: Transition;
  stiffness: number;
  damping: number;
  touchPower: number;
  touchTimeConstant: number;
  motionSeam: MotionSeamRegistration | null;
  columnFocused: boolean;
  contentHeight: number;
  effectiveViewportHeight: number;
  scrollCommandRegistry: Map<string, (cmd: ScrollCommand) => void>;
  colRef: React.MutableRefObject<HTMLDivElement | null>;
  contentWrapperRef: React.MutableRefObject<HTMLDivElement | null>;
  scrollTo: string | null;
}

export interface UseColumnScrollResult {
  scrollY: MotionValue<number>;
  scrollOffset: number;
  setScrollOffset: (value: number) => void;
  scrollOffsetRef: React.MutableRefObject<number>;
  maxScroll: number;
  maxScrollRef: React.MutableRefObject<number>;
  viewportHeightRef: React.MutableRefObject<number>;
  contentHeightRef: React.MutableRefObject<number>;
  pinnedRef: React.MutableRefObject<boolean>;
  updatePinnedState: (offset: number, maxScrollValue: number) => void;
  driveScrollYRef: React.MutableRefObject<(target: number) => void>;
  applyScrollYDeltaRef: React.MutableRefObject<(delta: number) => void>;
  applyScrollCommand: (cmd: ScrollCommand) => void;
  scrollYSpringTargetRef: React.MutableRefObject<number | null>;
  flingActiveRef: React.MutableRefObject<boolean>;
  wheelCliffTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  wheelStreamPairedRef: React.MutableRefObject<boolean>;
  lastWheelEventAtRef: React.MutableRefObject<number>;
  resyncScrollMetricsRef: React.MutableRefObject<(() => void) | null>;
}

export function useColumnScroll(params: UseColumnScrollParams): UseColumnScrollResult {
  const {
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
  } = params;

  // S3 motion pipeline: scrollY mirrors scrollOffset (below) as a MotionValue
  // so the content wrapper's `top` can be driven off React's render cycle —
  // touch pan (commit 2) needs 1:1 per-frame writes without forcing a
  // re-render on every pointermove. scrollY represents the JS scroll amount
  // alone (not the swap offset), keeping its bounds naturally [0, maxScroll]
  // for inertia's min/max in commit 2.
  //
  // Deliberately NOT routed through ownedAnimation's settle-signal seam
  // (ui#17 cascade-fix round, Step 2 audit) despite being an animate()-
  // driven channel like width/margin/z/topOffset above: scrollY is
  // vertical content-scroll offset WITHIN a column, which never changes
  // the column's own outer bounding box — the only thing Scene's camera-
  // recentering effect ever measures — so wiring it in would add zero
  // camera-correctness benefit. It would add real risk: scrollY drives a
  // heavily-tuned, empirically-measured physics system (wheel coalescing,
  // reentrant boundary rubber-banding, touch-drag 1:1 tracking, release
  // inertia — see driveBoundedSpring's own comment for the measured
  // tuning this represents) across many call sites, several of which are
  // continuously re-triggered during active user interaction (a sustained
  // wheel/drag session would keep this channel perpetually claimed,
  // delaying every OTHER channel's zero-crossing for as long as the user
  // keeps scrolling — harmless for camera correctness since scrollY was
  // never camera-relevant, but an unnecessary coupling between two
  // unrelated systems for no benefit). Confirmed empirically: a frame-by-
  // frame trace of scrollY through a camera-recentering window showed its
  // value never moving by more than floating-point noise.
  const scrollY = useMotionValue(0);
  // scrollY.getVelocity() is used at TWO call sites, both mid-animation
  // (never at release — F13 commit 2 replaced the release-time read with
  // computeReleaseVelocity's own drag-sample tracker; see its doc comment
  // for why a MotionValue read is unreliable exactly there): the mid-coast
  // re-fling capture in applyScrollYDeltaRef (F13 commit 4) and the
  // in-flight-spring-retarget capture just below it. Both are valid
  // precisely because they're mid-animation, not post-jump/release —
  // getVelocity() is always computed fresh with no caching, so it
  // correctly reflects the currently-running animation's real velocity;
  // the staleness class this used to guard against (probe-confirmed:
  // useVelocity(scrollY)'s CACHED signal, which only refreshes on a
  // "change" event or an elapsed animation frame tick — neither guaranteed
  // in a same-tick grab->release) was specific to the RELEASE-time read
  // this file no longer makes.
  useEffect(() => {
    motionSeam?.registerMotionValue(`scrollY:${name}`, scrollY);
    return () => motionSeam?.unregisterMotionValue?.(`scrollY:${name}`);
  }, [motionSeam, scrollY, name]);

  // Drives scrollY in parallel with the existing scrollOffset React state at
  // every write site below (wheel/keyboard/swap-reset/scrollbar). duration=0
  // uses `.set()` directly (NOT animate(...,{duration:0}) — async completion
  // semantics differ, forecast-gate adjudication #1); otherwise `animate()`
  // retargets the in-flight spring exactly like the old animate={{top}} prop
  // did on every tick (the "spring-chase" feel). Stored in a ref (mirroring
  // this file's viewportHeightRef/maxScrollRef pattern) so the stable-closure
  // effects below (wheel, keyboard — subscribed once via `[]` deps) always
  // call the latest version instead of a stale one captured at mount.
  const driveScrollYRef = useRef<(target: number) => void>(() => {});

  // F13 commit 4: true while a REAL multi-frame inertia coast (the
  // type:"inertia" animate() call assigned to startInertiaFlingRef below)
  // is actively running — distinct from scrollYSpringTargetRef, which only
  // tracks destination-based (driveScrollYRef) springs; an inertia coast
  // has no fixed destination to track (see applyScrollCommand's fling
  // branch — no registerTarget call there, on purpose). Read by
  // applyScrollYDeltaRef to decide whether a content-growth/prepend
  // compensation arriving mid-coast must RE-FLING (preserve the user's
  // momentum) rather than plain-jump (silently killing it — jump()
  // unconditionally stops any in-flight Motion animation, fling included).
  // Cleared at every write-path entry that supersedes or completes the
  // coast: startInertiaFlingRef's own onComplete (natural settle), and
  // every other direct scrollY write site below (driveScrollYRef, the
  // maxScroll-shrink clamp effect, the follow-the-end pin effect,
  // handleContentPointerDown's own re-grab jump) — each superseding write
  // clears it at its own site, mirroring how those same sites already
  // clear scrollYSpringTargetRef for the identical reason.
  const flingActiveRef = useRef(false);

  // F13 commit 4: extracted so BOTH applyScrollCommand's release-time fling
  // branch below AND applyScrollYDeltaRef's mid-coast re-fling (content-
  // growth compensation arriving while a fling is active) share the exact
  // same inertia call — no duplicated animate() invocation to drift out of
  // sync. Declared empty here (mirrors driveScrollYRef's own two-step
  // ref-then-assign pattern just above) and assigned its real
  // implementation further down, once every dependency it needs
  // (maxScrollRef, the tuned inertia params, updatePinnedState,
  // resyncScrollMetricsRef) is in scope.
  const startInertiaFlingRef = useRef<(velocity: number) => void>(() => {});

  // F9 anchoring: the destination a REAL-mode scrollY spring is currently
  // animating toward, or null when at rest (no live spring). Content-growth
  // compensation (below) reads this to decide between retargeting an
  // in-flight spring by the compensation delta (adjudication 1 — carries
  // momentum) and a plain jump when nothing is currently animating (nothing
  // further to animate toward). Cleared on the spring's NATURAL completion
  // via onComplete — NOT on interruption (`.stop()`/`.jump()`), since every
  // call site that stops a running spring immediately either sets a fresh
  // target (a new command, or compensation's own retarget) or explicitly
  // clears this ref itself (see handleContentPointerDown, the maxScroll-
  // shrink clamp effect below).
  const scrollYSpringTargetRef = useRef<number | null>(null);

  // ui#27: the pending wheel catch-stop (cliff) timer handle, armed on
  // every wheel-tagged scrollBy command and cancelled by anything that
  // supersedes the stream it's watching (a fresh wheel-tagged scrollBy
  // re-arms it; everything else — a non-wheel command, or a touch grab via
  // handleContentPointerDown — just cancels it, since the debt calculation
  // it's watching is about to become stale). Null when no wheel stream is
  // currently being watched for a catch.
  const wheelCliffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The absolute magnitude of the most recent wheel-tagged scrollBy's own
  // delta — read by the timer callback below (fresh at fire time, not a
  // stale closure) to decide whether the stream that just went silent
  // ended on a still-large delta (a catch) or had already faded out
  // (natural decay, WHEEL_CLIFF_DELTA_FLOOR_PX excludes it).
  const lastWheelDeltaAbsPxRef = useRef(0);

  // ui#27, orchestrator-ruled amendment: whether the CURRENT unbroken wheel
  // stream has been confirmed as a real stream — at least two wheel-tagged
  // scrollBy commands landing within WHEEL_STREAM_PAIRING_MS of each other
  // (see that constant's own doc comment for why). A RATCHET: once paired,
  // stays paired for the rest of the stream regardless of any later gap —
  // only the enumerated reset points below (cliff fire, a non-wheel command
  // superseding the stream, the compensation-path cancel, a touch grab, or
  // the silence timer elapsing without firing) clear it. The cliff timer
  // may only ARM while this is true — a lone single wheel command (this
  // stays false until a second one arrives close behind) is an ordinary,
  // uncaught scroll, not a stream with anything to catch.
  const wheelStreamPairedRef = useRef(false);
  // Timestamp (performance.now()) of the most recent wheel-tagged scrollBy
  // — used only to compute the gap for the pairing check above. 0 means
  // "no wheel event since the last reset," matching every reset site's own
  // convention below.
  const lastWheelEventAtRef = useRef(0);

  // F9 commit 2: whether this column's follow-the-end pin is currently
  // engaged (anchor="end" only — always false/unused for anchor="none").
  // Starts pinned per the design doc's "Initial mount of an anchor='end'
  // column starts pinned at end" rule. The growth-while-pinned effect
  // below is what actually DELIVERS that on a true first mount (see its
  // own comment — geometryStore isn't measured yet when A2's swap-reset
  // effect runs on the very first commit, so A2's own mount-time
  // computation is a harmless no-op there); A2 is what matters for a
  // GENUINE within-column swap between already-registered objects.
  // Updated at every user-initiated write site (wheel/keyboard/scrollbar/
  // touch-drag/fling) via updatePinnedState — evaluated against the
  // resulting/target offset, not delta sign (a positive-delta command
  // issued while already at maxScroll is a no-op, not a release trigger;
  // touch drag's sign convention is inverted from wheel's). Deliberately
  // NEVER touched by the maxScroll-shrink clamp effect or by F9 commit 1's
  // own anchoring-compensation/pin-follow writes — those are content/
  // viewport-driven corrections, not user intent, and must never be
  // classified as a release or re-pin signal.
  const pinnedRef = useRef(anchor === "end");

  // F9 commit 2: the single check used at every user-initiated write site
  // to decide release ("moved away from the end") vs re-pin ("scrolled
  // back to the end") — a no-op for anchor="none" columns.
  const updatePinnedState = (offset: number, maxScrollValue: number) => {
    if (anchor !== "end") return;
    pinnedRef.current = isAtScrollEnd(offset, maxScrollValue);
  };

  // F9 commit 3: populated by the onScroll subscription effect below with a
  // function that re-emits the current SceneScrollMetrics on demand. Every
  // updatePinnedState call site orders itself BEFORE the scrollY write that
  // triggers onScroll's own change-event subscriber, so that subscriber's
  // next firing already carries the correct anchored field — except the
  // inertia settle callback (applyScrollCommand's fling branch), where the
  // final scrollY value is already set by the animation driver by the time
  // onComplete runs and decides the re-pin. That one site calls this ref
  // directly to force a resync after updatePinnedState, since no further
  // scrollY change event will fire on its own to carry the correction.
  const resyncScrollMetricsRef = useRef<(() => void) | null>(null);

  // F17: the actual bounded-spring call — extracted from driveScrollYRef's
  // public entry point below so BOTH a fresh external command AND this
  // function's OWN reentrant boundary correction (inside onUpdate) share
  // the exact same animate() invocation, no duplicated call to drift out
  // of sync (mirrors this file's own established pattern for
  // startInertiaFlingRef/applyScrollYDeltaRef's shared inertia call).
  //
  // `velocityOverride` lets the reentrant boundary correction (below) start
  // from rest instead of inheriting the live carried velocity — see that
  // call site's own comment for why: carrying the live velocity into the
  // correction empirically produced LARGE secondary overshoots (900+px
  // measured), not the small rubber-band this fix is supposed to produce.
  const driveBoundedSpring = (target: number, velocityOverride?: number) => {
    scrollYSpringTargetRef.current = target;
    // F17 fix (mechanism pinned at source): clamp the velocity Motion
    // would otherwise inherit from scrollY's own internal tracking before
    // it feeds this retarget's spring — see clampSpringRetargetVelocity's
    // own doc comment for the near-zero-dt blowup this closes. Only read
    // for a FRESH external command (velocityOverride undefined) — the
    // reentrant boundary correction always supplies its own explicit 0.
    const velocity =
      velocityOverride !== undefined
        ? velocityOverride
        : clampSpringRetargetVelocity(scrollY.getVelocity());
    const controls = animate(scrollY, target, {
      ...transition,
      velocity,
      // F17 fix: boundary rubber-band — a plain spring generator (unlike
      // Motion's type:"inertia", which the fling uses) has no built-in
      // min/max clamp (full history: tests/scene-spring-bounds.test.tsx's
      // own header), so this watches the live value every frame and
      // reentrantly retargets toward the nearest bound, WITH
      // velocityOverride: 0 (not the carried-over live velocity — see
      // below). Deliberately unguarded (no "already correcting" flag): the target is always the
      // SAME deterministic nearest bound while still out of range, so
      // re-issuing it every frame is idempotent, not divergent —
      // probe-confirmed a correctingBoundaryRef guard that RESETS on every
      // fresh external command (needed so a genuine new user command can
      // always interrupt/redirect) thrashes badly once wheel input arrives
      // every frame (even coalesced to one retarget/frame): each frame's
      // "fresh" command wiped the guard and re-triggered its own
      // correction before the PREVIOUS one had a chance to converge,
      // measured WORSE (0/10 clean runs) than this boundary fix alone
      // (7/10 clean). Re-issuing the same target every frame while out of
      // range avoids that interrupt-vs-guard tension entirely.
      //
      // velocityOverride: 0 on the correction itself (rather than carrying
      // scrollY's live velocity through, the way a fresh external command
      // does): at the moment the boundary trips, the live value's velocity
      // is, by construction, heading FURTHER out of bounds — that's what
      // triggered the correction. A damped spring given a nonzero starting
      // velocity that points AWAY from its new target doesn't calmly
      // reverse course; it keeps carrying that momentum outward for a beat
      // before the spring force turns it around, producing a SECOND,
      // larger overshoot on the way back — empirically measured up to
      // ~900-1000px under a sustained multi-pass wheel stream with the
      // carried-velocity version of this correction, an order of magnitude
      // past the intended small rubber-band margin. Starting the
      // correction from rest removes that wrong-direction-momentum
      // mechanism entirely: a spring moving a short, bounded distance
      // (already within margin of the target when this trips) with zero
      // initial velocity settles smoothly, matching "a small damped
      // rubber-band margin" as actually specified.
      onUpdate: (latest) => {
        const max = maxScrollRef.current;
        if (latest > max + SPRING_RUBBER_BAND_MARGIN_PX) {
          driveBoundedSpring(max, 0);
        } else if (latest < -SPRING_RUBBER_BAND_MARGIN_PX) {
          driveBoundedSpring(0, 0);
        }
      },
      onComplete: () => {
        // Guard against a stale onComplete firing after a NEWER spring has
        // already retargeted to a different destination — only clear if
        // this callback's own target is still the one currently tracked.
        if (scrollYSpringTargetRef.current === target) {
          scrollYSpringTargetRef.current = null;
        }
      },
    });
    motionSeam?.registerControls(`scrollY:${name}`, controls);
    motionSeam?.registerTarget?.(`scrollY:${name}`, target);
  };

  driveScrollYRef.current = (target: number) => {
    // F13 commit 4: any intent-driven command (wheel/keyboard/scrollbar/
    // scrollTo) superseding an active fling must stop tracking it as
    // active — this call is about to drive scrollY toward its OWN target
    // via the standard chase, not the inertia coast, and a later
    // compensation event must not try to re-fling something that no
    // longer exists.
    flingActiveRef.current = false;
    if (duration === 0) {
      scrollY.set(target);
      return;
    }
    driveBoundedSpring(target);
  };

  // F9 anchoring/content-driven scroll changes: applies a displacement
  // DELTA to scrollY, never as a navigation (jump semantics — never
  // animated on its own). When a real spring is currently in flight
  // (scrollYSpringTargetRef tracks its destination), retargets it by the
  // SAME delta with velocity carryover (adjudication 1) rather than a
  // naive `.set()` (silently overwritten by the still-running spring's own
  // next tick — probe-confirmed elsewhere in this file, see
  // handleContentPointerDown's doc comment) or a hard stop-and-jump (kills
  // the user's in-progress scroll momentum). At rest (no tracked target),
  // there is nothing further to animate toward — a plain jump is both
  // correct and cheaper (asserted by commit 1's tests: no animate() call
  // during a resting-state compensation).
  const applyScrollYDeltaRef = useRef<(delta: number) => void>(() => {});
  applyScrollYDeltaRef.current = (delta: number) => {
    if (delta === 0) return;
    // ui#27: content-growth compensation bypasses applyScrollCommand
    // entirely (this ref's own doc comment above), so a pending wheel-cliff
    // timer's top-of-applyScrollCommand cancel never sees it — a real
    // regression, gate-caught: a wheel-armed timer that outlives this call
    // fires later using the WHEEL command's own lastDeltaAbsPx against
    // whatever debt this compensation's own retarget just created, jumping
    // into (and killing) a spring this timer was never watching. The
    // caller keeps scrollOffsetRef.current in sync with the compensated
    // target (its own doc comment above), so scrollOffsetRef staying
    // "correct" doesn't help — the timer itself is what must not outlive
    // the stream it was armed for.
    if (wheelCliffTimerRef.current !== null) {
      clearTimeout(wheelCliffTimerRef.current);
      wheelCliffTimerRef.current = null;
    }
    // ui#27, orchestrator-ruled amendment: same reset as the timer cancel
    // above — this compensation breaks whatever wheel stream was being
    // paired/watched too, so a wheel command arriving after it must re-earn
    // pairing from scratch rather than inheriting stale ratchet state.
    wheelStreamPairedRef.current = false;
    lastWheelEventAtRef.current = 0;
    if (duration === 0) {
      scrollY.jump(scrollY.get() + delta);
      return;
    }
    // F13 commit 4: a mid-coast compensation must shift the coast, not kill
    // it. A plain jump() below stops ANY in-flight Motion animation — that's
    // fine for the resting/spring-retarget cases this function already
    // handled, but a coasting inertia fling has no "target" to retarget
    // toward (scrollYSpringTargetRef is never set for it — see
    // startInertiaFlingRef's own comment), so it would otherwise fall
    // straight into the plain-jump branch below and silently freeze the
    // user's still-in-flight momentum. Capture the LIVE velocity first
    // (valid mid-animation — Motion's animate() writes via .set() every
    // frame, which keeps its internal velocity-tracking state fresh, unlike
    // the release-time staleness this file works around elsewhere), jump by
    // the delta (stops the interrupted controls exactly as it always has),
    // then re-fling with that captured velocity through the SAME inertia
    // call release uses — maxScrollRef.current is read FRESH at re-fling
    // time inside startInertiaFlingRef, not the bound baked into the now-
    // ended animation, which was computed pre-growth and is now stale.
    if (flingActiveRef.current) {
      const velocity = scrollY.getVelocity();
      scrollY.jump(scrollY.get() + delta);
      startInertiaFlingRef.current(velocity);
      return;
    }
    const currentTarget = scrollYSpringTargetRef.current;
    if (currentTarget === null) {
      scrollY.jump(scrollY.get() + delta);
      return;
    }
    const velocity = scrollY.getVelocity();
    scrollY.jump(scrollY.get() + delta); // stops the running spring, shifts current position
    const newTarget = currentTarget + delta;
    scrollYSpringTargetRef.current = newTarget;
    const controls = animate(scrollY, newTarget, {
      ...transition,
      velocity,
      onComplete: () => {
        if (scrollYSpringTargetRef.current === newTarget) {
          scrollYSpringTargetRef.current = null;
        }
      },
    });
    motionSeam?.registerControls(`scrollY:${name}`, controls);
    motionSeam?.registerTarget?.(`scrollY:${name}`, newTarget);
  };

  // -------------------------------------------------------------------------
  // Vertical scroll state (pure JS — no overflow-y, no proxy divs)
  //
  // scrollOffset drives `top: -scrollOffset` on the content wrapper.
  // maxScroll = contentHeight - viewportHeight (clamped to 0 when content fits).
  // The viewport's wheel handler decides a target column and calls straight
  // into that column's registered applyScrollCommand (S5 input controller,
  // below) with a scrollBy command — no intervening DOM event.
  // -------------------------------------------------------------------------

  const [scrollOffset, setScrollOffset] = useState(0);
  const scrollOffsetRef = useRef(0);

  const maxScroll = Math.max(
    0,
    columnFocused && effectiveViewportHeight > 0
      ? contentHeight - effectiveViewportHeight
      : 0,
  );
  const maxScrollRef = useRef(maxScroll);
  maxScrollRef.current = maxScroll;

  // F9 commit 3: ref mirror of contentHeight state, for onScroll's
  // SceneScrollMetrics — the scrollY.on("change", ...) subscription below
  // needs the CURRENT value at callback time, not whatever was captured
  // when the effect last (re-)subscribed.
  const contentHeightRef = useRef(contentHeight);
  contentHeightRef.current = contentHeight;

  // Clamp scrollOffset to [0, maxScroll] whenever maxScroll changes (e.g. on
  // content resize or viewport resize). F9 adjudication 3: reclassified
  // from spring to jump — a maxScroll shrink is content/viewport-driven,
  // not user intent, so under this slice's "content-driven scroll changes
  // jump; intent-driven scroll changes spring" rule it must not animate.
  // Shipping that rule as a spec'd contract (this slice) while this
  // already-mapped site still sprang via driveScrollYRef would make the
  // spec false on day one. scrollY.jump() stops any in-flight spring
  // without firing its onComplete (an interruption, not a completion), so
  // the tracked spring target is cleared explicitly here too — otherwise a
  // LATER compensation event could read a stale target and retarget
  // toward a destination nothing is actually animating toward anymore.
  useEffect(() => {
    if (scrollOffsetRef.current > maxScroll) {
      const clamped = Math.min(scrollOffsetRef.current, maxScroll);
      scrollOffsetRef.current = clamped;
      setScrollOffset(clamped);
      scrollY.jump(clamped);
      scrollYSpringTargetRef.current = null;
      // F13 commit 4: same interruption as scrollYSpringTargetRef above —
      // a maxScroll shrink stops any in-flight fling too.
      flingActiveRef.current = false;
    }
  }, [maxScroll, scrollY]);

  // F9 commit 2: while pinned (anchor="end"), new content arriving keeps
  // the offset at maxScroll — same-frame, no animation (a content-driven
  // change, not a navigation, same jump-not-spring rule as the clamp
  // effect above). Deliberately unconditional on maxScroll's direction
  // (unlike the clamp effect, which only fires on shrink past the current
  // offset) — a pinned column always tracks the CURRENT maxScroll exactly,
  // whichever way it moved. A no-op for anchor="none" (pinnedRef stays
  // permanently false there, since updatePinnedState only ever sets it
  // when anchor==="end").
  //
  // This is ALSO what actually delivers "starts pinned at mount" in
  // practice, not the A2 swap-reset effect below — probe-confirmed while
  // debugging this slice: on a column's true first-ever render,
  // geometryStore hasn't been measured yet (children register in the SAME
  // commit but the very first remeasure happens moments before A2 reads
  // it), so A2's own freshMaxScroll computes as 0 at that instant — a
  // harmless no-op there (scrollOffsetRef already starts at 0 too), NOT
  // the mechanism doing the real work. `contentHeight`/`maxScroll` REACT
  // STATE settles one render later, and THIS effect reacts to that first
  // real transition (0 -> the true maxScroll) while pinnedRef is already
  // true from its initial useRef(anchor==="end") value — that's the
  // actual mount-pin path. A2's own override is what uniquely matters for
  // a GENUINE swap (switching to an already-registered, already-measured
  // object) — defeat-check-confirmed: severing A2's override broke only
  // the swap-re-pins test, not the mount-pin test; severing THIS effect
  // broke both.
  useEffect(() => {
    if (anchor === "end" && pinnedRef.current) {
      scrollOffsetRef.current = maxScroll;
      setScrollOffset(maxScroll);
      scrollY.jump(maxScroll); // NOT driveScrollYRef — must not spring
      scrollYSpringTargetRef.current = null;
      // F13 commit 4: same interruption as scrollYSpringTargetRef above.
      flingActiveRef.current = false;
    }
  }, [maxScroll, scrollY, anchor]);

  // F13 commit 4: the actual inertia call, assigned via a ref (mirrors
  // driveScrollYRef/applyScrollYDeltaRef's own reassign-every-render
  // pattern) so applyScrollCommand's fling branch below AND
  // applyScrollYDeltaRef's mid-coast re-fling can both call the exact same
  // logic — see startInertiaFlingRef's own declaration (near
  // driveScrollYRef, above) for the full rationale.
  startInertiaFlingRef.current = (velocity: number) => {
    flingActiveRef.current = true;
    // NOTE: deviates from the plan's literal
    // animate(scrollY, undefined, {type:"inertia",...}) — probe-confirmed
    // that resolves internally to keyframes=[null, undefined], which
    // finishes the animation instantly without ever running. Passing an
    // explicit single-element keyframes array with the current value is
    // required for inertia to actually decelerate from here.
    const controls = animate(scrollY, [scrollY.get()], {
      type: "inertia",
      velocity,
      min: 0,
      max: maxScrollRef.current,
      // F13 commit 3: iOS-feel flywheel constants (the classic
      // power/timeConstant pair), Michael-tunable via the dev TuningPanel —
      // threaded through SceneConfig exactly like stiffness/damping (see
      // useSceneConfig.tsx's DEFAULT_TOUCH_POWER/DEFAULT_TOUCH_TIME_CONSTANT
      // for the shipped defaults).
      power: touchPower,
      timeConstant: touchTimeConstant,
      // Reuses Scene's configured spring constants for the boundary bounce
      // so the touch-release feel matches wheel/keyboard's spring physics,
      // rather than introducing a third unrelated set of magic numbers —
      // judgment call: the plan named bounceStiffness/bounceDamping
      // without pinning values.
      bounceStiffness: stiffness,
      bounceDamping: damping,
      // F15 fix: a fling has no fixed target (unlike every other write
      // path's synchronous "chase" model), so nothing else keeps
      // scrollOffsetRef live during the coast, and every consumer (a
      // subsequent grab's dragStartOffset, wheel/keyboard's scrollBy delta
      // base, the F9/F10 compensation clamps) reads it cold. Full history:
      // tests/scene-model-sync.test.tsx's own header. Ref-only, no
      // setScrollOffset — this fires every animation frame
      // for the whole coast, and forcing a React re-render that often is
      // exactly the per-tick-render overhead the scrollY MotionValue
      // pipeline exists to avoid (see handleContentPointerMove's own
      // per-tick comment on the same tradeoff for 1:1 drag).
      onUpdate: (latest) => {
        scrollOffsetRef.current = latest;
      },
      // F9 commit 2: re-pin (or stay released) once the coast genuinely
      // settles — the only point at which the final resting offset is
      // knowable for a physics-based multi-frame deceleration. F9
      // commit 3: the animation driver has already set scrollY to its
      // final value (and fired onScroll's own change-event subscriber
      // for it) by the time onComplete runs, so updatePinnedState's
      // decision here arrives too late for that subscriber to have
      // reported it — force an explicit resync so the pin transition
      // is still observable via onScroll. F13 commit 4: also clears
      // flingActiveRef — this is the coast's NATURAL settle (an
      // interruption instead clears it at its own write site — see the
      // ref's own declaration for the full list). F15 fix: also flushes
      // scrollOffsetRef/scrollOffset explicitly here (not relying purely
      // on onUpdate's own last tick) — this is exactly the "sensible
      // boundary" a natural settle represents, and it's the one point
      // this file already forces an explicit resync for a DIFFERENT
      // reason (onScroll), so the state write costs nothing extra here.
      onComplete: () => {
        flingActiveRef.current = false;
        const settled = scrollY.get();
        scrollOffsetRef.current = settled;
        setScrollOffset(settled);
        updatePinnedState(settled, maxScrollRef.current);
        resyncScrollMetricsRef.current?.();
      },
    });
    motionSeam?.registerControls(`scrollY:${name}`, controls);
    // No registerTarget here (F4 active-springs panel): an inertia
    // deceleration has no fixed destination to report — it coasts to
    // wherever momentum runs out, only meeting the boundary spring
    // above if it overshoots. The panel shows "—" for this key while
    // coasting, which is the honest answer.
  };

  // Single write-path closure (S5 input controller) for every scroll command
  // source: wheel (via the registry below), keyboard, touch release (fling),
  // and the Scrollbar thumb (pointer-drag and keyboard). Non-fling commands
  // resolve to a target offset and write it through the same triplet
  // (scrollOffsetRef, scrollOffset state, driveScrollYRef) every other write
  // site used to duplicate individually. fling is a real branch of its own —
  // it drives the scrollY MotionValue directly (instant clamp, boundary
  // spring-back, or full inertia decay) rather than the driveScrollYRef
  // triplet, since inertia's physics aren't expressible as a single target +
  // the standard transition chase.
  const applyScrollCommand = useCallback(
    (cmd: ScrollCommand) => {
      // ui#27: an ALLOWLIST, not an enumerated exclusion list — see
      // ScrollCommand's own doc comment in inputController.ts. Captured
      // once, up front, so the rest of this callback (the timer-cancel
      // below, and the arm/rebase logic after the write) can read it
      // without re-narrowing `cmd`'s type at each use.
      const isWheelScrollBy = cmd.type === "scrollBy" && cmd.source === "wheel";
      const wheelDeltaAbsPx = cmd.type === "scrollBy" ? Math.abs(cmd.delta) : 0;

      // Any command that ISN'T a wheel-tagged scrollBy supersedes whatever
      // wheel stream a pending cliff timer might be watching — cancel it so
      // a stale timer can never fire a jump into an unrelated later scroll
      // state (fling/toTop/toBottom/scrollTo taking over; page/keyboard/
      // scrollbar-thumb-drag scrollBy moving the target the timer's own
      // debt calculation was tracking), and reset the pairing gate too —
      // the stream it was tracking is over, so a wheel command arriving
      // later starts a fresh stream that must re-earn pairing from
      // scratch. A fresh wheel-tagged scrollBy re-arms the timer instead,
      // after the write below.
      if (!isWheelScrollBy) {
        if (wheelCliffTimerRef.current !== null) {
          clearTimeout(wheelCliffTimerRef.current);
          wheelCliffTimerRef.current = null;
        }
        wheelStreamPairedRef.current = false;
        lastWheelEventAtRef.current = 0;
      }

      if (cmd.type === "fling") {
        // F9 commit 2 / adjudication 2 (velocity-sign-at-initiation,
        // ACCEPTED): from a pinned state the only possible fling is
        // away-from-end — release immediately at initiation rather than
        // waiting for the coast to settle. Re-pin (below, at each fling
        // sub-branch's own settled destination) covers both a fling that
        // begins unpinned but settles at the end, and the S3 boundary-
        // bounce case (an overshooting fling whose own boundary spring
        // pulls it back to maxScroll has RETURNED to the end).
        if (anchor === "end" && pinnedRef.current) {
          pinnedRef.current = false;
        }
        if (duration === 0) {
          // Instant mode: inertia has no meaningful instant equivalent — just
          // settle at the clamped release position (forecast-gate plan §2).
          // Clamped defensively — instant mode never runs a fling (this whole
          // branch returns before the inertia code below), so scrollY
          // shouldn't normally be out of bounds here, but the same bound-on-
          // release invariant as the real-mode path below applies if it ever is.
          const clamped = Math.max(0, Math.min(maxScrollRef.current, scrollY.get()));
          // F9 commit 3: updatePinnedState BEFORE the write — onScroll's
          // subscriber fires synchronously off scrollY.set below, so
          // pinnedRef must already reflect this release/re-pin decision or
          // that one onScroll call would report the pre-transition anchored
          // value (probe-confirmed: reversing this order left the LAST
          // onScroll call of a release still reporting "end").
          updatePinnedState(clamped, maxScrollRef.current);
          scrollY.set(clamped);
          return;
        }

        // F13 commit 2: velocity is computeReleaseVelocity's own drag-sample
        // tracker (handleContentPointerUp), not a scrollY MotionValue read
        // at release — see that function's own doc comment for why a
        // MotionValue read is unreliable exactly at a pointer release (a
        // cached signal that can land just outside its own refresh window
        // on a fast grab->release, plus — since commit 4 — corruption from
        // a mid-coast compensation jump that never reflects real finger
        // movement).
        const velocity = cmd.velocity;

        // Motion's type:"inertia" generator engages its boundary-catch spring
        // at GENERATOR CREATION TIME whenever the STARTING keyframe is out of
        // [min,max] bounds — independent of the passed velocity (verified at
        // source: animate(y, [2029], {type:"inertia", velocity:0, max:1200})
        // still springs 2029->1366 over 300ms). scrollY CAN legitimately sit
        // out of bounds here: a PRIOR fling's own rubber-band overshoot can be
        // where this grab's jump() froze it (C4's clamped-rubber-band physics,
        // not a bug). A genuinely zero-velocity release imparts no momentum,
        // so no inertia/friction decay is warranted — but per iOS convention
        // and the Touch spec ("overscroll past the scroll bounds should be
        // clamped"), the strip still must not rest permanently past its edge:
        // in bounds → leave it where jump() froze it; out of bounds → spring
        // back to the nearest edge (full regression history: see
        // tests/scene-touch.test.tsx's "round 3" test).
        if (Math.abs(velocity) < 0.01) {
          const current = scrollY.get();
          const clamped = Math.max(0, Math.min(maxScrollRef.current, current));
          if (current !== clamped) {
            const controls = animate(scrollY, clamped, transition);
            motionSeam?.registerControls(`scrollY:${name}`, controls);
            motionSeam?.registerTarget?.(`scrollY:${name}`, clamped);
          }
          // clamped IS the final destination in both branches above
          // (whether an animation was needed to get there or it was
          // already there) — re-pin (or stay released) against it now.
          updatePinnedState(clamped, maxScrollRef.current);
          return;
        }

        // F13 commit 4: the real, multi-frame decay call lives in
        // startInertiaFlingRef (assigned just above, before this callback —
        // see its own declaration near driveScrollYRef for why) so
        // applyScrollYDeltaRef can call the exact SAME logic to re-fling a
        // coast interrupted mid-flight by a content-growth compensation —
        // no duplicated animate() invocation to drift out of sync.
        startInertiaFlingRef.current(velocity);
        return;
      }

      let nextOffset: number;
      switch (cmd.type) {
        case "scrollBy":
        case "page": {
          // ui#27 / ui#o85 F1: a wheel-tagged delta whose sign OPPOSES the
          // outstanding spring debt is a deliberate reverse-scroll — rebase
          // the target computation onto the LIVE spring position instead
          // of chasing the stale (pre-reversal) target, so the reversal
          // feels immediate rather than first having to unwind whatever
          // the forward chase still owed. Scoped to wheel (matching the
          // cliff detector's own allowlist) — keyboard/scrollbar-thumb
          // commands keep today's plain accumulate-onto-target behavior.
          let base = scrollOffsetRef.current;
          if (isWheelScrollBy) {
            const outstandingDebt = scrollOffsetRef.current - scrollY.get();
            if (opposesOutstandingDebt(Math.sign(cmd.delta), Math.sign(outstandingDebt))) {
              base = scrollY.get();
            }
          }
          nextOffset = Math.max(0, Math.min(maxScrollRef.current, base + cmd.delta));
          break;
        }
        case "toTop":
          nextOffset = 0;
          break;
        case "toBottom":
          nextOffset = maxScrollRef.current;
          break;
        case "scrollTo":
          // F11 commit 2: the target offset is already fully computed
          // (nearest-edge, clamped) by the scrollTo effect below — this
          // command just routes it through the SAME shared write path
          // every other intent-driven command uses, springing exactly
          // like scrollBy/toTop/toBottom, and getting the pin-interaction
          // re-pin below "for free" (updatePinnedState runs unconditionally
          // for every command type here, scrollTo included).
          nextOffset = Math.max(0, Math.min(maxScrollRef.current, cmd.offset));
          break;
      }
      scrollOffsetRef.current = nextOffset;
      setScrollOffset(nextOffset);
      // F9 commit 2: release/re-pin against the target this command is
      // driving toward, evaluated at the SAME site as the write (not
      // waiting for the spring to visually finish) — the user's intent
      // (and thus the pin transition) is clear the moment the command is
      // issued. F9 commit 3: ordered BEFORE driveScrollYRef below —
      // instant mode (duration===0) writes scrollY synchronously, firing
      // onScroll's change-event subscriber immediately, so pinnedRef must
      // already carry this decision or that call would report the
      // pre-transition anchored value.
      updatePinnedState(nextOffset, maxScrollRef.current);
      driveScrollYRef.current(nextOffset);

      // ui#27, orchestrator-ruled amendment: update the pairing ratchet on
      // every wheel-tagged command BEFORE deciding whether to arm — pairs
      // THIS event with the immediately preceding one if they landed
      // within WHEEL_STREAM_PAIRING_MS of each other (see that constant's
      // own doc comment). A ratchet: once true, stays true for the rest of
      // this unbroken stream regardless of any later gap — only the
      // top-of-function reset (a non-wheel command), the compensation-path
      // reset, handleContentPointerDown's reset, or this timer's own
      // callback (below, unconditionally) ever clear it.
      if (isWheelScrollBy) {
        const now = performance.now();
        if (lastWheelEventAtRef.current !== 0 && now - lastWheelEventAtRef.current <= WHEEL_STREAM_PAIRING_MS) {
          wheelStreamPairedRef.current = true;
        }
        lastWheelEventAtRef.current = now;
      }

      // Arm (or re-arm) the wheel catch-stop timer — only once the stream
      // is paired (a lone single wheel command is an ordinary, uncaught
      // scroll with nothing to catch; see WHEEL_STREAM_PAIRING_MS).
      // duration===0 (instant/test-harness mode) never arms it — no spring
      // debt exists to detect, mirroring the fling branch's own early
      // special-case for the identical reason (see its own comment above).
      // MUST clear any timer this same branch already had pending before
      // scheduling a new one — a real wheel stream fires far faster than
      // WHEEL_CLIFF_SILENCE_MS apart, so without this, every event in the
      // stream would leave its OWN still-scheduled timer behind (the
      // top-of-function cancel above only fires for NON-wheel commands),
      // producing a cascade of stale timers that start firing mid-stream
      // against whatever the CURRENT (not their own arm-time) state
      // happens to be — repeatedly snapping the spring throughout the
      // whole stream instead of a single clean arrest after real silence.
      if (isWheelScrollBy && duration !== 0) {
        if (wheelCliffTimerRef.current !== null) {
          clearTimeout(wheelCliffTimerRef.current);
          wheelCliffTimerRef.current = null;
        }
        lastWheelDeltaAbsPxRef.current = wheelDeltaAbsPx;
        if (wheelStreamPairedRef.current) {
          wheelCliffTimerRef.current = setTimeout(() => {
            wheelCliffTimerRef.current = null;
            // The stream this timer was watching is over either way —
            // silence has now elapsed, whether or not it qualifies as a
            // catch below. A wheel command arriving after this point starts
            // a fresh stream that must re-earn pairing from scratch.
            wheelStreamPairedRef.current = false;
            lastWheelEventAtRef.current = 0;

            const live = scrollY.get();
            const outstandingPx = Math.abs(scrollOffsetRef.current - live);
            const shouldStop = shouldCliffStop(
              { lastDeltaAbsPx: lastWheelDeltaAbsPxRef.current, outstandingPx },
              { deltaFloorPx: WHEEL_CLIFF_DELTA_FLOOR_PX, outstandingFloorPx: WHEEL_CLIFF_OUTSTANDING_FLOOR_PX },
            );
            if (!shouldStop) return;

            // Touch-arrest idiom, copied from handleContentPointerDown below
            // (see its own comment for the full rationale on jump() over
            // stop(), and on each of these four writes) — a caught wheel
            // stream gets the identical treatment a touch grab already gets.
            // updatePinnedState is the one addition beyond the touch path:
            // touch bypasses applyScrollCommand entirely, but this jump
            // happens INSIDE it, so the pin-state sync every other command
            // here gets must run for this one too.
            scrollY.jump(live);
            scrollYSpringTargetRef.current = null;
            flingActiveRef.current = false;
            const resynced = scrollY.get();
            scrollOffsetRef.current = resynced;
            setScrollOffset(resynced);
            updatePinnedState(resynced, maxScrollRef.current);
          }, WHEEL_CLIFF_SILENCE_MS);
        }
      }
    },
    // F13 commit 4: stiffness/damping dropped from this list — the real
    // inertia call (which used them for bounceStiffness/bounceDamping) now
    // lives in startInertiaFlingRef, a stable ref this callback reads
    // through .current rather than closing over directly.
    [duration, transition, motionSeam, name, scrollY, anchor],
  );

  // Mirrors driveScrollYRef's ref pattern: the wheel/keyboard effects below
  // subscribe once via `[]` deps for a stable listener across renders, so
  // they read applyScrollCommand through a ref kept fresh every render
  // rather than closing over a possibly-stale version from mount time.
  const applyScrollCommandRef = useRef(applyScrollCommand);
  applyScrollCommandRef.current = applyScrollCommand;

  // Register this column's command applier so Scene's wheel handler can
  // route a decided ScrollCommand straight here (replaces the old
  // 'columnscroll' CustomEvent bridge). Kept fresh as applyScrollCommand's
  // own deps change; only deletes on cleanup if we're still the registered
  // handler for this name (guards a same-name remount race, mirroring this
  // file's other name-keyed store patterns).
  useEffect(() => {
    scrollCommandRegistry.set(name, applyScrollCommand);
    return () => {
      if (scrollCommandRegistry.get(name) === applyScrollCommand) {
        scrollCommandRegistry.delete(name);
      }
    };
  }, [scrollCommandRegistry, name, applyScrollCommand]);

  // Ref to the latest EFFECTIVE (padding-subtracted) viewport height for use
  // in the keyboard handler (avoids stale closure — we want the current
  // value at the time of the keypress). Page Up/Down's page size must match
  // the same padding-adjusted basis as maxScroll (S6 padding cluster) — the
  // raw viewportHeight overshoots by Scene's padding.
  const viewportHeightRef = useRef(effectiveViewportHeight);
  viewportHeightRef.current = effectiveViewportHeight;

  // Keyboard scroll: intercept arrow/page/home/end keys when keyboard focus is
  // inside this column. Standard scroll amounts match browser conventions.
  // isInteractiveElement (S5 input controller, DELTA-1) is the CURATED
  // exemption gate — a naive [role]/[tabindex] matcher would also exempt this
  // column's own scrollable content wrapper (role="region", tabIndex=0 — D2)
  // and the scrollbar thumb, breaking the tab-to-region-then-arrow-scroll path.
  useEffect(() => {
    const el = colRef.current;
    if (!el) return;

    const handler = (e: KeyboardEvent) => {
      // Only handle when this column has focused content to scroll.
      if (maxScrollRef.current <= 0) return;

      if (isInteractiveElement(e.target as Element)) return;

      const cmd = mapScrollKeyToCommand(e.key, e.shiftKey, viewportHeightRef.current);
      if (!cmd) return; // Not a scroll key — don't intercept

      applyScrollCommandRef.current(cmd);
      e.preventDefault();
    };

    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, []);

  // F11 commit 2: declarative scrollTo. Fires once per VALUE CHANGE to a
  // non-null string — React's own dependency comparison on `scrollTo` (a
  // primitive string) already gives one-shot semantics for free: setting
  // the SAME id again while it's already the current value doesn't change
  // the dependency, so this effect simply doesn't re-run (no extra
  // "already navigated" tracking ref needed). `null` is inert (early
  // return) and also resets the comparison baseline, so a LATER re-set of
  // the same id (after passing through null) is a genuine new value change
  // and fires again — the intended "clear then re-request" semantics.
  useEffect(() => {
    if (scrollTo === null) return;
    const wrapper = contentWrapperRef.current;
    if (!wrapper) return;

    const target = findScrollToTarget(wrapper, scrollTo);
    if (!target) {
      console.warn(
        `Scene: scrollTo target "${scrollTo}" not found within column "${name}" — no-op.`,
      );
      return;
    }

    // Transform-immune rect-delta measurement — the SAME technique
    // remeasureGeometry and the F10/F10b intra-object anchoring use
    // throughout this file, for the same reason: getBoundingClientRect
    // alone would report a foreshortened size/position under any ancestor
    // transform (H11), but the DELTA between two simultaneous reads in the
    // same transform context cancels that out.
    const wrapperRect = wrapper.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetOffsetTop = targetRect.top - wrapperRect.top;
    const targetHeight = (target as HTMLElement).offsetHeight;

    const nextOffset = computeNearestEdgeScrollOffset(
      scrollOffsetRef.current,
      viewportHeightRef.current,
      targetOffsetTop,
      targetHeight,
      maxScrollRef.current,
    );
    // Routes through the SAME applyScrollCommand write path every other
    // intent-driven command uses (springs; re-pins for free via its
    // shared updatePinnedState call — see the "scrollTo" case's own
    // comment there) rather than writing scrollOffsetRef/scrollY directly.
    applyScrollCommandRef.current({ type: "scrollTo", offset: nextOffset });
  }, [scrollTo, name]);

  return {
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
  };
}
