import React, { useState, useCallback, useLayoutEffect, useEffect } from "react";

/** Measured stage-vs-focused-span bounds for StageBoundsOutline below. */
interface StageBoundsInfo {
  left: number;
  top: number;
  width: number;
  height: number;
  stageWidth: number;
  focusedWidth: number;
}

/**
 * Measures the stage's true rendered width against the union of currently
 * focused columns' width. Returns null when there's nothing focused (no
 * "focused span" to compare against) or when the stage doesn't exceed it
 * (the common case — most layouts have no frozen/parked columns extending
 * the stage beyond what's focused).
 */
function measureStageBounds(viewport: HTMLElement, stage: HTMLElement): StageBoundsInfo | null {
  const focusedCols = Array.from(stage.querySelectorAll<HTMLElement>("[data-ui-scene-column-focused='true']"));
  if (focusedCols.length === 0) return null;

  const focusedUnion = focusedCols.reduce(
    (acc, col) => {
      const rect = col.getBoundingClientRect();
      return { left: Math.min(acc.left, rect.left), right: Math.max(acc.right, rect.right) };
    },
    { left: Infinity, right: -Infinity },
  );
  const focusedWidth = focusedUnion.right - focusedUnion.left;

  const stageRect = stage.getBoundingClientRect();
  const stageWidth = stageRect.width;

  // 1px epsilon absorbs sub-pixel layout rounding noise, not real overflow.
  if (stageWidth <= focusedWidth + 1) return null;

  const vpRect = viewport.getBoundingClientRect();
  return {
    left: stageRect.left - vpRect.left,
    top: stageRect.top - vpRect.top,
    width: stageWidth,
    height: stageRect.height,
    stageWidth,
    focusedWidth,
  };
}

function stageBoundsEqual(a: StageBoundsInfo | null, b: StageBoundsInfo | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height &&
    a.stageWidth === b.stageWidth &&
    a.focusedWidth === b.focusedWidth
  );
}

/**
 * F4 feature (b): draws the stage's TRUE rendered bounds — the full flex
 * row, including any frozen/parked columns outside the focused span — with
 * a numeric label, but ONLY when that true width exceeds the focused span.
 * This is the CameraDebug-incident class made visible at a glance (see
 * warnStrayChild below): a wide-but-currently-hidden stage (overflowsX
 * false, so no scrollbar hints at it) is exactly the shape that widened
 * scrollWidth invisibly before the F4 commit-1 purity fix — this outline
 * exists so a developer can SEE that shape exists without needing to know
 * to check scrollWidth themselves. The existing permanent magenta stage
 * outline (SceneViewport's `outline: debug ? "2px solid magenta"` on the
 * stage element itself) already technically delineates these same bounds,
 * but it's clipped by the viewport's own overflow just like real content —
 * the far edge of a wide stage is invisible in the current scroll position
 * exactly when this matters most. Rendered inside the same viewport-pinned
 * overflow:hidden clipping layer SceneObjectOutlines uses (commit 1) — this
 * label is exactly as width-unconstrained as SceneObjectOutlines' name
 * labels were, so it MUST stay inside that clip to avoid reopening the same
 * purity bug.
 */
export function StageBoundsOutline({
  viewportRef,
  stageRef,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [bounds, setBounds] = useState<StageBoundsInfo | null>(null);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    const fresh = viewport && stage ? measureStageBounds(viewport, stage) : null;
    setBounds((prev) => (stageBoundsEqual(prev, fresh) ? prev : fresh));
  }, [viewportRef, stageRef]);

  useLayoutEffect(() => {
    measure();
  });

  // F6 item 1 fix: same staleness class as SceneObjectOutlines above — a
  // React-render-only measurement misses the stage width shifting during a
  // Motion-driven (imperative, off-React) transition. `stageBoundsEqual`'s
  // bail-out keeps this from re-rendering every frame once settled.
  useEffect(() => {
    let rafId = requestAnimationFrame(function loop() {
      measure();
      rafId = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(rafId);
  }, [measure]);

  if (!bounds) return null;

  const hidden = Math.round(bounds.stageWidth - bounds.focusedWidth);

  return (
    <div
      data-ui-scene-debug-stage-bounds
      style={{
        position: "absolute",
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        border: "2px dashed orange",
        pointerEvents: "none",
        boxSizing: "border-box",
        zIndex: 9997,
      }}
    >
      <span
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          background: "orange",
          color: "#000",
          fontFamily: "monospace",
          fontSize: 10,
          padding: "0 2px",
          lineHeight: "14px",
        }}
      >
        stage {Math.round(bounds.stageWidth)}px (focused {Math.round(bounds.focusedWidth)}px, +{hidden}px hidden)
      </span>
    </div>
  );
}
