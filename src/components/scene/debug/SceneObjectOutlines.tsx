import React, { useState, useCallback, useLayoutEffect, useEffect, useRef } from "react";
import type { DebugObjectEntry } from "./types";
import { queryDebugObjects } from "./debugObjectQuery";

/**
 * Absolutely-positioned overlay elements that draw colored outlines around each
 * SceneObject. Rendered inside the viewport so positions are relative to it.
 * `pointer-events: none` ensures these overlays never interfere with interaction.
 *
 * Outline positions are updated in two ways:
 * 1. `useLayoutEffect` fires on every React render for initial/settled layout.
 * 2. A `requestAnimationFrame` loop runs continuously for as long as this
 *    component is mounted (i.e. for as long as `debug` is enabled — F6 item
 *    1 fix), measuring positions every frame and mutating outline div styles
 *    directly (no setState) so Motion animations are tracked without
 *    triggering re-renders. Previously gated on a `animatingRef.current > 0`
 *    counter fed by `onAnimationStart`/`onLayoutAnimationStart` callbacks —
 *    those only fire for DECLARATIVE `animate`-prop transitions with the
 *    callback actually wired up (SceneColumn's opacity/x/y/filter + layout
 *    FLIP + marginTop), never for the S3+ imperative motion pipeline
 *    (topOffsetMV, zMV, scrollY, cameraX, SceneObject's within-column
 *    heightMV/marginBottomMV, replacing the retired topMV) or for
 *    SceneObject's own declarative opacity/filter animate (z moved to a
 *    discrete, non-animated zIndex channel — ui/t:21's z-index paint-order
 *    channel amendment) — none of these were ever wired to any
 *    onAnimationStart callback at all.
 *    Probe-confirmed on the dev app's Debug mode demo: an object's outline
 *    froze at its pre-transition position for an entire ~330ms swap and
 *    never caught up even after the real object settled, because nothing
 *    ever incremented the counter for that transition. ActiveSpringsSection.tsx
 *    already reaches this same conclusion for its own per-frame
 *    readouts and runs continuously for exactly this reason — this mirrors
 *    that established pattern rather than inventing a new one.
 */
export function SceneObjectOutlines({
  viewportRef,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Outline div refs, keyed by object name. Direct DOM mutation during rAF.
  const outlineRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Track which objects (name + focused) we've rendered outlines for — DOM
  // truth via queryDebugObjects, re-derived every render by the layout
  // effect below. Used to detect when the object list (or its focus state)
  // changes and we need to re-render the outline divs.
  const [renderedObjects, setRenderedObjects] = useState<DebugObjectEntry[]>([]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- Deliberate every-render effect (no dependency array by design) — adding one changes it from per-render to per-dep-change, a real behavior change to a documented remeasure/correction idiom.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const objects = queryDebugObjects(viewport);
    setRenderedObjects((prev) => {
      const same =
        prev.length === objects.length &&
        prev.every((p, i) => p.name === objects[i]?.name && p.focused === objects[i]?.focused);
      return same ? prev : objects;
    });
  });

  // Shared measurement helper: measure each object and mutate its outline
  // div. Re-queries the DOM directly (rather than reading renderedObjects
  // state) so it's always accurate for THIS pass, matching the old
  // always-fresh `objects` prop — renderedObjects itself lags by one commit
  // when it changes (the state-update-in-layout-effect pattern above).
  const measureAndUpdate = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const vpRect = viewport.getBoundingClientRect();

    for (const obj of queryDebugObjects(viewport)) {
      const el = viewport.querySelector<HTMLElement>(`[data-ui-scene-id='${obj.name}']`);
      const outlineDiv = outlineRefs.current.get(obj.name);
      if (!el || !outlineDiv) continue;

      const rect = el.getBoundingClientRect();
      outlineDiv.style.left = `${rect.left - vpRect.left}px`;
      outlineDiv.style.top = `${rect.top - vpRect.top}px`;
      outlineDiv.style.width = `${rect.width}px`;
      outlineDiv.style.height = `${rect.height}px`;
    }
  }, [viewportRef]);

  // Measure on every React render (catches layout changes, focus state changes).
  useLayoutEffect(() => {
    measureAndUpdate();
  });

  // F6 item 1 fix: rAF loop runs continuously for as long as this component
  // is mounted (i.e. for as long as `debug` is enabled), mirroring
  // ActiveSpringsSection.tsx's own established continuous pattern —
  // matches Motion's per-frame imperative writes with no external trigger
  // needed. Debug-only, so the per-frame cost never reaches the production
  // path; it doesn't mutate React state or the scene's own layout (only
  // this overlay div's own style, pointer-events: none), so it doesn't
  // reopen the "debug does not affect layout" bar (F4 commit 1).
  useEffect(() => {
    let rafId = requestAnimationFrame(function loop() {
      measureAndUpdate();
      rafId = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(rafId);
  }, [measureAndUpdate]);

  return (
    <>
      {renderedObjects.map(({ name, focused }) => {
        const borderColor = focused ? "green" : "gray";
        return (
          <div
            key={name}
            ref={(el) => {
              if (el) {
                outlineRefs.current.set(name, el);
              } else {
                outlineRefs.current.delete(name);
              }
            }}
            data-ui-scene-debug-object-outline={name}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 0,
              height: 0,
              border: `1px solid ${borderColor}`,
              pointerEvents: "none",
              boxSizing: "border-box",
              zIndex: 9998,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                background: borderColor,
                color: "#fff",
                fontFamily: "monospace",
                fontSize: 10,
                padding: "0 2px",
                lineHeight: "14px",
                pointerEvents: "none",
              }}
            >
              {name}
            </span>
          </div>
        );
      })}
    </>
  );
}
