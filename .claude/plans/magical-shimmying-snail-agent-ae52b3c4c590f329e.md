# Scene System Rework Plan

The current implementation diverges from the spec in 12 areas. This plan corrects all of them in a dependency-ordered commit sequence. Each commit bundles failing tests first, then implementation.

## Architecture Summary

The fundamental problem is the column positioning model. The spec says "all columns are always present and visible — the scene is a real space, not a set of hidden panels." The code currently pulls ALL unfocused columns out of flex flow with `position: absolute` and hides them with `opacity: 0`. Only in-between columns (depth deck) should go absolute. Outer unfocused columns stay in the flex row — they are simply off-camera (clipped by the viewport's `overflow: hidden`).

This architectural fix (Commit 1) is the foundation. Everything else builds on it.

---

## Commit 1: Column positioning model — all columns stay in flow

**Spec scenarios addressed:**
- scene.feature: "All columns are always present and visible" (line 6)
- scene.feature: "Column size is based on content by default" (line 28)
- scene.feature: "Outer unfocused columns slide offscreen" (lines 82-87)
- scene.feature: "In-between unfocused columns stack as a depth deck" (lines 89-93)
- scene-navigation.feature: "Outer unfocused column slides offscreen" (lines 96-100)

**What changes:**

This is the biggest commit. The mental model shift: the scene is a spatial row of all columns. The Camera (viewport with `overflow: hidden`) shows only the focused region. Unfocused columns don't disappear — they're just off-camera. Only in-between columns go `position: absolute` for the depth deck effect.

### `SceneColumn.tsx` changes (lines 436-500):

1. **`focusedStyle`** (line 436): Change `flex: "1 1 0"` to `flex: "0 1 auto"`. Remove `overflow: "hidden"`. Content-sized by default; consumers opt into equal sharing via their own CSS.

2. **`unfocusedStyle`** (line 455): Replace the blanket `position: "absolute"` with conditional logic:
   - **In-between columns** (`position === "in-between"`): Keep `position: "absolute"`, frozen size, depth deck behavior. This is the only case that exits flex flow.
   - **Outer columns** (`position === "outer-left"` or `"outer-right"`): Stay `position: "relative"` in flex flow. Keep frozen width/height as inline styles so they don't collapse to 0 (the column's content is inert and may not dictate size). No opacity: 0 — the viewport clips them.
   - **No-position columns** (all unfocused, `position === null`): Stay `position: "relative"` with frozen size. Camera stays still.

3. **Remove `opacity: 0`** from unfocused columns entirely. Outer columns are clipped by the viewport; they don't need to be invisible. The `depthOpacity` calculation (line 495) should only apply to in-between columns. Outer columns and no-position columns get `opacity: 1`.

4. **Remove `x: outerX` translation** for outer columns (line 477). Outer columns don't need translateX — they're already in the flex row beyond the focused columns. The viewport clips them naturally. Only in-between columns need the `x: stackTargetLeft` translation.

5. **Remove `overflow: "hidden"`** from `focusedStyle` (line 447). The spec says clipping happens at the viewport boundary, not column boundaries. This lets shadows, glows, and decorative elements bleed past the column edge.

### `SceneObject.tsx` changes (lines 90-96):

6. **Remove `opacity: 0`** from unfocused SceneObjects in focused columns. Currently line 95 sets `{ position: "absolute", opacity: 0 }` for unfocused objects. Change to `{ position: "absolute" }` only. The object is out of the column's flow (correct for vertical swap), but its visibility is controlled by the column's `overflow: hidden`... wait, we're removing overflow hidden. Need a different approach.

   Actually, re-reading the spec: unfocused objects within a column that has a focused object are slid out of view by the column's vertical offset. They are off-camera vertically. But without `overflow: hidden` on the column, they'd be visible. The spec says clipping happens at the viewport level. So unfocused objects in a column with a vertical swap DO peek above/below — and that's fine because the viewport clips them. The `position: absolute` on unfocused objects within a column is still needed so they don't affect the column's content height for scroll calculations. Keep the absolute positioning, drop the opacity: 0.

