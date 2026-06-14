import { forwardRef } from "react";
import { cn } from "../utils/cn";
import { interactiveRing, interactiveDisabled } from "./shared";
import type { ButtonSize } from "./shared";

// ---------------------------------------------------------------------------
// TextInput — single-line text field
//
// Ported from voice-chat-prototype's input design and reconciled onto the
// lib's tokens + Button conventions, following the webdesserts state language:
// the bottom rule IS the interactivity affordance (no box, no drop shadows).
// State is signaled by the rule, by inversion, and by the shared accent ring —
// never by shadows. The interaction model mirrors a button exactly: hover fills
// (mono-inversion), focus-visible adds the accent ring on top. Accent is earned:
// it appears only via that focus/active ring, never on hover.
//   - rest    → subtle bottom rule
//   - hover   → field inverts to the interactive surface (fill, no ring)
//   - focus   → same inversion + the accent ring
//   - invalid → rule turns danger-colored ("color with intent"); inversion and
//                ring still apply, with the danger rule persisting through them
// Heights share Button's size scale so an input and a Button align in a row.
// ---------------------------------------------------------------------------

/** Height-matched to Button (h-8/h-10/h-12) so inputs and buttons align in a row. */
const textInputSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

/**
 * Surface + interaction treatment shared by every state: the recessed input
 * surface, the mono-inversion applied on BOTH hover and focus (fill to the
 * interactive surface, inverted text/placeholder — mirroring a button's hover
 * fill), and the shared accent ring added only on focus-visible/active (the
 * `highlight:` idiom in interactiveRing). The ring is the sole difference
 * between hover and focus, exactly like a button. Identical for valid and
 * invalid fields — an error rides on top via its danger rule.
 */
const baseClasses = cn(
  interactiveRing,
  interactiveDisabled,
  "bg-surface-input text-text-primary placeholder:text-text-muted",
  // Gate the hover fill on :not(:disabled) (like the buttons' not-disabled:hover)
  // so a disabled field stays at rest under the pointer. Focus needs no gate —
  // a disabled input can't be focused.
  "not-disabled:hover:bg-interactive-bg not-disabled:hover:text-surface-base not-disabled:hover:placeholder:text-surface-base",
  "focus:bg-interactive-bg focus:text-surface-base focus:placeholder:text-surface-base",
);

/** Resting border state — a subtle bottom rule (the fill takes over on hover/focus). */
const borderRest = "border-rule-subtle";

/**
 * Invalid border state — danger-colored rule that persists through the hover and
 * focus inversions as the error cue, so an error never reads as accent. Layers
 * over `baseClasses`, which still provides the fill and the accent focus ring.
 */
const borderInvalid = "border-danger";

interface TextInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Shared height scale with Button. Defaults to "md". */
  size?: ButtonSize;
  /** Error state — the bottom rule turns danger-colored. */
  invalid?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ size = "md", invalid = false, className, ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "w-full rounded-none border-b border-t-0 border-x-0",
          "transition-[color,background-color,border-color] duration-200",
          textInputSizes[size],
          baseClasses,
          invalid ? borderInvalid : borderRest,
          className,
        )}
        {...props}
      />
    );
  },
);

export type { TextInputProps };
