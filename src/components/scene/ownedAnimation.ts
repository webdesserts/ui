import { useCallback, useContext, useMemo, useRef } from "react";
import { animate, type MotionValue } from "motion/react";
import { SettleSignalContext } from "./SettleSignalContext";

/**
 * The seam every owned-channel MotionValue animation flows through (ui/t:17
 * cascade-fix round, Step 2), replacing the hand-wired per-channel
 * claimChannelAnimation/retireChannelAnimation guards Slice 1 close-out
 * originally built directly in SceneColumn. Reason for the move: a
 * per-channel counter wired by hand at each call site is exactly as
 * strong as the discipline of whoever adds the NEXT channel — miss one
 * wire-up and Scene's camera-recentering effect silently stops
 * re-measuring against it, the exact failure the counter exists to
 * prevent (proven directly: cameraX itself was the missed channel this
 * round, traced end to end — its own corrective retarget, triggered BY
 * the zero-crossing, wasn't itself tracked, so the crown-jewel tests
 * regressed 5/5 even though the counter mechanism was working exactly as
 * designed). Routing every owned animation through ONE shared entry
 * point instead means a forgotten channel can't happen structurally — it
 * either goes through here (and is automatically tracked) or it doesn't
 * animate at all, because there's no other way to drive an owned
 * MotionValue's settle-relevant transitions in this codebase. See
 * SettleSignalContext's own doc comment for why the counter itself is an
 * aggregate zero-crossing, not a per-event fire.
 *
 * One hook call per MotionValue, not per call site — several channels
 * (cameraX especially: driveCameraX's own recentering, the touch-fling
 * inertia, the drag-start stop-jump) drive the SAME underlying value
 * from different trigger paths, and they share ONE claim/retire state
 * since the question the counter answers is "is THIS MotionValue
 * currently mid-transition," not "did this specific call site start
 * something." Every current caller (SceneColumn, SceneObject,
 * SceneViewport) is a descendant of Scene's own
 * <SettleSignalContext.Provider>, so the plain context read below always
 * resolves correctly — including SceneViewport, where cameraX itself
 * lives: it's a CHILD Scene renders inside its own provider, not Scene's
 * own component body, so it's never inside its own provider's blind
 * spot the way Scene itself would be.
 *
 * Deliberately includes non-geometry-affecting channels rather than
 * trying to filter to only the ones that affect what Scene's camera
 * measures (Michael's ruling: simplicity beats micro-optimization here —
 * a slightly-later re-measure triggered by an unrelated channel's own
 * settle is harmless; a channel silently excluded because someone
 * guessed it was safe to skip is the exact fragility this exists to
 * kill). scrollY is the one deliberate exception — see its own call
 * sites in SceneColumn for why.
 */
export function useOwnedAnimation(duration: number | undefined) {
  const settle = useContext(SettleSignalContext);
  const activeRef = useRef(false);

  const claim = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    settle?.animationStarted();
  }, [settle]);

  const retire = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    settle?.animationEnded();
  }, [settle]);

  /**
   * Wraps `motionValue.jump()`. A synchronous jump has no genuine "start"
   * distinct from its own completion, so this only ever retires — if the
   * jump is superseding an in-flight animation this MotionValue's own
   * `claim` had registered, that's exactly the "cancel" path the counter
   * needs to hear about; if nothing was claimed, this is a no-op on the
   * counter (a fresh jump with nothing else in flight for this value).
   */
  const ownedJump = useCallback(
    <T>(mv: MotionValue<T>, target: T) => {
      mv.jump(target);
      retire();
    },
    [retire],
  );

  /**
   * Wraps the imperative `animate()` call. Claims on start; the caller's
   * own `onComplete` (if any) still runs, after this wrapper's own
   * retire — Motion never calls `onComplete` for an animation superseded
   * by a later `animate()` call on the same MotionValue (confirmed at
   * source, motion-dom's `MotionValue.start()` calls `stop()` on any
   * animation it supersedes, firing that prior animation's cancel path,
   * never its completion), so retire only ever fires for the LATEST
   * animate() call on a given MotionValue — exactly the pairing claim
   * needs, with no orphaning possible from an interrupted intermediate
   * call.
   */
  const ownedAnimate = useCallback(
    <T>(
      mv: MotionValue<T>,
      // T | T[] rather than just T: Motion's keyframes syntax accepts an
      // array target even for a single-value MotionValue (the touch-fling
      // inertia call site passes [cameraX.get()], a one-element keyframes
      // array — the documented way to make `type: "inertia"` actually
      // decelerate rather than resolving instantly).
      target: T | T[],
      transition: Parameters<typeof animate>[2],
      onComplete?: () => void,
    ): ReturnType<typeof animate> => {
      claim();
      return animate(mv, target as never, {
        ...transition,
        onComplete: () => {
          retire();
          onComplete?.();
        },
      });
    },
    [claim, retire],
  );

  // ui/t:33: "did duration just transition to 0 (from something else), as of
  // THIS hook instance's own last render." Closes a structural gap in every
  // caller's own target-changed guard (see each caller's own effect): a
  // live duration flip with no accompanying target change never re-enters a
  // guard keyed purely on "did my target change," so the claimed channel's
  // animation never retires — it freezes rather than settling, since the
  // rendered style also switches away from the live MotionValue the same
  // render (`duration === 0 ? <plain number> : <MotionValue>`, ungated by
  // any ref). Callers OR this into their existing guard's early-return.
  //
  // One `prevDurationRef` per channel instance (one hook call per
  // MotionValue, see this file's own top doc comment) rather than a single
  // shared ref — harmless, since every channel in a component reads the
  // SAME `duration` prop every render, so every instance's own ref
  // independently converges on the same answer the same render the flip
  // happens.
  const prevDurationRef = useRef(duration);
  const durationJustBecameZero = duration === 0 && prevDurationRef.current !== 0;
  prevDurationRef.current = duration;

  // Memoized so the returned object is itself a stable reference across
  // renders that don't change `settle` or `durationJustBecameZero` —
  // callers that put it in a useCallback/useEffect dependency array
  // (driveCameraX does, since it's used by other callbacks that depend on
  // ITS OWN reference stability) don't get invalidated every render just
  // because this hook was called again. durationJustBecameZero is only
  // ever true for the single render an actual flip happens, so the
  // resulting identity churn is bounded to that rare event, not routine
  // per-render noise.
  return useMemo(
    () => ({ jump: ownedJump, animateTo: ownedAnimate, durationJustBecameZero }),
    [ownedJump, ownedAnimate, durationJustBecameZero],
  );
}
