# Scene System Rework Plan

The current implementation has 271 tests but diverges from the spec in multiple architectural ways. This plan corrects all divergences in a dependency-ordered commit sequence. The spec files are the source of truth.

## Key Architectural Divergences (Current vs Spec)

| Area | Current Code | Spec Requirement |
|------|-------------|-----------------|
| Column flex | `flex: 1 1 0` (equal share) | `flex: 0 1 auto` (content-sized) |
| Unfocused positioning | ALL unfocused → `position: absolute` | Only in-between → absolute; outer stays in flex |
| Unfocused visibility | Outer unfocused → `opacity: 0` | No opacity:0 anywhere; viewport clips |
| Horizontal centering | `margin-inline: auto` on stage | Camera `scrollLeft` centers focused region |
| Column overflow | `overflow: hidden` on focused columns | No overflow hidden on columns; viewport clips |
| Depth effect | CSS `scale` transform | CSS `perspective` + `translateZ` (real 3D) |
| Depth greyscale | Not implemented | `filter: grayscale(depth * 0.25)` |
| Scroll restore | Not implemented | Save/restore per-object, spring-animated |
| Padding in scroll | Not implemented | `maxScroll = contentHeight + padding*2 - viewportHeight` |
| Scrollbar position | Column right edge | Camera right edge (single) / between columns (multi) |
| Scrollbar ARIA | Missing | `role="scrollbar"`, `aria-valuenow/min/max` on thumb |
| Within-column depth | Not implemented | Unfocused objects between focused siblings get depth treatment |
| Debug overlays | Partial | Full: column outlines, scroll areas, stage outline, computed bounds |
| Container queries | Not implemented | `container-type: size` on Camera viewport |

---

## Phase 1: Column Positioning Model (Commits 1a-1c)

This is the foundation. Everything else depends on it.

### Commit 1a: All columns stay in flex flow; content-sized by default

**Spec scenarios:**
- scene.feature lines 22-26: "All columns are always present and visible"
- scene.feature lines 28-31: "Column size is based on content by default"
- scene.feature lines 33-35: "Consumer can override column sizing via CSS"
- scene.feature lines 82-87: "Outer unfocused columns slide offscreen"
- scene.feature lines 89-93: "In-between unfocused columns stack as depth deck"
- scene-navigation.feature lines 96-100: "Outer unfocused column slides offscreen"

**The mental model shift:** The stage is a full-width flex row containing ALL columns in DOM order. Focused and unfocused columns alike stay `position: relative` in the flex row. Only in-between columns (depth deck) go `position: absolute` — they are the sole exception. Outer unfocused columns remain in flex flow at their frozen size; the viewport clips them.

#### `SceneColumn.tsx` changes:

1. **`focusedStyle` (line 436-448):** Change `flex: "1 1 0"` to `flex: "0 1 auto"`. Remove `overflow: "hidden"`. Remove the `width: ""`, `height: ""` resets (those will be handled by clearing frozenSize). Remove `minWidth: 0`.

   New focusedStyle:
   ```tsx
   const focusedStyle: React.CSSProperties = {
     position: "relative",
     flex: "0 1 auto",
     opacity: 1,
   };
   ```

2. **`unfocusedStyle` (line 455-461):** Split into three variants based on position:

   ```tsx
   // In-between: the ONLY case that exits flex flow
   const inBetweenStyle: React.CSSProperties = {
     position: "absolute",
     flex: "none",
     ...(frozenSize ? { width: frozenSize.width, height: frozenSize.height } : {}),
   };

   // Outer (left/right) and no-position: stay in flex flow with frozen size
   const outerStyle: React.CSSProperties = {
     position: "relative",
     flex: "0 0 auto",  // don't shrink — hold frozen width
     ...(frozenSize ? { width: frozenSize.width, height: frozenSize.height } : {}),
   };
   ```

   The column style selection becomes:
   ```tsx
   const columnStyle = columnFocused
     ? focusedStyle
     : position === "in-between"
       ? inBetweenStyle
       : outerStyle;
   ```

3. **Remove `opacity: 0` from all unfocused columns.** The `depthOpacity` calculation (line 495-499) changes:
   - In-between: `Math.max(0, 1 - stackDepth * 0.2)` (unchanged)
   - Outer-left/outer-right: `1` (was `0`)
   - No-position (all unfocused): `1` (unchanged)

