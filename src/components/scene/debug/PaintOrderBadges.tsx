import React, { useState, useCallback, useLayoutEffect, useEffect, useRef } from "react";

/** Identifies one deck card (column-level in-between, or within-column depth object). */
interface DeckCardKey {
  /** React key + badge-ref key. */
  key: string;
  kind: "column" | "object";
  /** The data-ui-scene-column-anchor name (kind "column") or data-ui-scene-id name (kind
   *  "object") used to re-find the live DOM element on every frame. */
  domId: string;
}

/**
 * Finds every current deck card: columns classified in-between (F1/H8's
 * `data-ui-scene-stack-depth`, only ever set for in-between columns) and
 * within-column depth-deck objects (`data-ui-scene-within-column-depth`, only ever
 * set when an object is sandwiched between two focused siblings — see
 * SceneObject's withinDepthInfo). Focused cards and outer-left/outer-right
 * columns carry neither attribute and are correctly excluded — badges are
 * for deck cards specifically, matching the paint-order invariant they
 * exist to visually check (Michael's ruled invariant: two objects
 * overlapping in 2D screen space must never change which one paints on top
 * — see tests/utils/animation.ts's assertPaintOrderInvariant).
 */
function findDeckCardKeys(stage: HTMLElement): DeckCardKey[] {
  const keys: DeckCardKey[] = [];
  stage.querySelectorAll<HTMLElement>("[data-ui-scene-stack-depth]").forEach((el) => {
    const name = el.getAttribute("data-ui-scene-column-anchor") ?? "";
    keys.push({ key: `column:${name}`, kind: "column", domId: name });
  });
  stage.querySelectorAll<HTMLElement>("[data-ui-scene-within-column-depth]").forEach((el) => {
    const name = el.getAttribute("data-ui-scene-id") ?? "";
    keys.push({ key: `object:${name}`, kind: "object", domId: name });
  });
  return keys;
}

function deckCardKeysEqual(a: DeckCardKey[], b: DeckCardKey[]): boolean {
  return a.length === b.length && a.every((k, i) => k.key === b[i]?.key);
}

/**
 * Reads the live translateZ a card is CURRENTLY rendered at, straight off
 * its computed `transform` — not off a MotionValue, because only
 * SceneColumn's column-level z is one (zMV, registered on the motion seam
 * for feature (a)'s active-springs panel); a within-column depth object's z
 * lives in Motion's declarative `animate` prop (WAAPI-driven — see
 * SceneObject's own comment on why opacity/filter/z go there instead of a
 * MotionValue). getComputedStyle reflects whichever mechanism is driving a
 * given card, uniformly, so one read path covers both card kinds. Any 3D
 * transform (translateZ specifically) resolves to `matrix3d(...)` (16
 * comma-separated values, column-major) — tz is the 15th value (index 14).
 * A 2D `matrix(...)` or `none` has no z component (0).
 */
function parseTranslateZ(transform: string): number {
  const match = transform.match(/matrix3d\(([^)]+)\)/);
  if (!match) return 0;
  const values = match[1]!.split(",").map((v) => parseFloat(v.trim()));
  return values[14] ?? 0;
}

/**
 * F4 feature (d): a small badge on every deck card (column-level and
 * within-column) showing its current live paint-order value — the visual
 * check for the paint-order invariant (do cards nearer the front actually
 * paint in front of cards behind them, at a glance, without pausing a
 * transition and inspecting devtools). Updates continuously via
 * requestAnimationFrame while mounted (i.e. while `debug` is enabled) —
 * same rationale and pattern as ActiveSpringsSection.tsx: the underlying
 * value can change every frame mid-spring, off React's own render cycle, so
 * reading it only at commit time would show it stale throughout a
 * transition.
 *
 * Two DIFFERENT mechanisms drive paint order depending on card kind (ui#21
 * z-index paint-order channel amendment) — column-level cards still use
 * translateZ (SceneColumn.tsx:~2856's own comment: paint-INERT there,
 * DOM-order actually governs, translateZ is kept for the perspective
 * foreshortening visual cue only); within-column object cards use a
 * discrete zIndex write instead (SceneObject's own zIndex comment —
 * object-level translateZ never actually reached the object and was removed
 * entirely). The badge reads whichever channel is real for that card kind.
 */
export function PaintOrderBadges({
  viewportRef,
  stageRef,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [cards, setCards] = useState<DeckCardKey[]>([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Deliberate every-render effect (no dependency array by design) — adding one changes it from per-render to per-dep-change, a real behavior change to a documented remeasure/correction idiom.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const fresh = stage ? findDeckCardKeys(stage) : [];
    setCards((prev) => (deckCardKeysEqual(prev, fresh) ? prev : fresh));
  });

  const badgeRefs = useRef<Map<string, HTMLElement>>(new Map());

  const updateBadges = useCallback(() => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage) return;
    const vpRect = viewport.getBoundingClientRect();
    for (const card of cards) {
      const el =
        card.kind === "column"
          ? stage.querySelector<HTMLElement>(`[data-ui-scene-column-anchor='${card.domId}']`)
          : stage.querySelector<HTMLElement>(`[data-ui-scene-id='${card.domId}']`);
      const badge = badgeRefs.current.get(card.key);
      if (!el || !badge) continue;
      const rect = el.getBoundingClientRect();
      badge.style.left = `${rect.left - vpRect.left}px`;
      badge.style.top = `${rect.top - vpRect.top}px`;
      if (card.kind === "column") {
        // ui#17 anchor/column split: the depth translateZ lives on the column's
        // inner column node now, not the outer flex anchor `el` itself — read
        // z from the column node when one exists (every column has one; this
        // falls back to `el` defensively, which has no column child to begin
        // with).
        const zSource = el.querySelector<HTMLElement>("[data-ui-scene-column]") ?? el;
        const z = parseTranslateZ(getComputedStyle(zSource).transform);
        badge.textContent = `z:${Math.round(z)}`;
      } else {
        // ui#21 z-index paint-order channel amendment: object-level depth
        // cards no longer carry translateZ at all (removed entirely — see
        // SceneObject's own zIndex comment) — paint order is a discrete
        // zIndex write on the object instead. parseTranslateZ would always
        // read 0 here now; read the real channel directly.
        const zSource = el.querySelector<HTMLElement>("[data-ui-scene-object]") ?? el;
        badge.textContent = `z:${getComputedStyle(zSource).zIndex}`;
      }
    }
  }, [cards, stageRef, viewportRef]);

  // Paint-synchronous pass so the first frame isn't blank before the first
  // rAF tick (mirrors ActiveSpringsSection/SceneObjectOutlines).
  useLayoutEffect(() => {
    updateBadges();
  });

  useEffect(() => {
    let rafId = requestAnimationFrame(function loop() {
      updateBadges();
      rafId = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(rafId);
  }, [updateBadges]);

  return (
    <>
      {cards.map((card) => (
        <div
          key={card.key}
          ref={(el) => {
            if (el) badgeRefs.current.set(card.key, el);
            else badgeRefs.current.delete(card.key);
          }}
          data-ui-scene-debug-paint-badge={card.key}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            background: card.kind === "column" ? "#7c3aed" : "#0891b2",
            color: "#fff",
            fontFamily: "monospace",
            fontSize: 9,
            padding: "0 2px",
            lineHeight: "12px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        />
      ))}
    </>
  );
}
