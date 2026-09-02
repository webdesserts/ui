import type { ComponentProps, CSSProperties } from "react";
import { Scene, SceneColumn, SceneObject } from "../../src";
import { TestWrapper } from "../test-wrapper";

/**
 * Shared fixture builder for the dominant Scene test shape: a flat
 * SceneColumn > SceneObject > div nest, one object per column, wrapped in
 * TestWrapper + Scene (ui/o:45 / ui/t:23). Replaces hand-rolled JSX at
 * structurally-identical call sites — genuinely bespoke shapes (Fragment-
 * wrapped columns, custom-component-wrapped columns, div-wrapped objects,
 * multi-object columns needing per-object control beyond this shape) stay
 * inline rather than being forced through here.
 */
export type SceneObjectSpec = {
  name: string;
  /** Required — never silently defaulted (ui/o:45's non-vacuity rule). */
  focused: boolean;
  /** Required — never silently defaulted (ui/o:45's non-vacuity rule). */
  width: number | string;
  /** Required — never silently defaulted (ui/o:45's non-vacuity rule). */
  height: number | string;
  /** Defaults to `${name}-content`, the file's dominant convention. */
  testId?: string;
  /** Merged over width/height for overrides (overflowY, cqw units, etc.). */
  style?: CSSProperties;
  onActivate?: () => void;
};

export type SceneColumnSpec = {
  name: string;
  objects: SceneObjectSpec[];
};

/**
 * `sceneProps` is PASSTHROUGH ONLY — `duration` is never injected or
 * defaulted here. Mirror the source site's presence/absence of `duration`
 * exactly when converting a render call: omit the key entirely for a bare
 * `<Scene>` (the real spring-animated path), or pass `{ duration: 0 }` when
 * the source had it explicit. Silently defaulting `duration` would flip a
 * spring-animated test onto the instant path without changing its name or
 * count, invisible to the split's parity protocol.
 */
export function buildScene(
  columns: SceneColumnSpec[],
  sceneProps?: Partial<ComponentProps<typeof Scene>>,
  wrapperProps?: { fullPage?: boolean; width?: number; height?: number },
) {
  return (
    <TestWrapper {...wrapperProps}>
      <Scene {...sceneProps}>
        {columns.map((column) => (
          <SceneColumn key={column.name} name={column.name}>
            {column.objects.map((object) => (
              <SceneObject key={object.name} name={object.name} focused={object.focused} onActivate={object.onActivate}>
                <div
                  data-testid={object.testId ?? `${object.name}-content`}
                  style={{ width: object.width, height: object.height, ...object.style }}
                />
              </SceneObject>
            ))}
          </SceneColumn>
        ))}
      </Scene>
    </TestWrapper>
  );
}
