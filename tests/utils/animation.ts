/**
 * Utilities for testing CSS transitions and animations at intermediate keyframes.
 *
 * Uses the Web Animations API (document.getAnimations()) to pause CSS transitions
 * at specific progress points. Since vitest browser mode runs tests directly in the
 * browser, we have direct DOM access — no page.evaluate() needed.
 *
 * IMPORTANT: When screenshotting a frozen animation, pass:
 *   screenshotOptions: { animations: "allow" }
 * Otherwise Playwright's default behavior fast-forwards finite animations to
 * completion, destroying the paused state.
 *
 * ## Capturing mid-transition frames
 *
 * CSS transitions only appear in `getAnimations()` while they are actively
 * running. A 200ms transition completes before JS gets another turn, so by the
 * time `freezeAnimationsAt` runs there is nothing to freeze.
 *
 * `slowTransitions` solves this by injecting a `<style>` tag that overrides
 * every transition-duration to 10 seconds. Trigger hover inside the callback,
 * then freeze — the transition is still running and `getAnimations()` returns it.
 * Call the returned `restore()` function after freezing to remove the override.
 */

import type { AnimationPlaybackControls, MotionValue } from "motion/react";
import type { MotionSeamRegistration } from "@/src/components/scene/motionSeam";

/**
 * Wait for CSS transitions to start on an element after a state change.
 * Transitions don't exist on the element until the next frame.
 */
export function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Inject a global style override that stretches all CSS transition durations
 * to 10 seconds, giving `freezeAnimationsAt` time to capture them mid-flight.
 *
 * @returns A `restore()` function that removes the override.
 *
 * BLIND SPOT: this override's selector (`*, *::before, *::after`) does not
 * reach `::placeholder`, and separately, `element.getAnimations({subtree:
 * true})` never surfaces a `::placeholder` transition as an Animation object
 * even while it's genuinely running (probe-confirmed on TextInput.tsx's own
 * placeholder-opacity fix: `getComputedStyle(input, "::placeholder")`
 * correctly reports the declared transition-property/duration, but zero
 * Animation objects appear for it under `wrapper.getAnimations({subtree:
 * true})` during an active hover/focus transition — only the wrapper's own
 * `::after` fill and the input's own `color` transition show up). So neither
 * this function's slowdown NOR `freezeAnimationsAt`'s freeze/pin can reach a
 * `::placeholder` transition at all. `transitionend` doesn't help either:
 * probe-confirmed (2026-07-22, capture-phase document listener during a full
 * hover cycle) that no transitionend event with `pseudoElement:
 * "::placeholder"` ever fires in this Chromium — the same cycle emits the
 * input's own `color` event and the wrapper's three `::after` events — so an
 * event-driven settle is not an option. The working pattern for a
 * deterministic post-settle capture of one: a real wait (`wait()`)
 * comfortably past the transition's own duration, before
 * freezing/screenshotting — see text-input.test.tsx's `captureFocused` and
 * its hover-dark test.
 *
 * @example
 * const restore = slowTransitions();
 * await btn.hover();
 * await waitForAnimationFrame();
 * const anims = freezeAnimationsAt(el, 0.5, { subtree: true });
 * restore();
 * // screenshot ...
 * unfreezeAnimations(anims);
 */
export function slowTransitions(): () => void {
  const style = document.createElement("style");
  // Override both transition-duration and animation-duration so that any CSS
  // transition (including those on ::after pseudo-elements) is slowed down
  // enough for getAnimations() to observe it as in-progress.
  style.textContent = `*, *::before, *::after { transition-duration: 10000ms !important; animation-duration: 10000ms !important; }`;
  document.head.appendChild(style);
  return () => style.remove();
}

/**
 * Pause all animations on an element (and optionally its subtree) at a
 * specific progress point (0 = start, 1 = end).
 *
 * Returns the paused animations so they can be cleaned up with `unfreezeAnimations`.
 */
