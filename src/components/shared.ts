// ---------------------------------------------------------------------------
// Shared component primitives
//
// Small constants used by more than one component (Button family + TextInput),
// kept here so the interaction language stays identical across them.
// ---------------------------------------------------------------------------

/** Size tier shared across interactive components — ensures consistent heights in toolbars, groups, and forms. */
export type ButtonSize = "sm" | "md" | "lg";

/**
 * Accent outline ring — identical for focus-visible and active states. The
 * `highlight:` custom variant (semantic.css) matches both `:focus-visible` and
 * `:active:not(:disabled)`. Uses `outline` so it composes with box-shadow
 * borders instead of conflicting; `z-1` keeps it from being clipped by
 * adjacent elements. Shared by buttons and inputs so the focus/active cue is
 * the same accent ring everywhere.
 */
export const interactiveRing =
  "outline-none highlight:outline-solid highlight:outline-2 highlight:outline-accent highlight:z-1";

/** Disabled affordance shared by interactive controls. */
export const interactiveDisabled =
  "disabled:cursor-not-allowed disabled:opacity-50";

let focusModalityTrackerInstalled = false;

/**
 * Track whether focus is arriving via keyboard or pointer, recording it as
 * `data-focus-source="keyboard" | "pointer"` on <html>. Lets a component show a
 * focus ring for keyboard users only (tab → ring) while staying ring-free on
 * click — the behavior buttons get from `:focus-visible`, which the browser
 * forces ON for text inputs, so they need this manual signal instead.
 *
 * Safe to call from any component on mount: SSR-guarded and idempotent (the
 * listeners attach once for the whole document, no matter how many inputs mount).
 */
export function installFocusModalityTracker(): void {
  if (focusModalityTrackerInstalled || typeof document === "undefined") return;
  focusModalityTrackerInstalled = true;

  const setSource = (source: "keyboard" | "pointer") => () => {
    document.documentElement.dataset.focusSource = source;
  };
  // Capture phase so the modality is recorded before focus styles resolve.
  document.addEventListener("keydown", setSource("keyboard"), true);
  document.addEventListener("pointerdown", setSource("pointer"), true);
}
