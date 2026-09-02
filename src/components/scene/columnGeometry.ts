import React, { isValidElement } from "react";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import type { WithinColumnDepthInfo } from "./ColumnContext";

/** Derives whether any direct SceneObject child is currently focused. */
export function deriveColumnFocused(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some(
    (child) =>
      isValidElement<SceneObjectProps>(child) &&
      child.type === SceneObject &&
      child.props.focused === true,
  );
}

/** A direct SceneObject child's focus state and reset preference, in DOM order. */
export interface ObjectState {
  name: string;
  focused: boolean;
  resetAlignment: "top" | "center";
}

/**
 * Derives all direct SceneObject children's focus state in DOM order.
 * Returns an array of `{ name, focused, resetAlignment }` entries.
 */
export function deriveObjectStates(children: React.ReactNode): ObjectState[] {
  const result: ObjectState[] = [];
  React.Children.forEach(children, (child) => {
    if (
      isValidElement<SceneObjectProps>(child) &&
      child.type === SceneObject
    ) {
      result.push({
        name: child.props.name,
        focused: child.props.focused,
        resetAlignment: child.props.resetAlignment ?? "top",
      });
    }
  });
  return result;
}

/**
 * Joins the names of all currently-focused objects (sorted, so the key is
 * independent of DOM order) into a single string key. Used by the swap-reset
 * scroll model (A2) to distinguish an unchanged inner focus arrangement
 * (park/return — restore) from a within-column swap (reset).
 */
export function computeFocusedObjectKey(objectStates: ObjectState[]): string {
  return objectStates
    .filter((o) => o.focused)
    .map((o) => o.name)
    .sort()
    .join(",");
}

/** A registered object's measured position within its column's content wrapper. */
export interface GeometryEntry {
  /** Distance (px) from the content wrapper's top edge to this object's top edge. */
  offsetTop: number;
  /**
   * This object's LIVE rendered height (px), via offsetHeight — a raw DOM
   * measurement of the object's own outer anchor node. HAZARD (ui/t:21 delta
   * claim review Slice 0 spike, source-verified): unlike `width` below,
   * this is NOT safe to read for a currently-focused object once ui/t:21's
   * own height-override channel lands (SceneObject.tsx) — that channel
   * applies a pixel override DIRECTLY to this SAME anchor node, so
   * `offsetHeight` read here would capture the spring's own in-flight
   * value mid-transition, not a settled target (the exact "camera chases
   * width" bug class, on the vertical scroll model this time). Consumers
   * summing focused-object height (computeFocusedContentHeight,
   * inputController.ts's selectAnchorObject) MUST read `heightTarget`
   * below instead. This raw field survives only for the Slice 0
   * disposition list's OWN "harmless" sites (debug overlays, one-shot
   * command reads, column-level frozen-size snapshots) — see the plan's
   * own disposition list before adding a new consumer here.
   */
  height: number;
  /**
   * This object's height-channel TARGET (px) — synchronously known,
   * mirroring `width`'s own precedent below exactly: 0 while sandwiched
   * (permanent), the object's own natural in-flow height while focused or
   * otherwise in-flow (a snapshot taken at rest, when nothing is
   * overriding it — see SceneObject.tsx's naturalHeightRef). Reported by
   * SceneObject via the extended `register` call (ui/t:21) — NOT derived
   * from a DOM read here, since the same node this measures is the one
   * the height channel writes to (see `height`'s own hazard note above).
   * Undefined only during the one-render deferred-measurement window for
   * an object that mounts already sandwiched, never having been in-flow
   * (mirrors `neverFocusedNaturalWidth`'s own bootstrap case) — a
   * currently-focused object never has this undefined in practice, since
   * an object must be in-flow to become focused in the first place.
   */
  heightTarget: number | undefined;
  /**
   * This object's rendered width (px) — the ui/t:17 owned width channel's
   * "after" target. An object's own declared width (e.g. a `cqw` value)
   * resolves against the STAGE's container-query context (Scene.tsx's
   * `containerType: "size"`), not this column's own current box, so it's
   * stable and measurable regardless of whether the column itself is
   * currently constrained by a frozen or in-flight spring width.
   */
  width: number;
}

