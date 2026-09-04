import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { selectAnchorObject, findDeepestIntraObjectAnchor } from "./inputController";
import { computeFocusedContentHeight, type ObjectState, type GeometryEntry } from "./columnGeometry";
import type { FrozenSize } from "./types";

/**
 * SceneColumn's anchor-descent/geometry slice (ui/t:24 Cluster E extraction):
 * bulk geometry remeasurement, F9/F10/F12 scroll-anchoring compensation
 * (native-scroll-anchoring-style content-growth correction, plus intra-
 * object anchoring for a prepend inside the focused object's own interior),
 * and the two effects that drive it — the shared ResizeObserver (catches
 * content growth with no accompanying React render) and the per-render
 * synchronous remeasure (the common case: focus/prop changes).
 *
 * Shared-refs manifest — every ref/setter below is the SAME INSTANCE as
 * SceneColumn's own; this hook must never re-declare a local stand-in for
 * any of them (that's the wiring's one silent-failure mode: no crash, no
 * test failure, just quietly-stale state):
 * - `geometryStore` — written here; read by SceneColumn's rendering and
 *   registration code and by useColumnScroll's swap-reset consumers via
 *   SceneColumn (the most-shared structure in the seam network).
 * - `registeredEls` / `registeredHeightTargetsRef` — populated by
 *   SceneColumn's registration effect (ColumnContext's `register`), read
 *   here during remeasurement.
 * - `contentWrapperRef` / `colRef` — SceneColumn's own DOM refs, read here
 *   for rect measurements.
 * - `resizeObserverRef` — created/stored/nulled here; SceneObject's own
 *   callback ref (via SceneColumn's `observeElement`/`unobserveElement`,
 *   ui/t:32 Cluster 2) observes/unobserves objects on it as they genuinely
 *   attach/detach — deliberately decoupled from SceneColumn's per-render
 *   registration effect, which no longer touches the observer at all.
 * - `lastObservedSize` — written here (the ResizeObserver callback) AND by
 *   SceneColumn's frozen-size capture effect, which reads it on focus loss.
 * - `scrollOffsetRef` / `setScrollOffset` — one of several writers across
 *   the seam network; `viewportHeightRef` is read-only here, owned by
 *   useColumnScroll (which declares and writes it — an inverted seam:
 *   that hook owns, this one only reads).
 * - `applyScrollYDeltaRef` — assigned inside useColumnScroll, called here
 *   (a one-directional call-in: this is the literal geometry→scroll seam).
 * - `dragStartOffset` / `isDragging` — owned by SceneColumn's touch
 *   handling, compound-assigned/read here to keep a mid-drag compensation
 *   event's baseline coherent.
 * - `setContentHeight` — SceneColumn's own state setter; `contentHeight`
 *   itself is read by code that stays behind (frozen-content-height
 *   capture, vertical centering), so only the setter is threaded in.
 */
export interface UseColumnAnchoringParams {
  /** This render's focused-object classification (DOM order). */
  objectStates: ObjectState[];
  /** This column's objectGap prop (px). */
  objectGap: number;
  /** Whether this column is currently focused. */
  columnFocused: boolean;
  /**
   * Whether this column is currently decked in-between two focused
   * siblings (ui/t:32) — SceneColumn's own `inBetweenNow`/`isInBetween`
   * expression, computed a third time here per this file's established
   * duplicate-computation idiom (see `inBetweenNow`'s own comment) rather
   * than threading position/stackDepth through as separate params. An
   * in-between column's columnWidthMV/computeMeasuredWidth channel reads
   * live geometryStore data regardless of focus (the column's natural
   * width doesn't depend on focus) — the per-render remeasure gate below
   * must not starve it just because the column itself is unfocused.
   */
  inBetweenNow: boolean;
  /** This column's anchor mode — governs offset-0 suppression and the witness fallback (F11/F12). */
  anchor: "none" | "end";

  geometryStore: React.MutableRefObject<Map<string, GeometryEntry>>;
  registeredEls: React.MutableRefObject<Map<string, HTMLElement>>;
  registeredHeightTargetsRef: React.MutableRefObject<Map<string, number | undefined>>;
  contentWrapperRef: React.MutableRefObject<HTMLDivElement | null>;
  colRef: React.MutableRefObject<HTMLDivElement | null>;
  resizeObserverRef: React.MutableRefObject<ResizeObserver | null>;
  lastObservedSize: React.MutableRefObject<FrozenSize>;
  scrollOffsetRef: React.MutableRefObject<number>;
  viewportHeightRef: React.MutableRefObject<number>;
  applyScrollYDeltaRef: React.MutableRefObject<(delta: number) => void>;
  dragStartOffset: React.MutableRefObject<number>;
  isDragging: React.MutableRefObject<boolean>;

  setScrollOffset: (value: number) => void;
  setContentHeight: (value: number) => void;
}

