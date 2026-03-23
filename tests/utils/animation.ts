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
    locator.click({ delay: 50 }),
    (async () => {
      await wait(25);
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
