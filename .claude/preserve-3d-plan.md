# preserve-3d Depth Deck Implementation Plan

Replace CSS `scale` with CSS `perspective` + `preserve-3d` + `translateZ` for the Scene depth deck stacking effect.

## Background

The depth deck currently uses CSS `scale` + manual x-offset (`peekOffsetPx`) + `z-index` to create the stacking visual. This works but is a simulation — elements don't actually recede in 3D space. Real CSS perspective projection gives us:

- Natural size reduction from perspective (no manual scale math)
- Natural peek-left shift from `perspective-origin` (no manual x-offset)
- True 3D z-ordering via `translateZ` (no `z-index` needed)

Two earlier attempts failed due to: (1) `getBoundingClientRect()` returning projected sizes inside `preserve-3d`, and (2) `z-index` not working in 3D stacking contexts. Both issues now have solutions.

## Architecture: Where preserve-3d Lives

**The 3D context lives on the stage div only.** The stage already contains both focused columns (`position: relative`, in flex flow) and in-between columns (`position: absolute`). The `preserve-3d` + `perspective` properties go on this stage.

**Focused columns get `translateZ(0)`.** This is critical — they must explicitly participate in the 3D stacking context so they render in front of in-between columns (which have negative `translateZ`). Without `translateZ(0)`, focused columns would not be in the 3D ordering and could render behind the depth deck.

**In-between columns get `translateZ(-depth * N)`.** The perspective projection naturally makes them appear smaller and shifted toward `perspective-origin`.

**Within-column depth deck (SceneObject level) is NOT affected.** The within-column depth deck operates inside a single column's content wrapper. These use `position: absolute` + `top` offset for positioning and opacity/greyscale for visual treatment. They don't need `translateZ` because they're within a single flat column, not between columns in 3D space.

## getBoundingClientRect Considerations

Inside a `preserve-3d` container, `getBoundingClientRect()` returns the **projected** (screen-space) size of elements. This means:

- **Focused columns at `translateZ(0)`**: return their normal size — projection at z=0 is identity. **No problem.**
- **In-between columns at `translateZ(-N)`**: return smaller projected sizes. **This is fine** — we don't use their bounding rect for layout calculations. The frozen size is captured *before* the column becomes unfocused (while it's still focused at `translateZ(0)`).
- **Stage div**: `getBoundingClientRect()` on the stage itself returns its normal size because `perspective` is set on the stage (not a parent). The stage is the *perspective origin*, not a 3D-transformed element.

The specific `getBoundingClientRect` calls in the codebase and their safety:

| File | Line | Element | Safe? | Why |
|------|------|---------|-------|-----|
| Scene.tsx | 550 | viewport | Yes | Viewport is *outside* the 3D context |
| Scene.tsx | 612-614 | stage, focused cols | Yes | Stage is the perspective container; focused cols at `translateZ(0)` |
| Scene.tsx | 654-655 | stage, rightmost focused | Yes | Same as above |
| SceneColumn.tsx | 412 | colRef (while focused) | Yes | Focused columns are at `translateZ(0)` |
| SceneColumn.tsx | 443, 461 | contentWrapper | Yes | Inside a focused column at `translateZ(0)` |
| SceneColumn.tsx | 508 | contentWrapper (focused) | Yes | Same |
| SceneColumn.tsx | 536 | contentWrapper (never-focused) | **Check** | Never-focused columns don't have `translateZ` set via `animate` — need to verify |
| SceneColumn.tsx | 633 | colRef (in-between) | **Changed** | This measures `colHeight` for in-between centering — currently reads bounding rect, but we can use `frozenSize.height` (already captured while focused) |
| SceneObject.tsx | 57 | outerRef (focused) | Yes | Inside a focused column at `translateZ(0)` |

