import { useLayoutEffect, useRef, useState } from "react";
import { useMotionValue, useTransform, type MotionValue, type Transition } from "motion/react";
import { formatGrayscale } from "./depth";
import type { MotionSeamRegistration } from "./motionSeam";
import { useMotionSeamRegistration } from "./useMotionSeamRegistration";
import { useOwnedAnimation } from "./ownedAnimation";

/**
 * The depth deck's greyscale channel, as an owned MotionValue whose rendered
 * CSS is RELEASED at rest — pixels (a real `filter` string) only while the
 * treatment is live, no `filter` property at all once it settles back at
 * identity. Shared by SceneColumn (column-level depth) and SceneObject
 * (within-column depth); both used to emit `filter: grayscale(0)` through
 * `animate` unconditionally, on every node, in every state.
 *
 * WHY the release matters, and why it can't be cosmetic: an element with ANY
 * `filter` — including a visually inert `grayscale(0)` — is a BACKDROP ROOT
 * per the Filter Effects spec, and a descendant's `backdrop-filter` can only
 * sample back as far as its nearest backdrop root. Scene's own column and
 * object nodes therefore truncated the backdrop of every glass surface a
 * consumer placed inside a Scene: the blur rendered, but it had nothing but
 * its own column behind it to sample. Measured on an isolated fixture
 * (blur-on vs blur-off luminance stdDev over the same region): an ancestor
 * carrying `filter: grayscale(0)` reads a 0.965 ratio (blur samples nothing)
 * where `filter: none` or no filter at all reads 0.029. The full table,
 * including the properties that turned out HARMLESS (`isolation: isolate`,
 * `contain: paint`, 3D transforms), is in tests/scene-backdrop-root.test.tsx.
 *
 * WHY an owned MotionValue rather than the `animate` prop it replaces —
 * three cheaper shapes were measured and each failed:
 *
 *  - `animate={{ filter: "none" }}` at identity. Motion resolves `none`
 *    against the other keyframe and lands on `grayscale(0)` anyway, so the
 *    computed style at rest is unchanged and the bug survives verbatim.
 *  - Keeping `animate` and adding a settle-gated `style={{ filter: "none" }}`.
 *    Motion's own animated value wins over the `style` prop on a motion
 *    component, so the release simply never takes.
 *  - Keeping `animate`, dropping the key at rest AND writing the explicit
 *    clear through `style`. The release works, but the NEXT transition then
 *    starts from a literal `none` that Motion has no numeric state for: the
 *    spring degenerates into a decaying blip near zero followed by a jump to
 *    the target. That is exactly the snap THE SMOOTH RULING forbids.
 *
 * An owned MotionValue keeps the true numeric greyscale across the release,
 * so re-entering a transition resumes from the real value rather than from a
 * keyword Motion has to re-parse. It is also this family's established shape
 * for "pixels mid-spring, live CSS at rest" — SceneColumn's own width channel
 * releases to `"auto"` the same way, and for the same documented reason:
 * Motion never clears a value it has written, so a release has to be an
 * EXPLICIT write ("none" here, "auto" there), never an omitted key.
 *
 * Returns the value to hand straight to `style.filter`.
 */
export function useDepthFilterChannel(options: {
  /** Target greyscale amount, 0 at identity. */
  grayscale: number;
  /** SceneConfig duration — 0 selects the instant, non-springing path. */
  duration: number | undefined;
  /** The transition this channel springs with (the caller's own). */
  transition: Transition;
  /** Motion-seam registration, or null outside a test harness. */
  motionSeam: MotionSeamRegistration | null;
  /**
   * Whole seam key, caller-assembled. SceneColumn and SceneObject share this
   * channel but must use distinct prefixes (`columnDepthFilter:${name}` /
   * `objectDepthFilter:${name}`) — the seam registry is a flat map, and a
   * column and an object with the same `name` would otherwise collide onto
   * one entry (ui/t:18 claim gate, probe 9).
   */
  seamKey: string;
}): string | MotionValue<string> {
  const { grayscale, duration, transition, motionSeam, seamKey } = options;

  const grayscaleMV = useMotionValue(grayscale);
  useMotionSeamRegistration(motionSeam, seamKey, grayscaleMV);
  const filterMV = useTransform(grayscaleMV, formatGrayscale);

  const targetRef = useRef(grayscale);
  const ownedAnimation = useOwnedAnimation(duration);

  // Released === "this channel has settled at identity, so no filter property
  // is written at all". Starts released for a node that mounts at identity
  // (the common case: every focused column and object), which is what makes
  // a Scene's glass surfaces work on first paint without waiting for a
  // transition to complete first.
  const [released, setReleased] = useState(grayscale === 0);

  // The flag is raised and lowered FROM THE EFFECT, not by React's usual
  // "adjust state while rendering" pattern, and the two eslint suppressions
  // below are the price of that. The render-phase shape was written, measured
  // and reverted: adjusting this state during render re-runs the component's
  // render pass, and `useOwnedAnimation` derives `durationJustBecameZero`
  // from a ref it mutates DURING render — so the second pass sees the flip
  // already consumed and reports false. Every owned channel in the component
  // then early-returns out of its own retarget guard, the in-flight animation
  // is never stopped, and the settle counter never retires: a live
  // reduced-motion (duration -> 0) flip mid-transition hangs the scene
  // outright. Reproduced exactly, on the two tests that guard that flip —
  // scene-settle-signal's "mixed-duration double interruption" and
  // scene-physics-accessibility's "reactive consumer" — both red under the
  // render-phase shape and green under this one.
  //
  // The effect has no dependency array on purpose, matching every other owned
  // channel in this family; its own target-changed check is the guard.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Deliberate every-render effect (no dependency array by design), matching every other owned channel in this family — its own target-changed check (targetRef comparison) is the guard, not the dependency array.
  useLayoutEffect(() => {
    if (grayscale === targetRef.current && !ownedAnimation.durationJustBecameZero) return;
    targetRef.current = grayscale;

    // ui#33's duration-flip contract: jump() (not .set()) so a live
    // duration→0 flip mid-spring stops the in-flight animation and retires
    // the settle counter, rather than freezing the channel.
    if (duration === 0) {
      ownedAnimation.jump(grayscaleMV, grayscale);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see the block comment above this effect
      setReleased(grayscale === 0);
      return;
    }

    // Dropped before the browser paints (layout effect), so the released
    // `"none"` is never the rendered value for a frame of a live spring —
    // it would shadow the whole transition if it were. Guarded on the
    // current value rather than set unconditionally: React re-renders once
    // before bailing out on an unchanged state value, and a channel
    // retargeting while already unreleased (a decked column moving deeper)
    // has no reason to spend that render — this runs on every column and
    // every object of a scene, on every focus change.
    if (released) setReleased(false);
    const controls = ownedAnimation.animateTo(grayscaleMV, grayscale, transition, () => {
      // `grayscale` is the target of the animation that actually completed:
      // Motion never completes an animation superseded by a later animate()
      // on the same value (see ownedAnimation's own doc comment), so this
      // closure can only ever be the latest one.
      setReleased(grayscale === 0);
    });
    motionSeam?.registerControls(seamKey, controls);
    motionSeam?.registerTarget?.(seamKey, grayscale);
  });

  if (released) return "none";
  // Instant mode writes the plain string synchronously for the same reason
  // every other channel does (SceneColumn's `z`/`width`): relying on
  // Motion's rAF-batched MotionValue binding for a same-frame instant write
  // would depend on undocumented frame-ordering internals.
  return duration === 0 ? formatGrayscale(grayscale) : filterMV;
}
