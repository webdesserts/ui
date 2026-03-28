import React, {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { motion } from "motion/react";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import { useSceneConfig } from "./useSceneConfig";
import type { FrozenSize } from "./types";

// ---------------------------------------------------------------------------
// ColumnContext — lets SceneObjects register their elements with their parent
// column. The column uses these to compute vertical offsets for the swap.
// ---------------------------------------------------------------------------

interface ColumnRegistration {
  /** Register a SceneObject's outer element. Returns an unregister function. */
  register: (name: string, el: HTMLElement) => () => void;
}

export const ColumnContext = createContext<ColumnRegistration | null>(null);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Derives all direct SceneObject children's focus state in DOM order.
 * Returns an array of `{ name, focused }` entries.
 */
function deriveObjectStates(
  children: React.ReactNode,
): Array<{ name: string; focused: boolean }> {
  const result: Array<{ name: string; focused: boolean }> = [];
  React.Children.forEach(children, (child) => {
    if (
      isValidElement<SceneObjectProps>(child) &&
      child.type === SceneObject
    ) {
      result.push({ name: child.props.name, focused: child.props.focused });
    }
  });
  return result;
}

/**
 * Computes the natural vertical offset (in px) that the content wrapper must
 * slide to in order to bring the focused object into view at the top of the
 * column. Returns 0 when multiple objects are focused (stacking mode — show
 * from top).
 *
 * The offset is the sum of heights of all objects that appear before the
 * (single) focused object in DOM order, where "height" is the natural rendered
 * height of that object's registered element.
 */
function computeTopOffset(
  objectStates: Array<{ name: string; focused: boolean }>,
  registeredEls: Map<string, HTMLElement>,
): number {
  const focusedNames = objectStates
    .filter((o) => o.focused)
    .map((o) => o.name);

  // Multi-focus stacking: show from top, no offset
  if (focusedNames.length !== 1) return 0;

  const focusedName = focusedNames[0]!;

  // Sum the natural heights of all objects that come before the focused one.
  let offset = 0;
  for (const { name } of objectStates) {
    if (name === focusedName) break;
    const el = registeredEls.get(name);
    if (el) {
      offset += el.getBoundingClientRect().height;
    }
  }
  return offset;
}

// ---------------------------------------------------------------------------
// SceneColumn
// ---------------------------------------------------------------------------

export interface SceneColumnProps {
  /** Stable name for this column. Shown in debug mode and used for implicit wrapping. */
  name: string;
  children: React.ReactNode;
}

/**
 * A vertical slot within a Scene. Objects inside a column share a horizontal
 * position and swap vertically when focus changes. A column is considered
 * focused if any of its children are focused.
 *
 * Focused columns participate in the Scene's flex row (`position: relative`,
 * `flex: 1 1 0`). Unfocused columns exit the flex flow — they capture their
 * last known size via ResizeObserver, then switch to `position: absolute` with
 * explicit inline width/height (the "freeze"). On re-focus, the frozen size is
 * cleared and motion's `layout` FLIP-animates the column back into flex.
 *
 * Within a column, vertical swap is implemented by spring-animating the `top`
 * property on an inner content wrapper. When focus changes from object A to
 * object B, the column slides its content to bring B into view. Multiple
 * simultaneously focused objects stack vertically (no slide offset).
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
  const objectStates = deriveObjectStates(children);
  const { duration } = useSceneConfig();

  // Registered SceneObject elements — populated via ColumnContext.
  const registeredEls = useRef<Map<string, HTMLElement>>(new Map());

  // The vertical offset to apply to the column content wrapper.
  const [topOffset, setTopOffset] = useState(0);

  // The last measured size while the column was focused. Set to null while
  // focused (no freeze applied) and to a FrozenSize after losing focus.
  const [frozenSize, setFrozenSize] = useState<FrozenSize | null>(null);

  // Tracks the latest size observed via ResizeObserver while focused.
  const lastObservedSize = useRef<FrozenSize>({ width: 0, height: 0 });
  const colRef = useRef<HTMLDivElement | null>(null);

  // Recompute the top offset whenever focus state changes.
  useEffect(() => {
    const offset = computeTopOffset(objectStates, registeredEls.current);
    setTopOffset(offset);
    // objectStates is an inline array — compare by serialized focused states
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectStates.map((o) => `${o.name}:${o.focused}`).join(",")]);

  // While the column is focused, snapshot its current dimensions synchronously
  // after each render (useLayoutEffect fires before the browser paints). This
  // ensures `lastObservedSize` is always fresh and doesn't depend on the async
  // ResizeObserver firing before focus is lost.
  useLayoutEffect(() => {
    if (columnFocused && colRef.current) {
      const { width, height } = colRef.current.getBoundingClientRect();
      if (width > 0 || height > 0) {
        lastObservedSize.current = { width, height };
      }
    }
  });

  // Track column focus state: set up a ResizeObserver for ongoing size changes
  // while focused, freeze the last size on focus loss, and clear on re-focus.
  useEffect(() => {
    if (columnFocused) {
      // Re-focusing — clear the frozen size so the column returns to flex flow.
      setFrozenSize(null);

      const el = colRef.current;
      if (!el) return;

      // ResizeObserver keeps lastObservedSize current during dynamic resizes.
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          lastObservedSize.current = {
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          };
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    } else {
      // Column just lost focus — freeze at the last captured dimensions.
      // lastObservedSize is kept current by the useLayoutEffect above, so this
      // should always have a reliable value.
      setFrozenSize({ ...lastObservedSize.current });
    }
  }, [columnFocused]);

  // Registration callback provided to child SceneObjects via ColumnContext.
  const register = useCallback((objName: string, el: HTMLElement) => {
    registeredEls.current.set(objName, el);
    return () => {
      registeredEls.current.delete(objName);
    };
  }, []);

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
    // Clear any inline width/height left over from the frozen state so flex
    // can recalculate the column size freely.
    width: "",
    height: "",
  };

  // Unfocused columns exit flex flow and are hidden. If we have a frozen size,
  // set explicit dimensions so the column preserves its footprint in the DOM
  // (needed for FLIP to animate from the correct position when re-focusing).
  // opacity is set here directly so the initial render doesn't flash before
  // motion applies the animate prop.
  const unfocusedStyle: React.CSSProperties = {
    position: "absolute",
    flex: "none",
    opacity: 0,
    ...(frozenSize
      ? { width: frozenSize.width, height: frozenSize.height }
      : {}),
  };

  return (
    <ColumnContext.Provider value={{ register }}>
      <motion.div
        ref={colRef}
        layout
        data-column={name}
        data-column-focused={String(columnFocused)}
        animate={{ opacity: columnFocused ? 1 : 0 }}
        transition={transition}
        style={columnFocused ? focusedStyle : unfocusedStyle}
      >
        {/* Content wrapper: spring-animated top offset for vertical swap. */}
        <motion.div
          data-column-content
          animate={{ top: -topOffset }}
          transition={transition}
          style={{ position: "relative", top: -topOffset }}
        >
          {children}
        </motion.div>
      </motion.div>
    </ColumnContext.Provider>
  );
}

// Explicit displayName allows Scene to detect SceneColumn children via
// child.type.displayName without importing SceneColumn directly (avoiding
// circular import issues).
SceneColumn.displayName = "SceneColumn";
