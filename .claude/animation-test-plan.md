# Scene Animation Visual Snapshot Test Plan

## Problem

Scene focus transitions look "weird" — the position: relative <-> position: absolute swap during focus/unfocus creates visual discontinuities. We need mid-animation visual snapshots to diagnose what is happening and lock in correct behavior once fixed.

## Core Technical Challenge: motion vs WAAPI

The existing `freezeAnimationsAt` utility works with CSS transitions via the Web Animations API (`getAnimations()`). However, the Scene system uses **motion's spring physics**, which do NOT use CSS transitions or WAAPI. Motion drives animations through its own JS-based animation loop (requestAnimationFrame). `getAnimations()` will return nothing for motion-driven animations.

This means the `slowTransitions` + `freezeAnimationsAt` pattern used for button spread animations **will not work** for Scene transitions.

### Recommended Approach: Timed Duration with `wait()`

Use motion's `duration` prop with a **known tween duration** (not springs) and capture at a fixed timestamp via `wait()`.

**Why this works:**
- When `duration` is set to a number (e.g. `duration={800}`), motion uses a tween (ease) rather than spring physics
- The transition object already handles this: `duration === 0 ? { duration: 0 } : { type: "spring", stiffness, damping }`
- We can pass a **custom transition override** through the Scene config to force tween mode
- At `wait(400)` into an 800ms tween, the animation is at roughly 50% progress
- Tweens are deterministic — same duration + same easing = same intermediate values

**Implementation: Add `transition` override to Scene props**

The cleanest approach is to accept an optional `transition` prop on `<Scene>` that overrides the computed spring/duration transition object. This lets animation tests pass `{ duration: 0.8, ease: "linear" }` for predictable mid-animation capture without changing the production spring behavior.

```tsx
// In test:
<Scene transition={{ duration: 0.8, ease: "linear" }}>
```

This is simpler than adding a separate config prop because it directly maps to what motion expects.

**Alternative considered: capturing at a fixed delay with springs.** Springs are velocity-dependent and non-deterministic at intermediate timestamps. A slight timing variance (browser scheduling, GC pause) shifts the frame. This would cause flaky visual diffs. Rejected.

**Alternative considered: using `onUpdate` callback to freeze at a specific value.** Motion supports `onUpdate` on animate, but pausing the animation loop mid-frame requires internal API access we don't have. Rejected.

## Files to Modify

### 1. `src/components/scene/Scene.tsx`
- Add optional `transition` prop to `SceneProps` interface (~line 124)
- Pass `transition` through `SceneConfigContext` instead of computing it inline
- SceneViewport already reads from config; just add the field

### 2. `src/components/scene/useSceneConfig.tsx`
- Add `transition?: object` to `SceneConfig` interface
- Default remains `undefined` (computed from stiffness/damping/duration as today)

### 3. `src/components/scene/SceneColumn.tsx`
- Read `transition` from config context
- If provided, use it directly instead of computing from duration/stiffness/damping (~line 557-560)

### 4. `tests/utils/animation.ts`
- Add `waitForMotionSettle(ms: number)` helper — thin wrapper around `wait()` with a clear semantic name
- Add `ANIMATION_TEST_TRANSITION` constant: `{ duration: 0.8, ease: "linear" }` — shared by all animation tests

### 5. `tests/visual/scene-animation.test.tsx` (NEW)
- New test file for all mid-animation visual snapshots
- Separate from `tests/visual/scene.test.tsx` (which tests final states with `duration={0}`)

## Test Inventory

### Test 1: Focus Transition (3 snapshots)

**What:** Column A starts unfocused, column B is focused. Rerender to focus A.

**Start state** (before rerender):
- Render with B focused, A unfocused
- Screenshot: `scene-focus-transition-start`

**Mid-animation** (rerender + wait):
- Rerender with A focused, B unfocused
- `await wait(400)` — 50% through 800ms linear tween
- A should be partially transitioned from absolute to flex position
- Camera should be partially panned toward A
- Screenshot: `scene-focus-transition-mid` with `animations: "allow"`