export function useColumnAnchoring(params: UseColumnAnchoringParams): void {
  const {
    objectStates,
    objectGap,
    columnFocused,
    inBetweenNow,
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
  } = params;

  // Ref mirrors of render-time values, kept fresh every render so the
  // ResizeObserver callback below (a stable closure, subscribed once on
  // mount) always reads the current values instead of a stale snapshot.
  const objectStatesRef = useRef(objectStates);
  objectStatesRef.current = objectStates;
  const objectGapRef = useRef(objectGap);
  objectGapRef.current = objectGap;
  const columnFocusedRef = useRef(columnFocused);
  columnFocusedRef.current = columnFocused;

  // Fingerprint of the last-remeasured geometry, used to bail out of forcing
  // a re-render (geometryVersion bump) when a ResizeObserver callback fires
  // but nothing actually moved.
  // Numeric previous-geometry snapshot for the epsilon compare (see the
  // remeasure body's scroll-crash fix comment) — null until first measure.
  // Numeric snapshot of the geometry as of the last ACCEPTED bump — the
  // epsilon compare runs against THIS (not the previous measurement), so
  // sub-tolerance per-frame deltas accumulate across frames until they
  // cross the tolerance and land a bump. Accumulation is what keeps the
  // wheel-coalescing contract (tests/scene-wheel-coalescing.test.tsx):
  // comparing frame-to-frame would suppress a real 1px-per-frame growth
  // forever, lagging the spring's maxScroll clamp behind the content.
  const geometryLastBumpedGeometryRef = useRef<Map<string, GeometryEntry> | null>(null);
  // Bumped (via setGeometryVersion) only when the ResizeObserver-driven
  // remeasure finds a real change — forces a re-render so topOffset/
  // contentHeight recompute from the fresh geometry. The value itself is
  // never read; only the state update matters.
  const [, setGeometryVersion] = useState(0);

  // Bulk-remeasures every registered object's offsetTop/height relative to
  // the content wrapper (the rect-delta technique — invariant under the
  // wrapper's own animated `top`, since both rects shift together). Shared
  // by the per-render layout effect below and the ResizeObserver callback.
  // Returns true when the geometry actually changed (fingerprint bail-out —
  // avoids forcing a re-render on every ResizeObserver callback when
  // nothing moved).
  //
  // H11 fix (first-focus-only vertical marginTop swing): height uses
  // `el.offsetHeight`, NOT `rect.height`. A column transitioning out of the
  // depth deck (in-between position) carries an active translateZ/scale
  // transform — the depth treatment's own perspective-projection shrink
  // (computeDepthTreatment; ui/t:17 removed Motion's `layout` FLIP prop
  // entirely, so this is no longer compounded by a second, FLIP-driven
  // correction on top of it — the depth treatment's transform is the only
  // one left), biggest on a column's FIRST focus (no frozenSize yet, so the
  // box shape changes dramatically) — and getBoundingClientRect() reports
  // that transform's PROJECTED size, not the true laid-out height. Unlike
  // offsetTop's rect-delta (both rects share the same transform context, so
  // it cancels out), there is no delta to cancel a direct scale factor
  // applied to a raw dimension. offsetHeight is a layout metric, immune to
  // any transform on the element or its ancestors — probe-verified (first-
  // vs-second-focus trace): before this fix, first focus's marginTop
  // overshot from ~301 to ~330 before settling back to 300 over ~500ms
  // (second focus, with a real frozenSize already set, stayed flat at 300
  // throughout); after, first focus converges monotonically, matching
  // second focus's flat trace.
  const remeasureGeometry = useCallback((): boolean => {
    const wrapper = contentWrapperRef.current;
    if (!wrapper) return false;
    const wrapperRect = wrapper.getBoundingClientRect();
    for (const [objName, el] of registeredEls.current) {
      const rect = el.getBoundingClientRect();
      const offsetTop = rect.top - wrapperRect.top;
      const height = el.offsetHeight;
      // ui/t:21: reported by SceneObject via register(), not DOM-measured —
      // see GeometryEntry's own `heightTarget` doc comment for why.
      const heightTarget = registeredHeightTargetsRef.current.get(objName);
      // ui/t:17: offsetWidth, not rect.width — same H11 rationale as height
      // above (a layout metric, immune to any transform on the element or
      // its ancestors), now load-bearing for the owned width channel's
      // target measurement, not just a defensive choice.
      const width = el.offsetWidth;
      geometryStore.current.set(objName, { offsetTop, height, heightTarget, width });
      // F4 feature (c) debug-only mirror: exposes this store's per-object
      // entries to the debug overlay's geometry-store inspector without
      // giving it a live React-level handle into this column's internal
      // ref. Imperative attribute write (not React-rendered), same
      // rationale as data-ui-scene-scroll-offset's own writer in SceneColumn — this runs on
      // every remeasure pass (potentially every ResizeObserver tick), and
      // React-rendering it would force a re-render on every tick just to
      // keep a debug-only number current. Unconditional (not gated on
      // `debug`), matching data-ui-scene-scroll-offset's own precedent — a plain
      // attribute write doesn't affect layout either way.
      el.setAttribute("data-ui-scene-debug-geometry-offset-top", String(Math.round(offsetTop)));
      el.setAttribute("data-ui-scene-debug-geometry-height", String(Math.round(height)));
      el.setAttribute("data-ui-scene-debug-geometry-width", String(Math.round(width)));
    }
    // Scroll-crash fix (2026-09-04, iris, ui#35): the fingerprint used to
    // compare Math.round()-quantized STRINGS — but during an anchor
    // compensation the wrapper's spring is mid-flight, and the measured
    // offsetTop jitters by sub-pixel fractions across its rounding
    // boundary, so the rounded string kept flipping between adjacent
    // integers. Every flip reported "changed", the per-render layout
    // effect then bumped geometryVersion synchronously, and the
    // render → re-measure → flip cycle spun until React's nested-update
    // limit killed the whole tree ("Maximum update depth exceeded" →
    // blank screen) — reproducibly, whenever the user scrolled a focused
    // column with a tall focused object in Firefox AND Safari.
    //
    // Fix: compare numerically with a small tolerance instead of exact
    // rounded strings. Sub-pixel spring jitter (well under 1.5px) no
    // longer reads as a geometry change, so the bump settles; a REAL
    // layout change (≥1.5px on any field) still bumps exactly as before.
    // Keeping the bump synchronous preserves the wheel-coalescing
    // rebase contract (tests/scene-wheel-coalescing.test.tsx) — a
    // deferred bump was tried first and broke criterion 3's 250ms
    // reversal-tail bound.
    const EPSILON_PX = 1.5;
    let changed = geometryLastBumpedGeometryRef.current === null;
    const prev = geometryLastBumpedGeometryRef.current;
    if (prev !== null) {
      if (prev.size !== geometryStore.current.size) {
        changed = true;
      } else {
        for (const [objName, g] of geometryStore.current) {
          const p = prev.get(objName);
          if (!p) {
            changed = true;
            break;
          }
          const h = g.heightTarget ?? g.height;
          const ph = p.heightTarget ?? p.height;
          if (
            Math.abs(g.offsetTop - p.offsetTop) > EPSILON_PX ||
            Math.abs(h - ph) > EPSILON_PX ||
            Math.abs(g.width - p.width) > EPSILON_PX
          ) {
            changed = true;
            break;
          }
        }
      }
    }
    geometryLastBumpedGeometryRef.current = new Map(geometryStore.current);
    return changed;
    // Deliberately NOT listing contentWrapperRef/geometryStore/registeredEls/
    // registeredHeightTargetsRef here: they're all stable ref objects (a
    // textbook-safe addition by plain exhaustive-deps rules), but doing so
    // makes React Compiler bail out of memoizing this callback entirely —
    // its own inferred dependencies are the narrower `registeredEls.current`/
    // `geometryStore.current` property reads, and a manually-declared array
    // that doesn't match verbatim trips react-hooks/preserve-manual-
    // memoization (compiler-specific finding, ui#29 dispatch 1).
  }, []);

  // F9 anchoring: a snapshot of geometryStore taken at the end of the last
  // remeasureGeometryWithAnchorCompensation call — used as the "before"
  // reference for the NEXT compensation event, instead of reading
  // geometryStore.current live (see that wrapper's own comment for why:
  // SceneObject's own per-render register/unregister cleanup can
  // transiently wipe entries before this wrapper's layout effect runs).
  const lastSettledGeometryRef = useRef<Map<string, GeometryEntry>>(new Map());

  /**
   * F10: the intra-object anchor candidate tracked at the end of the last
   * remeasureGeometryWithAnchorCompensation call. `el` is tracked by
   * reference (not name — descendant candidates don't have Scene-level
   * identifiers) and re-measured via `el.isConnected` at the next settle;
   * `offsetTop` is stored LOCAL to `objName`'s own object (candidate
   * offsetTop minus the anchor object's own offsetTop), not
   * content-wrapper-relative — see remeasureGeometryWithAnchorCompensation's
   * own comment for why the local frame is what lets this compose
   * additively with the object-level diff instead of double-counting.
   *
   * F12: `height` (offsetHeight, transform-immune — the H11 discipline) is
   * the anchor's own measured height at settle time, used to detect
   * in-place growth (vs. a sibling insertion) at the next settle. `witness`
   * is the deepest in-view element intersecting the line just below the
   * anchor's bottom edge, stored the same LOCAL-offsetTop way — the element
   * whose movement reveals a prepend BETWEEN the anchor and itself, when the
   * anchor itself hasn't moved or grown. See the compensation branch below
   * for the full witness-fallback rationale.
   */
  const lastSettledIntraAnchorRef = useRef<{
    objName: string;
    el: Element;
    offsetTop: number;
    height: number;
    witness: { el: Element; offsetTop: number } | null;
  } | null>(null);

  // F9 anchoring-as-default: wraps remeasureGeometry with content-growth
  // scroll-position compensation, mirroring native browser scroll
  // anchoring. Captures the anchor object's offsetTop BEFORE remeasuring,
  // then diffs against its offsetTop AFTER — if a focused sibling earlier
  // in DOM order changed height, everything after it (including the
  // anchor) shifts by that delta, and applying the SAME delta to the
  // scroll offset keeps the user's in-view content visually stable. See
  // selectAnchorObject's own doc comment for why this operates at object
  // granularity rather than arbitrary DOM nodes.
  //
  // Only meaningful for multi-focused-object stacking: a single-focused-
  // object column's anchor is trivially that object, and its OWN growth
  // never moves its OWN offsetTop (nothing precedes it in the content
  // wrapper) — a structural no-op there, which is why the existing B2
  // single-object content-growth test is unaffected by this addition.
  //
  // A displacement correction, never a navigation — applyScrollYDeltaRef
  // (jump semantics, with in-flight-spring retargeting per adjudication 1)
  // is the write path, never driveScrollYRef (which always springs in
  // real mode).
  // eslint-disable-next-line react-hooks/immutability -- This callback mutates dragStartOffset.current (a ref prop) after render — the plan's known ref-mirror exception; documented drag-baseline-correction idiom, opt-out not rewrite.
  const remeasureGeometryWithAnchorCompensation = useCallback((): boolean => {
    if (!columnFocusedRef.current) {
      const changed = remeasureGeometry();
      lastSettledGeometryRef.current = new Map(geometryStore.current);
      lastSettledIntraAnchorRef.current = null; // F10: nothing to track while unfocused
      return changed;
    }

    // "Before" reads from the last-SETTLED snapshot (captured at the end
    // of the PREVIOUS call to this same wrapper), never live geometryStore
    // directly — probe-confirmed bug avoided here: SceneObject's own
    // registration effect unregisters-then-reregisters on EVERY render
    // (no deps array — see its own doc comment, "a focus-only change must
    // be reflected in the registry the SAME commit"), and unregistering
    // deletes that object's geometryStore entry as a side effect.
    // Children's layout effects run BEFORE the parent's (React's
    // bottom-up ordering), so by the time THIS wrapper's own layout
    // effect runs, sibling children may have already wiped their entries
    // for this same commit — geometryStore.current can transiently read
    // empty/partial even though nothing about their geometry actually
    // needs to change. The settled snapshot sidesteps this entirely.
    const anchorName = selectAnchorObject(
      objectStatesRef.current,
      lastSettledGeometryRef.current,
      scrollOffsetRef.current,
      viewportHeightRef.current,
    );
    // Null-safety (forecast Finding 2): selectAnchorObject legally returns
    // null (no focused object's geometry is known yet, e.g. mid-swap-
    // commit) — skip compensation entirely rather than NaN-propagating.
    const beforeOffsetTop = anchorName ? lastSettledGeometryRef.current.get(anchorName)?.offsetTop : undefined;

    // F10: carry forward the element tracked at the end of the PREVIOUS
    // settle, discarding it if it belonged to a DIFFERENT anchor object
    // (the user scrolled to a different focused object between settles —
    // its LOCAL offset would be meaningless against a different object's
    // basis) or has since been disconnected (removed by the same content
    // change this call is reacting to). Both are legal transient states,
    // not errors: a fresh candidate is always re-selected at the end of
    // this function regardless, so tracking self-heals on the very next
    // call with no special-case recovery path needed.
    const beforeIntra = lastSettledIntraAnchorRef.current;
    const intraBefore =
      beforeIntra && beforeIntra.objName === anchorName && beforeIntra.el.isConnected
        ? beforeIntra
        : null;

    const changed = remeasureGeometry();

    // F10: one wrapperRect read serves every intra-object measurement below
    // (the "after" delta for intraBefore AND the fresh re-selection at the
    // end) — mirrors remeasureGeometry's own single-read-per-pass
    // technique. Safe to reuse across the scroll-offset writes in between:
    // neither React's state-driven `top` (instant mode) nor Motion's
    // rAF-batched MotionValue-driven `top` (real mode) mutates the
    // wrapper's rendered position SYNCHRONOUSLY within this function call —
    // both defer to a later commit/frame — so the wrapper never actually
    // moves between these reads.
    const wrapper = contentWrapperRef.current;
    const wrapperRect = wrapper?.getBoundingClientRect();
    const afterOffsetTop = anchorName ? geometryStore.current.get(anchorName)?.offsetTop : undefined;

    // ui/t:28: set below (when intraBefore exists) — whether the currently
    // tracked F10b candidate is still within the CURRENT scroll window.
    // Stays false (the conservative default: re-select) when there's no
    // tracked candidate to judge yet.
    let candidateStillInWindow = false;

    if (anchorName !== null && beforeOffsetTop !== undefined && afterOffsetTop !== undefined) {
      const delta = afterOffsetTop - beforeOffsetTop;
      if (delta !== 0) {
        // Clamp against a FRESHLY computed maxScroll, not maxScrollRef —
        // probe-confirmed bug avoided here: maxScrollRef.current still
        // reflects the STALE, pre-remeasure contentHeight React state
        // (setContentHeight is only called AFTER this wrapper returns,
        // later in the same layout effect), so clamping against it here
        // would clip a genuine correction to the OLD, smaller bound
        // before the new content's height is accounted for. Mirrors the
        // A2 swap-reset effect's own established pattern for this exact
        // staleness class ("Computing a fresh value directly from the
        // just-remeasured geometry store sidesteps that lag entirely").
        const freshContentHeight = computeFocusedContentHeight(
          objectStatesRef.current,
          geometryStore.current,
          objectGapRef.current,
        );
        const freshMaxScroll = Math.max(
          0,
          viewportHeightRef.current > 0 ? freshContentHeight - viewportHeightRef.current : 0,
        );
        const corrected = Math.max(
          0,
          Math.min(freshMaxScroll, scrollOffsetRef.current + delta),
        );
        const appliedDelta = corrected - scrollOffsetRef.current;
        scrollOffsetRef.current = corrected;
        setScrollOffset(corrected);
        applyScrollYDeltaRef.current(appliedDelta);
        // F9 commit 2 scope addition: rebase the active touch drag's own
        // baseline by the same delta so the gesture's math stays
        // coherent through a mid-drag compensation event. Without this,
        // handleContentPointerMove recomputes newOffset from
        // dragStartOffset every pointermove tick — a STALE baseline
        // relative to the just-applied compensation — silently
        // overwriting the correction on the very next tick (a flash-
        // then-revert). Rebasing dragStartOffset by the same delta
        // preserves the user's finger-anchored expectation: the finger
        // still tracks the SAME visual content it started on, just now
        // correctly offset by however much content shifted above it.
        if (isDragging.current) {
          // eslint-disable-next-line react-hooks/immutability -- dragStartOffset.current += appliedDelta — deliberate drag-baseline correction while dragging, the plan's known-expected ref-mirror exception.
          dragStartOffset.current += appliedDelta;
        }
      }

      // F10: intra-object anchoring — a PREPEND inside the anchor object's
      // own interior (adding content above the currently-tracked row) grows
      // the object's total height but never moves the object's OWN
      // offsetTop (nothing precedes the OBJECT itself), so the object-level
      // pass above is structurally blind to it (same reason a sole
      // focused object's own growth is a no-op there). Layered on top,
      // never in place of it: intraBefore.offsetTop and
      // afterIntraLocalOffsetTop are both expressed LOCAL to anchorName
      // (candidate offsetTop minus the object's OWN offsetTop), which is
      // what lets this branch's correction compose ADDITIVELY with the
      // object-level one above rather than double-counting it — a
      // content-wrapper-relative (global) delta for the SAME tracked
      // candidate would already include whatever shifted the object itself,
      // since a descendant's absolute position is anchorObjectOffsetTop +
      // itsOwnLocalOffset; subtracting the object's own offsetTop on both
      // sides of the diff cancels that shared term, isolating the
      // object's-own-interior contribution only. scrollOffsetRef.current is
      // read below AFTER the object-level write above (if any fired), so
      // the two corrections stack rather than race.
      if (intraBefore && wrapperRect) {
        const afterIntraGlobalOffsetTop = intraBefore.el.getBoundingClientRect().top - wrapperRect.top;
        const afterIntraLocalOffsetTop = afterIntraGlobalOffsetTop - afterOffsetTop;
        const intraDelta = afterIntraLocalOffsetTop - intraBefore.offsetTop;
        // ui/t:28: cheap (no extra DOM read — reuses afterIntraGlobalOffsetTop,
        // already measured above for the correction check), scroll-window
        // straddle test in the SAME wrapper-relative frame scrollOffsetRef/
        // viewportHeightRef are already expressed in (matches
        // selectAnchorObject's own windowStart/windowEnd predicate below).
        // Feeds the F10b re-selection gate: a candidate still inside the
        // CURRENT viewport window needs no fresh descent.
        candidateStillInWindow =
          afterIntraGlobalOffsetTop + intraBefore.height > scrollOffsetRef.current &&
          afterIntraGlobalOffsetTop < scrollOffsetRef.current + viewportHeightRef.current;
        // Offset-exactly-0 suppression, MODE-SCOPED to anchor="none" (F11
        // fix — Peri's CR-3, source-confirmed): F10's original suppression
        // fired for every column, but a real anchor="end" reader who has
        // scrolled all the way to offset 0 is holding their place in
        // HISTORY, not "at the top with nothing above yet" the way a plain
        // anchor="none" feed's offset-0 reader is. The anchor mode already
        // declares content direction — "end" = the live edge (new content
        // arrives ahead, at maxScroll; offset 0 is just far history) vs.
        // "none"'s plain native-anchoring mirror (offset 0 IS the true
        // top — mirrors native scroll anchoring, which never corrects at
        // scrollTop 0 so newly-arrived top content stays discoverable
        // there rather than being invisibly scrolled past). So anchor="end"
        // compensates at ANY offset, including exactly 0; anchor="none"
        // keeps the original suppression. Evaluated against the RUNNING
        // offset (post any object-level write above), matching where this
        // branch's own correction, if applied, would land.
        // F12: shared write path for both intra-object corrections below
        // (the anchor-delta branch and the witness-delta fallback) — the
        // SAME fresh-maxScroll-then-clamp-then-apply sequence the
        // object-level branch above uses, factored once so the witness
        // fallback can never drift from the anchor branch's own mechanism.
        const applyIntraCorrection = (delta: number) => {
          const freshContentHeight = computeFocusedContentHeight(
            objectStatesRef.current,
            geometryStore.current,
            objectGapRef.current,
          );
          const freshMaxScroll = Math.max(
            0,
            viewportHeightRef.current > 0 ? freshContentHeight - viewportHeightRef.current : 0,
          );
          const corrected = Math.max(0, Math.min(freshMaxScroll, scrollOffsetRef.current + delta));
          const appliedDelta = corrected - scrollOffsetRef.current;
          scrollOffsetRef.current = corrected;
          setScrollOffset(corrected);
          applyScrollYDeltaRef.current(appliedDelta);
          // Same drag-rebase rationale as the object-level branch above —
          // both branches' appliedDelta accumulate independently onto
          // dragStartOffset when they compose in the same settle.
          if (isDragging.current) {
            dragStartOffset.current += appliedDelta;
          }
        };

        if (intraDelta !== 0 && (anchor === "end" || scrollOffsetRef.current > 0)) {
          applyIntraCorrection(intraDelta);
        } else {
          // F12: witness-element fallback, scoped to anchor="end" only (the
          // anchor mode declares content direction — see the offset-0
          // suppression comment above; a "none" column never witnesses).
          // Handles the case F11's guard didn't: a STATIONARY element above
          // the real prepend point (a "load earlier" affordance, a date
          // header) is itself the tracked anchor, so it never moves on a
          // prepend below it — intraDelta stays 0 and the branch above
          // never fires. The witness (the deepest in-view element just
          // below the anchor's bottom edge, recorded at the last settle —
          // see the record site below) reveals that exact case: if IT moved
          // while the anchor's own top AND height stayed put, something was
          // inserted between them.
          const witness = anchor === "end" && intraDelta === 0 ? intraBefore.witness : null;
          if (witness && witness.el.isConnected) {
            // Anchor's own height growing in place (e.g. an image loading
            // inside it) is NOT a sibling insertion — that keeps native
            // hold-the-top semantics, same as any other in-place growth.
            // offsetHeight (not getBoundingClientRect, per H11) matches how
            // `height` was captured at settle time.
            const afterAnchorHeight = (intraBefore.el as HTMLElement).offsetHeight;
            if (afterAnchorHeight === intraBefore.height) {
              const afterWitnessGlobalOffsetTop = witness.el.getBoundingClientRect().top - wrapperRect.top;
              const afterWitnessLocalOffsetTop = afterWitnessGlobalOffsetTop - afterOffsetTop;
              const witnessDelta = afterWitnessLocalOffsetTop - witness.offsetTop;
              if (witnessDelta !== 0) {
                applyIntraCorrection(witnessDelta);
              }
            }
          }
        }
      }
    }

    // F10b: re-select the DEEPEST candidate to track for the NEXT settle
    // (recursive descent — F10's own one-level version stopped at the
    // first branching level, which reproduces the exact object-level
    // blindness one wrapper deeper: a real consumer pipeline can nest the
    // actual rows two or more levels below where real siblings first
    // appear, e.g. behind a list component's own root, alongside sticky
    // siblings like a chat's Composer/PushBanner). Always freshly derived
    // rather than carried forward, so a changed anchor or a disconnected
    // previous candidate self-heals with no special-case recovery path.
    // findDeepestIntraObjectAnchor operates in the GLOBAL (content-
    // wrapper-relative) frame throughout its walk — the SAME frame
    // wrapperRect/scrollOffsetRef.current already share — converting to
    // the object-LOCAL frame intraBefore uses only at the end, once,
    // rather than at every recursion level.
    //
    // ui/t:28: this descent walks every one of the anchor object's own DOM
    // descendants (findIntraObjectAnchorCandidates + isStickyOrFixed's
    // getComputedStyle per candidate) — O(rows), not O(registered
    // objects) like `changed` above, and it re-runs on EVERY commit with
    // no gate at all pre-fix (48 getComputedStyle + 48
    // getBoundingClientRect per row per 12-event wheel gesture on an
    // anchor="end" column — hunt-lag round 2a, ui/o:87).
    //
    // Gating on `changed` alone (content/registered-object geometry) is
    // UNSOUND here and was proven so empirically: a pure scroll (no
    // content change) legitimately needs the candidate/witness pair
    // re-selected once the viewport has moved far enough that the
    // TRACKED element is no longer near it — 11 growth-compensation/
    // pinning-suite tests broke under a `changed`-only gate (scrolling
    // away from a tracked candidate, then prepending, produced zero
    // compensation — the stale candidate/witness pair referenced a
    // viewport position the user had long since scrolled away from).
    //
    // The sound gate: re-select when EITHER (a) `changed` — real content/
    // registered-object geometry moved, forcing a fresh read regardless
    // of position, or (b) `!candidateStillInWindow` — the tracked
    // candidate has scrolled OUTSIDE the current viewport window, so it's
    // no longer a valid proxy for "what's near the boundary now" and a
    // fresh descent is needed to find one that is. A continuous scroll
    // gesture moving by less than one row's height per frame (the common
    // case) keeps re-triggering (b) far less often than once per commit —
    // the reselection frequency now scales with distance scrolled past a
    // row boundary, not with row count or commit count, which is what
    // keeps the DOM-read total from scaling with row count (criterion
    // 6abd0aa0 — probe-lag8 methodology, same-row-count-varying gesture).
    // When it DOES need to run again, it always reads scrollOffsetRef.
    // current fresh, so re-selection reflects the CURRENT scroll position
    // regardless of how many renders were skipped getting there.
    const needsReselect = changed || !candidateStillInWindow;
    const anchorEl = needsReselect && anchorName ? registeredEls.current.get(anchorName) : undefined;
    if (anchorEl && wrapperRect && afterOffsetTop !== undefined) {
      const match = findDeepestIntraObjectAnchor(
        anchorEl,
        wrapperRect,
        scrollOffsetRef.current,
        viewportHeightRef.current,
      );
      if (match !== null) {
        // F12: witness bookkeeping, scoped to anchor="end" (see the
        // compensation branch above for the fallback rationale). The
        // witness is the deepest in-view element intersecting a WINDOW
        // from just below the anchor's own bottom edge to the end of the
        // current viewport — reusing the SAME recursive descent as the
        // anchor selection above. F12b: a single-point scan (a 0-height
        // "viewport" at the line) dies in inter-sibling gaps (flex `gap`,
        // margins) — the line can land in dead space between the anchor's
        // wrapper and the next real sibling, so nothing intersects it and
        // the descent stops one level up with no usable witness. Widening
        // to a window means the same straddle predicate
        // (`offsetTop < windowEnd && offsetTop + height > windowStart`)
        // still excludes the anchor's own wrapper (its bottom edge sits at
        // or before windowStart, so it fails the straddle) while landing on
        // the first real element below it regardless of gap size —
        // containers spanning the window still descend to their first
        // qualifying child, same as before. No witness when that line falls
        // at or past the bottom of the current viewport window — the anchor
        // fills the rest of the visible area, so nothing below it is
        // currently displaceable-and-visible, correctly a no-op. The line
        // is always past the viewport's top edge here: match's own
        // selection already guarantees
        // match.offsetTop + match.height > scrollOffsetRef.current.
        // Accepted bound (documented): a SECOND stationary element stacked
        // between the anchor and the insert point re-creates the
        // blindness — same class, revisit on evidence.
        // ui/t:28 (criterion a18e8581): this witness pass only runs as part
        // of the SAME re-selection the `needsReselect` gate above governs
        // — eliminated as a side effect whenever that gate skips, not
        // separately gated. Measured (probe-lag8 methodology, 500/1,000-
        // row anchor="end" columns, the mode this pass is scoped to): the
        // gate reduces re-selection — and with it, this witness pass — to
        // 3 of 31 commits across a full 12-event gesture (mount plus two
        // real out-of-window events), collapsing getComputedStyle calls
        // 24,120→24 and getBoundingClientRect 24,254→144 at 500 rows, with
        // BOTH counts identical at 1,000 rows — true row-count
        // independence, not just a smaller constant. No separate handling
        // needed: retaining the pass but gating its invocation is a
        // strictly smaller diff than trying to eliminate it as its own
        // code path, and the identical-count-at-both-row-counts result
        // means there's no further win available from doing so.
        const witnessLine = match.offsetTop + match.height + 1;
        const viewportEnd = scrollOffsetRef.current + viewportHeightRef.current;
        const witnessMatch =
          anchor === "end" && witnessLine < viewportEnd
            ? findDeepestIntraObjectAnchor(anchorEl, wrapperRect, witnessLine, viewportEnd - witnessLine)
            : null;
        lastSettledIntraAnchorRef.current = {
          objName: anchorName!,
          el: match.el,
          offsetTop: match.offsetTop - afterOffsetTop,
          height: match.height,
          witness:
            witnessMatch !== null
              ? { el: witnessMatch.el, offsetTop: witnessMatch.offsetTop - afterOffsetTop }
              : null,
        };
      } else {
        lastSettledIntraAnchorRef.current = null;
      }
    } else if (needsReselect) {
      // Only clear tracking when this settle actually attempted a fresh
      // selection and the fallback conditions (anchor known, wrapper
      // mounted, geometry available) came back unmet — a `!needsReselect`
      // skip above must NOT reach here, or every render where the
      // candidate is still in-window would wipe the still-valid tracking
      // the gate above exists to preserve.
      lastSettledIntraAnchorRef.current = null;
    }

    lastSettledGeometryRef.current = new Map(geometryStore.current);
    return changed;
  }, [remeasureGeometry]);

  // Single shared ResizeObserver for this column: observes colRef plus every
  // registered SceneObject element. Created once on mount; register/
  // unregister (in SceneColumn's own registration effect) manage membership
  // as objects mount/unmount. Catches content growth (e.g. an image
  // finishing load) with no accompanying React render — the actual B2 fix.
  // The synchronous per-render remeasure below handles the common case
  // (focus/prop changes); this handles the rest.
  // eslint-disable-next-line react-hooks/immutability -- This effect mutates dragStartOffset.current after render — same drag-baseline-correction idiom as L235/L345.
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      // Always refresh the cache (cheap; corrected again by the next
      // synchronous per-render remeasure regardless) so a column that later
      // becomes focused starts from reasonably fresh geometry. F9: the
      // anchor-compensation wrapper (not raw remeasureGeometry) — this is
      // the async path content growth reaches with no accompanying React
      // render (the B2 fix's own scenario), so it must apply anchoring
      // compensation here directly, synchronously inside this callback,
      // before any state update — ResizeObserver callbacks run pre-paint
      // in the SAME rendering pass as the layout change that triggered
      // them (same guarantee data-ui-scene-scroll-offset's writer already relies
      // on), so a synchronous scrollY write here lands before that frame
      // paints, matching the "same-frame, no visible motion" contract.
      const changed = remeasureGeometryWithAnchorCompensation();

      // Only unfocused columns' geometry (colHeight, marginTop) — none of
      // it depends on the geometry store (computeTopOffset/
      // computeFocusedContentHeight both early-return with zero focused
      // objects, and computeWithinColumnDepths no longer reads the geometry
      // store at all — ui/t:21 Slice 4 hygiene, see its own doc comment), so
      // forcing a re-render here would be pure overhead. Worse,
      // an unfocused in-between column sits under CSS perspective/translateZ
      // depth treatment — a rect read after that transform has visually
      // settled reports a foreshortened size, and forcing an otherwise-
      // unnecessary render risks feeding that projected size into
      // unrelated column-level layout math. Bail out entirely.
      if (!columnFocusedRef.current) return;

      setContentHeight(
        computeFocusedContentHeight(objectStatesRef.current, geometryStore.current, objectGapRef.current),
      );
      const colEl = colRef.current;
      if (colEl) {
        // F7 item 1 fix: offsetWidth/offsetHeight, not getBoundingClientRect()
        // — same projection-contamination class as the per-render snapshot
        // effect in SceneColumn (this is the SAME lastObservedSize this
        // ResizeObserver callback also writes to). columnFocusedRef.current
        // being true only means the column's Z *target* is 0 — its zMV can
        // still be mid-flight back from a depth-deck transform (e.g. a
        // rapid refocus, this ResizeObserver callback firing before that
        // spring settles).
        lastObservedSize.current = { width: colEl.offsetWidth, height: colEl.offsetHeight };
      }
      // Fingerprint bail-out (forecast-gate adjudication): only force a
      // re-render when the geometry actually changed.
      if (changed) setGeometryVersion((v) => v + 1);
    });
    resizeObserverRef.current = observer;
    if (colRef.current) observer.observe(colRef.current);
    for (const el of registeredEls.current.values()) observer.observe(el);
    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [
    remeasureGeometryWithAnchorCompensation,
    colRef,
    geometryStore,
    lastObservedSize,
    registeredEls,
    resizeObserverRef,
    setContentHeight,
  ]);

  // Measure the content wrapper synchronously after each render (useLayoutEffect
  // fires before the browser paints) so geometry is fresh for the very next
  // render — this is what removes the one-render lag that would otherwise
  // corrupt a same-commit swap-reset decision reading maxScroll. Skipped
  // entirely for a column that's neither focused nor in-between (ui/t:32):
  // such a column's width relies on a frozen snapshot (SceneColumn's own
  // `frozenSize`), not live geometryStore data, so remeasuring it on every
  // unrelated Scene-level re-render is pure waste — the shared
  // ResizeObserver above still keeps its geometry current for the day it
  // DOES become focused (a real content-size change fires it regardless of
  // focus). An in-between (decked) column IS let through the first gate
  // below despite being unfocused: its own columnWidthMV/computeMeasuredWidth
  // channel reads live geometryStore data regardless of focus (the column's
  // natural width doesn't depend on focus) — starving it here left that
  // channel stuck at its mount-time value (caught by
  // tests/scene-glass-stack-deck.test.tsx's own resize-tracking test, see
  // the ui/t:32 worker report for the isolation evidence). The SECOND gate
  // (unchanged from before this commit) keeps the focused-only content-
  // height/geometryVersion work scoped to focused columns exactly as it
  // always was — an in-between column has zero focused objects, so
  // computeFocusedContentHeight would be meaningless for it.
  // Compute focused content height from the sum of focused objects' heights
  // (not the content wrapper's total height, which includes unfocused
  // objects in flow). This ensures scroll range only covers focused content.
  // F9: the anchor-compensation wrapper (not raw remeasureGeometry) — this
  // is the sync path a React re-render (e.g. a focused sibling's content
  // prop changing) reaches; useLayoutEffect fires pre-paint, same commit
  // tier as the compensation write, so it lands before paint here too.
  useLayoutEffect(() => {
    if (!columnFocused && !inBetweenNow) return;
    const changed = remeasureGeometryWithAnchorCompensation();
    if (!columnFocused) return;
    setContentHeight(computeFocusedContentHeight(objectStates, geometryStore.current, objectGap));
    // Mirrors the ResizeObserver sibling above — without this, a
    // newly-MOUNTED focused object's first render reads stale (missing)
    // geometry (computeTopOffset falls back to `?? 0`, since it reads
    // geometry captured by the PREVIOUS render's layout effects — see that
    // function's own comment). This effect's remeasure call above DOES
    // correct geometryStore with the new object's real geometry, but if its
    // content height happens to coincide with what was already accounted
    // for, setContentHeight no-ops (React bails on an identical state
    // update) and nothing else forces the re-render computeTopOffset needs
    // to pick up the corrected geometry — the entrance freezes permanently,
    // not just late by one frame.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setGeometryVersion forces a synchronous re-render only when remeasurement actually changed geometry — documented above as required to avoid a permanently frozen entrance; deliberate.
    if (changed) setGeometryVersion((v) => v + 1);
  });
}
