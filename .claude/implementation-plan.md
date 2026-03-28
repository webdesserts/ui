# Scene System Implementation Plan

> Rewrite of the Scene spatial navigation system on the `camera` branch.
> Source of truth: `specs/scene.feature`, `specs/scene-scroll.feature`, `specs/scene-navigation.feature`, `specs/scene-debug.feature`, and the [[Scene System Design]] note.

## Strategy: Clean Rewrite

The existing Scene/SceneColumn/SceneObject/SceneScrollView components (~920 lines) and tests (~1785 lines) will be **deleted and rewritten from scratch**. The current implementation uses inline styles + CSS transitions for all positioning, centering, and swaps. The new architecture uses:

- **`motion` library** for FLIP layout animations and spring physics on all transitions
- **CSS flexbox** for focused column layout (no transforms on focused content at rest)
- **Pure JS scroll state** per column with custom scrollbar component (no proxy divs, no overflow-y)
- **CSS `perspective`** + `translateZ` for depth deck stacking visuals
- **Native `overflow-x`** for horizontal camera movement
- **`margin-inline: auto`** and **`margin-top`** for centering (no transforms on focused at rest)

### Key Architectural Differences from Current Code

| Concern | Current | New |
|---------|---------|-----|
| Focused layout | CSS `flex` + inline `style.flex` | `motion.div` with `layout` prop, CSS flex |
| Unfocused positioning | `position: absolute` + inline style | `motion.div` with `animate={{ x, y, scale, opacity }}` |
| Vertical swap | `translateY` + CSS transition + RAF phasing | motion spring on column content `top` offset |
| Centering | `CenteringContext` + `transform: translate()` on columns | `margin-inline: auto` on stage, `margin-top` on column content |
| Horizontal scroll | `overflow-x: auto` on viewport div | `overflow-x: auto` on horizontal scroll wrapper around stage |
| Vertical scroll | SceneScrollView (deprecated stub) | Pure JS scroll state per column, wheel events on Camera, custom scrollbar component |
| Size freeze | `useState<FrozenStyle>` + inline width/height | ResizeObserver captures, motion `animate` from frozen to flex |
| Spring physics | CSS `transition-duration` | motion springs with `stiffness`/`damping` or `duration: 0` for tests |

### File Structure (New)

```
src/components/scene/
  Scene.tsx          — Scene component, SceneContext, auto-wrapping
  SceneObject.tsx    — SceneObject component, registration, inert wrapper
  SceneColumn.tsx    — SceneColumn component, focus derivation, vertical content
  SceneStage.tsx     — Internal flex container for focused columns (the "stage")
  SceneViewport.tsx  — Internal viewport wrapper, horizontal scroll, centering
  Scrollbar.tsx      — Custom scrollbar component (track + thumb, positioned per column)
  useCamera.tsx      — CameraContext + useCamera hook
  useSceneConfig.tsx — Shared config context (springs, padding, duration, debug)
  types.ts           — Shared types (SceneEntry, FrozenSize, etc.)
  index.ts           — Re-exports

tests/
  scene.test.tsx           — Behavioral tests (rewritten)
  visual/scene.test.tsx    — Visual snapshot tests (rewritten)

dev/pages/ScenePage.tsx    — Updated demo
```

### motion Usage Pattern

```tsx
// Focused column — layout FLIP animation, no transforms at rest
<motion.div layout style={{ flex: "0 1 auto" }} transition={spring}>
  {children}
</motion.div>

// Unfocused column — animate to absolute position with spring
<motion.div
  layout
  animate={{ x: offscreenX, scale: 0.95, opacity: 0.5 }}
  transition={spring}
  style={{ position: "absolute", width: frozenWidth, height: frozenHeight }}
>
  {children}
</motion.div>
```

motion's `layout` prop handles FLIP: it measures DOM position before and after React renders, then animates the delta. When `layout` and `animate` are on the same element, motion composes them (confirmed in source analysis). The transform is removed at rest for focused elements.

### Test Duration Strategy

- **Non-animation tests**: `duration={0}` on Scene — motion skips all springs, transitions are instant
- **Animation-specific tests**: Use real spring duration + `waitForSpring()` (2000ms setTimeout)
- **Visual tests**: `duration={0}` unless specifically testing animation frames

---

## Phase 0: Clean Slate + Shells

**Goal**: Delete old code, set up new file structure with minimal shells that compile and pass trivial tests. Establish the DOM structure that all subsequent phases build on.

