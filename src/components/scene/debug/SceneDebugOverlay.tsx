import React, { useState, useLayoutEffect } from "react";
import type { DebugColumnStackEntry, DebugColumnScroll, DebugObjectBounds, DebugObjectEntry } from "./types";
import { queryDebugObjects } from "./debugObjectQuery";
import { ActiveSpringsSection } from "./ActiveSpringsSection";
import type { DebugMotionRecorder } from "./motionRecorder";

/** Debug overlay rendered inside the Scene when `debug` is enabled. */
export function SceneDebugOverlay({
  columnStacks,
  viewportRef,
  stageRef,
  motionRecorder,
  slowMo,
  onToggleSlowMo,
}: {
  columnStacks: DebugColumnStackEntry[];
  viewportRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
  /** Scene's own motion-seam recorder (see createDebugMotionRecorder in
   *  motionRecorder.ts), or null when a test harness supplied its own
   *  MotionSeamContext.Provider instead (motionSeam.ts) — in that case the
   *  active-springs section below simply has nothing of Scene's own to read
   *  and renders nothing. */
  motionRecorder: DebugMotionRecorder | null;
  /** F4 feature (e): the currently-effective slowMo (prop or override). */
  slowMo: boolean;
  /** F4 feature (e): flips Scene's internal slowMo override. */
  onToggleSlowMo: () => void;
}) {
  // Object list — DOM truth (queryDebugObjects), same rationale as
  // SceneObjectOutlines.tsx. Corrected via a useLayoutEffect (mirroring
  // SceneObjectOutlines' renderedObjects pattern), NOT computed inline
  // during render: a during-render query reads the DOM as of the END of
  // the PREVIOUS commit (React applies THIS commit's mutations only after
  // the whole tree has rendered), and unlike SceneObjectOutlines — whose
  // own state update triggers its own self-correcting re-render —
  // SceneDebugOverlay has no other re-render trigger of its own, so an
  // idle scene would otherwise show a mount/unmount stale by exactly one
  // commit indefinitely.
  const [objects, setObjects] = useState<DebugObjectEntry[]>([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Deliberate every-render effect (no dependency array by design) — adding one changes it from per-render to per-dep-change, a real behavior change to a documented remeasure/correction idiom.
  useLayoutEffect(() => {
    const currentViewport = viewportRef.current;
    if (!currentViewport) return;
    const fresh = queryDebugObjects(currentViewport);
    setObjects((prev) => {
      const same =
        prev.length === fresh.length &&
        prev.every((p, i) => p.name === fresh[i]?.name && p.focused === fresh[i]?.focused);
      return same ? prev : fresh;
    });
  });

  // F4 purity audit finding: everything below (columnScrollStates,
  // scrollLeft/scrollWidth/clientWidth, offsetParentWarnings, objectBounds)
  // is still computed via RENDER-TIME reads of viewportRef.current/
  // stageRef.current — the exact one-commit-stale hazard `objects` above was
  // moved off of (see its comment). These are lower-stakes than `objects`
  // (no self-correcting re-render loop existed for them either way, and an
  // idle scene's stale display corrects on the next unrelated re-render), and
  // — same rationale as SceneObjectOutlines' pure DOM reads — reading here is
  // observationally pure: it only feeds the overlay's OWN displayed text, and
  // is never written back into Scene's actual layout/scroll decisions, so it
  // doesn't threaten "Debug does not affect layout" (scene-debug.feature).
  // Left as pre-existing behavior (out of scope for this purity fix, which is
  // about Scene's real behavior, not the overlay's internal display
  // freshness) — a future pass could apply the same layout-effect+state
  // treatment `objects` already got, purely to reduce staleness in what's
  // shown.
  const columnScrollStates: DebugColumnScroll[] = [];
  const viewport = viewportRef.current;
  if (viewport) {
    const columns = viewport.querySelectorAll("[data-ui-scene-column-anchor]");
    columns.forEach((col) => {
      const name = col.getAttribute("data-ui-scene-column-anchor") ?? "?";
      const focused = col.getAttribute("data-ui-scene-column-focused") === "true";
      if (!focused) return;
      const scrollOffset = parseFloat(col.getAttribute("data-ui-scene-scroll-offset") ?? "0");
      const contentHeight = parseFloat(col.getAttribute("data-ui-scene-content-height") ?? "0");
      const maxScroll = parseFloat(col.getAttribute("data-ui-scene-max-scroll") ?? "0");
      const viewportHeight = contentHeight - maxScroll; // viewport = content - maxScroll
      columnScrollStates.push({
        name,
        scrollOffset,
        contentHeight,
        viewportHeight,
        scrollable: maxScroll > 0,
      });
    });
  }

  const scrollLeft = viewport?.scrollLeft ?? 0;
  const scrollWidth = viewport?.scrollWidth ?? 0;
  const clientWidth = viewport?.clientWidth ?? 0;

  // Detect offsetParent issues: a column's offsetParent should be the stage div
  // (which has position: relative). If it's anything else — whether an element
  // inside the stage or completely outside it — a positioned ancestor is
  // intercepting layout calculations.
  const stage = stageRef.current;
  const offsetParentWarnings: string[] = [];
  if (stage && viewport) {
    const columns = viewport.querySelectorAll<HTMLElement>("[data-ui-scene-column-anchor]");
    columns.forEach((col) => {
      const op = col.offsetParent;
      if (op && op !== stage) {
        const name = col.getAttribute("data-ui-scene-column-anchor") ?? "?";
        offsetParentWarnings.push(name);
      }
    });
  }

  // Measure object bounds for the overlay panel display.
  const objectBounds: DebugObjectBounds[] = [];
  if (viewport) {
    const vpRect = viewport.getBoundingClientRect();
    for (const obj of objects) {
      const el = viewport.querySelector<HTMLElement>(`[data-ui-scene-id='${obj.name}']`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      objectBounds.push({
        name: obj.name,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        x: Math.round(rect.left - vpRect.left),
        y: Math.round(rect.top - vpRect.top),
      });
    }
  }

  // F4 feature (c) geometry-store inspector: reads SceneColumn's per-object
  // data-ui-scene-debug-geometry-offset-top/height mirror (written by remeasureGeometry —
  // see SceneColumn.tsx), grouped by parent column. No provenance tag
  // (seeded-at-registration vs remeasured, as originally scoped) — SceneColumn
  // has exactly ONE write site into its geometryStore (remeasureGeometry's
  // bulk pass; verified at source, no separate registration-time seed
  // exists), so a provenance boolean would have nothing real to distinguish.
  const geometryByColumn = new Map<string, Array<{ name: string; offsetTop: number; height: number }>>();
  if (viewport) {
    viewport.querySelectorAll<HTMLElement>("[data-ui-scene-debug-geometry-offset-top]").forEach((el) => {
      const name = el.getAttribute("data-ui-scene-id") ?? "?";
      const columnName = el.closest<HTMLElement>("[data-ui-scene-column-anchor]")?.getAttribute("data-ui-scene-column-anchor") ?? "?";
      const entries = geometryByColumn.get(columnName) ?? [];
      entries.push({
        name,
        offsetTop: parseFloat(el.getAttribute("data-ui-scene-debug-geometry-offset-top") ?? "0"),
        height: parseFloat(el.getAttribute("data-ui-scene-debug-geometry-height") ?? "0"),
      });
      geometryByColumn.set(columnName, entries);
    });
  }

  return (
    <div
      data-ui-scene-debug-overlay
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        zIndex: 9999,
        background: "rgba(0,0,0,0.8)",
        color: "#fff",
        fontFamily: "monospace",
        fontSize: 11,
        padding: "6px 10px",
        borderRadius: 4,
        // F4 feature (e) tradeoff, taken deliberately and documented rather
        // than left as a silent side effect: every OTHER debug element
        // (outlines, badges, stage bounds, stray-child flags) stays
        // pointerEvents:"none" — pure observation, exactly what F4 commit 1
        // guarantees ("Debug does not affect layout"). This ONE panel
        // becomes pointerEvents:"auto" so its slowMo checkbox below is
        // actually clickable, which means debug mode's bottom-right corner
        // becomes click-opaque (mouse/touch events over the panel hit it,
        // not whatever Scene content happens to sit underneath) — an
        // inherent, accepted cost of having ANY interactive debug chrome at
        // all. This does not reopen the purity bar: that bar is about
        // layout/scroll METRICS (scrollWidth/clientWidth/rects) being
        // identical debug on vs off, which pointer-events has zero bearing
        // on — nothing here changes what gets MEASURED or LAID OUT, only
        // what a click in this specific screen region hits.
        pointerEvents: "auto",
      }}
    >
      <label
        data-ui-scene-debug-slowmo-toggle
        style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4, cursor: "pointer" }}
      >
        <input type="checkbox" checked={slowMo} onChange={onToggleSlowMo} />
        slow motion
      </label>

      <div style={{ fontWeight: "bold", marginBottom: 4 }}>Scene objects</div>
      {objects.map((obj) => {
        const bounds = objectBounds.find((b) => b.name === obj.name);
        return (
          <div key={obj.name}>
            <span style={{ color: obj.focused ? "#4ade80" : "#9ca3af" }}>
              {obj.name}
            </span>
            {" — "}
            <span style={{ color: obj.focused ? "#4ade80" : "#9ca3af" }}>
              {obj.focused ? "focused" : "unfocused"}
            </span>
            {bounds && (
              <span style={{ color: "#6b7280" }}>
                {" "}
                {bounds.width}×{bounds.height} @ {bounds.x},{bounds.y}
              </span>
            )}
          </div>
        );
      })}

      {offsetParentWarnings.length > 0 && (
        <>
          <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4, color: "#f87171" }}>
            ⚠ offsetParent warning
          </div>
          {offsetParentWarnings.map((name) => (
            <div key={name} style={{ color: "#f87171" }}>
              {name}: positioned ancestor breaks bounds
            </div>
          ))}
        </>
      )}

      {columnStacks.length > 0 && (
        <>
          <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4 }}>
            Column stacking
          </div>
          {columnStacks.map((col) => (
            <div key={col.name}>
              <span style={{ color: "#c4b5fd" }}>{col.name}</span>
              {": "}
              <span style={{ color: "#94a3b8" }}>{col.classification}</span>
              {col.classification === "in-between" && (
                <span style={{ color: "#94a3b8" }}>{" depth "}{col.depth}</span>
              )}
            </div>
          ))}
        </>
      )}

      {columnScrollStates.length > 0 && (
        <>
          <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4 }}>
            Vertical scroll
          </div>
          {columnScrollStates.map((col) => (
            <div key={col.name} data-ui-scene-debug-scroll-column={col.name}>
              <span style={{ color: col.scrollable ? "#facc15" : "#9ca3af" }}>
                {col.name}
              </span>
              {": "}
              <span>{Math.round(col.scrollOffset)}</span>
              {" / "}
              <span>{Math.round(col.contentHeight - col.viewportHeight)}</span>
              {col.scrollable ? " (scrollable)" : " (fits)"}
            </div>
          ))}
        </>
      )}

      {geometryByColumn.size > 0 && (
        <>
          <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4 }}>
            Geometry store
          </div>
          {Array.from(geometryByColumn.entries()).map(([columnName, entries]) => (
            <div key={columnName} data-ui-scene-debug-geometry-column={columnName}>
              <span style={{ color: "#c4b5fd" }}>{columnName}</span>
              {entries.map((entry) => (
                <div key={entry.name} style={{ paddingLeft: 8 }} data-ui-scene-debug-geometry-object={entry.name}>
                  <span style={{ color: "#9ca3af" }}>{entry.name}</span>
                  {": top="}
                  {Math.round(entry.offsetTop)}
                  {" h="}
                  {Math.round(entry.height)}
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4 }}>
        Horizontal scroll
      </div>
      <div data-ui-scene-debug-h-scroll>
        {Math.round(scrollLeft)} / {Math.round(scrollWidth - clientWidth)} (vp:{" "}
        {Math.round(clientWidth)})
      </div>

      <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4 }}>
        Camera
      </div>
      <div data-ui-scene-debug-camera>
        <span style={{ color: "#93c5fd" }}>viewport</span>
        {": "}
        {Math.round(clientWidth)} × {Math.round(viewport?.clientHeight ?? 0)}
      </div>

      {motionRecorder && <ActiveSpringsSection recorder={motionRecorder} />}
    </div>
  );
}