export function freezeAnimationsAt(
  element: HTMLElement,
  progress: number,
  options: { subtree?: boolean } = {},
): Animation[] {
  const animations = options.subtree
    ? element.getAnimations({ subtree: true })
    : element.getAnimations();

  for (const anim of animations) {
    anim.pause();
    const timing = anim.effect?.getComputedTiming();
    if (!timing) continue;
    const delay = (timing.delay ?? 0) as number;
    const duration = (timing.activeDuration ?? 0) as number;
    anim.currentTime = delay + duration * Math.max(0, Math.min(1, progress));
  }

  return animations;
}

/**
 * Resume or cancel previously frozen animations.
 */
export function unfreezeAnimations(
  animations: Animation[],
  mode: "resume" | "cancel" = "cancel",
): void {
  for (const anim of animations) {
    if (mode === "resume") {
      anim.play();
    } else {
      anim.cancel();
    }
  }
}

/**
 * Wait for a given number of milliseconds.
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Monkey-patches `Element.prototype.animate` so any native WAAPI `Animation`
 * created while installed is paused and jumped to `fraction` (0-1) of its
 * own duration as soon as it's created — via a microtask queued the instant
 * `element.animate()` is called (see the inline comment on the `pin` closure
 * below for why a microtask, not an inline synchronous pause, is required).
 *
 * Why this exists: `freezeAnimationsAt` requires the animation to already
 * be visible in `getAnimations()`, which for motion/react's declarative
 * `animate` prop (SceneObject's opacity/filter/translateZ depth treatment)
 * is NOT synchronous with React's commit. Probe-confirmed at source
 * (instrumented this exact patch point and timestamped it against
 * `rerender()`): motion/react defers the real `element.animate()` call to
 * its OWN internal requestAnimationFrame-scheduled frame loop, decoupled
 * from React's layout effects — `container.getAnimations()` reports 0
 * animations immediately after `await rerender()` resolves, and only
 * becomes non-empty after motion's own scheduler runs (one real animation
 * frame later, under light load). A single `await waitForAnimationFrame()`
 * then `freezeAnimationsAt` (this file's previous pattern for
 * unfocus-sync-mid-spring and refocus-from-depth-deck-mid-spring) has to
 * guess correctly how many frames motion needs, and is wrong under load:
 * `requestAnimationFrame` callbacks are throttled to the browser's
 * paint/vsync cycle, which is exactly what concurrent GPU/compositor
 * contention from other browser instances can delay — if motion's real
 * call lands on a later frame than the guess, `getAnimations()` is still
 * empty when freeze runs (nothing to freeze — the transition silently
 * captures as fully-settled). This is the same class of race
 * `pinAllRegisteredAnimations` (called after a wait) is exposed to on the
 * rAF/MotionValue seam side — see `createMotionSeamRecorder`'s
 * `pinFraction` param, the equivalent fix for that side.
 *
 * This helper needs no such guess: Motion calls the real, unpatched
 * `Element.prototype.animate` to create the animation regardless of which
 * frame it lands on, so intercepting that exact call point means every
 * animation is captured and pinned before it has ticked even once,
 * independent of scheduling delay. The caller still has to wait for motion
 * to actually get around to calling it (this doesn't eliminate that wait)
 * — but unlike the previous pattern, waiting LONGER than strictly necessary
 * is now harmless: once captured, an animation is paused for good and
 * can't progress further no matter how many additional frames the caller
 * waits afterward. Pair with `waitForAnimationsToSettle` to wait exactly as
 * long as needed (and no more) rather than guessing a fixed frame count.
 *
 * Returns the paused Animations (same shape `freezeAnimationsAt` returns)
 * so `unfreezeAnimations()` works unchanged, plus `restore()` to remove the
 * patch. `restore()` MUST be called — this mutates a prototype shared by
 * every element on the page, including subsequent tests in the same file.
 */
