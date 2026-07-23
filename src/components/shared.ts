// ---------------------------------------------------------------------------
// Shared component primitives
//
// Small constants used by more than one component (Button family + TextInput),
// kept here so the interaction language stays identical across them.
// ---------------------------------------------------------------------------

/** Size tier shared across interactive components — ensures consistent heights in toolbars, groups, and forms. */
export type ButtonSize = "sm" | "md" | "lg";

/** Which edge a control's spread bar rests on (and therefore which corners round). */
export type BorderSide = "bottom" | "top" | "right" | "left";

/** Maps a border side to the rounding of the opposite corners (bottom bar → rounded top). */
export const borderSideClasses = {
  bottom: { rounding: "rounded-t-sm" },
  top: { rounding: "rounded-b-sm" },
  right: { rounding: "rounded-l-sm" },
  left: { rounding: "rounded-r-sm" },
} as const;

// ---------------------------------------------------------------------------
// Spread animation — shared ::after fill system (Button family + TextInput)
//
// A ::after pseudo-element starts as a resting bar on one edge and expands to
// fill the whole element on hover/focus, sliding the bar up into a full fill.
// Asymmetric timing: fast enter (~250ms), slow rest/exit (~400ms).
//
// The system is split so two different element types can drive the same fill:
//   - spreadSetupBase   — geometry only (the ::after setup + resting transition).
//                         Element-agnostic; safe on a Button OR a TextInput wrapper.
//   - spreadSelfTriggers — Button-family self-state triggers (:hover/:focus-visible
//                          on the element itself) + the text/opacity transition.
//   - spreadBarClasses   — resting bar position per side.
//
// TextInput is a <div> wrapper around an <input>, so its hover/focus live on the
// input, not the wrapper — it supplies its own input-state triggers
// (has-[input:focus], not-has-[input:disabled]:hover) instead of spreadSelfTriggers.
// ---------------------------------------------------------------------------

/**
 * Element-agnostic ::after setup: the pseudo-element, its resting color, and the
 * slow resting/exit transition. Geometry only — no self-state triggers and no
 * element-level color/opacity transition (that belongs to the element's own
 * state, see spreadSelfTriggers), so this is safe to drop onto any host element.
 */
export const spreadSetupBase = [
  "relative z-0 overflow-hidden",
  // ::after setup
  "after:absolute after:-z-1",
  "after:bg-[var(--spread-bg-rest,var(--interactive-border))]",
  // Geometry entries ride --spread-out (default 400ms, matching this file's
  // former hardcoded value) so a host element can slow its own exit — see
  // MenuItem (Button.tsx), which sweeps a wider axis than buttons and sets
  // 600ms. Background-color stays hardcoded at 600ms — distance-independent,
  // untouched by the menu-only tune.
  "after:[transition:top_var(--spread-out,400ms)_ease-in-out,left_var(--spread-out,400ms)_ease-in-out,right_var(--spread-out,400ms)_ease-in-out,bottom_var(--spread-out,400ms)_ease-in-out,width_var(--spread-out,400ms)_ease-in-out,height_var(--spread-out,400ms)_ease-in-out,margin_var(--spread-out,400ms)_ease-in-out,background-color_600ms_ease-in]",
].join(" ");

/**
 * Button-family self-state triggers: fill + text inversion on the element's own
 * :hover / :focus-visible, plus the element-level color/opacity transition. Only
 * usable when the host element is itself the interactive target (a <button>) —
 * TextInput's wrapper isn't, so it omits these.
 */
export const spreadSelfTriggers = [
  "transition-[color,opacity] duration-200",
  // Hover — fill + text inversion. Geometry entries ride --spread-in
  // (default 250ms, matching this file's former hardcoded value) — see
  // spreadSetupBase's comment above for the --spread-out counterpart.
  // --spread-fill-left insets the grown fill's left edge (default 0px —
  // full-bleed, byte-identical to every existing consumer): a menu panel
  // sets 4px (2px full-height rail + 2px seam) so row fills clear the
  // panel's border column instead of covering it. Left-only for now (the
  // side MenuItem's bar occupies) — other sides hand-roll their own inset
  // like TRIGGER_C (select-trigger-candidates.test.tsx) until a real need
  // arises.
  "not-disabled:hover:text-interactive-text",
  "not-disabled:hover:after:top-0 not-disabled:hover:after:right-0 not-disabled:hover:after:bottom-0 not-disabled:hover:after:left-[var(--spread-fill-left,0px)] not-disabled:hover:after:w-full not-disabled:hover:after:h-full not-disabled:hover:after:m-0",
  "not-disabled:hover:after:bg-[var(--spread-bg-hover,var(--interactive-bg))]",
  "not-disabled:hover:after:[transition:top_var(--spread-in,250ms),left_var(--spread-in,250ms),right_var(--spread-in,250ms),bottom_var(--spread-in,250ms),width_var(--spread-in,250ms),height_var(--spread-in,250ms),margin_var(--spread-in,250ms),background-color_200ms]",
  // Focus-visible — same as hover
  "not-disabled:focus-visible:text-interactive-text",
  "not-disabled:focus-visible:after:top-0 not-disabled:focus-visible:after:right-0 not-disabled:focus-visible:after:bottom-0 not-disabled:focus-visible:after:left-[var(--spread-fill-left,0px)] not-disabled:focus-visible:after:w-full not-disabled:focus-visible:after:h-full not-disabled:focus-visible:after:m-0",
  "not-disabled:focus-visible:after:bg-[var(--spread-bg-hover,var(--interactive-bg))]",
  "not-disabled:focus-visible:after:[transition:top_var(--spread-in,250ms),left_var(--spread-in,250ms),right_var(--spread-in,250ms),bottom_var(--spread-in,250ms),width_var(--spread-in,250ms),height_var(--spread-in,250ms),margin_var(--spread-in,250ms),background-color_200ms]",
].join(" ");

/** Bar geometry per border side (resting state position). */
export const spreadBarClasses = {
  bottom: "after:top-[calc(100%-2px)] after:left-0 after:right-0 after:bottom-0 after:w-full after:h-0.5",
  top: "after:top-0 after:left-0 after:right-0 after:bottom-[calc(100%-2px)] after:w-full after:h-0.5",
  right: "after:top-0 after:left-[calc(100%-2px)] after:right-0 after:bottom-0 after:w-0.5 after:h-full",
  left: "after:top-0 after:left-0 after:right-[calc(100%-2px)] after:bottom-0 after:w-0.5 after:h-full",
} as const;

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
