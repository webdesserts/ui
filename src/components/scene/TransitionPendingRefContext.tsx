import { createContext, type RefObject } from "react";

/**
 * A ref mirror of TransitionPendingContext's own boolean, for the ONE
 * consumer that cannot safely read the reactive context value directly:
 * SceneObject's two-phase focus effect (F2).
 *
 * Why this exists (a real, probe-confirmed race, not a defensive
 * precaution): Scene's own settle-tracking layout effect mutates
 * `transitionPendingRef` (Scene.tsx) and calls `setTransitionPending(true)`
 * SYNCHRONOUSLY, in that order, within the SAME layout-effect invocation —
 * a state update from inside `useLayoutEffect` forces React to flush and
 * commit a corrective re-render before paint. Confirmed at source
 * (instrumented trace): React flushes SceneObject's own PASSIVE effect
 * (the two-phase focus effect, a `useEffect`) for the FIRST, not-yet-
 * corrected commit BEFORE processing that corrective re-render's own
 * layout-effect phase — so on a real (non-zero-duration) focus-gain, the
 * two-phase effect's very first firing can observe
 * TransitionPendingContext's boolean still reading its STALE pre-arm value
 * (`false`), even though Scene's own `transitionPendingRef.current` (a
 * plain mutable ref, not tied to any particular render's closure) is
 * ALREADY `true` by that point — the ref mutation happens synchronously,
 * strictly before any descendant's own effects for that commit run.
 * Reading the ref instead of the reactive boolean for the phase-2 decision
 * sidesteps this staleness entirely: whichever "generation" of render a
 * given effect invocation happens to correspond to, `.current` always
 * reflects Scene's latest truth. The reactive boolean
 * (TransitionPendingContext) is still what re-fires the effect (via its
 * presence in the dependency array) and still what `activatable`
 * render-time gating uses directly — this context exists ONLY to break the
 * one same-effect-pass staleness window the two-phase mechanism is
 * otherwise exposed to.
 */
export const TransitionPendingRefContext = createContext<RefObject<boolean>>({ current: false });