### `Scene.tsx` changes:

7. **Remove the `DepthDeckContext` dependency for stackTargetLeft**. In the new model, in-between columns are absolute-positioned within the stage (relative to the stage's position: relative). The `stackTargetLeft` measurement (line 458-473) is still needed for positioning in-between columns. No change needed here.

8. **Stage `width: "fit-content"`** (line 572) needs review. With all columns in flow, the stage needs to fit ALL columns (not just focused ones). The viewport clips what's visible. This should work as-is because `fit-content` sizes to the content, and all columns are now in flow. But we need the stage to expand to at least the viewport width when focused columns are narrower. The `margin-inline: auto` centering (line 573) handles this case — the stage fits its content, and `auto` margins center it.

   Actually, there's a subtlety: if we have [unfocused-200px] [focused-400px] [unfocused-200px], the stage is 800px wide with `fit-content`. The viewport is 1280px. The `margin-inline: auto` centers the stage. The focused column at 400px is centered within 1280px. The unfocused columns at the edges are 200px from the stage edge, which is ~240px from the viewport edge — still visible. That's actually correct per spec ("all columns are always present and visible").

   But the Camera should frame the focused content, which means the focused content should be centered. This centering currently works via `margin-inline: auto` on the stage. With all columns in flow, the stage includes unfocused columns, so the stage center !== focused center. We need the stage to include all columns but center the focused portion within the viewport.

   **Resolution**: The stage should NOT include outer unfocused columns in its layout. Outer unfocused columns should be positioned absolutely (like in-between) but translated to their natural position in the row. Wait — that contradicts the spec's "all columns in a horizontal row."

   Let me re-read the spec more carefully. "The scene is a horizontal row of columns in DOM order" — this describes the mental model. "When columns are focused, they participate in a responsive flex layout filling the viewport. Unfocused columns are positioned by the Scene: outer columns slide offscreen, in-between columns stack as a depth deck behind the nearest focused column."

   So **focused columns** participate in flex. **Unfocused columns** are positioned by the Scene. The spec doesn't say unfocused columns must be in flex flow — it says the Scene positions them. The key difference from the current code is:
   - Current: ALL unfocused → absolute + hidden
   - Spec: outer unfocused → positioned offscreen (but still "present and visible" in the sense that they exist, just off-camera)

   The simplest correct implementation: focused columns are in flex flow. ALL unfocused columns are absolute-positioned by the Scene. Outer columns get translated offscreen. In-between columns get depth-decked. The difference from current code: outer columns are NOT `opacity: 0` — they're translated offscreen and the viewport clips them. They're still "in the scene" with real dimensions, just off-camera.

   **Final approach**: Keep `position: absolute` for all unfocused columns (current behavior). Remove `opacity: 0`. Outer columns get `translateX` offscreen. In-between columns get depth deck. The viewport's `overflow: hidden` clips everything outside. This is actually close to the current code — the main fixes are:
   - Remove `opacity: 0` from outer unfocused columns (they're clipped by overflow, not hidden)
   - Change `flex: "1 1 0"` to `flex: "0 1 auto"` for content-based sizing
   - Remove `overflow: "hidden"` from focused columns

### Tests to update:

- **`"focused column has flex: 0 1 auto and position: relative"`** (line 238): Update assertion from `flex: 1 1 0` to `flex: 0 1 auto`. Actually the test name already says `0 1 auto` but the assertion on line 254 checks `flexGrow: "1"`. Fix to check `"0"`, `"1"`, `"auto"`.

- **`"unfocused column (never focused) has position: absolute and opacity: 0"`** (line 259): Change to check `position: absolute` (still true) but **remove** the `opacity: 0` assertion. With the outer-right classification, opacity should be 1 (not 0).

  Wait — a single unfocused column with no focused siblings: all columns are unfocused, `computeColumnPositions` returns `null` for all. The `depthOpacity` code gives `1` for null position. So opacity is already 1 in the no-position case. But the current code on line 495 gives `0` for outer-left and outer-right. We need to keep them opaque (the viewport clips them). Change outer opacity from `0` to `1`.

- **`"mixed focused/unfocused — focused is relative, unfocused is absolute"`** (line 303): Still valid (unfocused is absolute).

- **`"two flexible focused columns share available width roughly equally"`** (line 328): This test depends on `flex: 1 1 0`. With `flex: 0 1 auto`, columns won't share equally by default — they'll size to content. The test gives columns `minWidth: 100` — with `flex: 0 1 auto`, they'd be 100px each, not sharing the viewport. This test needs to either: (a) be updated to reflect content-based sizing, or (b) add `flex: 1 1 0` via consumer CSS to opt into equal sharing. Per spec, equal sharing is consumer-controlled. Update this test to verify content-based sizing instead.

- **`"debug does not affect layout"`** (line 555): Checks `flexGrow: "1"` — update to `"0"`.

- **`"focus change: previously focused becomes absolute, newly focused becomes relative"`** (line 488): Still valid.

- **Outer positioning tests** (line 2119): The mechanism changes. Currently outer columns get `translateX(-viewportWidth)` via motion `animate`. With the rework, outer columns are still `position: absolute` and translated, so these tests should still work. BUT: the `rect.right <= 0` check (line 2149) depends on the translate being applied by motion. With `duration=0`, motion applies it asynchronously. The `waitForAnimationFrame` call should handle this. These tests likely still pass.

- **Depth deck tests** (line 2284): The depth deck mechanism is unchanged — in-between columns are absolute + translated to stackTargetLeft. These should still pass.

### New tests to add:

- **Content-based column sizing**: A column with a 400px wide element should be 400px wide (spec line 28-31).
- **No overflow hidden on columns**: Verify focused column content is NOT clipped at the column boundary (e.g., a box-shadow extends past the column edge and is visible).
- **Outer columns are not visible** (clipped by viewport, not by opacity): Verify outer column has opacity 1 but is positioned outside the viewport rect.

### Visual snapshot tests to add:

- **Outer columns clipped by viewport**: Scene with focused center, unfocused sides — verify the unfocused columns are not visible in the viewport.
- **Content-sized columns**: Scene with columns of different content widths — verify they're sized to content, not equally.

### Files affected:
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneObject.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`
- `/Users/nir/code/webdesserts/ui/tests/visual/scene.test.tsx`

---

## Commit 2: Greyscale filter on depth-stacked columns

**Spec scenarios addressed:**
- scene.feature: "lower opacity and more greyscale" (line 129)
- scene.feature: "Stacking depth scales opacity and greyscale" (lines 132-135)

**What changes:**

### `SceneColumn.tsx`:

Add `filter: grayscale(${depth * 0.25})` to in-between columns alongside existing opacity scaling. The `depthScale`, `depthOpacity` variables (lines 492-499) need a new `depthGreyscale` value.

Since `filter` is not animatable via motion's `animate` prop (motion animates `opacity` and transforms, not CSS filter), apply it as an inline style that changes with depth. The transition between greyscale levels during focus changes will be handled by CSS transition on the filter property (add `transition: filter 0.3s` or use motion's `style` prop).

Actually, `filter` can be animated by motion via the `animate` prop — motion supports filter properties. Add `filter: \`grayscale(${depthGreyscale})\`` to the `animate` prop alongside opacity, x, and scale.

Wait, checking motion docs: motion's `animate` supports `filter` as a string. So:

```tsx
animate={{
  opacity: depthOpacity,
  x: outerX,
  scale: depthScale,
  filter: isInBetween ? `grayscale(${stackDepth * 0.25})` : "grayscale(0)",
}}
```

### Tests to add:

- **`"depth-1 column has grayscale applied"`**: Check computed filter includes `grayscale`.
- **`"deeper stacked columns have more greyscale"`**: Depth-2 has more greyscale than depth-1.

### Visual snapshot test:

- **Depth deck with greyscale**: Scene with 3 columns (outer focused, middle unfocused) showing the greyscale + opacity effect. This is the most important visual verification.

### Files affected:
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`
- `/Users/nir/code/webdesserts/ui/tests/visual/scene.test.tsx`

---

## Commit 3: Real 3D depth for stacking (perspective + translateZ)

**Spec scenarios addressed:**
- scene.feature: "scaled down slightly to appear farther back in the scene" (line 93)
- scene.feature: "each successive column deeper in the stack should be scaled down further" (line 98)

**What changes:**

Replace CSS `scale` transform with `perspective` on the stage + `translateZ` on stacked columns for real 3D depth visuals. The perspective spike (tests/scene-perspective-spike.test.tsx) already confirmed this works:
- Perspective on flex container doesn't shift flex children layout
- translateZ shrinks elements visually via perspective projection
- translateZ shifts elements toward perspective-origin (creating peek-left effect)
- motion layout FLIP works inside perspective containers

### `Scene.tsx` changes:

The stage div (line 563-577) already has `perspective: "1000px"` and `transformStyle: "preserve-3d"`. These were added during the spike. Keep them.

Add dynamic `perspectiveOrigin` set to the horizontal center of the rightmost focused column (already measured as `stackTargetLeft`). This makes stacked columns peek toward the right focused column.

### `SceneColumn.tsx` changes:

Replace `scale: depthScale` (line 492) with `translateZ: -(stackDepth * 100)` (or similar). The perspective projection naturally shrinks the element — no explicit scale needed.

Remove `depthScale` variable. The `animate` prop becomes:
```tsx
animate={{
  opacity: depthOpacity,
  x: outerX,
  z: isInBetween ? -(stackDepth * 100) : 0,
  filter: isInBetween ? `grayscale(${stackDepth * 0.25})` : "grayscale(0)",
}}
```

Wait — motion uses `z` for translateZ. Check: yes, in motion/framer-motion, `z` in `animate` maps to `translateZ`.

### Test updates:

- **`"in-between column appears smaller than natural size (perspective depth)"`** (line 2353): This test uses `getBoundingClientRect` to compare sizes. The spike confirmed that inside `preserve-3d`, `getBoundingClientRect` returns 0 or incorrect values. However, the spike test on line 80 shows it DOES work — `pushedBack.width < natural.width` passes.

  Looking more carefully at the spike: the spike uses `position: absolute` children with explicit `width/height` inside a `preserve-3d` container, and `getBoundingClientRect` works correctly there. The issue the design note mentions ("getBoundingClientRect returns 0") may have been about a different setup. The spike proves it works for our case (absolute children with translateZ inside preserve-3d).

  So the existing test should still pass with translateZ instead of scale. Update it to verify via `getBoundingClientRect` as before — the perspective projection should make the element appear smaller.

- **`"multiple in-between columns: deeper columns appear further back"`** (line 2388): Update to verify depth-2 appears smaller than depth-1. Should still work.

- **Depth scale tests that check `scale`**: Any test asserting `transform: scale(...)` needs to be updated to check for `translateZ` instead. But actually the tests check `getBoundingClientRect` width, not transform strings. So they should work as-is.

### Visual snapshot test:

- **3D depth deck**: Scene with focused left/right, 2 unfocused in between. The 3D perspective should create a visually compelling depth effect with parallax-like peeking. This screenshot is critical for verifying the visual quality.

### Files affected:
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scene.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`
- `/Users/nir/code/webdesserts/ui/tests/visual/scene.test.tsx`

---

## Commit 4: Within-column depth deck visuals

**Spec scenarios addressed:**
- scene-navigation.feature: "Object B should be positioned under Object C" (lines 62-73)
- scene-navigation.feature: "Multiple unfocused objects between focused objects stack with depth" (lines 68-71)

**What changes:**

Currently, unfocused objects between two focused objects within a column get `position: relative` (if parent column is in depth deck) or `position: absolute; opacity: 0` (if parent is focused). Neither applies depth visuals.

The spec says unfocused objects BETWEEN focused objects should stack as a depth deck under the lower focused object — same visual treatment as column-level stacking (scale/translateZ, opacity, greyscale, peek from top).

### `SceneObject.tsx` changes:

Add depth deck logic for within-column stacking. Need to:
1. Determine if this unfocused object is "in-between" two focused siblings
2. Compute its depth index within the column
3. Apply scale/opacity/greyscale/translateY (vertical peek instead of horizontal)

This requires the column to classify its children similarly to how Scene classifies columns. The `deriveObjectStates` function in `SceneColumn.tsx` already collects focus states. Add a `computeObjectPositions` function (parallel to `computeColumnPositions`) that classifies objects as "above" (before first focused), "below" (after last focused), or "in-between".

Pass classification and depth down to SceneObject via the existing `ColumnContext`. Add new fields:
```typescript
interface ColumnRegistration {
  // ... existing fields ...
  objectPosition: Map<string, "above" | "below" | "in-between" | null>;
  objectDepth: Map<string, number>;
}
```

### `SceneObject.tsx` changes:

Read position and depth from ColumnContext. When `position === "in-between"`:
- Apply `translateY` to peek above the lower focused object
- Apply `scale` / `translateZ` for depth
- Apply `opacity` and `filter: grayscale()` scaled by depth
- Set `z-index` decreasing with depth

### Tests to add:

- **In-between object has depth treatment**: Column with A (focused), B (unfocused), C (focused). B should have reduced opacity, greyscale, and scale.
- **Multiple in-between objects stack with increasing depth**: A (focused), B (unfocused), C (unfocused), D (focused). B and C should have increasing depth treatment.
- **Above/below objects don't get depth treatment**: Only in-between objects.

### Visual snapshot:

- **Within-column depth deck**: Shows focused A and C with unfocused B peeking between them.

### Files affected:
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneObject.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`
- `/Users/nir/code/webdesserts/ui/tests/visual/scene.test.tsx`

---

## Commit 5: Scroll position restore on refocus

**Spec scenarios addressed:**
- scene-scroll.feature: "column should attempt to restore its previous scroll position" (lines 138-145)
- scene-scroll.feature: "Vertical swap restores per-object scroll position" (lines 157-161)

**What changes:**

Currently, scroll resets to 0 every time a column regains focus. The spec says:
1. Save scroll offset when a column loses focus
2. Restore it when the column regains focus
3. But adjust if the focused object is not visible at the restored position
4. If the column has drastically resized, fall back to scrolling to the top of focused content

### `SceneColumn.tsx` changes:

Add a `savedScrollPositions` ref (Map<string, number>) that persists per-object scroll positions. Key by `objectName` (not column name) so vertical swaps restore per-object positions.

In the `columnFocused` effect (line 342):
- On focus loss: save `scrollOffsetRef.current` keyed by the current focused object name
- On focus gain: look up saved position for the newly focused object. If found and the focused object would be visible at that position, restore it (spring-animated). Otherwise, scroll to 0.

The spring animation on restore means using `setScrollOffset` with the restored value and letting the motion `animate={{ top: combinedTop }}` spring to it.

### Tests to add:

- **Scroll position saves and restores**: Scroll column A to 200px, switch focus to column B, switch back to A — scroll should restore to 200px.
- **Restore adjusts if focused object not visible**: Scroll down, swap focused object within column, restore — if the new focused object isn't visible at the saved position, adjust.
- **Vertical swap restores per-object position**: Object A scrolled to 100px, swap to Object B (at 0), swap back to A — A restores to 100px.

### Files affected:
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

## Commit 6: Padding in scroll bounds

**Spec scenarios addressed:**
- scene-scroll.feature: "scroll range should include padding above and below" (lines 127-128)
- scene-scroll.feature: "Padding can push content into overflow" (lines 130-134)

**What changes:**

### `SceneColumn.tsx`:

The `maxScroll` calculation (line 193) is currently:
```tsx
const maxScroll = Math.max(0, contentHeight - viewportHeight);
```

The spec says padding should be included. The Scene's `padding` prop adds CSS padding to the stage. This padding is around ALL content, not per-column. The stage padding affects the available viewport height for columns: `effectiveViewportHeight = viewportHeight - padding * 2`.

Update:
```tsx
const maxScroll = Math.max(0, contentHeight - (viewportHeight - padding * 2));
```

Read `padding` from `useSceneConfig()` (already available in SceneColumn).

### Tests to add:

- **Padding extends scroll range**: Scene with padding=16 and content at 1200px in 800px viewport. maxScroll should be 1200 - (800 - 32) = 432, not 400.
- **Padding can push content into overflow**: Content at 790px in 800px viewport with padding=16. Without padding it fits; with padding (effective height 768px) it overflows.

### Files affected:
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

## Commit 7: Scrollbar positioning per spec

**Spec scenarios addressed:**
- scene-scroll.feature: "scrollbar should appear at the right edge of the Camera" (lines 82-83)
- scene-scroll.feature: "other columns' scrollbars should appear between adjacent focused columns" (lines 87-88)

**What changes:**

Currently, each column renders its own `<Scrollbar>` inside itself (SceneColumn.tsx line 565). The scrollbar is positioned at `right: 0` of the column. This means with two columns, both scrollbars are at their own column's right edge.

The spec says:
- Single overflowing column: scrollbar at the Camera (viewport) right edge
- Multiple overflowing columns: rightmost at Camera right edge, others between adjacent focused columns

### Architecture change:

Move scrollbar rendering from `SceneColumn` to `SceneViewport` (inside `Scene.tsx`). SceneViewport already has the viewport ref and can position scrollbars relative to itself.

1. **SceneColumn** stops rendering `<Scrollbar>`. Instead, it exposes scroll state via data attributes (already does: `data-scroll-offset`, `data-max-scroll`, `data-content-height`).

2. **SceneViewport** collects scroll state from all focused columns (via DOM query of `[data-column-focused="true"][data-max-scroll]`) and renders scrollbars positioned:
   - Rightmost overflowing column: scrollbar at viewport right edge
   - Other overflowing columns: scrollbar between this column and its right neighbor

3. Need a way for the Scene-level scrollbar to call back into the column's scroll state. Options:
   - Dispatch a custom event on the column element (like the existing `columnscroll` pattern)
   - Lift scroll state to Scene level

   The simpler approach: keep scroll state in SceneColumn but have SceneViewport render the scrollbar UI. SceneViewport reads scroll position from data attributes and dispatches `columnscroll` events for drag updates.

   Actually, this gets complex with reactivity — data attributes don't trigger React re-renders in the parent. A cleaner approach: create a `ScrollStateContext` that columns register their scroll state into, and SceneViewport reads from it.

   Simplest approach: lift the Scrollbar rendering into SceneViewport. Pass scrollbar props via a new context that columns populate. The column provides `{ scrollOffset, maxScroll, onScroll }` to the context, keyed by column name. SceneViewport reads and positions.

### New context: `ScrollStateContext`

```typescript
interface ColumnScrollState {
  scrollOffset: number;
  maxScroll: number;
  onScroll: (offset: number) => void;
}
type ScrollStates = Map<string, ColumnScrollState>;
```

SceneColumn registers its scroll state. SceneViewport reads all registered states and renders scrollbars with correct positioning.

### Tests to update:

- **`"column taller than viewport gets a vertical scrollbar"`** (line 1583): Scrollbar is now rendered by SceneViewport, not inside the column. Query `[data-scrollbar]` from the scene element (should still work if scrollbar is in the viewport).
- **Scrollbar positioning tests**: Add new tests for multi-column scrollbar placement.

### Tests to add:

- **Single column: scrollbar at Camera right edge**: Verify scrollbar is positioned at the viewport's right edge, not the column's right edge.
- **Two columns: rightmost scrollbar at Camera right, left scrollbar between columns**: Verify positioning.

### Files affected:
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scene.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scrollbar.tsx`
- New: `/Users/nir/code/webdesserts/ui/src/components/scene/ScrollStateContext.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

## Commit 8: Scrollbar ARIA attributes

**Spec scenarios addressed:**
- Accessibility: proper scrollbar semantics

**What changes:**

### `Scrollbar.tsx`:

Add ARIA attributes to the scrollbar thumb:
```tsx
role="scrollbar"
aria-valuenow={Math.round(scrollOffset)}
aria-valuemin={0}
aria-valuemax={Math.round(maxScroll)}
aria-orientation="vertical"
aria-controls={columnId}  // ID of the column content wrapper
```

The track div gets the `role="scrollbar"` (not the thumb). The thumb is the visual indicator; the track is the interactive scrollbar widget.

### Tests to add:

- **Scrollbar has role="scrollbar"**: Query `[role="scrollbar"]` in the scene.
- **Scrollbar has correct aria-valuenow/min/max**: Verify values match scroll state.

### Files affected:
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scrollbar.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

## Commit 9: Consumer scroll override test

**Spec scenarios addressed:**
- scene-scroll.feature: "Consumer adds internal scroll to a SceneObject" (lines 229-234)

**What changes:**

The behavior likely already works: a SceneObject at `height: 100%` with `overflow-y: auto` handles its own scrolling. The column sees `contentHeight <= viewportHeight` (because the object is 100% of the viewport), so `maxScroll = 0`, no scrollbar. Wheel events fall through to the object's native scroll.

### Test to add:

- **Consumer internal scroll suppresses column scrollbar**: Render a SceneObject with `height: 100%; overflow-y: auto` containing tall content. Verify no `[data-scrollbar]` appears. Verify the content scrolls natively.

### Files affected:
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

## Commit 10: Debug mode — full overlay implementation

**Spec scenarios addressed:**
- scene-debug.feature: all scenarios (lines 1-67)

**What changes:**

### `Scene.tsx` — SceneDebugOverlay:

1. **Stage magenta outline** (currently missing): Add `outline: "2px solid magenta"` to the stage div when debug is enabled. Currently only the viewport has cyan outline (line 541).

2. **SceneObject colored outlines**: Render debug outlines on each SceneObject (green for focused, gray for unfocused) with name labels. This requires either:
   - CSS applied via the debug context to SceneObject
   - A debug overlay div positioned over each SceneObject

   Simplest: add to `SceneObject.tsx` — when debug is enabled (read from `useSceneConfig`), add an outline and a positioned label.

3. **Scroll area outlines**: Yellow outline around each scrollable column's scroll bounds area. Render in SceneViewport as positioned overlays.

4. **Camera state in overlay**: Add viewport width/height and Camera target bounds to the debug panel. Already partially there (viewport dimensions via `clientWidth`).

5. **Computed bounds per object**: Show each object's `getBoundingClientRect()` in the overlay. The existing overlay shows name + focused state but not bounds.

6. **Stacking depth for unfocused columns**: Already implemented (line 319-335 in Scene.tsx).

7. **offsetParent warnings**: Already implemented (line 262-274).

### `SceneObject.tsx`:

Add debug outline when `useSceneConfig().debug` is true:
```tsx
const { debug } = useSceneConfig();
// ... in the outer div:
style={{
  ...inColumnStyle,
  ...style,
  ...(debug ? {
    outline: `2px solid ${focused ? "#4ade80" : "#9ca3af"}`,
    outlineOffset: -2,
  } : {}),
}}
```

Add a positioned name label (small monospace text).

### Tests to update:

- **Existing debug tests**: Add assertions for magenta stage outline, SceneObject outlines, scroll area outlines.

### Tests to add:

- **Stage has magenta outline in debug mode**
- **Focused SceneObjects have green outline with name in debug mode**
- **Unfocused SceneObjects have gray outline with name in debug mode**
- **Scrollable columns have yellow scroll area outline in debug mode**
- **Overlay shows Camera state (viewport dimensions)**
- **Overlay shows computed bounds per object**
- **Debug toggles cleanly**: Enable then disable — all overlays disappear.

### Files affected:
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scene.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneObject.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

## Commit 11: Demo page update + final visual snapshots

**What changes:**

Update the demo page to verify all fixes work together visually. Add new visual snapshot tests that capture the full reworked system.

### Demo page updates:

- Depth deck demo should show greyscale + 3D depth effect
- Add a demo with within-column depth deck (A focused, B unfocused, C focused in same column)
- Verify outer unfocused columns are clipped (not opacity:0)
- Verify no overflow clipping on focused column content

### Visual snapshots to add:

1. **Scene with all column states**: Focused center, outer-left unfocused, outer-right unfocused, in-between depth deck. Full system test.
2. **3D depth deck close-up**: Two in-between columns with greyscale, opacity, and perspective depth.
3. **Content-sized columns**: Columns with different content widths showing content-based sizing.
4. **Within-column depth deck**: Focused/unfocused/focused objects in one column.
5. **Scroll with padding**: Tall content with scene padding, scrollbar visible.

### Files affected:
- `/Users/nir/code/webdesserts/ui/dev/pages/ScenePage.tsx`
- `/Users/nir/code/webdesserts/ui/tests/visual/scene.test.tsx`

---

## Risks and Decision Points

### Decision 1: Column positioning strategy

The analysis above went back and forth on whether outer unfocused columns should be in flex flow or absolute-positioned. The final recommendation is: **keep all unfocused columns `position: absolute`** (current approach), but **remove `opacity: 0`** and rely on viewport `overflow: hidden` for clipping. This minimizes the architectural change while fixing the spec gaps.

The alternative (keeping outer columns in flex flow) would be more spec-faithful but creates centering complexity — the stage would include unfocused column widths, throwing off `margin-inline: auto` centering of focused content.

**Needs user decision**: Is the absolute-positioned-but-visible approach acceptable, or must outer columns literally be in the DOM flow?

### Decision 2: 3D perspective viability

The spike tests pass, but the design note says "CSS perspective + translateZ doesn't work for stacking — getBoundingClientRect returns 0 inside preserve-3d containers." The spike tests show this is NOT true for absolute-positioned children with explicit dimensions. However, if there are edge cases we haven't hit, the fallback is CSS `scale` (current approach) + greyscale.

**Recommendation**: Proceed with perspective + translateZ. The spike tests are comprehensive. Fall back to scale only if we hit issues during implementation.

### Decision 3: ScrollStateContext complexity

Commit 7 (scrollbar positioning) introduces a new context for scroll state. This is medium complexity. An alternative is to keep scrollbars in columns but use CSS to reposition them (e.g., scrollbar is position: fixed relative to viewport). However, this is fragile with the column's own absolute positioning.

**Recommendation**: The context approach is cleaner and more maintainable. Proceed.

### Risk: Test volume

Many existing tests assert specific CSS values (`position: absolute`, `opacity: 0`, `flex: 1 1 0`) that will change. Estimated 10-15 test assertion updates in Commit 1 alone. The Coder needs to methodically update each one.

### Risk: Visual regressions

The removal of `overflow: hidden` on focused columns and `opacity: 0` on unfocused columns may cause visual artifacts that only show up in certain configurations. Visual snapshot tests are critical — the plan includes 5+ new snapshots to catch these.

---

## Summary

| Commit | Description | Tests (est.) | Files |
|--------|-------------|:---:|-------|
| 1 | Column positioning + sizing + no overflow:hidden | ~10 updated, ~3 new | 4 |
| 2 | Greyscale filter on depth-stacked columns | ~2 new | 3 |
| 3 | Real 3D depth (perspective + translateZ) | ~3 updated, ~1 new visual | 4 |
| 4 | Within-column depth deck visuals | ~4 new | 4 |
| 5 | Scroll position restore on refocus | ~3 new | 2 |
| 6 | Padding in scroll bounds | ~2 new | 2 |
| 7 | Scrollbar positioning per spec | ~4 updated, ~2 new | 5 |
| 8 | Scrollbar ARIA attributes | ~2 new | 2 |
| 9 | Consumer scroll override test | ~1 new | 1 |
| 10 | Debug mode full overlay | ~7 new | 3 |
| 11 | Demo page + final visual snapshots | ~5 new visuals | 2 |

Total: ~15 test updates, ~35 new tests, ~5 new visual snapshots.