export function pinWaapiAnimationsOnCreate(fraction: number): {
  animations: Animation[];
  restore: () => void;
} {
  const animations: Animation[] = [];
  const pinOne = (anim: Animation) => {
    anim.pause();
    const timing = anim.effect?.getComputedTiming();
    const delay = (timing?.delay ?? 0) as number;
    const duration = (timing?.activeDuration ?? 0) as number;
    anim.currentTime = delay + duration * Math.max(0, Math.min(1, fraction));
  };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (
    this: Element,
    keyframes: Parameters<typeof original>[0],
    options: Parameters<typeof original>[1],
  ): Animation {
    const anim = original.call(this, keyframes, options);
    animations.push(anim);
    // Deferred to a microtask, not pinned synchronously inline: probe-
    // confirmed at source (instrumented this exact call and read the
    // resulting playState back) that motion/react does its OWN
    // post-creation setup on the returned Animation SYNCHRONOUSLY, in the
    // same call stack that invoked element.animate() — including
    // (re-)starting playback, which silently overwrote a synchronous
    // pause()+currentTime set made here before returning. A microtask runs
    // after all of that same-task synchronous code finishes but still
    // before the browser's next paint or animation-timeline tick, so it
    // wins the race against motion's own setup without introducing any
    // real wall-clock window of the kind this whole helper exists to
    // eliminate (document.timeline.currentTime — what an Animation's
    // currentTime measures against — only advances once per rendering
    // frame, not per microtask).
    //
    // Tried and REVERTED: (1) re-applying the pin on every polled frame
    // (`repin`) and (2) additionally neutering `.play()` to make the pause
    // irreversible. Both were built to chase a residual, lower-frequency
    // flake specifically on refocus-from-depth-deck-mid-spring (the test
    // that also drives motion's `layout` FLIP, not just declarative
    // animate-prop values) — but A/B stress runs showed each layered
    // "improvement" made the full-file pass rate WORSE (95% -> 69% -> 70%
    // -> 60% across the four variants, same methodology each time), not
    // better. The likely mechanism: repeatedly touching an Animation
    // motion/react still considers live (via renewed pause() calls, or by
    // making its own `.play()` a no-op) appears to confuse motion's
    // internal progress tracking, which then computes visibly wrong
    // downstream values (e.g. the camera pan target) — worse than the
    // occasional one-shot-pin race it was meant to fix. Left at the
    // single-microtask-hop version, which is the empirically best-performing
    // one measured. See this item's Worker report for the full
    // investigation and the still-open residual flake on
    // refocus-from-depth-deck-mid-spring specifically.
    void Promise.resolve().then(() => pinOne(anim));
    return anim;
  };
  return {
    animations,
    restore() {
      Element.prototype.animate = original;
    },
  };
}

/**
 * Waits (polling real animation frames, bounded) until `getCount()` stops
 * increasing for `stableFrames` consecutive frames, or `maxFrames` is
 * reached. Pairs with `pinWaapiAnimationsOnCreate` / `createMotionSeamRecorder`'s
 * `pinFraction`: since every animation is paused-and-pinned the instant
 * it's CREATED (not the instant this helper notices it), waiting longer
 * than strictly necessary here is always safe — nothing progresses further
 * while paused. That's what makes this non-racy where a fixed single
 * `waitForAnimationFrame()` isn't: this only needs to wait AT LEAST long
 * enough for every expected animation to register, with no penalty for
 * waiting longer under heavier load.
 */
export async function waitForAnimationsToSettle(
  getCount: () => number,
  options: { stableFrames?: number; maxFrames?: number } = {},
): Promise<number> {
  const { stableFrames = 3, maxFrames = 60 } = options;
  let stableStreak = 0;
  let lastCount = getCount();
  for (let i = 0; i < maxFrames; i++) {
    await waitForAnimationFrame();
    const count = getCount();
    if (count === lastCount) {
      stableStreak++;
      if (stableStreak >= stableFrames) return count;
    } else {
      stableStreak = 0;
    }
    lastCount = count;
  }
  return lastCount;
}

/**
 * Run a callback while a locator's element is in CSS :active state.
 *
 * Uses Playwright's `click({ delay })` to hold mousedown, then runs the
 * callback during the delay window. This triggers real CSS :active via
 * trusted browser input events — no CDP or synthetic events needed.
 */
export async function whilePressed(
  locator: { click: (options?: { delay?: number }) => Promise<void> },
  callback: () => Promise<void>,
): Promise<void> {
  await Promise.all([
    locator.click({ delay: 200 }),
    (async () => {
      await wait(100);
      await callback();
    })(),
  ]);
}