### Spec Scenarios Unlocked
- "All columns are visible on initial render" (partial — no focus yet)
- "Column size is based on content by default" (partial)

### Commits

#### Commit 0a: Delete old implementation, create new file structure

**Files to delete:**
- `/Users/nir/code/webdesserts/ui/src/components/Scene.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/SceneColumn.tsx`
- `/Users/nir/code/webdesserts/ui/src/components/SceneScrollView.tsx`
- `/Users/nir/code/webdesserts/ui/tests/scene.test.tsx`
- `/Users/nir/code/webdesserts/ui/tests/visual/scene.test.tsx`
- All visual screenshot baselines in `tests/visual/__screenshots__/scene.test.tsx/`

**Files to create (shells):**
- `/Users/nir/code/webdesserts/ui/src/components/scene/types.ts` — `SceneEntry`, `FrozenSize` types
- `/Users/nir/code/webdesserts/ui/src/components/scene/useSceneConfig.tsx` — Config context with `stiffness`, `damping`, `padding`, `duration`, `debug`
- `/Users/nir/code/webdesserts/ui/src/components/scene/useCamera.tsx` — `CameraState`, `CameraContext`, `useCamera()` hook
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneObject.tsx` — Shell: renders a div with `data-scene-id`, `data-focused`, inner `inert` wrapper
- `/Users/nir/code/webdesserts/ui/src/components/scene/SceneColumn.tsx` — Shell: renders a div with `data-column`, `data-column-focused`, children
- `/Users/nir/code/webdesserts/ui/src/components/scene/Scene.tsx` — Shell: SceneContext, auto-wrapping, renders children in a simple flex row
- `/Users/nir/code/webdesserts/ui/src/components/scene/index.ts` — Re-exports

**Files to modify:**
- `/Users/nir/code/webdesserts/ui/src/index.ts` — Update imports to point at `./components/scene`

**Tests to write (TDD):**
- `tests/scene.test.tsx`:
  - "SceneObject renders with data-scene-id attribute"
  - "SceneObject renders with data-focused=true when focused"
  - "SceneObject renders with data-focused=false when unfocused"
  - "Unfocused SceneObject content is inert"
  - "Focused SceneObject content is not inert"
  - "SceneColumn renders with data-column attribute"
  - "Bare SceneObjects are auto-wrapped in implicit SceneColumns"
  - "SceneColumns pass through without wrapping"

**DOM structure after this phase:**
```html
<div data-testid="scene"> <!-- Scene -->
  <div data-column="nav" data-column-focused="true"> <!-- SceneColumn -->
    <div data-scene-id="panel" data-focused="true"> <!-- SceneObject outer -->
      <div> <!-- inert wrapper (inert only when unfocused) -->
        <!-- consumer content -->
      </div>
    </div>
  </div>
