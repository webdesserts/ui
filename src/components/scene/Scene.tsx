import React, { isValidElement } from "react";
import { SceneColumn } from "./SceneColumn";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import { SceneConfigContext } from "./useSceneConfig";
import { CameraContext } from "./useCamera";

export interface SceneProps {
  children: React.ReactNode;
  /**
   * Animation duration override (in ms). Set to 0 to disable all animations
   * in tests. When omitted, spring physics are used.
   */
  duration?: number;
  /** Enable debug overlays. */
  debug?: boolean;
}

/**
 * Wraps a bare SceneObject child in an implicit SceneColumn using the
 * SceneObject's name as the column name. SceneColumn children pass through
 * unchanged.
 */
function wrapChild(child: React.ReactNode): React.ReactNode {
  if (!isValidElement(child)) return child;

  // SceneColumn passes through — already has a column wrapper.
  const type = child.type as { displayName?: string } | string;
  if (
    typeof type !== "string" &&
    (type === SceneColumn || type.displayName === "SceneColumn")
  ) {
    return child;
  }

  // Bare SceneObject: wrap in an implicit column using the SceneObject's name.
  if (child.type === SceneObject) {
    const objectProps = child.props as SceneObjectProps;
    return (
      <SceneColumn key={objectProps.name} name={objectProps.name}>
        {child}
      </SceneColumn>
    );
  }

  return child;
}

/**
 * The top-level spatial navigation container. Renders a horizontal flex row of
 * SceneColumns. Bare SceneObjects placed directly inside Scene are automatically
 * wrapped in implicit SceneColumns using the object's name.
 *
 * @example
 * <Scene>
 *   <SceneColumn name="nav">
 *     <SceneObject name="nav-panel" focused={view === "nav"}>
 *       <NavPanel />
 *     </SceneObject>
 *   </SceneColumn>
 *   <SceneColumn name="content">
 *     <SceneObject name="article" focused={view !== "nav"}>
 *       <Article />
 *     </SceneObject>
 *   </SceneColumn>
 * </Scene>
 */
export function Scene({ children, duration, debug = false }: SceneProps) {
  const wrappedChildren = React.Children.map(children, wrapChild);

  return (
    <SceneConfigContext.Provider
      value={{ stiffness: 300, damping: 30, padding: 0, duration, debug }}
    >
      <CameraContext.Provider
        value={{
          bounds: { top: 0, left: 0, width: 0, height: 0 },
          transitioning: false,
        }}
      >
        <div data-testid="scene" style={{ display: "flex", flexDirection: "row" }}>
          {wrappedChildren}
        </div>
      </CameraContext.Provider>
    </SceneConfigContext.Provider>
  );
}