/**
 * Computes the vertical offset (in px) that the content wrapper must slide to
 * bring the (single) focused object into view at the top of the column.
 * Returns 0 when multiple objects are focused (stacking — show from top) or
 * when no objects are focused.
 *
 * Reads the focused object's own measured offsetTop directly from the
 * geometry store — every registered object (focused or not, except
 * within-column depth cards) stays in flow, so its rendered offset already
 * reflects the real cumulative height (and gap) of everything before it,
 * with no need to sum anything here.
 */
export function computeTopOffset(
  objectStates: ObjectState[],
  geometryStore: Map<string, GeometryEntry>,
): number {
  const focusedNames = objectStates
    .filter((o) => o.focused)
    .map((o) => o.name);

  // Multi-focus stacking: show from top, no offset
  if (focusedNames.length !== 1) return 0;

  const focusedName = focusedNames[0]!;
  return geometryStore.get(focusedName)?.offsetTop ?? 0;
}

/**
 * ui/t:17: computes the column's own target width while focused — the widest
 * currently-focused object's own measured width (multi-focus stacking can
 * have several focused objects of different widths; the column's
 * shrink-to-fit box becomes as wide as the widest one, matching ordinary
 * block layout). Returns undefined when nothing is focused, or when a
 * focused object hasn't been geometry-measured yet (e.g. its very first
 * render, before any remeasure pass has run) — the caller's own "no target
 * yet" handling (no override, natural CSS sizing) already covers this.
 */
export function computeFocusedWidth(
  objectStates: ObjectState[],
  geometryStore: Map<string, GeometryEntry>,
): number | undefined {
  let width: number | undefined;
  for (const { name, focused } of objectStates) {
    if (!focused) continue;
    const entry = geometryStore.get(name);
    if (!entry) continue;
    width = width === undefined ? entry.width : Math.max(width, entry.width);
  }
  return width;
}

/**
 * The widest REGISTERED object's own measured width, regardless of focus.
 * Unlike computeFocusedWidth, this doesn't filter to focused objects — a
 * deck column's own object is never focused while it's the one being
 * measured, so computeFocusedWidth would always return undefined for it.
 * Safe from the circularity a same-node-composition design would hit
 * (geometryStore measuring an already-crushed size fed back as the
 * channel's own target): the column this feeds is position:absolute within
 * its own zero-footprint anchor, never constrained by the anchor's own
 * shrinking width, so its own natural/cqw-resolved size is always what's
 * actually measured here.
 */
export function computeMeasuredWidth(
  objectStates: ObjectState[],
  geometryStore: Map<string, GeometryEntry>,
): number | undefined {
  let width: number | undefined;
  for (const { name } of objectStates) {
    const entry = geometryStore.get(name);
    if (!entry) continue;
    width = width === undefined ? entry.width : Math.max(width, entry.width);
  }
  return width;
}

// The owned-channel settle counter's own claim/retire guard now lives at
// the shared seam every animate()/jump() call for an owned MotionValue
// flows through — see ownedAnimation.ts's useOwnedAnimation() doc comment
// (ui/t:17 cascade-fix round, Step 2) for the full rationale, including why
// this replaced the hand-wired per-channel guard that originally lived
// here.

