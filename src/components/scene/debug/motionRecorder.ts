import type { MotionSeamRegistration } from "../motionSeam";
import type { AnimationPlaybackControls, MotionValue } from "motion/react";

/**
 * A MotionSeamRegistration recorder Scene creates for ITSELF when `debug` is
 * enabled and no test harness has already wrapped a MotionSeamContext.Provider
 * around the tree (see SceneViewport's `motionSeam` derivation below) — powers
 * the debug overlay's active-springs panel. Registration-only and
 * observationally pure: it never drives/mutates the values or controls it
 * receives, only stores references for later reads.
 */
export interface DebugMotionRecorder extends MotionSeamRegistration {
  values: Map<string, MotionValue<number>>;
  controls: Map<string, AnimationPlaybackControls | undefined>;
  targets: Map<string, number>;
}

export function createDebugMotionRecorder(): DebugMotionRecorder {
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
