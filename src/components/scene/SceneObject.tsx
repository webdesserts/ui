import React, { useContext, useEffect, useLayoutEffect, useRef } from "react";
import { ColumnContext } from "./SceneColumn";
import { computeDepthTreatment } from "./depth";

export interface SceneObjectProps {
  /** Stable identifier for this object. Used as data-scene-id and for the implicit column name. */
  name: string;
  /** Whether this object is currently in focus. Focused objects participate in the flex layout. */
  focused: boolean;
  children: React.ReactNode;
  /**
   * Called when an unfocused SceneObject is clicked. The consumer should use
   * this to set `focused={true}` on this object, which triggers a Scene layout
   * transition. Not called when the object is already focused.
   */
  onActivate?: () => void;
  /**
   * Inline styles applied to the outer wrapper div. Useful for setting
   * explicit dimensions (width, height, minWidth) on the object.
   */
  style?: React.CSSProperties;
  /**
   * How this column's scroll position resets when this object becomes the
   * newly-focused object after a within-column swap (the A2 swap-reset
   * model — a swap always resets deterministically, it never inherits the
   * previously-focused object's scroll position). "top" (default) shows
   * this object from the top of its content; "center" starts roughly
   * centered — e.g. an image viewer where the interesting content sits
   * mid-frame. Read by the parent SceneColumn via child prop introspection
   * (deriveObjectStates) — not used directly by this component.
   */
  resetAlignment?: "top" | "center";
}

/**
 * An individual focusable item within a SceneColumn. When unfocused, the inner
 * content wrapper receives the `inert` attribute, disabling all descendant
 * interaction. The outer wrapper stays interactive for click-to-focus (Phase 8).
 *
 * Within a column, focused objects are `position: relative` (in flow) and
 * unfocused siblings are `position: absolute` (out of flow). The column's
 * content wrapper slides vertically to bring the focused object into view.
 *
 * @example
 * <SceneObject name="article" focused={currentView === "article"}>
 *   <ArticlePanel />
 * </SceneObject>
 */
export function SceneObject({ name, focused, children, onActivate, style }: SceneObjectProps) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const column = useContext(ColumnContext);

  // Register this object's DOM element with the parent SceneColumn so the
  // column can track it. useLayoutEffect fires bottom-up (children before
  // parent), ensuring registration happens before the column's own
  // useLayoutEffect reads the registered elements.
  useLayoutEffect(() => {
    if (!column || !outerRef.current) return;
    return column.register(name, outerRef.current);
  }, [column, name]);

  // When this object transitions from unfocused to focused, move keyboard
  // focus to the first focusable element inside it so keyboard users land
  // directly in the new content without needing to tab manually.
  //
  // We use useEffect (not useLayoutEffect) so the DOM has been painted and the
  // inner wrapper's `inert` attribute has been removed before we try to focus.
  // The dependency on `focused` ensures this only fires when focus state changes,
  // not on every render.
  const prevFocusedRef = useRef(focused);
  useEffect(() => {
    const justBecameFocused = focused && !prevFocusedRef.current;
    prevFocusedRef.current = focused;

    if (!justBecameFocused || !outerRef.current) return;

    const focusable = outerRef.current.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    focusable?.focus();
  }, [focused]);

  // Within-column depth deck: this object is sandwiched between two focused
  // siblings. Instead of hiding it, we show it stacked behind the lower focused
  // sibling with depth-card visual treatment.
  const withinDepthInfo = column?.withinColumnDepths.get(name);

  // Within a focused column, unfocused objects are removed from flow so they
  // don't push down the focused object. They are also hidden so they don't
  // render on top of the focused object (topOffset may be 0 if the object was
  // never previously focused and has no saved natural height).
  //
  // Within an unfocused column (depth deck or outer), all objects stay in flow
  // (isInDepthDeck = true) so the column sizes to its content — necessary for
  // outer columns to have natural width and for depth-deck perspective sizing.
  //
  // Exception: unfocused objects between two focused siblings get depth-card
  // treatment — position: absolute, translateZ projects them back in 3D space
  // within the column content wrapper's perspective context.
  //
  // When there is no parent column context (standalone usage), fall back to
  // default (static) positioning.
  const withinDepth = withinDepthInfo ? computeDepthTreatment(withinDepthInfo.depth) : undefined;

  const inColumnStyle: React.CSSProperties | undefined = column
    ? focused
      ? { position: "relative", transform: "translateZ(0)" }
      : withinDepthInfo && withinDepth
        ? {
            position: "absolute",
            // Anchor near the lower focused sibling. Perspective projection
            // handles the visual depth — no manual peek offset needed.
            top: withinDepthInfo.anchorTop,
            // translateZ pushes this object back in 3D space. The column
            // content wrapper's perspective (800px) projects it smaller:
            // depth-1 → 800/900 ≈ 0.89×, depth-2 → 800/1000 = 0.80×.
            transform: `translateZ(${withinDepth.translateZ}px)`,
            opacity: withinDepth.opacity,
            filter: withinDepth.grayscale > 0 ? `grayscale(${withinDepth.grayscale})` : undefined,
          }
        : {
            position: "relative",
            // Unfocused objects not in the depth deck still get pushed back
            // 1 z-level and receive depth-1 visual treatment to distinguish
            // them from focused content.
            transform: "translateZ(-100px)",
            opacity: 0.8,
            filter: "grayscale(0.25)",
          }
    : undefined;

  return (
    <div
      ref={outerRef}
      data-scene-id={name}
      data-focused={String(focused)}
      {...(withinDepthInfo ? { "data-within-column-depth": String(withinDepthInfo.depth) } : {})}
      style={{ ...inColumnStyle, ...style }}
      onClick={!focused ? onActivate : undefined}
    >
      {/* Inner wrapper: inert when unfocused to disable all descendant interaction.
          React 19 treats inert={true} as the attribute present, inert={false} as absent. */}
      <div inert={!focused}>
        {children}
      </div>
    </div>
  );
}
