import { forwardRef } from "react";
import { cn } from "../utils/cn";
import type { ButtonSize } from "./Button";

// ---------------------------------------------------------------------------
// TextInput — single-line text field
//
// Ported from voice-chat-prototype's input design and reconciled onto the
// lib's tokens + Button conventions, following the webdesserts state language:
// the bottom rule IS the interactivity affordance (no box, no drop shadows).
// State is signaled by that rule and by inversion, never by shadows:
//   - rest    → subtle bottom rule
//   - hover   → rule brightens to the accent
//   - focus   → field inverts to the interactive surface (recessed → raised)
//   - invalid → rule turns danger-colored, overriding accent ("color with intent")
// Heights share Button's size scale so an input and a Button align in a row.
// ---------------------------------------------------------------------------

/** Height-matched to Button (h-8/h-10/h-12) so inputs and buttons align in a row. */
const textInputSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

/**
 * Surface + focus treatment shared by every state. Focus is the universal
 * mono-inversion (interactive surface, inverted text/placeholder) carried over
 * from voice-chat — the same for valid and invalid fields, so an error keeps
 * signalling through its danger rule rather than a competing ring.
 */
const baseClasses = cn(
  "bg-surface-input text-text-primary placeholder:text-text-muted",
  "focus:bg-interactive-bg focus:text-surface-base focus:placeholder:text-surface-base",
);

/** Resting border state — subtle rule that brightens to the accent on hover. */
const borderRest = "border-rule-subtle hover:border-accent";

/**
 * Invalid border state — danger-colored rule that stays danger on hover, so an
 * error never reads as accent ("accent is earned"). Layers over `baseClasses`,
 * so an invalid field still inverts on focus with the danger rule persisting.
 */
const borderInvalid = "border-danger hover:border-danger";

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
          "w-full rounded-none border-b border-t-0 border-x-0 outline-none",
          "transition-[color,background-color,border-color] duration-200",
          "disabled:cursor-not-allowed disabled:opacity-50",
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
