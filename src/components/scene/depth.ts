/**
 * Shared depth treatment formulas for Scene's 3D stacking system.
 *
 * Invariant: a depth value is never handed to a motion component as a plain
 * number in inline `style` — a static inline value wins at React commit time
 * and silently shadows the spring. `opacity` and `translateZ` therefore go
 * through `animate={{}}`; `grayscale` goes through its own owned MotionValue
 * (useDepthFilterChannel), which is a live style binding rather than a static
 * one and so doesn't shadow anything. Grayscale needs the owned channel
 * because it is the only one of the three that must be RELEASED entirely at
 * rest: any `filter`, identity included, makes its element a backdrop root
 * and truncates the backdrop of every glass surface below it.
 */

export interface DepthTreatment {
  opacity: number;
  grayscale: number;
  translateZ: number;
}

/**
 * Computes the visual treatment for a given depth level in the Scene depth
 * deck. Used by both SceneColumn (column-level depth) and SceneObject
 * (within-column depth) — but NOT for the same fields: SceneColumn reads
 * `opacity`/`grayscale`/`translateZ` (translateZ is still genuinely
 * paint-relevant there, the perspective-projection foreshortening cue —
 * SceneColumn.tsx's own comment near columnDepth/depthZ). SceneObject
 * reads only `opacity`/`grayscale` (both still animate-driven, this file's
 * own invariant below) — its `translateZ` is computed here but never
 * consumed; object-level paint order is a SEPARATE, discrete zIndex write
 * (`-depth`, not derived from this function at all — ui/t:21's z-index
 * paint-order channel amendment, object-level translateZ never actually
 * reached the object, ui/o:32).
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
 *
 * Always returns a valid filter string — never `undefined`, and never the
 * `none` keyword either. Motion cannot spring between a filter string and
 * `undefined` (it snaps), and it cannot resume a spring out of a written
 * `none` either: with no numeric state to start from it emits a decaying
 * blip and then jumps. Releasing the filter at rest is therefore NOT this
 * function's job — it belongs to the owned channel that decides when to stop
 * calling it at all (useDepthFilterChannel, which writes the literal "none"
 * itself once settled at identity).
 */
export function formatGrayscale(n: number): string {
  return `grayscale(${n})`;
}