4. **Remove `x: outerX` translation for outer columns (line 476-484).** Outer columns no longer need translateX — they are in the flex row, naturally positioned beyond the focused columns. The viewport clips them. Only in-between columns need `x: stackTargetLeft`.

   New animate:
   ```tsx
   animate={{
     opacity: depthOpacity,
     x: position === "in-between" ? stackTargetLeft : 0,
     scale: depthScale,
   }}
   ```

5. **Remove `overflow: "hidden"` from focusedStyle entirely.** Spec says clipping is at viewport only (scene-scroll.feature lines 16-20: "content is clipped at the viewport boundary, not at individual column boundaries").

#### `SceneObject.tsx` changes (line 90-96):

6. **Remove `opacity: 0` from unfocused SceneObjects.** Change line 95 from `{ position: "absolute", opacity: 0 }` to `{ position: "absolute" }`. The object is out of the column's flow (correct for vertical swap offset calculation), but visibility is governed by the viewport clip, not opacity.

#### `Scene.tsx` changes:

7. **Stage `width: "fit-content"` (line 572) stays.** With all columns in flow, the stage fits ALL columns' widths. This is correct — the stage is the full spatial row.

8. **Remove `margin-inline: "auto"` from stage (line 573).** Centering is now handled by Camera scrollLeft (see Commit 1b). The stage left-aligns within the viewport.

9. **Add `container-type: "size"` to the viewport div (line 536).** This gives consumers `cqw`/`cqh` units for responsive column sizing relative to the Camera viewport.

#### Tests to UPDATE (assertions change):

- **Line 238 (`"focused column has flex: 0 1 auto"`):** Change assertion from `flexGrow: "1"`, `flexBasis: "0px"` to `flexGrow: "0"`, `flexShrink: "1"`, `flexBasis: "auto"`.

- **Line 259 (`"unfocused column (never focused) has position: absolute and opacity: 0"`):** A never-focused column with no focused siblings has `position === null` (no-position). It stays `position: relative` with `opacity: 1`. Rename test to `"unfocused column (never focused, no siblings focused) stays relative with opacity 1"`. Assert `position: "relative"`, `opacity: "1"`.

- **Line 303 (`"mixed focused/unfocused"`):** With one focused column (left) and one unfocused (right), the unfocused column is classified as `outer-right`. It stays `position: relative`. Update assertion from `position: "absolute"` to `position: "relative"`.

- **Line 328 (`"two flexible focused columns share available width roughly equally"`):** With `flex: 0 1 auto`, columns size to content, not equally. Two columns with `minWidth: 100` will each be ~100px, NOT half the viewport. Update test to verify content-based sizing: each column should be approximately 100px wide. OR add consumer CSS `flex: 1 1 0` to opt into equal sharing and test that pattern instead.

