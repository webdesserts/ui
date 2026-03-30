import { createContext, useContext } from "react";

/**
 * Callbacks for SceneColumn to notify the debug outline system when a Motion
 * animation starts or completes. The rAF loop in SceneObjectOutlines runs
 * while the counter is > 0 so outlines track object positions during animation.
 *
 * Only active when `debug` is enabled — the context value is null in
 * production, and SceneColumn checks before calling.
 */
export interface AnimationCallbacks {
  onStart: () => void;
  onEnd: () => void;
}

export const AnimationCallbackContext = createContext<AnimationCallbacks | null>(null);

/** Returns the animation callbacks, or null when debug is disabled. */
export function useAnimationCallbacks(): AnimationCallbacks | null {
  return useContext(AnimationCallbackContext);
}