The line 633 case (`colHeight` for in-between vertical centering) needs attention. Currently it falls back to `getBoundingClientRect()` when `frozenSize` is null, which would return a projected size for in-between columns. **Fix: always use `frozenSize` for in-between columns** (they always have a frozen size because they were focused before becoming in-between... actually, they might never have been focused if they started unfocused). The fallback path matters for columns that were never focused. Since these columns don't have `translateZ` applied via motion `animate` yet... wait — they DO get `translateZ` via `animate` as soon as they're classified as in-between. So the `getBoundingClientRect` fallback on line 633 would return projected size. **Fix: for in-between columns that have no frozenSize, skip the vertical centering offset entirely** (they'll be top-aligned, which is acceptable for the depth deck).

The line 536 case: never-focused columns that aren't in-between don't get `translateZ` applied. They are outer-left/outer-right columns in the flex flow. They don't need `translateZ` and their bounding rect is unaffected. **Safe.**

## Detailed Changes

### Commit 1: Enable preserve-3d on stage and add translateZ to columns

#### `/Users/nir/code/webdesserts/ui/src/components/scene/Scene.tsx`

**Stage div style** (lines 757-769): Add `perspective` and `transformStyle: preserve-3d`.

```tsx
style={{
  position: "absolute",
  top: 0,
  left: stageLeft,
  height: "100%",
  display: "flex",
  flexDirection: "row",
  alignItems: "stretch",
  gap: columnGap || undefined,
  padding: padding || undefined,
  perspective: "800px",
  transformStyle: "preserve-3d",
  outline: debug ? "2px solid magenta" : undefined,
}}
```

**perspective-origin**: For now, use the default (`50% 50%` — center of stage). The perspective-origin-follows-rightmost-focused-column is a refinement for commit 2. Center perspective works well enough because in-between columns are already positioned near the right focused column — perspective projection will still shift them toward center, creating a subtle peek effect.

#### `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`

**Replace `depthScale` and `peekOffsetPx` with `translateZ`** (lines 608-627):

Remove:
- `peekOffsetPx` calculation (line 613)
- `depthScale` calculation (line 618)

Add:
- `depthZ` — the z-translation for depth: `const depthZ = isInBetween ? -stackDepth * 100 : 0;`
- For focused columns: `translateZ(0)` to participate in the 3D context

The `100` constant (pixels per depth level) determines how much each depth level recedes. With `perspective: 800px`, depth-1 at `translateZ(-100)` gives a scale factor of `800 / (800 + 100) = 0.89`, depth-2 at `translateZ(-200)` gives `800 / 1000 = 0.80`. These are reasonable depth ratios.

**Update animate prop** (lines 671-676):

```tsx
animate={{
  opacity: depthOpacity,
  x: animateX,
  y: inBetweenY,
  z: depthZ,  // replaces scale: depthScale
}}
```

Wait — motion's `animate` uses `z` for `translateZ`. Let me verify. Actually, motion uses `z` as shorthand for `translateZ`. So `animate={{ z: -100 }}` produces `translateZ(-100px)`. But there's a subtlety: motion manages transforms via its own transform pipeline, and it may not compose correctly with `preserve-3d`. The spike test (scene-perspective-spike.test.tsx) already validated that motion's `layout` FLIP works inside a `perspective` container. But it used CSS `transform` directly, not motion's `z` prop.

**Decision**: Use motion's `z` prop for in-between columns (it composes with `x` and `y` in the same transform string). For focused columns, apply `translateZ(0)` via `style.transform` to ensure it's always present (not dependent on motion animation completion). Actually, focused columns already use `layout={true}` — motion manages their transform. Adding `z: 0` to `animate` should work.

Actually, re-reading the SceneColumn code more carefully: focused columns use `layout={true}` but do NOT have an `animate` prop set (the current `animate` is only applied to ALL columns). Let me re-check...

Looking at line 671-676: the `animate` prop is on the motion.div that wraps ALL columns (focused and unfocused). Focused columns get `{ opacity: 1, x: 0, y: 0, scale: 1 }` (the non-in-between defaults). So adding `z: 0` for focused columns is straightforward — just make the focused default `z: 0`.

```tsx
// In the animate prop:
animate={{
  opacity: depthOpacity,
  x: animateX,
  y: inBetweenY,
  z: depthZ,  // 0 for focused, -depth*100 for in-between
}}
```

Where `depthZ` is:
```tsx
const depthZ = isInBetween ? -stackDepth * 100 : 0;
```

**Remove `scale` from both animate and style** (lines 675, 682):
- Remove `scale: depthScale` from `animate`
- Remove `scale: depthScale` from `style`

**Remove `peekOffsetPx` from `animateX`** (line 614):
- Change `const animateX = position === "in-between" ? stackTargetLeft - peekOffsetPx : 0;`
- To: `const animateX = position === "in-between" ? stackTargetLeft : 0;`

The perspective projection naturally shifts in-between columns toward the perspective origin, creating the peek effect without manual offset. If the peek effect isn't strong enough with default `perspective-origin: 50% 50%`, commit 2 adjusts `perspective-origin`.

**Remove `depthZIndex`** (line 627):
- Remove `z-index` from the style entirely. In `preserve-3d`, z-ordering is determined by `translateZ` values: higher z = closer = rendered on top.
- Focused columns at `translateZ(0)` render in front of in-between columns at `translateZ(-N)`.

Wait — this needs careful thought. The `z-index` is currently also used for focused vs outer unfocused ordering. Outer unfocused columns are `position: relative` in the flex flow with no `z-index`. Let me check if that's an issue...

Outer columns don't overlap with focused columns (they're in different flex positions, clipped by the viewport). So z-ordering between focused and outer columns doesn't matter. The only z-ordering that matters is focused vs in-between, and `translateZ` handles that.

