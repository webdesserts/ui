# Animation Testing Spike

## Goal

Validate that we can reliably capture mid-animation visual snapshots for Scene transitions. Answer three questions:

1. Can we override motion springs with linear tweens via the existing `duration` prop?
2. Can we capture a consistent mid-animation frame with `wait()`?
3. Does the layout FLIP transition respond to the same transition override?

## Approach

One test file, 3 tests, ~30 minutes of work. No new props or API surface — just use what exists.

### Test 1: Linear tween mid-capture

```tsx
// Use a long duration (not 0) to get a real tween instead of instant
<Scene duration={800}>
  <SceneColumn name="col">
    <SceneObject name="obj" focused>
      <div style={{ width: 400, height: 300 }} />
    </SceneObject>
  </SceneColumn>
</Scene>
```

Render with focused=true, capture initial screenshot. Then rerender with focused=false, wait 400ms, capture mid-animation screenshot. The column should be mid-transition between its focused position and unfocused position.

**What to verify:** Is the screenshot deterministic across runs? Run the same test 3 times and compare.

### Test 2: Layout FLIP mid-capture

Same setup but test whether the `layout` prop's FLIP animation respects the `duration` setting. When a column goes from `position: relative` (flex) to `position: absolute` (unfocused), motion's layout system does a FLIP correction.

**Key question:** Does `duration={800}` on the Scene make the FLIP animation take 800ms? Or does layout have its own default duration?

If layout has its own timing, we may need to explicitly set `transition={{ layout: { duration: 0.8, ease: "linear" } }}` on the motion.div. Check by:
1. Capturing at 400ms — if the element is mid-FLIP, the override works
2. If the element has already settled at 400ms, the layout transition is faster than 800ms

### Test 3: Focus transition full sequence (3 frames)

Capture 3 screenshots for one focus→unfocus transition:
- Frame 1: before (focused, centered)
- Frame 2: mid (400ms into 800ms transition)
- Frame 3: after (unfocused, in flex row at natural position)

This gives us the diagnostic tool to see exactly what happens during the transition.

## Files

- `tests/visual/scene-animation-spike.test.tsx` — new file, 3 tests
- `src/components/scene/SceneColumn.tsx` — check how `duration` maps to motion `transition` prop (line ~557). If `duration > 0` currently maps to `{ type: "spring", stiffness, damping }`, change to use duration directly: `{ duration: duration / 1000 }` when duration is a specific test value.

## Success Criteria

- Mid-animation screenshot shows the element in an intermediate state (not start, not end)
- Running the same test 3 times produces visually identical screenshots (deterministic)
- We understand whether layout FLIP respects the duration override

## Failure Criteria

If mid-animation capture is not deterministic (screenshots differ between runs), we need a different approach — possibly:
- Use `requestAnimationFrame` counting instead of wall-clock time
- Use motion's `onUpdate` callback to capture at a specific progress value
- Accept that animation tests are approximate and use generous pixel mismatch tolerance

## After Spike Succeeds

If the spike validates the approach, expand to the full 11 snapshots from the animation test plan:
1. Focus transition: before, mid, after (3)
2. Unfocus transition: mid (1)
3. Vertical swap: mid (1)
4. Depth deck entry: mid (1)
5. Camera pan: mid (1)
6. Multi-column focus change: mid (1)
7. Refocus from frozen: mid (1)
8. All-unfocus (browse mode): before, after (2)

Visual snapshots are cheap — test everything worth seeing.

## Time Box

1 hour max for the spike. If deterministic capture works, proceed to full 11 snapshots immediately.
