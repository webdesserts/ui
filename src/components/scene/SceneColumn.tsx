import React, { isValidElement } from "react";
import { motion } from "motion/react";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import { useSceneConfig } from "./useSceneConfig";

export interface SceneColumnProps {
  /** Stable name for this column. Shown in debug mode and used for implicit wrapping. */
  name: string;
  children: React.ReactNode;
}

/** Derives whether any direct SceneObject child is currently focused. */
function deriveColumnFocused(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some(
    (child) =>
      isValidElement<SceneObjectProps>(child) &&
      child.type === SceneObject &&
      child.props.focused === true,
  );
}

/**
 * A vertical slot within a Scene. Objects inside a column share a horizontal
 * position and swap vertically when focus changes. A column is considered
 * focused if any of its children are focused.
 *
 * Focused columns participate in the Scene's flex row (`position: relative`,
 * `flex: 0 1 auto`). Unfocused columns exit the flex flow and become
 * `position: absolute` with `opacity: 0`.
 *
 * @example
 * <SceneColumn name="nav">
 *   <SceneObject name="nav-panel" focused={view === "nav"}>
 *     <NavPanel />
 *   </SceneObject>
 * </SceneColumn>
 */
export function SceneColumn({ name, children }: SceneColumnProps) {
  const columnFocused = deriveColumnFocused(children);
  const { duration } = useSceneConfig();

  // duration=0 → instant transitions for tests; undefined → spring physics.
  const transition = duration === 0 ? { duration: 0 } : { type: "spring" as const };

  // position and flex must be in `style` (not `animate`) because motion only
  // animates transforms, opacity, and CSS custom properties — not layout properties.
  // flex: 1 1 0 → equal sharing of available viewport width among focused columns.
  const focusedStyle: React.CSSProperties = {
    position: "relative",
    flex: "1 1 0",
    minWidth: 0,
    opacity: 1,
  };

  // Unfocused columns exit flex flow and are hidden. opacity is set here
  // directly so the initial render doesn't flash before motion applies animate.
  const unfocusedStyle: React.CSSProperties = {
    position: "absolute",
    flex: "none",
    opacity: 0,
  };

  return (
    <motion.div
      layout
      data-column={name}
      data-column-focused={String(columnFocused)}
      animate={{ opacity: columnFocused ? 1 : 0 }}
      transition={transition}
      style={columnFocused ? focusedStyle : unfocusedStyle}
    >
      {children}
    </motion.div>
  );
}

// Explicit displayName allows Scene to detect SceneColumn children via
// child.type.displayName without importing SceneColumn directly (avoiding
// circular import issues).
SceneColumn.displayName = "SceneColumn";