**End state** (after settle):
- `await wait(500)` — remaining 400ms + buffer
- Screenshot: `scene-focus-transition-end` with `animations: "allow"`

```tsx
it("scene-focus-transition-start", async () => {
  document.documentElement.style.colorScheme = "dark";
  const { rerender, container } = await render(
    <TestWrapper fullPage>
      <Scene transition={ANIMATION_TEST_TRANSITION}>
        <SceneColumn name="left">
          <SceneObject name="left-panel" focused={false}>
            <Panel label="Left (unfocused)" color="indigo" />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="right">
          <SceneObject name="right-panel" focused>
            <Panel label="Right (focused)" color="pink" />
          </SceneObject>
        </SceneColumn>
      </Scene>
    </TestWrapper>,
  );
  await expect.element(page.elementLocator(container)).toMatchScreenshot();
});

it("scene-focus-transition-mid", async () => {
  document.documentElement.style.colorScheme = "dark";
  const { rerender, container } = await render(
    <TestWrapper fullPage>
      <Scene transition={ANIMATION_TEST_TRANSITION}>
        <SceneColumn name="left">
          <SceneObject name="left-panel" focused={false}>
            <Panel label="Left" color="indigo" />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="right">
          <SceneObject name="right-panel" focused>
            <Panel label="Right" color="pink" />
          </SceneObject>
        </SceneColumn>
      </Scene>
    </TestWrapper>,
  );
  // Trigger focus swap
  await rerender(
    <TestWrapper fullPage>
      <Scene transition={ANIMATION_TEST_TRANSITION}>
        <SceneColumn name="left">
          <SceneObject name="left-panel" focused>
            <Panel label="Left" color="indigo" />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="right">
          <SceneObject name="right-panel" focused={false}>
            <Panel label="Right" color="pink" />
          </SceneObject>
        </SceneColumn>
      </Scene>
    </TestWrapper>,
  );
  await wait(400); // 50% of 800ms linear
  await expect.element(page.elementLocator(container))
    .toMatchScreenshot(animationScreenshotOptions);
});

it("scene-focus-transition-end", async () => {
  // Same setup as mid, but wait for full settle
  // ...
  await wait(900); // 800ms + 100ms buffer
  await expect.element(page.elementLocator(container))
    .toMatchScreenshot(animationScreenshotOptions);
});
```

### Test 2: Unfocus Transition (2 snapshots)

**What:** Two columns focused. One unfocuses. Camera re-centers on the remaining.

- Start: both A and B focused (side by side)
- Rerender: B unfocused
- `await wait(400)`: mid-camera-pan, B partially frozen
- Screenshot: `scene-unfocus-mid`
- `await wait(500)`: settled
- Screenshot: `scene-unfocus-end`

### Test 3: Vertical Swap (2 snapshots)

**What:** Column with objects A (focused) and B (unfocused). Swap to B focused.

- Start: A focused in a single column
- Rerender: A unfocused, B focused
- `await wait(400)`: content wrapper sliding — A partially above viewport, B partially visible
- Screenshot: `scene-vertical-swap-mid`
- `await wait(500)`: settled
- Screenshot: `scene-vertical-swap-end`

### Test 4: Depth Deck Entry (2 snapshots)

**What:** Three columns: left (focused), middle (focused), right (focused). Unfocus middle — it should animate into the depth deck between left and right.

- Start: all three focused
- Rerender: middle unfocused
- `await wait(400)`: middle partially scaled, partially translated to depth deck position, partially transparent/greyscale
- Screenshot: `scene-depth-entry-mid`
- `await wait(500)`: settled
- Screenshot: `scene-depth-entry-end`

### Test 5: Camera Pan (2 snapshots)

**What:** Three columns. Focus moves from column 1 to column 3. Camera pans right.

