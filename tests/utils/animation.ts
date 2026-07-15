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
 */
export function createMotionSeamRecorder(): MotionSeamRegistration & {
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
