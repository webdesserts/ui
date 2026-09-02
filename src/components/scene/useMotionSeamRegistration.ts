import { useEffect } from "react";
import type { MotionValue } from "motion/react";
import type { MotionSeamRegistration } from "./motionSeam";

/**
 * F4 active-springs debug panel: registers a single owned MotionValue itself
 * (not just its AnimationPlaybackControls, registered separately by each
 * channel's own animate-driving effect) so the panel can read its live
 * value/velocity, and unregisters it on unmount or when `key`/`value` change
 * identity. A no-op in production — `motionSeam` is null unless a test
 * harness wraps `MotionSeamContext.Provider` (see motionSeam.ts).
 *
 * Shared by every owned motion-seam channel across the Scene family
 * (SceneColumn's topOffset/width/margin/columnWidth/z, SceneObject's
 * height/marginBottom, Scene's cameraX, useColumnScroll's scrollY) — each
 * channel's own jump/animateTo/settle-gating logic is unrelated and lives in
 * its own effects beside this one. `key` is passed whole (e.g.
 * `` `topOffset:${name}` `` for a named instance, or the bare `"cameraX"` for
 * Scene, which has no `name` of its own) rather than assembled inside this
 * hook, so callers control their own key shape.
 */
export function useMotionSeamRegistration(
  motionSeam: MotionSeamRegistration | null,
  key: string,
  value: MotionValue<number>,
): void {
  useEffect(() => {
    motionSeam?.registerMotionValue(key, value);
    return () => motionSeam?.unregisterMotionValue?.(key);
  }, [motionSeam, key, value]);
}
