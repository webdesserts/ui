import { forwardRef, useEffect } from "react";
import { cn } from "../utils/cn";
import {
  installFocusModalityTracker,
  spreadSetupBase,
  spreadBarClasses,
} from "./shared";
import type { ButtonSize } from "./shared";

// ---------------------------------------------------------------------------
// TextInput — single-line text field
//
// Ported from voice-chat-prototype's input design and reconciled onto the
// lib's tokens + Button conventions, following the webdesserts state language:
// a bottom rule IS the interactivity affordance (no box, no drop shadows) and
// state is signaled by that rule, by inversion, and by the accent ring — never
// by shadows.
//
// The control is a WRAPPER element around a transparent <input>. A bare <input>
// is a replaced element (can't host the interactive treatment cleanly) and the
// browser forces :focus-visible ON for it, so it would ring on click. Moving the
// box — surface, bottom rule, fill, ring — onto a non-replaced wrapper lets the
// treatment behave like a Button and enables a keyboard-only ring. The <input>
// is just the transparent editable interior (text + caret); `ref` and `...props`
// forward to it.
//
//   - rest    → a 2px bottom bar (the ::after spread bar shared with Button)
//   - hover   → the bar slides up to fill the field (mono-inversion), no ring
//   - focus   → same fill; keyboard focus also shows the accent ring (click does
//                not — matches a Button's :focus-visible, faked via a global
//                focus-modality signal since inputs can't use :focus-visible)
//   - invalid → the resting bar is danger-colored and persists under the fill
//                ("color with intent")
//
// The fill is the Button's sliding bar, not a background fade: the bottom rule
// IS Button's spread ::after bar, and it slides up to fill on hover/focus, so a
// field and a Button animate identically. The wrapper is a <div> (not the
// interactive target itself), so it supplies its own input-state triggers
// (has-[input:focus], not-has-[input:disabled]:hover) over the shared bar
// geometry, rather than Button's self-state :hover/:focus-visible triggers.
// Heights share Button's size scale so a field and a Button align in a row.
// ---------------------------------------------------------------------------

/** Wrapper height — matched to Button (h-8/h-10/h-12) so a field and a Button align in a row. */
const wrapperHeights: Record<ButtonSize, string> = {
  sm: "h-8",
  md: "h-10",
  lg: "h-12",
};

/** Input padding + text size per tier (the input owns padding so a click anywhere focuses it). */
const inputSizes: Record<ButtonSize, string> = {
  sm: "px-3 text-sm",
  md: "px-4 text-sm",
  lg: "px-5 text-base",
};

/**
 * The accent ring, shown only for KEYBOARD focus. The selector fires when
 * <html> carries `data-focus-source="keyboard"` (set by installFocusModalityTracker)
 * AND the wrapper contains the focused input — so tab → ring, click → no ring,
 * mirroring a Button's :focus-visible. `outline` composes with the border;
 * `z-1` (wrapper is relative) keeps the ring from being clipped by neighbors.
 *
 * RULE: this ring is reserved for FOCUS indication ONLY — never repurpose it to
 * signal any other state (e.g. invalid/error). Invalid is signaled by the danger
 * underline (a separate mechanism), so the two stay distinguishable by SHAPE even
 * when --danger and --accent are perceptually close (as they are in dark mode).
 * Do not, e.g., recolor this ring to --danger for invalid fields.
 */
const wrapperKeyboardRing = [
  "outline-none",
  "[[data-focus-source=keyboard]_&]:has-[input:focus]:outline-solid",
  "[[data-focus-source=keyboard]_&]:has-[input:focus]:outline-2",
  "[[data-focus-source=keyboard]_&]:has-[input:focus]:outline-accent",
  "[[data-focus-source=keyboard]_&]:has-[input:focus]:z-1",
].join(" ");

