import { useCallback, useRef } from "react";

/**
 * Tracks whether a numeric measurement has "settled" — arrived at the SAME
 * nonzero value across two consecutive commits — permanently latching true
 * once it has (never resets false again). ui#20 criterion 6: the shared
 * primitive behind Scene.tsx's `vpWidthSettledRef`/`lastVpWidthRef` (gates
 * the pan-bounds write) and SceneColumn.tsx's
 * `columnGeometrySettledRef`/`lastEffectiveViewportHeightRef` (gates
 * marginTop/topOffsetMV/width-channel/zMV's first-commit drive) — both were
 * the SAME two-consecutive-commits idiom, hand-duplicated at each site.
 *
 * NOT for the settle-SIGNAL registry (SettleSignalContext/ownedAnimation.ts)
 * — a genuinely different problem: this tracks a MEASUREMENT (viewport
 * clientWidth, effective viewport height) arriving stably across React
 * commits during mount/resize, not an owned MotionValue animation's
 * claim/retire lifecycle. A scene can be geometry-unsettled here with zero
 * owned animations running (board ui#o41).
 *
 * WHY two consecutive commits, not one: a late-arriving correction (e.g. a
 * horizontal scrollbar's space reservation toggling on, or an
 * async ResizeObserver callback) can still be in flight after the FIRST
 * commit where the value goes nonzero — probe-confirmed (SceneColumn's
 * original F7 item 2 fix): viewportHeight arrived in two separate real
 * commits during mount in a real (non-headless-suppressed) scrollbar
 * environment, first without the scrollbar's space reservation, then with
 * it once the now-smaller content-box height was measured. A one-shot
 * "nonzero means settled" check would have already latched true on the
 * FIRST, still-wrong commit, letting a real consumer (e.g. marginTop)
 * spring visibly from the placeholder value to the corrected one instead of
 * jumping straight to it.
 *
 * WHY `wasSettled` is the PRE-mutation value (read during render, not the
 * post-check value) and WHY the actual check/update is a manually-called
 * function rather than an effect this hook owns internally: mutating a ref
 * directly in the render body is impure, and React StrictMode's
 * development-only double-invocation of a component's render function
 * defeats a same-render mutate-and-read pattern — probe-confirmed
 * (SceneColumn's original A4 first-paint gate investigation): at the
 * critical commit where the tracked value first becomes real, StrictMode
 * calls the render function twice; the first call correctly reads "not yet
 * settled" and would mutate a ref to "settled" as a side effect, then the
 * SECOND call (whose return value React actually uses) would read the
 * already-mutated "settled" — silently collapsing the gate for the exact
 * render it exists to keep instant. Reading `wasSettled` here (unmutated)
 * and only ever calling `checkSettled` from a layout effect keeps both
 * StrictMode invocations of a given commit observing the SAME value, since
 * the effect only runs once the real commit has been decided. `checkSettled`
 * is exposed as a plain function (not driven by its own internal effect)
 * because the two production call sites measure their value differently:
 * SceneColumn's `effectiveViewportHeight` is known synchronously during
 * render (context-derived), but Scene's `viewport.clientWidth` is a live
 * DOM read that only happens inside an existing, larger layout effect —
 * `checkSettled` lets either caller feed it the value from wherever that
 * value actually becomes known, without forcing a second effect.
 */
export function useSettledValue(): [wasSettled: boolean, checkSettled: (value: number) => void] {
  const settledRef = useRef(false);
  const lastValueRef = useRef<number | null>(null);
  const wasSettled = settledRef.current;
  const checkSettled = useCallback((value: number) => {
    if (value > 0 && lastValueRef.current === value) {
      settledRef.current = true;
    }
    lastValueRef.current = value;
  }, []);
  return [wasSettled, checkSettled];
}
