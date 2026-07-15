import { createContext, useContext } from "react";
import type { AnimationPlaybackControls, MotionValue } from "motion/react";

/**
 * Internal seam letting Scene/SceneColumn register the live MotionValues (and
 * the latest AnimationPlaybackControls returned by imperative `animate()`
 * calls) that drive the S3 motion pipeline (camera pan `left`, strip scroll
 * `top`). NOT exported from either barrel — this is not public API. A future
 * test harness (S7) imports this module directly by its internal path to
 * scrub/inspect in-flight motion state deterministically instead of racing
 * real spring timing against `layout` FLIP animations in the same subtree.
 *
 * Mirrors AnimationCallbackContext's null-unless-wrapped pattern: production
 * renders never wrap a provider, so registration calls below are no-ops
 * unless a test opts in by wrapping `MotionSeamContext.Provider` around the
 * render tree.
 */
export interface MotionSeamRegistration {
  /** Register (or update) a named MotionValue driving Scene's motion pipeline. */
  registerMotionValue: (key: string, value: MotionValue<number>) => void;
  /** Register (or update) the latest AnimationPlaybackControls for a named value. */
  registerControls: (key: string, controls: AnimationPlaybackControls | undefined) => void;
  /**
   * Register (or update) the target a real `animate()` call is springing a
   * named value toward. Optional (F4 active-springs debug panel addition,
   * not part of the original S3/S7 pinning seam) — AnimationPlaybackControls
   * has no public API to read a target back out, so producers report it
   * separately at the same call site that already knows it. Omitted for
   * animations with no fixed target (e.g. an inertia/fling deceleration).
   */
  registerTarget?: (key: string, target: number) => void;
  /**
   * Unregister a named MotionValue when its owning component unmounts.
   * Optional (same F4 addition as registerTarget) — the original S3/S7
   * pinning seam never needed eviction (a fresh test recorder is created
   * per test and only ever queried for specific known keys), but the F4
   * active-springs debug panel lists EVERY currently-registered key as
   * visible text, so a never-evicted entry for a since-unmounted object
   * would leak that object's name into the overlay indefinitely.
   */
  unregisterMotionValue?: (key: string) => void;
}

export const MotionSeamContext = createContext<MotionSeamRegistration | null>(null);

/** Returns the motion seam registration, or null when no test harness has wrapped a provider. */
export function useMotionSeam(): MotionSeamRegistration | null {
  return useContext(MotionSeamContext);
}