/**
 * Wrapper box + sliding bar. Owns the surface, the shared spread ::after bar
 * (bottom-anchored, sliding up to fill on hover/focus), the disabled dimming,
 * and the keyboard ring. Because the wrapper is a <div> and not the interactive
 * target, the fill is driven by the input's state — not the wrapper's own
 * :hover/:focus-visible (which is why this uses the shared bar GEOMETRY plus its
 * own input-state triggers, rather than Button's spreadSelfTriggers). The
 * resting bar color comes from --spread-bg-rest; the invalid error rule is a
 * separate persistent box-shadow at the call site (the ::after fill would
 * otherwise cover it — see the call site).
 */
const wrapperBase = cn(
  "group/field flex w-full items-stretch rounded-t-sm",
  "bg-surface-input",
  spreadSetupBase,
  spreadBarClasses.bottom,
  // Fill on hover (enabled only) — slide the bar up to cover the field.
  "not-has-[input:disabled]:hover:after:inset-0 not-has-[input:disabled]:hover:after:w-full not-has-[input:disabled]:hover:after:h-full not-has-[input:disabled]:hover:after:m-0",
  "not-has-[input:disabled]:hover:after:bg-[var(--spread-bg-hover,var(--interactive-bg))]",
  "not-has-[input:disabled]:hover:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
  // Fill on any focus (pointer OR keyboard) — matches the old fade's focus fill.
  "has-[input:focus]:after:inset-0 has-[input:focus]:after:w-full has-[input:focus]:after:h-full has-[input:focus]:after:m-0",
  "has-[input:focus]:after:bg-[var(--spread-bg-hover,var(--interactive-bg))]",
  "has-[input:focus]:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
  "has-[input:disabled]:opacity-50",
  wrapperKeyboardRing,
);

/**
 * The transparent editable interior. No own background/border/ring — the
 * wrapper owns those. Text + placeholder invert with the wrapper's fill on
 * hover (gated to enabled) and focus; the resting placeholder uses
 * text-secondary so it reads against the recessed surface while staying dimmer
 * than entered text.
 */
const inputBase = cn(
  "w-full bg-transparent border-0 outline-none",
  "text-text-primary placeholder:text-text-secondary",
  "transition-[color] duration-200",
  "placeholder:transition-[color,opacity] placeholder:duration-200",
  // On the inverted (filled) surface the placeholder shares the entered-text
  // color (surface-base) but is knocked back with opacity so it stays readable
  // as a placeholder — there is no muted-on-inverted token to swap to.
  "not-disabled:group-hover/field:text-surface-base not-disabled:group-hover/field:placeholder:text-surface-base not-disabled:group-hover/field:placeholder:opacity-60",
  "focus:text-surface-base focus:placeholder:text-surface-base focus:placeholder:opacity-60",
  "disabled:cursor-not-allowed",
);

interface TextInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Shared height scale with Button. Defaults to "md". */
  size?: ButtonSize;
  /** Error state — the bottom rule turns danger-colored. */
  invalid?: boolean;
  /** Class names for the outer wrapper (the box). Use `className` for the input. */
  wrapperClassName?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput(
    { size = "md", invalid = false, className, wrapperClassName, ...props },
    ref,
  ) {
    // Idempotent + SSR-safe; attaches the document-level listeners once.
    useEffect(() => installFocusModalityTracker(), []);

    return (
      <div
        className={cn(
          wrapperBase,
          wrapperHeights[size],
          // Invalid: a persistent 2px danger rule. The spread ::after fills
          // the field with the NEUTRAL surface on hover/focus (and is z-behind
          // the box), so the danger affordance can't live on the ::after alone
          // — it would be covered by the fill. This inset box-shadow paints the
          // bottom rule ON TOP of the fill so the error cue persists through it.
          invalid && "shadow-[inset_0_-2px_0_var(--danger)]",
          wrapperClassName,
        )}
        // Color the resting ::after bar danger too, so at rest the bar and the
        // persistent rule coincide (both danger) rather than stacking colors.
        style={
          invalid
            ? ({ "--spread-bg-rest": "var(--danger)" } as React.CSSProperties)
            : undefined
        }
      >
        <input
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(inputBase, inputSizes[size], className)}
          {...props}
        />
      </div>
    );
  },
);

export type { TextInputProps };