**However**, there's a complication: CSS `z-index` does NOT work inside `preserve-3d` containers. Elements in a 3D stacking context are ordered by their z-position in 3D space, ignoring `z-index`. So removing `z-index` is not just a simplification — it's a requirement.

**Fix `colHeight` calculation** (line 633):
```tsx
// Old: falls back to getBoundingClientRect which returns projected size in 3D context
const colHeight = frozenSize?.height ?? (colRef.current?.getBoundingClientRect().height ?? 0);

// New: for in-between columns, only use frozenSize (never bounding rect, which is projected)
const colHeight = frozenSize?.height ?? (isInBetween ? 0 : (colRef.current?.getBoundingClientRect().height ?? 0));
```

#### Update `DepthDeckContext` — possibly remove or repurpose

Currently `DepthDeckContext` provides `stackTargetLeft` (the x-position to animate in-between columns to). This is still needed — `translateZ` only handles the z-axis, not the x-positioning of in-between columns behind the right focused column. **Keep `DepthDeckContext` as-is.**

### Commit 2: Dynamic perspective-origin tracking

**Goal**: Set `perspective-origin` to the center of the rightmost focused column within the stage. This makes `translateZ`'d in-between columns project toward that column, creating a natural "receding behind the right focused column" effect.

#### `/Users/nir/code/webdesserts/ui/src/components/scene/Scene.tsx`

The `stackTargetLeft` measurement (lines 644-662) already finds the rightmost focused column's left edge relative to the stage. Extend this to also compute the center:

```tsx
// After measuring stackTargetLeft, also compute perspective-origin
const colCenter = colRect.left - stageRect.left + colRect.width / 2;
const colMiddleY = colRect.top - stageRect.top + colRect.height / 2;
setStackTargetLeft(/*...*/);
setPerspectiveOrigin(`${colCenter}px ${colMiddleY}px`);
```

Add `perspectiveOrigin` state and apply it to the stage div's style.

**Note**: `perspective-origin` changes affect the projection of ALL `translateZ`'d elements. Since focused columns are at `translateZ(0)`, perspective-origin changes don't affect them at all (projection at z=0 is identity regardless of origin). Only in-between columns are affected — they'll project toward the new origin, which is exactly what we want.

**Risk**: Animating `perspective-origin` during focus transitions could cause a jarring visual jump for in-between columns. Since focus transitions are already spring-animated, the `perspective-origin` should update after the transition settles. Using `useLayoutEffect` (which fires synchronously) means it updates each frame during the transition, which should be smooth. If it's jarring, we can spring-animate the perspective-origin via motion's `animate` on the stage.

### Commit 3: Update tests

#### `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

**Tests that need updating in the "Scene depth deck stacking" describe block:**