- **Line 488 (`"focus change: previously focused becomes absolute"`):** The previously-focused column becomes outer-left (if there's a focused column to its right). Outer columns stay `position: relative`. Update assertion from `position: "absolute"` to `position: "relative"`.

- **Line 555 (`debug does not affect layout`):** If it checks `flexGrow: "1"`, update to `"0"`.

- **Line 2120 (`"unfocused column left of all focused slides offscreen left"`):** The column is now `position: relative` in flex flow with frozen width. It is offscreen because the Camera scrollLeft positions the viewport past it. The `rect.right <= 0` check needs to account for the Camera centering mechanism instead. This test changes fundamentally — the column is still in the DOM at a normal flex position, but the viewport scroll hides it.

- **Line 2152 (`"unfocused column right of all focused slides offscreen right"`):** Same change — column is in flex flow to the right, Camera doesn't scroll to show it.

- **Line 2229 (`"all unfocused — columns stay at last position"`):** Still valid — when all unfocused, Camera stays still, all columns keep frozen sizes in flex flow.

#### Tests to ADD:

- **Content-based column sizing (spec line 28-31):** A column with a 400px wide child should render at 400px, not stretch.
- **No overflow hidden on focused columns:** A focused column's box-shadow should extend past the column boundary and be visible in the viewport.
- **Outer columns are not opacity:0:** Verify outer-right column has `opacity: 1` but is outside the viewport rect (clipped, not hidden).
- **Adjacent columns position relative to column width (spec line 30):** Two columns with different content widths; verify the second starts where the first ends.

#### Visual snapshots to ADD:

- **Content-sized columns:** Scene with columns of different widths showing content-based sizing.
- **Outer columns clipped by viewport:** Scene with focused center, unfocused sides — unfocused sides visible in DOM but clipped by viewport overflow.

**Files:**
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneObject.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scene.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`
- `/Users/nir/code/webdesserts/ui/tests/visual/scene.test.tsx`

---

### Commit 1b: Camera scrollLeft for horizontal centering

**Spec scenarios:**
- scene.feature lines 197-200: "centered horizontally"
- scene-scroll.feature lines 181-183: "Content fits both axes — centered"
- scene-scroll.feature lines 185-188: "Focused column overflows vertically — centered horizontally"
- scene-scroll.feature lines 190-193: "Focused columns overflow horizontally — left-aligned"
- scene-scroll.feature lines 195-197: "Overflows both axes — top-left corner visible"
- scene-scroll.feature lines 199-209: alignment updates on viewport resize

**The mechanism:** The Camera viewport (`overflow-x: auto`) wraps the stage. The stage contains all columns in a flex row. To center the focused content within the viewport, the Camera computes:

1. Measure the focused region's position within the stage (leftmost focused column's left edge, rightmost focused column's right edge, relative to stage).
2. Compute the focused region width.
3. If focused region fits viewport: `scrollLeft = focusedRegionLeft - (viewportWidth - focusedRegionWidth) / 2`. This centers the focused region.
4. If focused region overflows viewport: `scrollLeft = focusedRegionLeft` (left-aligned).

This replaces `margin-inline: auto` on the stage.

#### `Scene.tsx` / `SceneViewport` changes:

1. **Remove `marginInline: "auto"` from stage style (line 573).** The stage left-aligns naturally.

2. **Add a `useLayoutEffect` that computes and sets `viewportRef.current.scrollLeft` after each render.** This runs after the focused region's position is known (columns have been measured). The logic:

   ```tsx
   useLayoutEffect(() => {
     const viewport = viewportRef.current;
     const stage = stageRef.current;
     if (!viewport || !stage) return;

     const focusedCols = Array.from(
       stage.querySelectorAll<HTMLElement>("[data-column-focused='true']"),
     );
     if (focusedCols.length === 0) return; // camera stays still

     const stageRect = stage.getBoundingClientRect();
     const first = focusedCols[0]!.getBoundingClientRect();
     const last = focusedCols[focusedCols.length - 1]!.getBoundingClientRect();

     // Focused region relative to stage
     const focusedLeft = first.left - stageRect.left;
     const focusedRight = last.right - stageRect.left;
     const focusedWidth = focusedRight - focusedLeft;

     const vpWidth = viewport.clientWidth;

     if (focusedWidth <= vpWidth) {
       // Center the focused region
       viewport.scrollLeft = focusedLeft - (vpWidth - focusedWidth) / 2;
     } else {
       // Left-align
       viewport.scrollLeft = focusedLeft;
     }
   });
   ```

   This also accounts for padding: the stage has CSS padding, so `stageRect` includes it. The focused columns' positions are inside the padding. The padding naturally shifts the focused region right, and the scrollLeft calculation keeps it visible.

3. **The existing focusKey scroll reset (line 444-453) can be simplified.** The useLayoutEffect above already sets scrollLeft correctly on every render. The focusKey-based reset is redundant — remove it. The scrollLeft is always computed from the focused layout.

#### Tests to UPDATE:

- **Line 1118 (`"fixed-width column is centered horizontally — stage has margin-inline: auto"`):** Rename. No longer checking margin-inline: auto. Instead verify that the content's `getBoundingClientRect()` shows it centered within the viewport. The content's left edge should be approximately `(viewportWidth - contentWidth) / 2`.

- **Line 1154 (`"content overflowing horizontally — stage left-aligns"`):** Update to verify content left edge is at viewport left edge (rect.left close to 0), NOT checking margin-left.

- **Line 1286 (`"small content — both axes centered in viewport"`):** Still valid — content should be centered. The mechanism changes (scrollLeft vs margin) but the visual result is the same. The rect-based check should still pass.

- **Line 1242 (`"viewport resize: centered content becomes left-aligned when it overflows"`):** Update to check rect position rather than margin-top (vertical centering via margin-top stays, horizontal centering now via scrollLeft).

#### Tests to ADD:

- **Horizontal centering via scrollLeft:** Verify `viewport.scrollLeft > 0` when a narrow column is centered in a wide viewport.
- **Focused region centered among unfocused:** Three columns, only center focused. Center column should be visually centered in viewport despite unfocused columns being in the flex row on either side.
- **Overflow left-aligns:** Three wide focused columns. Viewport scrollLeft should be 0 (left edge of focused region at viewport left edge).

**Files:**
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scene.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

### Commit 1c: Container queries on Camera viewport

**Spec decision #3:** Camera viewport is `container-type: size`. Consumers use `cqw`/`cqh`.

**Note:** `flex: 1` does NOT work on columns because the stage is `width: fit-content` — there is no extra space for flex-grow. All consumer sizing must be explicit widths, `cqw` units, or content-based.

#### `Scene.tsx` change:

Add `containerType: "size"` to the viewport div's style (alongside existing `display: "flex"`, etc.).

#### Tests to ADD:

- **Container query units work:** A column with `width: 50cqw` should be half the viewport width.
- **Column with `calc(100cqw - 300px)` fills remaining space** next to a 300px fixed column.

**Files:**
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scene.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

## Phase 2: 3D Depth + Greyscale (Commits 2a-2b)

### Commit 2a: Real 3D depth via perspective + translateZ

**Spec scenarios:**
- scene.feature lines 89-99: depth deck stacking, "scaled down slightly", "each successive column deeper"
- Scene System Design note: "CSS perspective on stage + translateZ on stacked columns creates real 3D depth"

**What changes:**

Replace CSS `scale` transform with `translateZ` for real 3D depth. The stage already has `perspective: "1000px"` and `transformStyle: "preserve-3d"` (from the spike). The spike tests (`tests/scene-perspective-spike.test.tsx`) confirmed:
- Perspective on flex container does not shift flex children layout
- translateZ shrinks elements visually via perspective projection
- `getBoundingClientRect` returns correct projected sizes for absolute children with translateZ inside preserve-3d
- Motion layout FLIP works inside perspective containers

#### `SceneColumn.tsx` changes:

1. **Replace `depthScale` (line 492):** Remove `const depthScale = isInBetween ? Math.max(0.1, 1 - stackDepth * 0.1) : 1;`

2. **Add `depthZ`:** `const depthZ = isInBetween ? -(stackDepth * 100) : 0;`

3. **Update animate prop (line 530):**
   ```tsx
   animate={{
     opacity: depthOpacity,
     x: position === "in-between" ? stackTargetLeft : 0,
     z: depthZ,
   }}
   ```
   Motion's `z` maps to `translateZ`.

4. **Remove `scale: depthScale`** from the animate prop.

#### `Scene.tsx` changes:

5. **Dynamic `perspectiveOrigin` on stage.** Set near the right focused column so stacked columns peek left naturally:
   ```tsx
   perspectiveOrigin: `${stackTargetLeft + rightFocusedColWidth / 2}px 50%`
   ```
   This requires measuring the rightmost focused column's width. The `stackTargetLeft` already measures its left edge. Add a `stackTargetCenter` or pass width alongside.

#### Tests to UPDATE:

- **Line 2353 (`"in-between column appears smaller than natural size"`):** Test currently uses `getBoundingClientRect` to compare. This should still work with translateZ — the spike confirms projected sizes are correct for absolute children. The test compares `middleRect.width < 300` — still valid.

- **Line 2388 (`"multiple in-between columns: deeper columns appear further back"`):** Still valid — deeper translateZ = smaller projected size.

#### Tests to ADD:

- **Transform string contains translateZ:** Verify the in-between column's transform includes `translateZ(-100px)` (or `translate3d(... , -100px)`), NOT `scale(0.9)`.

#### Visual snapshot to ADD:

- **3D depth deck:** Scene with 2 focused outer columns, 2 unfocused in-between. The perspective effect should create a compelling depth visual with natural size reduction and peeking.

**Files:**
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scene.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`
- `/Users/nir/code/webdesserts/ui/tests/visual/scene.test.tsx`

---

### Commit 2b: Greyscale filter on depth-stacked columns

**Spec scenarios:**
- scene.feature lines 126-135: "lower opacity and more greyscale", "Stacking depth scales opacity and greyscale"

#### `SceneColumn.tsx` changes:

Add `filter: grayscale(...)` to the animate prop for in-between columns:

```tsx
const depthGreyscale = isInBetween ? stackDepth * 0.25 : 0;

animate={{
  opacity: depthOpacity,
  x: position === "in-between" ? stackTargetLeft : 0,
  z: depthZ,
  filter: `grayscale(${depthGreyscale})`,
}}
```

Motion supports animating `filter` as a string.

#### Tests to ADD:

- **Depth-1 column has greyscale applied:** Check computed `filter` includes `grayscale(0.25)`.
- **Deeper columns have more greyscale:** Depth-2 has `grayscale(0.5)`, depth-1 has `grayscale(0.25)`.

#### Visual snapshot to ADD:

- **Greyscale depth deck:** Extends the 3D depth deck snapshot — the greyscale effect should be visible on unfocused stacked columns.

**Files:**
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`
- `/Users/nir/code/webdesserts/ui/tests/visual/scene.test.tsx`

---

## Phase 3: Within-Column Depth Deck (Commit 3)

### Commit 3: Unfocused objects between focused siblings get depth treatment

**Spec scenarios:**
- scene-navigation.feature lines 61-66: "Object B should be positioned under Object C... peek out above and be scaled down for depth"
- scene-navigation.feature lines 68-71: "Multiple unfocused objects between focused objects stack with depth"

**What changes:**

Within a column, unfocused objects between two focused objects should receive the same depth visual treatment as column-level stacking: position, z-index, translateZ (or scale), opacity, greyscale, and peek from the top (vertical equivalent of the horizontal peek for columns).

#### `SceneColumn.tsx` changes:

1. **Add `computeObjectPositions` function** (parallel to `computeColumnPositions` in Scene.tsx). Classifies objects within a column as `"above"` (before first focused), `"below"` (after last focused), `"in-between"` (between two focused), or `null` (focused).

2. **Add `computeObjectDepths` function** for depth indices of in-between objects within a column.

3. **Pass classification and depth to SceneObject via ColumnContext:**
   ```typescript
   interface ColumnRegistration {
     // ... existing fields ...
     objectPosition: Map<string, "above" | "below" | "in-between" | null>;
     objectDepth: Map<string, number>;
   }
   ```

#### `SceneObject.tsx` changes:

4. **Read position and depth from ColumnContext.** When `position === "in-between"`:
   - `z: -(depth * 100)` for translateZ depth effect
   - `opacity: 1 - depth * 0.2`
   - `filter: grayscale(depth * 0.25)`
   - `zIndex: 100 - depth`
   - Small `translateY` to peek from the top of the lower focused object
   - Keep `position: absolute` (already the case for unfocused objects in a focused column)

5. **"Above" and "below" unfocused objects:** No depth treatment. They are simply positioned out of flow via `position: absolute` and slid away by the column's `top` offset (existing behavior).

#### Tests to ADD:

- **In-between object has depth treatment:** Column with A (focused), B (unfocused), C (focused). B should have reduced opacity, greyscale, and scale.
- **Multiple in-between objects stack with increasing depth:** A (focused), B (unfocused), C (unfocused), D (focused). B and C should have increasing depth.
- **Above/below objects don't get depth treatment:** Only in-between.
- **Gap between focused objects is configurable (spec line 66):** Verify objectGap prop creates space between A and C.

#### Visual snapshot:

- **Within-column depth deck:** Focused A and C with unfocused B peeking between them.

**Files:**
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneObject.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`
- `/Users/nir/code/webdesserts/ui/tests/visual/scene.test.tsx`

---

## Phase 4: Scroll Fixes (Commits 4a-4d)

### Commit 4a: Scroll position restore on refocus

**Spec scenarios:**
- scene-scroll.feature lines 138-145: "column should attempt to restore its previous scroll position"
- scene-scroll.feature lines 157-161: "Vertical swap restores per-object scroll position"

#### `SceneColumn.tsx` changes:

1. **Add `savedScrollPositions` ref:** `useRef<Map<string, number>>(new Map())` — keyed by the focused object name (not column name) so vertical swaps restore per-object positions.

2. **On focus loss (in the `columnFocused` effect, line 342-372):** Save `scrollOffsetRef.current` keyed by the currently focused object's name. Determine the focused object name from `objectStates`.

3. **On focus gain:** Look up saved position for the newly focused object. Restore logic:
   - If saved position exists AND the focused object would be visible at that position: restore (spring-animated via `setScrollOffset`).
   - If saved position exists but focused object not visible: scroll to show the focused object (top of focused content).
   - If the column has drastically resized since last focused (content height changed by more than viewport height): fall back to top.
   - If no saved position: start at 0 (top).

4. **Spring-animated restore:** The `motion animate={{ top: combinedTop }}` already spring-animates. Setting `scrollOffset` to the restored value will smoothly animate to that position.

#### Tests to ADD:

- **Scroll position saves and restores:** Scroll column A to 200px, switch focus to column B, switch back to A — scroll restores to 200px.
- **Vertical swap restores per-object position:** Object A scrolled to 100px, swap to Object B (at 0), swap back to A — A restores to 100px.
- **Restore adjusts if focused object not visible:** Column with Object A scrolled to 300px (but A is only 200px tall), swap to Object B, swap back — adjust to show A.
- **First focus starts at top (spec line 152-155):** An unfocused column with no prior scroll position starts at 0 when first focused.

**Files:**
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

### Commit 4b: Padding in scroll bounds

**Spec scenarios:**
- scene-scroll.feature lines 127-128: "scroll range should include padding"
- scene-scroll.feature lines 130-134: "Padding can push content into overflow"

#### `SceneColumn.tsx` changes:

Update `maxScroll` calculation (line 193). The Scene's `padding` prop adds CSS padding to the stage. Padding reduces the effective viewport height available for each column.

```tsx
const { padding } = useSceneConfig(); // already available
const maxScroll = Math.max(
  0,
  columnFocused && viewportHeight > 0
    ? contentHeight - (viewportHeight - padding * 2)
    : 0,
);
```

#### Tests to ADD:

- **Padding extends scroll range:** Scene with `padding={16}` and content at 1200px in 800px viewport. `maxScroll` should be `1200 - (800 - 32) = 432`, not `400`. Check via `data-max-scroll` attribute.
- **Padding can push content into overflow:** Content at 790px in 800px viewport with `padding={16}`. Without padding it fits (no scrollbar); with padding the effective viewport is 768px, so it overflows (scrollbar appears).

**Files:**
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

### Commit 4c: Scrollbar positioning per spec

**Spec scenarios:**
- scene-scroll.feature lines 80-89: scrollbar position rules

**Architecture change:** Move scrollbar rendering from `SceneColumn` to `SceneViewport` (inside `Scene.tsx`). SceneViewport has the viewport ref and can position scrollbars relative to itself.

#### New file: `ScrollStateContext.tsx`

```typescript
interface ColumnScrollState {
  scrollOffset: number;
  maxScroll: number;
  contentHeight: number;
  onScroll: (offset: number) => void;
}

// Map<columnName, ColumnScrollState>
const ScrollStateContext = createContext<{
  register: (name: string, state: ColumnScrollState) => void;
  unregister: (name: string) => void;
  states: Map<string, ColumnScrollState>;
}>(/* ... */);
```

#### `SceneColumn.tsx` changes:

1. **Remove `<Scrollbar>` rendering** from SceneColumn (lines 565-575).
2. **Register scroll state** with ScrollStateContext on each render when scrollable.
3. **Keep all scroll logic** (wheel handler, keyboard handler, scrollOffset state) — only the visual scrollbar moves.

#### `Scene.tsx` / `SceneViewport` changes:

1. **Wrap children with ScrollStateContext.Provider.**
2. **Render scrollbars** based on registered scroll states, positioned:
   - **Single overflowing column:** Scrollbar at viewport right edge (`position: absolute; right: 0; top: 0`).
   - **Multiple overflowing columns:** Rightmost scrollbar at viewport right edge. Other scrollbars positioned between adjacent focused columns (measure column boundaries to compute x position).

#### `Scrollbar.tsx` changes:

3. **Add optional `left` prop** for horizontal positioning (when between columns).
4. **Keep existing drag/click logic unchanged.**

#### Tests to UPDATE:

- **Line 1583+ (scrollbar tests):** Query `[data-scrollbar]` from the scene element (not column). Should still work since scrollbar is now in viewport div.

#### Tests to ADD:

- **Single column: scrollbar at Camera right edge.** Verify scrollbar's `getBoundingClientRect().right` matches viewport's right edge.
- **Two overflowing columns: scrollbar positioning.** Rightmost at Camera right edge, left column's scrollbar between the two columns.

**Files:**
- New: `/Users/nir/code/webdesserts/ui/src/components/scene/ScrollStateContext.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scene.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scrollbar.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

### Commit 4d: Scrollbar ARIA attributes

**Decision #13:** `role="scrollbar"`, `aria-valuenow/min/max` on the thumb element.

#### `Scrollbar.tsx` changes:

Add to the thumb div (not the track — the thumb is the interactive indicator):

```tsx
role="scrollbar"
aria-valuenow={Math.round(scrollOffset)}
aria-valuemin={0}
aria-valuemax={Math.round(maxScroll)}
aria-orientation="vertical"
```

#### Tests to ADD:

- **Scrollbar thumb has `role="scrollbar"`:** Query `[role="scrollbar"]` in scene.
- **aria-valuenow matches scroll offset:** Scroll to 200px, verify `aria-valuenow="200"`.
- **aria-valuemax matches maxScroll.**

**Files:**
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scrollbar.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

## Phase 5: Debug Mode (Commit 5)

### Commit 5: Full debug overlay implementation

**Spec scenarios:**
- scene-debug.feature: all scenarios (lines 1-67)

**What exists:** Viewport cyan outline, debug panel with object names/focus states, column stacking info, vertical scroll info, horizontal scroll info, offsetParent warnings. **Missing:** Stage magenta outline, SceneObject colored outlines with names, scroll area outlines (yellow), Camera state (viewport dimensions + target bounds), computed bounds per object.

#### `Scene.tsx` changes:

1. **Stage magenta outline (spec line 14):** Add `outline: debug ? "2px solid magenta" : undefined` to the stage div's style (line 563-577).

2. **Scroll area outlines (spec line 22-25):** Render yellow-outlined overlay divs in SceneViewport for each scrollable column. The overlay shows the scroll bounds area (column position x viewport height). These are positioned absolute within the viewport.

3. **Camera state in overlay (spec line 39-41):** Add viewport width/height to the debug panel. Already partially there (shows `clientWidth` in h-scroll section). Add explicit section: `Camera: {width}x{height}` and target bounds.

4. **Computed bounds per object (spec line 35-37):** Enhance the objects section in the debug panel to include `getBoundingClientRect()` for each object. This requires reading from the DOM in the overlay component.

#### `SceneObject.tsx` changes:

5. **SceneObject colored outlines (spec lines 18-19):** When debug is enabled (read from `useSceneConfig()`), add to the outer wrapper:
   ```tsx
   outline: `2px solid ${focused ? "#4ade80" : "#9ca3af"}`
   ```
   And a positioned name label (top-left corner, small monospace text).

#### Tests to UPDATE:

- **Existing debug tests (line 536+):** Add assertions for magenta stage outline.

#### Tests to ADD:

- **Stage has magenta outline in debug mode.**
- **Focused SceneObjects have green outline with name label in debug mode.**
- **Unfocused SceneObjects have gray outline with name label in debug mode.**
- **Scrollable columns have yellow scroll area outline in debug mode.**
- **Overlay shows Camera state (viewport dimensions).**
- **Overlay shows computed bounds per object.**
- **Debug toggles cleanly (spec line 67):** Enable then disable — all overlays and outlines disappear.
- **Debug does not affect layout (spec line 29-30):** Already exists (line 555); verify it still passes with new outlines (outlines don't participate in layout).

**Files:**
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scene.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneObject.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

## Phase 6: Consumer Scroll Override + Demo (Commits 6a-6b)

### Commit 6a: Consumer scroll override test

**Spec scenarios:**
- scene-scroll.feature lines 229-234: "Consumer adds internal scroll to a SceneObject"

The behavior should already work by accident: a SceneObject at `height: 100cqh` with `overflow-y: auto` handles its own scrolling. The column sees `contentHeight <= viewportHeight`, so `maxScroll = 0`, no scrollbar. Wheel events fall through to the object's native scroll.

#### Test to ADD:

- **Consumer internal scroll suppresses column scrollbar:** Render a SceneObject with `height: 100cqh; overflow-y: auto` containing tall content inside a Scene. Verify no `[data-scrollbar]` appears. Verify the SceneObject's native scroll works (wheel event scrolls the content).

**Files:**
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`

---

### Commit 6b: Demo page update + final visual snapshots

Update the demo page to show the reworked system. Add comprehensive visual snapshots.

#### Demo page updates:

- Update depth deck demo to use 3D perspective + greyscale (should happen automatically with the code changes)
- Add within-column depth deck demo (A focused, B unfocused, C focused in same column)
- Remove consumer-side `opacity`/`grayscale` styling on unfocused panels (the Scene handles it now)
- Add debug mode toggle

#### Visual snapshots to ADD:

1. **Full system: all column states** — focused center, outer-left unfocused, in-between depth deck, outer-right unfocused.
2. **3D depth deck with greyscale** — close-up of 2 stacked columns showing perspective + greyscale.
3. **Within-column depth deck** — focused/unfocused/focused objects in one column.
4. **Scroll with padding** — tall content with scene padding, scrollbar visible at Camera right edge.
5. **Content-sized vs flexible columns** — side-by-side comparison.

**Files:**
- `/Users/nir/code/webdesserts/ui/dev/pages/ScenePage.tsx`
- `/Users/nir/code/webdesserts/ui/tests/visual/scene.test.tsx`

---

## Commit Dependency Graph

```
Phase 1 (foundation — sequential):
  1a: Column positioning model
   └─ 1b: Camera scrollLeft centering
       └─ 1c: Container queries

Phase 2 (can start after 1a):
  2a: 3D depth (perspective + translateZ)
   └─ 2b: Greyscale filter

Phase 3 (after 2a for the translateZ pattern):
  3: Within-column depth deck

Phase 4 (after 1b for scroll + centering):
  4a: Scroll position restore
  4b: Padding in scroll bounds
  4c: Scrollbar positioning (after 4a and 4b)
   └─ 4d: Scrollbar ARIA

Phase 5 (after all of above):
  5: Debug mode

Phase 6 (after everything):
  6a: Consumer scroll override test
  6b: Demo page + final visual snapshots
```

## Estimated Impact

| Metric | Estimate |
|--------|----------|
| Tests to update (assertion changes) | ~15-20 |
| Tests to add | ~35-40 |
| Visual snapshots to add | ~8 |
| Files modified | ~8 |
| Files created | 1 (ScrollStateContext.tsx) |
| Lines of test code | ~500-700 new |
| Lines of implementation | ~200 net change (some added, some removed) |

## Risks

1. **`getBoundingClientRect` inside `preserve-3d`:** The spike tests confirm it works for absolute-positioned children with explicit dimensions. The rework changes outer columns to `position: relative` in flex flow — need to verify `getBoundingClientRect` still returns correct values for flex children inside `preserve-3d`. The spike test Q1 shows flex children are unaffected by perspective, so their rects should be fine. Only in-between (absolute + translateZ) children have projected sizes.

2. **Camera scrollLeft reactivity:** The `useLayoutEffect` that sets `scrollLeft` runs synchronously after render. But if the focused columns haven't been painted yet, `getBoundingClientRect` might return stale values. This is unlikely since `useLayoutEffect` fires after DOM updates but before paint — the element positions should be current. If it's a problem, add a `requestAnimationFrame` wrapper.

3. **Overflow hidden removal from columns:** Without `overflow: hidden` on focused columns, unfocused SceneObjects within a column (positioned via `position: absolute` and slid away by `top` offset) will be visible above/below the column area. They will only be clipped by the viewport's `overflow: hidden`. This is correct per spec ("content is clipped at the viewport boundary") but may look odd if the unfocused content peeks between two focused columns. The within-column depth deck (Commit 3) mitigates this by giving in-between objects depth treatment.

4. **Test volume:** ~15-20 tests need assertion changes in Commit 1a alone. Risk of getting tests into a broken intermediate state. Mitigation: the Coder should update tests in the same commit as the implementation, running the full suite after each commit.

5. **Motion's `z` prop:** Need to verify that motion supports `z` in the `animate` prop to generate `translateZ`. If not, use `transform: \`translateZ(${depthZ}px)\`` as a style prop, not an animated value. The motion docs show `z` is supported for 3D transforms.
