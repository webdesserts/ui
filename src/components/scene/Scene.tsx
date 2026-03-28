import React, { isValidElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SceneColumn } from "./SceneColumn";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import { SceneConfigContext, useSceneConfig } from "./useSceneConfig";
import { CameraContext } from "./useCamera";
import { ViewportContext } from "./ViewportContext";
import { motion } from "motion/react";

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

/** A snapshot of a SceneObject's state for the debug overlay. */
interface DebugObjectEntry {
  name: string;
  focused: boolean;
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
 * Walks the children tree and collects all SceneObject name + focused pairs.
 * Used by the debug overlay to list all registered objects without needing a
 * separate registration context.
 */
function collectObjectEntries(children: React.ReactNode): DebugObjectEntry[] {
  const entries: DebugObjectEntry[] = [];

  React.Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;

    if (child.type === SceneObject) {
      const props = child.props as SceneObjectProps;
      entries.push({ name: props.name, focused: props.focused });
    } else if ((child.props as { children?: React.ReactNode }).children) {
      // Recurse into SceneColumns and other wrappers
      entries.push(
        ...collectObjectEntries(
          (child.props as { children?: React.ReactNode }).children,
        ),
      );
    }
  });

  return entries;
}

/** Debug overlay rendered inside the Scene when `debug` is enabled. */
function SceneDebugOverlay({ objects }: { objects: DebugObjectEntry[] }) {
  return (
    <div
      data-debug-overlay
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
        pointerEvents: "none",
      }}
    >
      <div style={{ fontWeight: "bold", marginBottom: 4 }}>Scene objects</div>
      {objects.map((obj) => (
        <div key={obj.name}>
          <span style={{ color: obj.focused ? "#4ade80" : "#9ca3af" }}>
            {obj.name}
          </span>
          {" — "}
          <span style={{ color: obj.focused ? "#4ade80" : "#9ca3af" }}>
            {obj.focused ? "focused" : "unfocused"}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Inner scene content — reads debug flag from config to apply outline. */
function SceneViewport({
  children,
  debugObjects,
}: {
  children: React.ReactNode;
  debugObjects: DebugObjectEntry[] | null;
}) {
  const { debug } = useSceneConfig();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportDimensions>({ width: 0, height: 0 });

  // Measure viewport dimensions synchronously on first render so columns have
  // valid values immediately (useLayoutEffect fires before paint, before
  // ResizeObserver callbacks). ResizeObserver keeps the values current for
  // dynamic viewport resizes.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setViewportSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setViewportSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <ViewportContext.Provider value={viewportSize}>
      {/* layoutScroll tells motion to account for scroll offset when measuring
          FLIP positions inside this overflow-hidden container. */}
      <motion.div
        ref={viewportRef}
        layoutScroll
        data-testid="scene"
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          outline: debug ? "2px solid cyan" : undefined,
        }}
      >
        {/* Stage: the flex row of focused columns. width: fit-content allows the
            stage to shrink to content width. margin-inline: auto centers the
            stage within the viewport when it's narrower. When it overflows (or
            all columns are flexible and fill the stage), margins collapse to 0
            and content left-aligns naturally.

            Flexible (flex: 1 1 0) columns grow to fill the stage width, which
            is their own intrinsic content size — they share that width equally.
            Columns with explicit minimum widths (e.g. minWidth: 300px) determine
            the stage's width directly. */}
        <div
          data-stage
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "stretch",
            width: "fit-content",
            marginInline: "auto",
          }}
        >
          {children}
        </div>
        {/* Overlay is inside the scene div so tests can find it via
            scene.querySelector('[data-debug-overlay]'). position:fixed
            ensures it doesn't participate in flex layout. */}
        {debug && debugObjects && <SceneDebugOverlay objects={debugObjects} />}
      </motion.div>
    </ViewportContext.Provider>
  );
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
  const debugObjects = debug ? collectObjectEntries(children) : null;

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
        <SceneViewport debugObjects={debugObjects}>
          {wrappedChildren}
        </SceneViewport>
      </CameraContext.Provider>
    </SceneConfigContext.Provider>
  );
}
