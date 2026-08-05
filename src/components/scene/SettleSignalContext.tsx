import { createContext } from "react";

/**
 * A column's owned geometry channels (width, margin, panel width — any
 * MotionValue-driven channel whose settled state the camera's own
 * recentering measurement depends on) report their own active/idle state
 * through this pair, so Scene can re-measure exactly once per activity
 * burst — when the WHOLE scene quiets, not each time one individual
 * channel happens to finish.
 *
 * `animationStarted` fires when a channel begins driving toward a new
 * target (the animate() branch only — a synchronous jump has no genuine
 * "start" distinct from its own completion). `animationEnded` fires at
 * every path that retires that channel's own contribution: the natural
 * animate().onComplete, the jump() branch (whether or not that specific
 * jump followed a start — SceneColumn's own per-channel guard is what
 * keeps this pair balanced, not this context), and any future cancel
 * path a channel adds. Scene aggregates these into a single active-count;
 * only the transition INTO zero triggers the actual re-render/re-measure.
 *
 * Why the aggregate, not the original per-settle-event fire-and-forget
 * version this replaced: Motion's `MotionValue.start()` calls `stop()` on
 * any animation it supersedes, which fires that PRIOR animation's
 * `animationCancel`, never its `onComplete` — confirmed at source
 * (motion-dom's value/index.mjs). A column mid-transition can retarget a
 * channel several times before anything naturally completes (measured
 * directly, ui#17 Slice 1 close-out: a single unfocus-then-refocus
 * produced a byte-reproducible 324→424→409→324 cameraX retarget
 * sequence, a full 100px swing, purely from firing on every individual
 * channel's own settle event while OTHER channels were still mid-flight).
 * Each of those intermediate fires re-measured geometry that hadn't
 * actually reached its final state yet — "settled" per-channel is not
 * "worth re-measuring against." Firing only at the count's zero-crossing
 * is what makes the fire mean "the scene is actually quiet now."
 *
 * Minimal precursor for ui#20's own settle-registry design (Michael ruled
 * ui#17 lands first so ui#20 can hook the final animation topology) —
 * this begin/end counter IS the registry-lite shape, one step closer to
 * ui#20's own begin/end-counter design than the single-signal version it
 * replaced. ui#20 KEEPS this scalar counter rather than replacing it with
 * a per-channel-keyed registry: `useOwnedAnimation()`'s claim/retire guard
 * (ownedAnimation.ts) already proved interruption-correct per channel, so
 * the aggregate zero-crossing this pair produces is exactly what ui#20's
 * `data-ui-scene-settled`/`onTransitionEnd`/inertness-gating layer (Scene.tsx,
 * SceneObject.tsx) needs — see Scene.tsx's own `transitionPending` doc
 * comment for how that layer is built on top of this signal.
 */
export type SettleSignal = {
  animationStarted: () => void;
  animationEnded: () => void;
};

/**
 * Provided by Scene to every descendant SceneColumn. `null` outside a Scene
 * (SceneColumn used standalone) — settle signaling is a no-op in that case,
 * matching every other Scene-provided context's null-outside-Scene contract.
 */
export const SettleSignalContext = createContext<SettleSignal | null>(null);
