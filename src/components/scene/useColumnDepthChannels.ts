import { useLayoutEffect, useRef, type RefObject } from "react";
import { useMotionValue, type MotionValue, type Transition } from "motion/react";
import { computeDepthTreatment } from "./depth";
import type { MotionSeamRegistration } from "./motionSeam";
import { useMotionSeamRegistration } from "./useMotionSeamRegistration";
import { useOwnedAnimation } from "./ownedAnimation";
import { useDepthFilterChannel } from "./useDepthFilterChannel";

/**
 * Everything the column-level depth deck RENDERS on the column node: the
 * opacity it fades to, the greyscale filter it desaturates with, and the
 * translateZ that foreshortens it. Extracted from SceneColumn as one coherent
 * block (ui/t:18) — the derivation and its two owned channels always move
 * together, and the file is over its size threshold.
 *
 * `columnDepth` must be computed from an ALREADY-DECIDED `isInBetween`, which
 * is why that comes in as a parameter rather than being derived here: its own
 * declaration site in SceneColumn carries the variable-ordering constraint.
 *
 * Returns the three rendered values plus the `z` MotionValue, which the caller
 * binds itself (`z: duration === 0 ? depthZ : zMV`) for the same instant-mode
 * reason every other channel is bound at its own call site.
 */
export function useColumnDepthChannels({
  isInBetween,
  stackDepth,
  duration,
  transition,
  columnTransition,
  motionSeam,
  name,
  firstPaintRef,
  columnGeometryWasSettled,
}: {
  isInBetween: boolean;
  stackDepth: number;
  duration: number | undefined;
  /** The column's own spring, for the z channel's imperative animate(). */
  transition: Transition;
  /** The first-paint-collapsed variant, for the filter channel. */
  columnTransition: Transition;
  motionSeam: MotionSeamRegistration | null;
  name: string;
  firstPaintRef: RefObject<boolean>;
  columnGeometryWasSettled: boolean;
}): {
  depthOpacity: number;
  depthZ: number;
  depthFilter: string | MotionValue<string>;
  zMV: MotionValue<number>;
} {
  // translateZ pushes in-between columns back in 3D space. The stage's
  // perspective (800px) projects them smaller: depth-1 → 800/900 ≈ 0.89×,
  // depth-2 → 800/1000 = 0.80×, depth-3 → 800/1100 ≈ 0.73×.
  // Focused columns explicitly sit at translateZ(0) to participate in the 3D
  // stacking context and always render in front of in-between columns.
  // columnDepth must be declared AFTER isInBetween (variable ordering).
  const columnDepth = isInBetween ? computeDepthTreatment(stackDepth) : { opacity: 1, grayscale: 0, translateZ: 0 };
  // Only in-between columns get depth-scaled opacity. Outer columns are fully
  // opaque — the viewport clips their visibility, not opacity:0.
  const depthOpacity = columnDepth.opacity;
  // Greyscale increases with depth: depth-1 → 25%, depth-2 → 50%, etc.
  // Reinforces the sense of receding into the background.
  const depthGreyscale = columnDepth.grayscale;
  const depthZ = columnDepth.translateZ;
  // Owned greyscale channel — released to no filter at all once settled at
  // identity, so a focused column never roots the backdrop of a glass
  // surface a consumer renders inside it (ui/t:18). See
  // useDepthFilterChannel's own doc comment for the backdrop-root mechanism
  // and for the three cheaper shapes that were measured and rejected.
  const depthFilter = useDepthFilterChannel({
    grayscale: depthGreyscale,
    duration,
    transition: columnTransition,
    motionSeam,
    seamKey: `columnDepthFilter:${name}`,
  });
  // Column-level paint order is DOM-order-driven in practice, and that's
  // design-correct: computeStackDepths (Scene.tsx) assigns depth by
  // walking backward from the rightmost focused column, so depth is
  // structurally guaranteed to equal reverse DOM order for every
  // reachable production state (see that function's own comment — the
  // invariant is load-bearing). translateZ here is paint-INERT, not
  // paint-driving — a multi-round discriminator investigation (ui/o:32,
  // the D-series record) forced a genuinely-transformed sibling into an
  // intact preserve-3d chain and it still lost to DOM order; z-index was
  // also tried directly (forced positive, confirmed applied via computed
  // style) and was EQUALLY inert, consistent with the well-documented CSS
  // behavior that z-index has no effect on children of a
  // transform-style:preserve-3d element — actual 3D depth governs there,
  // and that 3D depth-sort is itself the thing the D-series found broken
  // (isolated per-anchor subtrees don't compare against each other).
  // translateZ is retained purely for the perspective-projection
  // foreshortening visual cue (depth-1 → 0.89×, etc.), not for paint
  // order. If a future feature ever breaks the depth ≡ reverse-DOM-order
  // invariant (e.g. reordering columns independent of focus/depth),
  // column-level paint order needs an explicit mechanism — object level
  // (SceneObject.tsx) already has this via its own z-index channel,
  // built for exactly this reason (an object's own inner node sits outside any
  // column's preserve-3d chain, so DOM order there does NOT structurally
  // guarantee correctness the way it does at column level).

  // z-clearance coupling (Michael's ruled invariant, Scene F2 spike 2):
  // objects overlapping in 2D screen space must never change relative paint
  // order — a z-crossing (moving from "behind" toward "in front") is only
  // legal once the pair is disjoint. The invariant is enforced structurally
  // by DOM order today (see computeStackDepths), not by any gating here —
  // an RAF-poll-based front-ward-retarget gate was tried and reverted:
  // unsafe under concurrent test-suite load (see commit history for the
  // full investigation). zMV below is kept only for its debug-observability
  // value (pinnable/observable motion-seam treatment, same as
  // topOffset/scrollY/cameraX).
  const zMV = useMotionValue(depthZ);
  useMotionSeamRegistration(motionSeam, `z:${name}`, zMV);
  const zTargetRef = useRef(depthZ);
  const zOwnedAnimation = useOwnedAnimation(duration);

  useLayoutEffect(() => {
    if (depthZ === zTargetRef.current && !zOwnedAnimation.durationJustBecameZero) return;
    zTargetRef.current = depthZ;

    // ui/t:33: duration===0 now shares the jump() branch below instead of a
    // raw .set() — see topOffsetMV's identical fix above for the rationale
    // (.set() never calls .stop(), so a live flip mid-spring never stopped
    // the in-flight animation or retired the settle counter).
    if (duration === 0 || firstPaintRef.current || !columnGeometryWasSettled) {
      zOwnedAnimation.jump(zMV, depthZ);
    } else {
      const controls = zOwnedAnimation.animateTo(zMV, depthZ, transition);
      motionSeam?.registerControls(`z:${name}`, controls);
      motionSeam?.registerTarget?.(`z:${name}`, depthZ);
    }
  });
  return { depthOpacity, depthZ, depthFilter, zMV };
}
