# Architect Review: Scene Implementation Plan

> Reviewed 2026-03-27. Covers the implementation plan at `.claude/implementation-plan.md`, the four spec files, and the [[Scene System Design]] note.

---

## 1. Blocking Issues

### 1A. `layoutScroll` prop missing from scrollable containers

Motion's `layout` prop computes FLIP animations by measuring DOM position before and after render, then animating the delta. When `layout` elements live inside a scrollable container, motion needs to account for the container's scroll offset — otherwise FLIP measurements are wrong and elements jump to incorrect positions during transitions.

Motion provides the `layoutScroll` prop for this. The plan places `overflow-x: auto` on the viewport wrapper (Phase 4) and per-column scroll proxies (Phase 5), but never mentions `layoutScroll`. Every `motion.div layout` inside these scrollable containers will produce incorrect FLIP animations unless the scrollable ancestor has `layoutScroll`.

**Fix**: Add `layoutScroll` to SceneViewport's outer div and to any column content wrapper that becomes scrollable. Note this explicitly in Phase 4b and Phase 5b.

Reference: [Motion layout animations docs](https://motion.dev/docs/react-layout-animations) — "For layout animations to work correctly within scrollable elements, their scroll offset needs measuring. Add the layoutScroll prop to elements that should be measured."

### 1B. Vertical swap `top` offset collides with scroll `top` offset

Phase 2 animates column content `top` to `-focusedObjectOffset` for vertical swaps. Phase 5 also drives column content `top` via scroll proxy (`top: -scrollTop`). Both want sole control of the same CSS property on the same element. The plan never addresses how these compose.

When the user scrolls a column that previously had a vertical swap, the content wrapper's `top` needs to reflect both the swap offset (which object is in view) and the scroll offset (how far that object is scrolled). These are not independent — swap changes which object is at the top, then scroll moves within that object's content.

**Fix**: Resolve this before Phase 2 implementation starts. Options:
- Make `top` a single combined value: `top = -(swapOffset + scrollOffset)`.
- Use swap offset only during the swap animation, then transfer to scroll position once settled. The scroll proxy's "zero" becomes the swapped object's position.
- Use `translateY` for one and `top` for the other (but this reintroduces transforms on focused content, degrading text rendering).

The second option (transfer to scroll after settle) is cleanest — the swap animation brings the new object into view, then scroll takes over from that position.

---

## 2. Significant Concerns

### 2A. Scroll proxy wheel forwarding won't produce native momentum

The plan forwards `deltaY` to the proxy via `proxy.scrollTop += deltaY`. This works for discrete mouse wheel ticks but breaks momentum scrolling on trackpads. When a user flicks two fingers on a trackpad, the OS generates a burst of wheel events followed by synthetic momentum events with progressively smaller deltas. Forwarding these manually to `scrollTop` will produce jerky deceleration rather than the smooth, native momentum curve.

The proxy div itself *would* produce native momentum if it were the actual scroll target — but it's a hidden element that receives manual scrollTop updates, not real scroll events. The user will never directly interact with it.

**Workaround**: Instead of intercepting wheel events at the viewport level and forwarding, consider making the scroll proxy div the actual pointer-event target for its column's area. Use `pointer-events: none` on column content and `pointer-events: auto` on the proxy, sized to cover the column's viewport area. This way, wheel events hit the proxy natively, and the browser handles momentum. The proxy's `scroll` event then drives the column content's `top`.

This is a significant rework of the scroll proxy concept. It trades wheel interception for a more native approach but introduces its own complexity (click events need to pass through to column content for click-to-focus, which conflicts with `pointer-events: none`). Worth prototyping in Phase 5 before committing.

### 2B. Keyboard scroll has no clear path to the proxy

The plan says "keyboard scroll targets the column with keyboard focus" but doesn't explain how keyboard events (`Page Down`, `Arrow Down`, `Space`) reach the scroll proxy. These keys trigger scrolling on the element that has keyboard focus or its nearest scrollable ancestor. If keyboard focus is inside a SceneObject's content (a button, an input), the scroll target is the SceneObject or the column content wrapper — neither of which has `overflow-y: auto`. The proxy div is a separate element.

**Fix options**:
- Make the column content wrapper itself the scrollable element (simplest, but conflicts with the proxy architecture).
- Intercept keyboard events on the focused column and programmatically adjust proxy scrollTop. This requires a keydown listener on the column and manually computing scroll amounts for Page Down, Arrow keys, Space, Home, End.
- Use `tabindex` on the proxy and move focus to it on column focus. But this breaks the "keyboard focus on first interactive element" accessibility spec.

None of these are great. This is a fundamental tension in the proxy architecture — the scrollable element is not the element that receives user input. Consider whether the proxy approach is worth its complexity vs. making column content wrappers natively scrollable (with `overflow-y: auto` and `overflow-x: visible` — which browsers unfortunately promote to `auto`).

### 2C. Unfocused column `animate={{ x: -viewportWidth }}` depends on viewport width

Phase 6b positions outer-left unfocused columns at `x: -viewportWidth`. This means unfocused columns need to know the viewport width. If the viewport resizes, these positions need to update. The plan uses ResizeObserver for viewport dimensions (Phase 3), so this data is available, but the plan doesn't explicitly wire it into the unfocused positioning logic.

More subtly, using `viewportWidth` as the offscreen distance means columns slide exactly one viewport width — but the column itself might be wider than the viewport. A column frozen at 800px being moved `x: -1200px` (viewport width) would still have its right 800px visible if it started at position 0. The correct offscreen position is `x: -(column.left + column.width)` relative to the viewport left edge, not just `-viewportWidth`.

**Fix**: Compute offscreen position from the column's actual bounds, not viewport width.

### 2D. motion `layout` on unfocused columns may cause unnecessary FLIP

The plan puts `layout` on all column `motion.div`s. For unfocused columns that are `position: absolute` and controlled entirely by `animate={{ x, y, scale, opacity }}`, the `layout` prop is unnecessary and potentially harmful — motion will try to measure and FLIP-animate DOM position changes even though the position is explicitly driven by `animate`. This can cause double-animation glitches: FLIP correcting for a position change that `animate` is already handling.

**Fix**: Only apply `layout` to focused columns. Unfocused columns should use `animate` only, without `layout`. When a column transitions from focused to unfocused, remove `layout` and add `animate`. When transitioning back, add `layout` and remove the explicit position from `animate`.

---

## 3. Minor Suggestions

### 3A. ScrollProxy as part of SceneColumn, not a separate file

The plan creates `ScrollProxy.tsx` as a separate component. But scroll proxies are deeply coupled to column internals — they need focused content height, scroll state per column, and they drive the column's content `top`. Making this a separate component creates a coordination surface (props, refs, callbacks) that could be avoided by keeping scroll logic inside SceneColumn. Consider a `useColumnScroll` hook instead of a `ScrollProxy` component.

### 3B. `duration` prop naming

The plan uses `duration={0}` on Scene to disable animations in tests. This is clean and already in use in the existing tests. However, the `duration` prop name might conflict with motion's own `transition.duration` semantics (where `duration` means the spring duration hint, not a "disable" signal). Consider `animationDuration` or accepting a boolean `instant` prop alongside the spring config. Minor — the current name works fine, just noting potential confusion.

### 3C. 12-phase plan is heavy for a coder agent

11 phases (0-10) plus a polish phase means 12 separate coder sessions. Given the coder agent's timeout constraints (observed in the iroh migration), phases with 6+ commits (Phase 5, Phase 6) may time out. Consider pre-splitting the heaviest phases into independent sub-tasks.

### 3D. `SceneStage.tsx` and `SceneViewport.tsx` could be one file

The plan creates both `SceneStage.tsx` (flex container for focused columns) and `SceneViewport.tsx` (horizontal scroll wrapper, centering). These are tightly coupled — the viewport wraps the stage, centering is computed from their size relationship. Two files for two nested divs may be overkill. A single `SceneViewport.tsx` that renders both the scroll wrapper and the stage flex container would be simpler.

---

## 4. Spec Coverage Gaps

The following spec scenarios are not covered by any test in the plan:

| Spec File | Scenario | Line |
|-----------|----------|------|
| scene.feature | Consumer can override column sizing via CSS | 33 |
| scene.feature | Configurable gap between focused columns | 251 |
| scene.feature | Configurable gap between objects in a column | 255 |
| scene.feature | Default gap is zero | 261 |
| scene.feature | Padding adds space around focused bounds | 268 |
| scene.feature | Default padding is zero | 273 |
| scene.feature | useCamera reports transitioning during animation | 336 |
| scene-scroll.feature | Vertical swap restores per-object scroll position | 155 |
| scene-scroll.feature | Horizontal panning preserves vertical scroll positions | 69 |
| scene-navigation.feature | Column is a container with its own width | 23 |
| scene-navigation.feature | Objects fill column width by default | 28 |
| scene-navigation.feature | Vertical extension becomes one scrollable column | 74 |
| scene-navigation.feature | Very narrow viewport | 167 |
| scene-debug.feature | Overlay shows Camera state | 39 |
| scene-debug.feature | Overlay shows per-column vertical scroll state | 43 |
| scene-debug.feature | Overlay shows scene-level horizontal scroll state | 48 |
| scene-debug.feature | Overlay shows stacking depth for unfocused columns | 52 |
| scene-debug.feature | Overlay warns about offsetParent issues | 58 |
| scene-debug.feature | Debug toggles cleanly | 67 |

That's 19 untested scenarios. The padding tests exist in the current codebase but aren't listed in any phase. Gaps (configurable with min/max, default zero) are a full feature that the plan simply doesn't address. The debug overlay tests cover only 3 of 8 overlay scenarios from the spec.

**Recommendation**: Add a Phase for gaps (could fold into Phase 3 since it's centering-adjacent). Add the missing debug scenarios to Phase 10. Carry forward the existing padding tests into Phase 0 or 1.

---

## 5. Questions for the User

1. **Scroll proxy vs. native scroll**: The proxy approach introduces significant complexity (wheel forwarding, keyboard routing, momentum loss). Have you considered making each column content wrapper natively scrollable (`overflow-y: auto`) and accepting the browser's `overflow-x: visible -> auto` promotion? The visual consequence is that column content would clip horizontally at the column boundary rather than bleeding into adjacent columns. Is that visual bleed important enough to justify the proxy complexity?

2. **Gap feature priority**: The spec defines configurable gaps with min/max ranges at both scene and column level. The plan doesn't implement gaps at all. Should gaps be added to the plan, or deferred to a follow-up?

3. **Stacking animation sequence**: The spec describes a "picked up and set down" animation for in-between columns (scene.feature line 101-106, scene-navigation.feature line 109-112). The plan acknowledges this might need simplification to a single spring-animated slide. Is the multi-step pick-up/set-down animation a must-have, or is a simple slide-and-scale acceptable?

4. **Per-object scroll position**: The spec says vertical swaps restore per-object scroll position (scene-scroll.feature line 155-159). The plan notes this as an ambiguity. Should scroll be tracked per-column (simpler, plan's current assumption) or per-object (spec's requirement)? Per-object adds a Map<objectId, scrollTop> alongside the column-level Map.

5. **motion as required peer dep**: The plan notes this as a decision point. Since Scene cannot function without motion, and Scene is the primary complex component in this library, should motion move to required? Or should Scene be a separate entry point (`@webdesserts/ui/scene`) so consumers who only want buttons don't need motion?
