import { createContext, useContext } from "react";

/**
 * Tracks whether Scene is currently in its first paint.
 *
 * The context holds a mutable ref rather than state so reads are synchronous
 * during render — a column can check `ref.current` before motion has a chance
 * to commit any `initial` values. The ref is set to `false` in a Scene-level
 * useEffect(), which fires after the first paint but before any subsequent
 * re-renders.
 *
 * Default value is `{ current: false }` ("not in first paint") so components
 * rendered outside a Scene provider in isolated tests behave normally — the
 * first-paint guard is simply a no-op when there is no provider.
 *
 * Reusable for any future logic that should only fire during Scene's first
 * mount (e.g. entrance animations, deferred measurements).
 */
export const SceneFirstPaintContext = createContext<React.MutableRefObject<boolean>>(
  { current: false },
);

/**
 * Returns `true` during Scene's first paint, `false` afterward.
 *
 * Use this to suppress animations that should not run on initial mount
 * (e.g. the Phase 7c slide-in-from-right for a column that mounts
 * mid-session should only fire for late-mounting columns, not every
 * column on the very first render).
 */
export function useIsSceneFirstPaint(): boolean {
  return useContext(SceneFirstPaintContext).current;
}