/**
 * Screenshot options that preserve paused animation state.
 * Merge this into your toMatchScreenshot call.
 */
export const animationScreenshotOptions = {
  screenshotOptions: { animations: "allow" as const },
};

/**
 * A MotionSeamRegistration that records every registered MotionValue and
 * AnimationPlaybackControls into Maps instead of a live test harness — wrap
 * `MotionSeamContext.Provider` (imported directly from its internal path,
 * `@/src/components/scene/motionSeam` — it's not part of the public barrel)
 * around a render tree with this as the `value` to capture Scene's rAF-driven
 * motion pipeline (camera pan `cameraX`, column strip scroll `scrollY:<name>`)
 * for deterministic inspection.
 *
 * @param pinFraction When supplied, `registerControls` pauses and jumps the
 * newly-registered AnimationPlaybackControls to this fraction (0-1) of its
 * own duration SYNCHRONOUSLY, at registration time — see
 * `pinWaapiAnimationsOnCreate`'s doc comment for the full rationale (that
 * helper is this same "pin at creation, not at some later checked moment"
 * idea applied to WAAPI instead of the rAF/MotionValue seam). Every
 * `registerControls` call site in production fires synchronously inside the
 * same effect that calls `animate()` (confirmed at source across Scene.tsx
 * and SceneColumn.tsx's cameraX/scrollY/topOffset/z tracks and
 * SceneObject.tsx's withinColumnTop — all useLayoutEffects, none gated
 * behind a later tick), so this closes the wall-clock window
 * `pinAllRegisteredAnimations` (called later, after `await rerender()`
 * resolves, optionally after an additional `waitForAnimationFrame()`) is
 * exposed to under concurrent suite load: nothing can progress the real
 * spring between "it exists" and "it's paused" because there is no gap.
 * Omit (or pass `undefined`) to preserve the original store-only behavior —
 * needed by callers that re-scrub the SAME controls to many different
 * fractions across a sampling loop (e.g. `samplePaintOrder`), which a
 * one-shot pin-at-registration can't support.
 */
export function createMotionSeamRecorder(pinFraction?: number): MotionSeamRegistration & {
  values: Map<string, MotionValue<number>>;
  controls: Map<string, AnimationPlaybackControls | undefined>;
} {
  const values = new Map<string, MotionValue<number>>();
  const controls = new Map<string, AnimationPlaybackControls | undefined>();
  return {
    values,
    controls,
    registerMotionValue(key, value) {
      values.set(key, value);
    },
    registerControls(key, playbackControls) {
      controls.set(key, playbackControls);
      if (pinFraction !== undefined && playbackControls) {
        playbackControls.pause();
        playbackControls.time = pinFraction * playbackControls.duration;
      }
    },
  };
}

/**
 * Pauses a registered rAF-driven animation and jumps it to `fraction` (0–1)
 * of its total duration, for a deterministic mid-animation screenshot.
 * Motion's rAF loop only advances a PLAYING animation — pausing stops it from
 * continuing to write over the frame we're about to capture, which is what
 * made the wait()-based captures these replace non-deterministic (motion's
 * loop kept writing during the capture window under suite load).
 *
 * Throws if `key` was never registered — animate() (and therefore
 * registerControls) only runs when the transition actually retargets the
 * value (e.g. duration !== 0 and the target changed), so a caller that
 * expected a transition to start and got nothing here has a real setup bug,
 * not a timing race.
 */
export function pinAnimationAt(
  recorder: { controls: Map<string, AnimationPlaybackControls | undefined> },
  key: string,
  fraction: number,
): void {
  const controls = recorder.controls.get(key);
  if (!controls) {
    throw new Error(`pinAnimationAt: no AnimationPlaybackControls registered for "${key}"`);
  }
  controls.pause();
  controls.time = fraction * controls.duration;
}

