export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;
export type Bounds = { top: number; left: number; bottom: number; right: number };

export function getOffsetBounds(node: HTMLElement): Bounds {
  return {
    top: node.offsetTop,
    left: node.offsetLeft,
    right: node.offsetLeft + node.offsetWidth,
    bottom: node.offsetTop + node.offsetHeight,
  };
}

export function getTotalBounds(allBounds: Bounds[]): Bounds {
  if (allBounds.length === 0) {
    return { top: 0, left: 0, bottom: 0, right: 0 };
  }
  return allBounds.reduce(
    (total, bounds) => ({
      top: Math.min(total.top, bounds.top),
      left: Math.min(total.left, bounds.left),
      right: Math.max(total.right, bounds.right),
      bottom: Math.max(total.bottom, bounds.bottom),
    }),
    { top: Infinity, left: Infinity, right: -Infinity, bottom: -Infinity }
  );
}

export function boundsToRect(bounds: Bounds): Rect {
  return {
    x: bounds.left,
    y: bounds.top,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
  };
}
