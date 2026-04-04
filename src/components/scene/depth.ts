/**
 * Shared depth treatment formulas for Scene's 3D stacking system.
 *
 * Invariant: These values are meant to be passed into `animate={{}}` on motion
 * components, never into inline `style`. Inline style wins at React commit time
 * and silently shadows animation springs.
 */

export interface DepthTreatment {
  opacity: number;
  grayscale: number;
  translateZ: number;
}

/**
 * Computes the visual treatment for a given depth level in the Scene depth deck.
 * Used by both SceneColumn (column-level depth) and SceneObject (within-column depth).
 *
 * depth=1 → opacity 0.8, grayscale 0.25, translateZ -100px
 * depth=2 → opacity 0.6, grayscale 0.50, translateZ -200px
 */
export function computeDepthTreatment(depth: number): DepthTreatment {
  return {
    opacity: Math.max(0, 1 - depth * 0.2),
    grayscale: depth * 0.25,
    translateZ: -depth * 100,
  };
}

/**
 * Formats a grayscale value as a CSS filter string.
 * Always returns a valid filter string (never `undefined`), so motion can
 * interpolate between two filter strings rather than between a string and
 * `undefined` — which would produce an instant snap instead of a spring.
 */
export function formatGrayscale(n: number): string {
  return `grayscale(${n})`;
}