1. **"in-between column stacks under right focused column"** (line 2705): Currently checks `middleRect.left` vs `rightRect.left` within 50px. With perspective, the in-between column's bounding rect will be projected (smaller, shifted toward perspective origin). The left-edge comparison still works — perspective projection shifts in-between columns toward the right focused column, so their left edges will be close. **Keep but loosen tolerance if needed.**

2. **"in-between column appears smaller than natural size"** (line 2744): Currently checks `middleRect.width < 300`. With real perspective, `getBoundingClientRect()` returns the projected width, which IS smaller. **This test should pass as-is** — perspective projection genuinely makes the element appear smaller in screen space.

3. **"multiple in-between columns: deeper columns appear further back"** (line 2779): Checks `rect1.width < rect2.width` (deeper is smaller). With perspective, deeper columns have larger negative `translateZ`, so perspective projects them smaller. **Should pass as-is.**

4. **"depth-1 in-between column transform contains translateZ"** (line 2876): Currently has a misleading name and comment — says "translateZ" in the name but actually checks for `scale`. **Update**: Check that the computed transform string contains a `translateZ` component (or equivalently, that the 3D matrix has a z-translation). Actually, `getComputedStyle(el).transform` returns a `matrix3d(...)` string when 3D transforms are active. We should check that the element appears smaller via bounding rect (already covered by test #2) and that its transform is a 3D matrix. Update the test name to match reality and check for `matrix3d` in the transform string.

5. **"depth-1 has higher opacity than depth-2"** (line 2828): Unchanged — opacity is still applied the same way.

6. **"depth-1 in-between column has greyscale filter"** (line 2916): Unchanged.

7. **"deeper columns have more greyscale"** (line 2949): Unchanged.

**Tests that might break due to `preserve-3d` + `getBoundingClientRect` returning projected sizes:**

Search all tests that measure bounding rects of in-between columns. The depth deck tests already expect smaller sizes (that's the point). Other tests that set up depth deck scenarios and measure sizes need review.

Actually, the depth deck tests are the ONLY tests that create in-between columns. All other test scenarios use single-focused or all-focused setups where no columns go in-between. So the blast radius is limited to the depth deck test block.

#### `/Users/nir/code/webdesserts/ui/tests/visual/scene.test.tsx`

**"scene-depth-deck-3d-perspective"** visual test (line 249): The visual output will change because real perspective creates different scaling/positioning than CSS `scale` + manual offset. **Delete the existing baseline and regenerate.** The new baseline should show:
- Focused columns at full size, side by side
- In-between columns behind the right focused column, naturally smaller from perspective, shifted toward the perspective origin
- Greyscale and opacity applied to in-between columns

Review the new baseline carefully — this is the primary visual verification.

#### `/Users/nir/code/webdesserts/ui/tests/scene-perspective-spike.test.tsx`

This file can be **deleted** after the migration. Its purpose was to validate that perspective works with flex layout and motion FLIP. Once the real implementation is in place, these spike tests are redundant with the actual depth deck tests.

### Summary of Code Changes

| File | Change |
|------|--------|
| `src/components/scene/Scene.tsx` | Add `perspective: "800px"` and `transformStyle: "preserve-3d"` to stage div style. Add `perspectiveOrigin` state + measurement. |
| `src/components/scene/SceneColumn.tsx` | Replace `depthScale` with `depthZ = -stackDepth * 100`. Replace `peekOffsetPx` (remove). Remove `depthZIndex` (z-index). Add `z: depthZ` to `animate`, remove `scale: depthScale`. Fix `colHeight` bounding rect fallback for in-between columns. |
| `tests/scene.test.tsx` | Update "transform contains translateZ" test (check for `matrix3d`, not scale). Other depth deck tests should pass. |
| `tests/visual/scene.test.tsx` | Regenerate depth deck visual baseline. |
| `tests/scene-perspective-spike.test.tsx` | Delete after migration (spike served its purpose). |

## Commit Breakdown

### Commit 1: Switch depth deck from CSS scale to perspective + translateZ

**Files**: `Scene.tsx`, `SceneColumn.tsx`, `scene.test.tsx`, `visual/scene.test.tsx`

Changes:
1. Scene.tsx: Add `perspective: "800px"`, `transformStyle: "preserve-3d"` to stage
2. SceneColumn.tsx: Replace `depthScale`/`peekOffsetPx` with `depthZ`, remove z-index, fix `colHeight`
3. scene.test.tsx: Update translateZ test assertion
4. visual/scene.test.tsx: Regenerate depth deck baseline

### Commit 2: Dynamic perspective-origin follows rightmost focused column

**Files**: `Scene.tsx`

Changes:
1. Add `perspectiveOrigin` state
2. Compute center of rightmost focused column in the stackTargetLeft measurement
3. Apply `perspectiveOrigin` to stage style

### Commit 3: Delete perspective spike tests

**Files**: `tests/scene-perspective-spike.test.tsx`

## Key Questions Answered

### Does `translateZ(0)` on focused columns interact with motion's `layout` FLIP?

The spike test already validated this (Q3 in scene-perspective-spike.test.tsx). Motion's `layout` FLIP works correctly inside a `perspective` container with `duration: 0`. The FLIP system measures positions, computes the delta, and applies an inverse transform — all of which work fine in a 3D context because focused columns at `translateZ(0)` have identity projection (screen-space positions equal layout positions).

### How does `preserve-3d` interact with the stage's `position: absolute` and `left` offset?

`preserve-3d` is applied to the stage div, which is `position: absolute` with an animated `left` value. The `perspective` and `preserve-3d` create a 3D rendering context for the stage's CHILDREN. The stage's own positioning (`left`, `top`) is unaffected — it's positioned by its parent (the viewport div), which is a normal 2D stacking context.

The stage's `left` offset pans the entire 3D scene. This is correct — the perspective projection happens relative to the stage's own coordinate system, so panning the stage moves the entire depth deck scene together.

### Does the within-column depth deck also benefit from perspective?

No. The within-column depth deck (SceneObject level) is a 2D effect using `position: absolute` + `top` offset + opacity/greyscale. It doesn't use `scale` and doesn't need `translateZ`. The within-column depth deck operates entirely within a single column's content wrapper, which is inside the 3D context but doesn't need its own 3D transforms. **No changes needed to SceneObject.tsx for the perspective migration.**

## Risks and Fallback

### Risk: motion's `z` prop not composing correctly with `layout` FLIP

**Mitigation**: The spike test confirmed FLIP works in a perspective container. If `z` composing with `layout` causes issues, we can apply `translateZ` via `style.transform` directly instead of motion's `animate.z`. Focused columns (which use `layout`) always have `z: 0`, so even if there's an issue, it only manifests when a column transitions from in-between (with negative z) back to focused (with layout FLIP). In that case, we can skip `translateZ(0)` for focused columns and instead rely on the fact that elements without `translateZ` render at `z=0` by default.

### Risk: perspective-origin changes cause jarring jumps

**Mitigation**: Start with default `perspective-origin: 50% 50%` in commit 1. Only add dynamic perspective-origin in commit 2. If commit 2's dynamic origin looks bad, revert to fixed origin — the fixed origin still gives a reasonable depth effect.

### Risk: Other tests break due to preserve-3d changing bounding rect behavior

**Mitigation**: Only in-between columns have non-zero `translateZ`. All other elements (viewport, stage, focused columns, outer columns) are at `z=0` or not in the 3D context. The `getBoundingClientRect()` audit above shows all calls on focused/viewport elements are safe. Run the full test suite after commit 1 to catch any unexpected failures.

### Fallback

If `preserve-3d` causes unforeseen issues, revert to the current CSS `scale` approach. The `scale` approach works — it just doesn't look as natural. All current tests pass with it.

## Constants

| Constant | Value | Reasoning |
|----------|-------|-----------|
| `perspective` | `800px` | Standard perspective distance. Not too extreme (400px would be very dramatic), not too subtle (1200px would barely show depth). The spike test used 800px. |
| `depthZ` per level | `-100px` | At perspective=800, depth-1 projects at scale=0.89, depth-2 at 0.80, depth-3 at 0.73. These are similar to the current `1 - depth * 0.08` scale factors (0.92, 0.84, 0.76). |