- Start: column 1 focused
- Rerender: column 1 unfocused, column 3 focused
- `await wait(400)`: stage `left` is mid-pan, partially showing column 1 sliding offscreen-left and column 3 sliding into center
- Screenshot: `scene-camera-pan-mid`
- `await wait(500)`: settled
- Screenshot: `scene-camera-pan-end`

## Shared Test Helper

```tsx
// Panel helper used across all animation tests — consistent visual identity
function Panel({ label, color, width = 300, height = 250 }: {
  label: string;
  color: "indigo" | "pink" | "green" | "amber";
  width?: number;
  height?: number;
}) {
  const colors = {
    indigo: { bg: "rgba(99,102,241,0.3)", border: "rgba(99,102,241,0.6)" },
    pink: { bg: "rgba(244,114,182,0.3)", border: "rgba(244,114,182,0.6)" },
    green: { bg: "rgba(52,211,153,0.3)", border: "rgba(52,211,153,0.6)" },
    amber: { bg: "rgba(251,191,36,0.3)", border: "rgba(251,191,36,0.6)" },
  };
  const c = colors[color];
  return (
    <div style={{
      width, height, background: c.bg, border: `1px solid ${c.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontFamily: "monospace", fontSize: 14,
    }}>
      {label}
    </div>
  );
}
```

## Commit Breakdown

### Commit 1: Add `transition` prop to Scene config

**Files:**
- `src/components/scene/useSceneConfig.tsx` — add `transition` field to `SceneConfig`
- `src/components/scene/Scene.tsx` — add `transition` to `SceneProps`, thread through config
- `src/components/scene/SceneColumn.tsx` — use config `transition` when provided
- `src/components/scene/Scene.tsx` (SceneViewport) — use config `transition` for stage animation

**Test:** Existing tests still pass (all use `duration={0}`, `transition` is undefined by default).

### Commit 2: Animation test infrastructure + first focus transition tests

**Files:**
- `tests/utils/animation.ts` — add `ANIMATION_TEST_TRANSITION` constant
- `tests/visual/scene-animation.test.tsx` — new file with Panel helper, Tests 1 and 2 (focus + unfocus transitions, 5 snapshots)

### Commit 3: Vertical swap, depth deck, and camera pan animation tests

**Files:**
- `tests/visual/scene-animation.test.tsx` — add Tests 3, 4, 5 (vertical swap, depth entry, camera pan, 6 snapshots)

## Risks and Decision Points

### Risk: Linear tween timing may still be flaky

Even with a deterministic linear tween, browser frame scheduling could cause the `wait(400)` to land on slightly different frames between runs. The 800ms duration gives a wide window where visual changes are gradual (linear easing means 1px per ms), so small timing variance (~16ms frame boundary) should produce nearly identical screenshots.

**Mitigation:** Use generous `maxDiffPixelRatio` in screenshot options if needed. Start with defaults and tune if flaky.

### Risk: motion may not respect custom transition for layout animations

The `layout` prop on motion.div drives FLIP animations through motion's layout projection system, which has its own transition handling separate from `animate`. The `transition` prop on `<motion.div>` controls both `animate` and `layout` transitions, but we need to verify that the Scene's transition override propagates to the `layout` animation path, not just the `animate` path.

**Mitigation:** In commit 1, add a behavioral test that verifies a layout animation is still in progress at `wait(400)` with the custom transition. Check that the column's `getBoundingClientRect()` is at an intermediate position.

### Decision: Should `transition` prop replace or augment `duration`?

The current `duration` prop already serves two purposes: `duration={0}` disables animation, and `duration={undefined}` means "use spring." The new `transition` prop would be a third option. Recommendation: `transition` takes precedence when provided — it fully replaces the computed transition object. `duration={0}` continues to work as before (instant). Document that `transition` and `duration` are mutually exclusive; if both provided, `transition` wins.

### Decision: Snapshot tolerance

Mid-animation frames are inherently less stable than final-state frames. Should we use a higher `maxDiffPixelRatio` for animation tests? Recommendation: start with the project default and see how it goes. Linear tweens at 800ms should be stable enough at 2x device scale.