/**
 * Identifies unfocused SceneObjects that are sandwiched between two focused
 * siblings in DOM order and computes depth info for each. These objects will
 * peek out above the lower focused sibling rather than being hidden.
 *
 * Depth index counts from the lower focused sibling outward: the unfocused
 * object immediately above the lower focused object is depth-1, the next one
 * is depth-2, and so on.
 *
 * INVARIANT (load-bearing for the object-level z-index paint-order channel —
 * mirrors computeStackDepths' own DOM-order invariant at the column level
 * (sceneLayout.ts; see also SceneColumn.tsx's own comment near
 * columnDepth/depthZ), but serves a DIFFERENT purpose): within a single
 * sandwiched cluster (a contiguous run
 * of unfocused objects bounded by the same two focused siblings), `depth =
 * lowerFocusedIndex - i` is structurally guaranteed to produce depth order
 * ≡ reverse DOM order — the object further from the lower focused sibling
 * (earlier in DOM within the cluster) always gets the higher depth value.
 * SceneObject's own zIndex channel writes `-depth` directly, so THIS
 * ordering is what makes shallower siblings paint in front of deeper ones
 * (the "multi-sandwiched" z-index test's own subject). UNLIKE column-level
 * paint order, object-level DOM order alone does NOT structurally guarantee
 * correct stacking on its own (an object's own inner node sits outside any
 * column's preserve-3d chain — ui/o:32, the D-series record), so this invariant is
 * what the explicit z-index channel is built ON TOP OF, not a substitute
 * for it.
 *
 * `anchorTop` (a cross-object, live geometryStore read of the lower focused
 * sibling's own measured offsetTop) was DELETED from this function's return
 * shape (ui/t:21 Slice 4 hygiene) — verified zero consumers at tip
 * (SceneObject's peekY computation only ever reads `.depth`) and verified
 * vestigial by the same geometric argument the plan's own Design port
 * section made before implementation: every sandwiched object's own
 * zero-height anchor converges on the SAME local origin (flush against the
 * lower focused sibling) once settled, since each collapsed object
 * contributes exactly zero net flow height — the column's peek-offset
 * transform only needs its OWN local depth (`-peekOffset * depth`), never a
 * cross-object measured position. Same shape as ui/t:17's own stackTargetLeft
 * deletion (a cross-sibling measured value the flow-collapse architecture
 * made unnecessary).
 *
 * Returns a Map from object name → `{ depth }` for every between-unfocused
 * object. Objects that are not sandwiched are absent from the map.
 */
export function computeWithinColumnDepths(objectStates: ObjectState[]): Map<string, WithinColumnDepthInfo> {
  const result = new Map<string, WithinColumnDepthInfo>();
  const n = objectStates.length;

  // For each unfocused object, check whether there is a focused object both
  // before it and after it in DOM order.
  for (let i = 0; i < n; i++) {
    if (objectStates[i]!.focused) continue;

    const hasFocusedBefore = objectStates.slice(0, i).some((o) => o.focused);
    const focusedAfterIndex = objectStates.slice(i + 1).findIndex((o) => o.focused);
    if (!hasFocusedBefore || focusedAfterIndex === -1) continue;

    // This object is between two focused objects. Find the lower focused sibling
    // (the first focused object after this one in DOM order).
    const lowerFocusedIndex = i + 1 + focusedAfterIndex;

    // Depth = distance from this object to the lower focused sibling.
    // The object immediately above lowerFocused is depth-1, further away is higher.
    const depth = lowerFocusedIndex - i;

    result.set(objectStates[i]!.name, { depth });
  }

  return result;
}

/**
 * Sums the height-channel TARGETS of every currently-focused object (from
 * the geometry store) plus the gaps between them. This is the focused-content
 * scroll range — a distinct concept from topOffset (strip position): it
 * only ever includes focused content, never unfocused in-flow siblings.
 *
 * Reads `heightTarget`, NOT `height` (ui/t:21 delta claim review Slice 0 spike
 * finding, ruled): `height` is a live offsetHeight read on the same node
 * ui/t:21's own height-override channel writes to — summing it here would
 * chase the channel's own in-flight spring value mid-transition, the exact
 * "camera chases width" bug class ui/t:17 already had to fix once (see
 * GeometryEntry's own `heightTarget` doc comment for the full mechanism).
 * `heightTarget` is a synchronously-known spring destination instead, safe
 * to sum at any point in a transition. Falls back to `height` only for a
 * legacy/defensive path (an object that hasn't yet reported a height
 * target via the extended register() call — should not occur for a
 * currently-focused object in practice, since an object must be in-flow to
 * become focused, but kept as a non-throwing fallback rather than `?? 0`,
 * which would silently zero out a real object's contribution).
 */
export function computeFocusedContentHeight(
  objectStates: ObjectState[],
  geometryStore: Map<string, GeometryEntry>,
  objectGap: number,
): number {
  let focusedHeight = 0;
  let focusedCount = 0;
  for (const { name, focused } of objectStates) {
    if (!focused) continue;
    focusedCount++;
    const entry = geometryStore.get(name);
    focusedHeight += entry?.heightTarget ?? entry?.height ?? 0;
  }
  if (focusedCount > 1 && objectGap) {
    focusedHeight += (focusedCount - 1) * objectGap;
  }
  return focusedHeight;
}