</div>
```

---

## Phase 1: Focused Flex Layout + Unfocused Freeze

**Goal**: Focused columns participate in a CSS flex row. Unfocused columns freeze at last size and exit flow with `position: absolute`. motion `layout` prop animates transitions.

### Spec Scenarios Unlocked
- "Single focused object"
- "Multiple focused objects in separate columns"
- "Multiple columns can be focused simultaneously"
- "Focused objects share available width"
- "Focused object with max-width"
- "Adding focus reshapes the layout"
- "Removing focus lets siblings expand"
- "Unfocused objects remain in the DOM"
- "Unfocused objects freeze at their last size"
- "Re-focusing animates from frozen size"
- "Focus changes"
- "Focused object unmounts"
- "Consumer CSS changes cause layout reflow"
- "Fixed and flexible columns coexist"
- "Focusing a new column reshapes siblings"
- "Mixed sizing in the same layout"
- "Column with no focused objects"
- "Focused columns share viewport width"

### Commits

#### Commit 1a: Tests for focused flex layout

Write failing tests:
- "Focused column has flex: 0 1 auto and position: relative"
- "Unfocused column (never focused) has position: absolute and opacity: 0"
- "Two focused columns both participate in flex row"
- "Focused SceneObject inside column does not own flex shorthand"
- "Mixed focused/unfocused — focused is relative, unfocused is absolute"
- "Two flexible focused objects share viewport width" (assert each gets ~50%)
- "Fixed-width column + flexible column coexist" (assert fixed stays fixed, flexible fills rest)

#### Commit 1b: Implement focused flex layout

**SceneColumn changes:**
- Derive `hasAnyFocusedChild` from child registrations (same pattern as current)
- Focused: `motion.div` with `layout` prop, `style={{ flex: "0 1 auto", minWidth: 0, position: "relative" }}`
- Unfocused (never focused): `position: absolute`, `opacity: 0`
- Use `motion.div` with `layout` to get FLIP animations on focus transitions

**Scene changes:**
- Viewport div is a flex row: `display: flex`, `flexDirection: row`, `alignItems: stretch`, `width: 100%`, `height: 100%`
- `transition` prop from `useSceneConfig` applied to all motion.divs

#### Commit 1c: Tests for unfocused freeze

Write failing tests:
- "Column freezes at last dimensions when all children lose focus" (width/height > 0 on frozen)
- "Unfocused column stays in DOM"
- "Re-focusing column animates from frozen size back to flex layout"
- "Focus change: previously focused becomes absolute, newly focused becomes relative"

#### Commit 1d: Implement unfocused freeze

- ResizeObserver on column captures `lastFocusedSize` while focused
- On focus loss: set `frozenSize` state, column switches to `position: absolute` with `width: frozenSize.width`, `height: frozenSize.height`
- On re-focus: clear `frozenSize`, motion `layout` FLIP-animates from frozen position back to flex

#### Commit 1e: Debug — basic outlines and object state overlay

Add `debug` prop to Scene. When enabled:
- Camera viewport: cyan CSS outline
- Focused SceneObjects: green outline with name label
- Unfocused SceneObjects: gray outline with name label
- Overlay panel (fixed, bottom-right): lists each object's name, focused state, and computed bounds
- "Debug does not affect layout" test
- "Debug disabled — no overlays present" test

This gives visibility into flex layout and freeze behavior as we develop subsequent phases.

#### Commit 1f: Visual tests for flex layout

- "Single focused column centered" (screenshot)
- "Two focused columns side by side" (screenshot)
- "One focused, one unfocused" (screenshot — unfocused hidden since never focused)

---

## Phase 2: SceneColumn Internals — Vertical Stacking and Swaps

**Goal**: Multiple objects within a column. Vertical swap animation using motion springs. Multi-focus stacking.

### Spec Scenarios Unlocked
- "Column displays one focused object"
- "Vertical swap pushes the column to show the new object"
- "Vertical swap direction follows DOM order"
- "Sibling columns unaffected by vertical swaps"
- "Multiple focused objects in a column stack vertically"
- "Unfocusing an extended object shrinks the column"
- "Vertical extension becomes one scrollable column" (partial — scroll comes in Phase 5)
- "Replacing content within a column"
- "Objects fill column width by default"

### Commits

#### Commit 2a: Tests for vertical swap

Write failing tests:
- "Vertical swap changes focused state correctly"
- "Ascending swap — new object appears below" (after spring settles, new object is visible)
- "Descending swap — new object appears above" (after spring settles)
- "Sibling column unaffected by vertical swap"
- "Instant swap with duration=0 — no lingering transforms"
- "Swap completes — outgoing object freezes"

#### Commit 2b: Implement vertical swap

**Approach**: The column content wrapper has a spring-animated `top` offset. When focus swaps from A to B:
1. Measure B's offset relative to column top
2. Spring-animate column content `top` to `-B.offsetTop` so B slides into view
3. After settling, A freezes (position: absolute, opacity: 0 within column)

This replaces the old RAF-phased translateY approach. motion springs handle retargeting naturally.

- Column renders a `motion.div` content wrapper with `animate={{ top: -focusedObjectOffset }}`
- Each SceneObject within a column registers its DOM element
- Column measures focused child's `offsetTop` to compute the `top` offset

#### Commit 2c: Tests for multi-focus stacking

Write failing tests:
- "Two focused objects in a column are both visible and stacked vertically"
- "Three focused objects all stack in DOM order"
- "Unfocusing one of two leaves the other visible"
- "Column height adjusts when focused count changes"

#### Commit 2d: Implement multi-focus stacking

- When multiple children are focused, column content `top` is 0 (show from top)
- All focused children are `position: relative` in the column's flex-column layout
- Unfocused children between focused children are `position: absolute`, `opacity: 0`

#### Commit 2e: Visual tests for column behavior

- "Vertical swap result" (screenshot — post-swap state)
- "Multi-focus stacking" (screenshot — two objects stacked vertically)

---

## Phase 3: Centering and Alignment

**Goal**: Per-axis centering when content fits the viewport. No transforms on focused content at rest.

### Spec Scenarios Unlocked
- "Content fits both axes — centered"
- "Focused column overflows vertically — starts at top, centered horizontally"
- "Focused columns overflow horizontally — left-aligned, centered vertically"
- "Overflows both axes — top-left corner visible"
- "Alignment updates on viewport resize — fit to overflow"
- "Alignment updates on viewport resize — overflow to fit"
- "Flexible width, flexible height (Small panel pattern)"
- "Max-width on flexible content in wide viewport"

### Commits

#### Commit 3a: Tests for centering

Write failing tests:
- "Small content is centered horizontally and vertically in viewport"
- "Overflowing width — content is left-aligned"
- "Overflowing height — content starts at top, centered horizontally"
- "Overflows both axes — top-left corner visible"
- "Max-width column is centered with equal margins"

#### Commit 3b: Implement centering

**Horizontal centering**: `margin-inline: auto` on the stage div (the flex row container inside the viewport). When the stage is narrower than the viewport, auto margins center it. When it overflows, margins collapse to 0.

**Vertical centering (per-column)**: Each focused column content wrapper gets `margin-top: max(0, (viewportHeight - columnContentHeight) / 2)`. Computed via ResizeObserver on both viewport and column content. When content overflows, margin-top is 0.

No transforms on focused content. The centering uses margin, which doesn't degrade text rendering.

**Implementation:**
- `SceneViewport.tsx` — internal component wrapping the stage. Measures viewport size via ResizeObserver. Provides viewport dimensions via context.
- Stage div gets `margin-inline: auto`
- Each column reads viewport height from context, measures its own content height, applies `margin-top`

#### Commit 3c: Tests for alignment updates on resize

Write failing tests:
- "Viewport shrinks — centered content becomes left-aligned when it overflows"
- "Viewport grows — overflowing content becomes centered when it fits"

#### Commit 3d: Implement dynamic alignment

- Centering margins recompute on viewport resize (ResizeObserver already fires)
- No special code needed if margin computation is reactive to viewport dimensions

#### Commit 3e: Visual tests for centering

- "Small content centered in 400x300 viewport" (screenshot)
- "Overflowing content at top-left" (screenshot)

---

## Phase 4: Horizontal Scroll (Camera Movement)

**Goal**: Native `overflow-x: auto` for horizontal panning. The entire scene slides when scrolling horizontally.

### Spec Scenarios Unlocked
- "Horizontal scroll moves the camera across the scene"
- "Horizontal scrollbar when focused columns exceed viewport width"
- "No scrollbar when content fits"
- "Horizontal scroll range matches overflow"
- "Horizontal panning preserves vertical scroll positions"
- "Horizontal scroll position resets when focus layout changes"
- "Flexible width, scrollable height (Article pattern)" (horizontal part)
- "Fixed width, fixed height (DataTable pattern)" (horizontal part)
- "Very narrow viewport"
- "Scroll bounds include padding" (horizontal)
- "Padding can push content into overflow" (horizontal)

### Commits

#### Commit 4a: Tests for horizontal scroll

Write failing tests:
- "Focused columns wider than viewport — horizontal scrollbar appears"
- "Focused columns fit viewport — no horizontal scrollbar"
- "Horizontal scroll range = total focused width - viewport width"
- "Scroll resets to left on focus change"
- "Padding included in scroll range"

#### Commit 4b: Implement horizontal scroll

**SceneViewport** gets `overflow-x: auto` (not always — only when stage overflows viewport width). Since CSS can't do `overflow-x: auto` and `overflow-y: visible` simultaneously (browsers promote visible to auto), we need a specific wrapper:

- Outer viewport div: `overflow-x: auto`, `overflow-y: hidden`, `width: 100%`, `height: 100%`
- Stage div inside: flex row, `margin-inline: auto`, natural width from focused columns
- Vertical scroll is handled by per-column proxies (Phase 5), not by this wrapper

On focus change, reset `scrollLeft` to 0 on the viewport div.

**Padding**: CSS `padding` on the stage div. It naturally participates in scroll range.

#### Commit 4c: Visual test for horizontal scroll

- "Wide content with scrollbar" (screenshot)

---

## Phase 5: Vertical Scroll (Pure JS Per-Column Scroll)

**Goal**: Each overflowing focused column gets its own vertical scroll via pure JS state. Wheel events on the Camera are routed to the column under the cursor. Custom scrollbar component. No proxy divs, no overflow-y.

### Spec Scenarios Unlocked
- "Vertical scroll moves the column through the scene"
- "Non-overflowing focused columns stay centered during vertical scroll"
- "Unfocused columns stay frozen during vertical scroll"
- "Vertical scroll targets the column under the cursor"
- "Diagonal trackpad gesture scrolls both axes simultaneously"
- "Vertical scrollbar when a focused column overflows height"
- "Each overflowing column gets its own vertical scrollbar"
- "No scrollbar when content fits" (vertical)
- "Both scrollbars when content overflows both axes"
- "Scrollbar disappears on focus change to smaller content"
- "Each column's vertical scroll range covers only its focused content"
- "Unfocused objects in a column do not extend the scroll range"
- "Vertical scroll resets when a column first becomes focused"
- "Keyboard scroll targets the column with keyboard focus"
- "Focus change during active scroll"
- "Viewport resize while scrolled"
- "Consumer adds internal scroll to a SceneObject"
- "Focused content renders crisply during and after scroll"

### Commits

#### Commit 5a: Tests for vertical scroll

Write failing tests:
- "Column taller than viewport gets a vertical scrollbar"
- "Column fitting viewport has no scrollbar"
- "Scroll range = focused content height - viewport height"
- "Unfocused objects in column don't extend scroll range"
- "Scroll offset drives column content top"
- "Non-overflowing sibling stays centered during scroll"

#### Commit 5b: Implement per-column JS scroll

**Scroll state**: Each focused column tracks a `scrollOffset` number (clamped to `0...maxScroll`). No scroll containers, no proxy divs, no `overflow-y` anywhere.

**Wheel routing**:
- Camera container listens for `wheel` events
- Determines which column is under the cursor (`document.elementFromPoint` + walk up to `[data-column]`)
- Updates that column's `scrollOffset += deltaY`, clamped to bounds
- `deltaX` is left to the native horizontal scroll (`overflow-x: auto`)
- Trackpad momentum comes free — browsers send decaying wheel events after finger lift
- Call `preventDefault()` on the wheel event for deltaY to prevent viewport from scrolling

**Column content wrapper**: `position: relative; top: -scrollOffset`. No transform — text stays crisp.

**Scrollbar.tsx** — Custom React component (track div + thumb div):
- Scrollbar positioning rule: single focused column → right edge of Camera, scroll area = entire Camera. Multiple focused columns → rightmost column's scrollbar at Camera right edge, other columns' scrollbars between adjacent focused columns.
- Thumb height = (viewportHeight / contentHeight) * trackHeight
- Thumb position = (scrollOffset / maxScroll) * (trackHeight - thumbHeight)
- Supports drag interaction (pointer events on thumb to scroll)
- Styled thin with transparent track

#### Commit 5c: Tests for keyboard scroll + scroll position management

Write failing tests:
- "Keyboard Page Down scrolls column with keyboard focus"
- "Keyboard Arrow Down scrolls column by ~40px"
- "Keyboard Home/End scrolls to top/bottom"
- "Vertical scroll resets to 0 on first focus"
- "Scroll position restores when column is refocused"
- "Scroll position adjusts if focused object is not visible at restored position"
- "Focus change stops active scroll"

#### Commit 5d: Implement keyboard scroll + scroll position management

**Keyboard routing** (~40 lines):
- `keydown` listener on column content wrappers
- Intercepts: ArrowDown/Up (40px), PageDown/Up (viewport height), Space/Shift+Space (viewport height), Home (0), End (maxScroll)
- Routes to the column containing `document.activeElement`
- `preventDefault()` to suppress browser default scroll

**Scroll position management**:
- Per-column scroll state stored in a Map keyed by column ID
- On focus loss: save current scrollOffset
- On re-focus: restore scrollOffset (spring-animated, not instant jump)
- If restored position would hide the focused object, adjust to show it
- On first focus (no saved position): start at 0

#### Commit 5e: Tests for diagonal scroll and viewport resize

Write failing tests:
- "Diagonal trackpad gesture scrolls both axes"
- "Viewport resize while scrolled — position remains valid"
- "Viewport resize: content now fits — scrollbar disappears"

#### Commit 5f: Implement edge cases

- Diagonal: wheel event has both `deltaX` and `deltaY`. `deltaX` goes to native horizontal scroll, `deltaY` updates column scrollOffset. Both happen simultaneously.
- Viewport resize: ResizeObserver on viewport triggers centering recomputation. If content now fits, scrollOffset clamps to 0 and scrollbar disappears.

#### Commit 5g: Debug — scroll state overlay

Add to debug overlay:
- Per-column: scroll offset, content height, viewport height, whether scrollable
- Scene-level: horizontal scroll position, total focused width, viewport width
- Yellow outlines on scrollable column areas

---

## Phase 6: Unfocused Column Positioning (Outer + Depth Deck)

**Goal**: Outer unfocused columns slide offscreen. In-between unfocused columns stack as a depth deck with visual treatment.

### Spec Scenarios Unlocked
- "Outer unfocused columns slide offscreen"
- "In-between unfocused columns stack as a depth deck"
- "Multiple in-between columns stack with increasing depth"
- "Stacking animation — columns picked up and set down"
- "Scene applies stacking visuals to unfocused columns"
- "Stacking depth scales opacity and greyscale"
- "Consumer can override stacking visuals via className"
- "Outer unfocused column slides offscreen" (navigation scenario)
- "In-between unfocused column stacks as depth deck" (navigation scenario)
- "In-between stacking animation sequence"
- "Refocusing a column slides it back"
- "Unfocused objects between focused objects stack as depth deck" (within column)
- "Multiple unfocused objects between focused objects stack with depth"
- "If everything goes unfocused the camera doesn't move"

### Commits

#### Commit 6a: Tests for outer unfocused positioning

Write failing tests:
- "Unfocused column left of all focused slides offscreen left"
- "Unfocused column right of all focused slides offscreen right"
- "Refocusing outer column animates it back into viewport"
- "All unfocused — camera stays at last position"

#### Commit 6b: Implement outer unfocused positioning

Scene determines each unfocused column's classification:
- **Outer-left**: column index < leftmost focused column index → `animate={{ x: -(column.left + column.width) }}` (fully offscreen left, computed from column bounds)
- **Outer-right**: column index > rightmost focused column index → `animate={{ x: viewportWidth - column.left }}` (fully offscreen right, computed from column bounds)

Column uses `motion.div` with `animate` prop for offscreen positioning. Spring transitions.

#### Commit 6c: Spike — CSS perspective on flex container

Validate before committing to the approach:
- `perspective` on a flex parent doesn't change computed layout of flex children without 3D transforms
- `position: absolute` children with `translateZ` render correctly inside a perspective container
- motion's `layout` FLIP measurements aren't thrown off by perspective projection
- `perspective-origin` can be updated dynamically (set near the right focused column)

If any of these fail, fall back to manual scale/offset calculations.

#### Commit 6d: Tests for depth deck stacking

Write failing tests:
- "In-between unfocused column stacks under right focused column"
- "In-between column appears smaller and peeks left (perspective depth)"
- "Multiple in-between columns: deeper columns appear further back"
- "Depth-1 has highest opacity, depth-3 has lowest"
- "Consumer className can override stacking visuals"

#### Commit 6e: Implement depth deck stacking

Stage container gets `perspective: Npx` and `transform-style: preserve-3d`. `perspective-origin` set near the right focused column.

In-between columns (index between two focused column indices):
- Positioned under the right focused column (same x as right focused)
- `translateZ(-depth * N)` pushes them back — perspective projection naturally makes them smaller and shifts them toward the origin (peeking left)
- `opacity: 1 - depth * 0.2` and `filter: grayscale(depth * 0.3)` applied separately
- z-index decreasing with depth
- Staggered `transition.delay` proportional to distance from focused column for the cascading "recede and shift" animation

#### Commit 6f: Tests for within-column depth stacking

Write failing tests:
- "Unfocused object between two focused objects in a column stacks under lower focused"
- "Multiple unfocused between focused: increasing depth"

#### Commit 6g: Implement within-column stacking

Same visual treatment as column-level stacking, but vertical:
- Unfocused objects between focused objects within a column → position under the lower focused object, peek from top

#### Commit 6h: Visual tests for stacking

- "Outer columns offscreen" (screenshot)
- "Depth deck stacking" (screenshot)
- "Within-column stacking" (screenshot)

---

## Phase 7: Navigation Patterns + Dynamic Objects

**Goal**: Depth navigation (new columns appearing from right), back navigation, dynamic mount/unmount.

### Spec Scenarios Unlocked
- "New column appears from the right"
- "Navigating back reveals content from the left"
- "Column removed to the right does not shift focused content"
- "First focus animates from initial position"
- "SceneObject mounts while Scene is active"
- "Focused SceneObject unmounts"
- "Focused SceneObject resizes"
- "Focused content stability" scenarios (right/above/below don't shift, left may shift)

### Commits

#### Commit 7a: Tests for depth navigation

Write failing tests:
- "New focused column appears — animates from right"
- "Back navigation — column animates from left"
- "Column removed to right doesn't shift focused content"
- "Unfocused content unmounting right/above/below doesn't shift focus"
- "Unfocused content unmounting left may shift focus"

#### Commit 7b: Implement depth navigation

- New focused column: motion `layout` handles FLIP — column appears at its natural flex position, animated from its initial offscreen position
- Back navigation: same FLIP mechanism, old column animates out to the right
- Stability: focused content is the flex anchor. Changes to the right don't affect it. Left-side removals may cause flex reflow (accepted tradeoff per spec).

#### Commit 7c: Tests for dynamic mount/unmount/resize

Write failing tests:
- "SceneObject mounts while Scene is active — camera reframes"
- "Focused SceneObject unmounts — camera reframes to remaining"
- "Focused SceneObject resizes — camera reframes"
- "First focus animates from initial position"

#### Commit 7d: Implement dynamic objects

- Mount/unmount: motion `layout` handles entry/exit animations
- Resize: ResizeObserver triggers recomputation of centering and scroll bounds
- Initial animation: on first render with a focused object, motion animates from `initial={{ opacity: 0, scale: 0.95 }}` to final position

---

## Phase 8: Accessibility

**Goal**: `inert` on unfocused content, keyboard focus management, click-to-focus on unfocused objects.

### Spec Scenarios Unlocked
- "Unfocused objects are inert for assistive technology"
- "Focus change moves keyboard focus to new content"
- "Clicking an unfocused object refocuses it"
- "Unfocused object internals are not interactive"

### Commits

#### Commit 8a: Tests for accessibility

Write failing tests:
- "Unfocused content has inert attribute"
- "Focused content does not have inert attribute"
- "Clicking unfocused object fires onActivate callback"
- "Unfocused buttons/inputs are not focusable"
- "Focus change moves keyboard focus to first focusable in new content"

#### Commit 8b: Implement accessibility

**inert**: Already in the shell (Phase 0). Inner wrapper gets `inert` when `!focused`.

**Click-to-focus**: SceneObject outer wrapper has an `onActivate` callback prop (not `onClick` — the Scene doesn't control focus state, the consumer does). When unfocused, the outer wrapper is clickable and calls `onActivate`.

**Keyboard focus management**: On focus change, the newly focused SceneObject calls `element.querySelector('[tabindex], a, button, input, select, textarea')?.focus()` to move keyboard focus to the first interactive element.

---

## Phase 9: Spring Physics Polish

**Goal**: Initial mount animation, reduced motion, mid-animation retargeting, rapid focus changes.

### Spec Scenarios Unlocked
- "Mid-animation re-targeting"
- "Rapid sequential focus changes"
- "Initial mount animation"
- "Reduced motion disables all spring animations"

### Commits

#### Commit 9a: Tests for spring behavior

Write failing tests:
- "Rapid focus changes settle on final target" (assert final position is correct after 3 quick changes)
- "Reduced motion: all transitions are instant" (assert no intermediate frames via `prefers-reduced-motion`)
- "Initial mount: focused object animates from zero-size state"

#### Commit 9b: Implement spring polish

**Reduced motion**: Detect `prefers-reduced-motion` via `window.matchMedia`. When active, set `transition={{ duration: 0 }}` on all motion components.

**Initial mount**: `motion.div` with `initial={{ scale: 0.95, opacity: 0 }}` on the first focused column's layout animation.

**Retargeting**: motion handles natively — changing `animate` targets mid-spring redirects smoothly.

---

## Phase 10: Debug Mode — Final Polish

**Goal**: Remaining debug overlay details (stacking depth, scroll state, offsetParent warnings). Core debug infrastructure was added incrementally in earlier phases.

### Spec Scenarios Unlocked
- Remaining `scene-debug.feature` scenarios (stacking depth overlay, scroll state overlay, offsetParent warning, toggle)

### Commits

#### Commit 10a: Tests for remaining debug features

Write failing tests:
- "Debug — overlay shows stacking depth for unfocused columns"
- "Debug — overlay shows per-column vertical scroll state"
- "Debug — overlay shows scene-level horizontal scroll state"
- "Debug — overlay warns about offsetParent issues"
- "Debug toggles cleanly — enable/disable"

#### Commit 10b: Implement remaining debug features

- Stacking depth indicators on unfocused columns (position classification + depth index)
- Scroll state in overlay panel (per-column vertical + scene horizontal)
- offsetParent warning: detect when a positioned ancestor between Scene and SceneObject could break bounds calculation
- Ensure toggle removes all debug DOM cleanly

---

## Phase 11: Demo Page + Final Polish

**Goal**: Updated ScenePage demo, export cleanup, any remaining edge cases.

### Commits

#### Commit 11a: Update demo page

- Update `dev/pages/ScenePage.tsx` to use new components
- Add horizontal scroll demo (wide content)
- Add vertical scroll demo (tall content)
- Add depth deck demo (3+ columns, middle unfocused)
- Add debug mode toggle

#### Commit 11b: Export cleanup

- Update `/Users/nir/code/webdesserts/ui/src/index.ts` with final exports
- Remove any deprecated types/hooks (SceneScrollView, etc.)
- Verify `tsconfig.build.json` builds cleanly

---

## Risks and Decision Points

### Decisions Needed

1. **`onActivate` vs `onClick` on SceneObject**: The spec says "clicking an unfocused object refocuses it." The Scene doesn't control focus state — the consumer does. Should SceneObject have an `onActivate` prop that fires when an unfocused object is clicked, leaving the consumer to set `focused={true}`? Or should there be an `onFocusRequest` callback on Scene?

2. **Scroll proxy visual treatment**: The spec says "scrollbars are styled thin with a transparent track." Should this be CSS-only (custom scrollbar pseudo-elements) or a custom scrollbar component? CSS pseudo-elements are simpler but have limited cross-browser styling.

3. **`motion` as optional peer dep**: Currently `motion` is optional in `peerDependencies`. The new architecture requires it. Should it be moved to a required peer dep?

4. **Gap props**: The spec mentions configurable gaps at scene and column level. Should these be `gap` props (numbers in px) or `className`-based (consumer applies CSS gap)? The spec says "gaps can have a min/max range" suggesting `clamp()`, which is easier as a CSS class.

5. **Padding prop**: Currently a number (`padding={16}`). The design note says CSS `padding` on the stage. Should this stay as a prop or become a className concern?

### Risks

- **motion `layout` + `overflow: hidden`**: motion's layout animations can interact oddly with overflow:hidden containers. The viewport needs overflow-x:auto and overflow-y:hidden. Need to verify that motion's FLIP measurements work correctly inside this container.

- **ScrollProxy + wheel forwarding**: Intercepting wheel events and forwarding to proxy divs is fragile. Trackpad momentum scrolling, passive event listeners, and scroll chaining can cause issues. Need thorough browser testing.

- **ResizeObserver timing**: Multiple ResizeObserver callbacks firing in rapid succession (viewport resize + column content resize) can cause layout thrashing. May need to batch updates with `requestAnimationFrame`.

- **motion bundle size**: motion is a large library. As an optional peer dep, consumers who don't use Scene don't pay the cost. But Scene itself will import motion at the module level. Consider dynamic import or a separate entry point (`@webdesserts/ui/scene`).

### Spec Contradictions / Ambiguities

- **"Stacking animation — columns picked up and set down"** (scene.feature line 101-106): This describes a specific animation sequence for in-between stacking, but the detail level ("picked up from the right, set down on the column to its left, repeating") suggests a multi-step animation that's complex to implement with motion springs. This may need simplification to a single spring-animated slide into the deck position.

- **"Vertical swap restores per-object scroll position"** (scene-scroll.feature line 155-159): "once content is pushed to a position in the scene, it stays there" — this implies scroll position is per-object, not per-column. But the scroll proxy is per-column. Need to track scroll position per SceneObject within the column, and restore when that object becomes focused again.

- **"Consumer adds internal scroll to a SceneObject"** (scene-scroll.feature line 227-232): When a SceneObject handles its own scrolling (e.g., `overflow-y: auto` on consumer content with `height: 100%`), the column shouldn't get a scroll proxy. Detection: if the column's focused content height equals the viewport height (no overflow), no proxy is created. This should work naturally if the consumer's content constrains itself to `height: 100%`.

---

## Test Count Summary

| Phase | Behavioral | Visual | Total |
|-------|-----------|--------|-------|
| 0     | 8         | 0      | 8     |
| 1     | 11        | 3      | 14    |
| 2     | 10        | 2      | 12    |
| 3     | 7         | 2      | 9     |
| 4     | 5         | 1      | 6     |
| 5     | 11        | 0      | 11    |
| 6     | 11        | 3      | 14    |
| 7     | 9         | 0      | 9     |
| 8     | 5         | 0      | 5     |
| 9     | 3         | 0      | 3     |
| 10    | 6         | 0      | 6     |
| **Total** | **86** | **11** | **97** |