/**
 * Pauses and pins every rAF-driven animation registered on the seam so far,
 * at the same `fraction` (0–1) of each one's own duration. Use this (instead
 * of naming individual keys with `pinAnimationAt`) when a transition may
 * drive more than one MotionValue at once (e.g. the stage's `cameraX` pan
 * alongside a column's `scrollY:<name>` swap-reset) and every track should
 * read as "the same instant" in the capture — silently skips any key whose
 * animation never registered (a transition that didn't actually retarget
 * that value, e.g. a swap-reset resolving to an unchanged offset).
 */
export function pinAllRegisteredAnimations(
  recorder: { controls: Map<string, AnimationPlaybackControls | undefined> },
  fraction: number,
): void {
  for (const controls of recorder.controls.values()) {
    if (!controls) continue;
    controls.pause();
    controls.time = fraction * controls.duration;
  }
}

/**
 * A single ground-truth paint-order reading between two elements ("a" and
 * "b") at one fraction of an in-progress transition (or a real elapsed-time
 * sample — see `sampleLivePaintOrder` — in which case `fraction` is just a
 * sample index, not a proportion of a pinned duration).
 */
export interface PaintOrderSample {
  fraction: number;
  /** Whether the two elements' screen-space rects overlap at this fraction. */
  overlapping: boolean;
  /**
   * Which element real browser hit-testing reports as painted on top, at a
   * point inside the overlap. `null` when the elements don't overlap, or
   * (unexpectedly) when the hit point lands on neither element.
   */
  topElement: "a" | "b" | null;
}

/**
 * Ground-truth paint-order reading between two elements' CURRENT (live)
 * rects — no freezing/pinning, just `document.elementFromPoint` against
 * whatever is on screen right now. Tried at a 5x5 grid across the
 * intersection (inset so no point sits exactly on a border pixel) — the
 * first point hitting either element (not a third, unrelated occluder)
 * wins. A single center-point probe proved insufficient in a dense
 * multi-object scene where a THIRD sibling can occlude most of an A/B
 * intersection at once; a denser search is cheap (elementFromPoint is
 * fast) and dramatically cuts the chance every candidate lands under the
 * same occluder.
 */
function readPaintOrderOnce(
  index: number,
  elA: HTMLElement,
  elB: HTMLElement,
): PaintOrderSample {
  const rectA = elA.getBoundingClientRect();
  const rectB = elB.getBoundingClientRect();
  const left = Math.max(rectA.left, rectB.left);
  const right = Math.min(rectA.right, rectB.right);
  const top = Math.max(rectA.top, rectB.top);
  const bottom = Math.min(rectA.bottom, rectB.bottom);
  const overlapping = left < right && top < bottom;

  let topElement: "a" | "b" | null = null;
  if (overlapping) {
    const w = right - left;
    const h = bottom - top;
    const candidates: Array<[number, number]> = [];
    for (let gy = 1; gy <= 5; gy++) {
      for (let gx = 1; gx <= 5; gx++) {
        candidates.push([left + (w * gx) / 6, top + (h * gy) / 6]);
      }
    }
    for (const [x, y] of candidates) {
      const hit = document.elementFromPoint(x, y);
      if (!hit) continue;
      if (elA.contains(hit)) {
        topElement = "a";
        break;
      }
      if (elB.contains(hit)) {
        topElement = "b";
        break;
      }
    }
  }
  return { fraction: index, overlapping, topElement };
}

/**
 * Samples Michael's ruled paint-order invariant across a set of fractions
 * (0–1) of an in-progress transition: two objects overlapping in 2D screen
 * space must never change which one paints on top; z-crossings are only
 * legitimate once the pair is disjoint.
 *
 * At each fraction, pins every WAAPI track under `container` (freezeAnimationsAt)
 * and — when `recorder` is supplied — every rAF-driven MotionValue track
 * registered on the motion seam (pinAllRegisteredAnimations), so both classes
 * of animation read as "the same instant" for the sample, then reads ground
 * truth via `readPaintOrderOnce` (real elementFromPoint hit-testing, not
 * translateZ value inference — matching this codebase's DOM-truth
 * measurement philosophy, see SceneColumn's remeasureGeometry rect-delta
 * technique).
 *
 * Repeated calls to freezeAnimationsAt/pinAllRegisteredAnimations across
 * fractions re-scrub the same already-paused tracks (currentTime/.time are
 * freely settable), so samples can be taken in any order without an
 * unfreeze step between them.
 *
 * PREFER `sampleLivePaintOrder` for a transition that spans multiple
 * distinct real animations (e.g. several MotionValues that don't all start
 * in the same commit) — freeze/pin assumes every track's "fraction X of its
 * own duration" lines up with the same real instant, which breaks down
 * under heavy concurrent test-suite load (probe-confirmed: reliable in
 * isolation, reproducibly wrong under full-suite load — the same class of
 * wall-clock race documented on refocus-from-depth-deck-mid-spring).
 */
