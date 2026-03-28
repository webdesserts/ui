import React, { useContext, useLayoutEffect, useRef } from "react";
import { ColumnContext } from "./SceneColumn";

export interface SceneObjectProps {
  /** Stable identifier for this object. Used as data-scene-id and for the implicit column name. */
  name: string;
  /** Whether this object is currently in focus. Focused objects participate in the flex layout. */
  focused: boolean;
  children: React.ReactNode;
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
export function SceneObject({ name, focused, children }: SceneObjectProps) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const column = useContext(ColumnContext);

  // Register this object's DOM element with the parent SceneColumn so the
  // column can measure its height for vertical offset calculations.
  // useLayoutEffect fires before the parent column's useLayoutEffect (children
  // fire bottom-up), ensuring elements are registered before the column
  // computes the vertical offset.
  useLayoutEffect(() => {
    if (!column || !outerRef.current) return;
    return column.register(name, outerRef.current);
  }, [column, name]);

  // Within a column, unfocused objects are removed from flow so they don't
  // affect the column's natural content height. Focused objects stay in flow.
  // When there is no parent column context (standalone usage), fall back to
  // default (static) positioning.
  const inColumnStyle: React.CSSProperties | undefined = column
    ? focused
      ? { position: "relative" }
      : { position: "absolute", opacity: 0 }
    : undefined;

  return (
    <div
      ref={outerRef}
      data-scene-id={name}
      data-focused={String(focused)}
      style={inColumnStyle}
    >
      {/* Inner wrapper: inert when unfocused to disable all descendant interaction.
          React 19 treats inert={true} as the attribute present, inert={false} as absent. */}
      <div inert={!focused}>
        {children}
      </div>
    </div>
  );
}
