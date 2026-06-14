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
