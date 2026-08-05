/**
 * Extracts the raw (pre-perspective-projection) translateX value written to
 * an element's inline `transform` style. Motion writes this as either
 * `translate3d(x, y, z)` or, when y is 0, separate `translateX(x)
 * translateZ(z)` functions — this matches either shape. Depth-deck geometry
 * assertions read this raw value rather than getBoundingClientRect() because
 * CSS perspective projection scales rendered pixel positions non-linearly by
 * depth (deeper cards are foreshortened more), while the x offset actually
 * written to the transform (what SceneColumn's animateX computes) is exact.
 */
export function parseTranslateX(transform: string): number {
  const match = transform.match(/translateX?\(([-\d.]+)px(?:,|\))/) ?? transform.match(/translate3d\(([-\d.]+)px/);
  if (!match) throw new Error(`Could not parse translateX from transform: "${transform}"`);
  return parseFloat(match[1]!);
}

/** Same rationale as parseTranslateX (see its docstring) — the raw
 *  translateY written to the transform (undistorted by perspective
 *  foreshortening), not a rendered getBoundingClientRect() position. */
export function parseTranslateY(transform: string): number {
  const match =
    transform.match(/translate3d\([-\d.]+px,\s*([-\d.]+)px/) ??
    transform.match(/translateY\(([-\d.]+)px\)/);
  if (!match) throw new Error(`Could not parse translateY from transform: "${transform}"`);
  return parseFloat(match[1]!);
}
