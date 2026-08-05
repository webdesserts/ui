import { waitForAnimationFrame } from "./animation";

// ---------------------------------------------------------------------------
// Shared paint/layout-space geometry sampling for the glass-stack deck
// sensor family — the o31-o38 sensor-doctrine lineage extended from
// column-level measurement (ui#17, scene-glass-stack-deck.test.tsx) to
// object-level measurement (ui#21, scene-within-column-deck.test.tsx). One
// shared module is the evidence the two families are the same sensor
// applied at two structural depths, not two independent implementations
// that happen to agree.
// ---------------------------------------------------------------------------

/**
 * Polls via requestAnimationFrame until `hasChanged()` first returns
 * true (default predicate: `el.style.position` differs from its value
 * at call time). The panel's flip — and any Scene-derived state a
 * bystander column's own geometry depends on (position, stackDepth) —
 * reaches SceneColumn through context values that are NOT synchronous
 * with the raw `focused` prop change that triggers them: a registry-
 * correction render lands on a LATER commit, so sampling gBCR
 * synchronously around a click with no `await` never actually observes
 * the flip, making a same-tick before/after comparison vacuous
 * regardless of what it asserts (probe-confirmed directly: `data-
 * column-position` read back unchanged immediately after a click, for
 * both the directly-toggled column and a bystander sibling). Returns
 * the geometry from the frame immediately before the change and the
 * frame it was first observed in, the same "last pre-flip frame vs
 * first post-flip frame" methodology the spike's own trace-refocus.log
 * used.
 *
 * Layout-box geometry (ui#17 target-derived-aiming round, Part B's
 * structurally final form, superseding an earlier gBCR-rebased-against-
 * anchor draft of this same helper): `offsetLeft`/`offsetTop` (relative
 * to `offsetParent`, which is verified elsewhere to be the panel's own
 * anchor on BOTH sides of the flip — position:relative and
 * position:absolute both resolve to it) plus `offsetWidth`/
 * `offsetHeight`. Transform-free BY CONSTRUCTION: stage/camera
 * translation, the depth-deck's `translateZ` perspective projection, and
 * `columnAnimateX`'s own tuck offset are all CSS transforms, invisible to
 * offset* — while every REAL defect class this suite exists to catch
 * stays visible, because each one is a layout-box change: the 175px
 * refocus bug drove `width` (a layout property, ΔoffsetWidth sees it
 * directly); a `static`-vs-`absolute` position break moves the box
 * itself; a margin bug moves it too. The flip's zero-pixel promise IS a
 * layout-box promise — an EARLIER round of this suite measured it
 * through the perspective projection (gBCR, even after rebasing against
 * the anchor to cancel translation) and that measurement is what caught
 * one real frame of lawful, continuous mid-spring Z motion as a false
 * positive (innocence-checked directly: the flip-frame delta was
 * comparable to — often smaller than — its own frame-neighbor deltas,
 * and the Z MotionValue's own sequence was smoothly monotonic with no
 * jump coinciding with the position-mode flip).
 *
 * `anchorEl`, when provided, is an assertion-only sanity guard (not used
 * for any measurement): throws immediately if `el.offsetParent` isn't
 * `anchorEl` at either sample, so a future architecture change that
 * breaks the offsetParent-is-the-anchor assumption fails loudly here
 * instead of silently changing what these tests measure.
 */
export async function captureFlipCommit(
  el: HTMLElement,
  timeoutMs = 2000,
  hasChanged?: () => boolean,
  anchorEl?: HTMLElement,
): Promise<{ before: DOMRect; after: DOMRect; framesWaited: number }> {
  const initialPosition = el.style.position;
  const changed = hasChanged ?? (() => el.style.position !== initialPosition);
  const captureBox = (): DOMRect => {
    if (anchorEl && el.offsetParent !== anchorEl) {
      throw new Error(
        `captureFlipCommit: expected el.offsetParent to be anchorEl but it was ${el.offsetParent ? `<${el.offsetParent.tagName}>` : "null"} — the offsetParent-is-the-anchor assumption this helper's layout-box measurement depends on no longer holds`,
      );
    }
    return new DOMRect(el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight);
  };
  let before = captureBox();
  const start = performance.now();
  let frames = 0;
  while (performance.now() - start < timeoutMs) {
    await waitForAnimationFrame();
    frames++;
    if (changed()) {
      return { before, after: captureBox(), framesWaited: frames };
    }
    before = captureBox();
  }
  throw new Error(`change predicate never became true within ${timeoutMs}ms (initial panel position: "${initialPosition}")`);
}

export interface GBCRBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Ports the spike's outlier detector: flags a frame ONLY if its delta is
 * BOTH >20px absolute AND >5x each of its two immediate neighbors — a flat
 * threshold alone false-positives on normal, fast spring motion (a
 * legitimately large but neighbor-proportional delta isn't a
 * discontinuity, just a fast-moving frame — springs preserve position and
 * velocity continuity even across a retarget, so a healthy interrupt
 * commit produces no outlier here despite a real, large retarget).
 */
export function findGbcrOutliers(deltas: number[]): number[] {
  const outliers: number[] = [];
  for (let i = 1; i < deltas.length - 1; i++) {
    const d = deltas[i]!;
    const prev = deltas[i - 1]!;
    const next = deltas[i + 1]!;
    if (d > 20 && d > 5 * prev && d > 5 * next) {
      outliers.push(i);
    }
  }
  return outliers;
}

export function gbcrDeltasOf(samples: GBCRBox[]): number[] {
  const deltas: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    deltas.push(
      Math.max(
        Math.abs(b.left - a.left),
        Math.abs(b.top - a.top),
        Math.abs(b.width - a.width),
        Math.abs(b.height - a.height),
      ),
    );
  }
  return deltas;
}
