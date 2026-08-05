import type { DebugObjectEntry } from "./types";

/**
 * Reads the debug overlay's object list straight from the DOM — every
 * `[data-ui-scene-id]` element under the viewport, with its `data-ui-scene-focused`
 * attribute — rather than walking Scene's `children` prop tree. DOM truth is
 * immune by construction to Fragment wrapping, custom components that return
 * a SceneObject/SceneColumn, or any other composition that a shallow prop
 * walk can be fooled by (the same rationale as the S6 column registry
 * below), and it's what actually rendered — the only thing worth debugging.
 */
export function queryDebugObjects(viewport: HTMLElement): DebugObjectEntry[] {
  return Array.from(viewport.querySelectorAll<HTMLElement>("[data-ui-scene-id]")).map((el) => ({
    name: el.getAttribute("data-ui-scene-id") ?? "",
    focused: el.getAttribute("data-ui-scene-focused") === "true",
  }));
}