export function samplePaintOrder(
  container: HTMLElement,
  elA: HTMLElement,
  elB: HTMLElement,
  fractions: number[],
  recorder?: { controls: Map<string, AnimationPlaybackControls | undefined> },
): PaintOrderSample[] {
  const samples: PaintOrderSample[] = [];
  for (const fraction of fractions) {
    freezeAnimationsAt(container, fraction, { subtree: true });
    if (recorder) pinAllRegisteredAnimations(recorder, fraction);
    samples.push({ ...readPaintOrderOnce(0, elA, elB), fraction });
  }
  return samples;
}

/**
 * Samples Michael's ruled paint-order invariant across REAL elapsed time —
 * one `document.elementFromPoint` reading per animation frame, no
 * freeze/pin at all. Robust to the wall-clock race `samplePaintOrder`
 * (freeze/pin at a fixed fraction) is vulnerable to under concurrent
 * suite load: this just observes whatever is actually on screen at each
 * real frame, the same robustness principle as this file's own
 * poll-until-converged numeric sampling pattern.
 *
 * Awaits `waitForAnimationFrame` between reads — caller supplies `frames`
 * (how many real frames to sample).
 */
export async function sampleLivePaintOrder(
  elA: HTMLElement,
  elB: HTMLElement,
  frames: number,
): Promise<PaintOrderSample[]> {
  const samples: PaintOrderSample[] = [];
  for (let i = 0; i < frames; i++) {
    await waitForAnimationFrame();
    samples.push(readPaintOrderOnce(i, elA, elB));
  }
  return samples;
}

/**
 * Asserts Michael's ruled paint-order invariant against samples taken by
 * `samplePaintOrder`/`sampleLivePaintOrder`: consecutive OVERLAPPING samples
 * must agree on which element paints on top. A non-overlapping sample
 * resets the check — a paint-order swap is legitimate once the pair is
 * disjoint. `labelA`/`labelB` name the two elements in the thrown message
 * (test-authored, e.g. "middle-a" / "left").
 *
 * A sample whose hit point landed on NEITHER element (a third, unrelated
 * sibling fully occludes the A/B intersection at that instant — a real,
 * legitimate outcome in a scene with more than two overlapping bodies, not
 * a measurement bug) resets the check the same as a non-overlapping sample
 * — we simply have no A-vs-B information for that instant, so nothing is
 * asserted about it.
 *
 * Throws (rather than returning a boolean) so a genuine violation surfaces
 * as a test failure with the exact offending fraction.
 */
export function assertPaintOrderInvariant(
  samples: PaintOrderSample[],
  labelA: string,
  labelB: string,
): void {
  let lastOverlappingTop: "a" | "b" | null = null;
  for (const sample of samples) {
    if (!sample.overlapping || sample.topElement === null) {
      lastOverlappingTop = null;
      continue;
    }
    if (lastOverlappingTop !== null && sample.topElement !== lastOverlappingTop) {
      const from = lastOverlappingTop === "a" ? labelA : labelB;
      const to = sample.topElement === "a" ? labelA : labelB;
      throw new Error(
        `assertPaintOrderInvariant: paint order changed from "${from}" to "${to}" at fraction ${sample.fraction} while "${labelA}"/"${labelB}" were still overlapping — z-crossings are only legal when disjoint`,
      );
    }
    lastOverlappingTop = sample.topElement;
  }
}
