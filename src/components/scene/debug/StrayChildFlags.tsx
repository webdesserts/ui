import React, { useState, useCallback, useLayoutEffect, useEffect } from "react";

/** A stage child that joined the flex row without going through a SceneColumn. */
interface StrayChildEntry {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  typeName: string;
}

/**
 * Finds every DIRECT DOM child of the stage lacking `data-ui-scene-column-anchor` — the
 * attribute every legitimately-rendered SceneColumn carries. Scene.tsx's own
 * wrapChild already folds bare SceneObjects into an implicit SceneColumn, so
 * anything reaching the stage without `data-ui-scene-column-anchor` is exactly
 * warnStrayChild's trigger condition: a child that is neither a SceneColumn
 * nor a SceneObject, silently joining the flex row unchanged.
 */
function measureStrayChildren(viewport: HTMLElement, stage: HTMLElement): StrayChildEntry[] {
  const vpRect = viewport.getBoundingClientRect();
  const entries: StrayChildEntry[] = [];
  Array.from(stage.children).forEach((child, i) => {
    if (!(child instanceof HTMLElement)) return;
    if (child.hasAttribute("data-ui-scene-column-anchor")) return;
    const rect = child.getBoundingClientRect();
    entries.push({
      key: `stray-${i}-${child.tagName}`,
      left: rect.left - vpRect.left,
      top: rect.top - vpRect.top,
      width: rect.width,
      height: rect.height,
      typeName: child.tagName.toLowerCase(),
    });
  });
  return entries;
}

function strayChildrenEqual(a: StrayChildEntry[], b: StrayChildEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, i) =>
        entry.key === b[i]?.key &&
        entry.left === b[i]?.left &&
        entry.top === b[i]?.top &&
        entry.width === b[i]?.width &&
        entry.height === b[i]?.height,
    )
  );
}

/**
 * F4 feature (b): paints a red outline + label on every stray stage child
 * (see measureStrayChildren above) — the CameraDebug-incident class made
 * visible at a glance, pairing with warnStrayChild's console warning in
 * Scene.tsx. Rendered inside the same viewport-pinned clipping layer as
 * SceneObjectOutlines/StageBoundsOutline (commit 1's purity fix) — a stray
 * child is by definition NOT position-managed by Scene, so nothing bounds
 * where it might render.
 */
export function StrayChildFlags({
  viewportRef,
  stageRef,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [entries, setEntries] = useState<StrayChildEntry[]>([]);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    const fresh = viewport && stage ? measureStrayChildren(viewport, stage) : [];
    setEntries((prev) => (strayChildrenEqual(prev, fresh) ? prev : fresh));
  }, [viewportRef, stageRef]);

  useLayoutEffect(() => {
    measure();
  });

  // F6 item 1 fix: same staleness class as SceneObjectOutlines above.
  // strayChildrenEqual's bail-out keeps this from re-rendering every frame
  // once settled.
  useEffect(() => {
    let rafId = requestAnimationFrame(function loop() {
      measure();
      rafId = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(rafId);
  }, [measure]);

  return (
    <>
      {entries.map((entry) => (
        <div
          key={entry.key}
          data-ui-scene-debug-stray-child={entry.typeName}
          style={{
            position: "absolute",
            left: entry.left,
            top: entry.top,
            width: entry.width,
            height: entry.height,
            border: "2px solid red",
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
              background: "red",
              color: "#fff",
              fontFamily: "monospace",
              fontSize: 10,
              padding: "0 2px",
              lineHeight: "14px",
            }}
          >
            stray &lt;{entry.typeName}&gt;
          </span>
        </div>
      ))}
    </>
  );
}
