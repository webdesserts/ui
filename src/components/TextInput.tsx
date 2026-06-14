import { forwardRef, useEffect } from "react";
import { cn } from "../utils/cn";
import { installFocusModalityTracker } from "./shared";
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
//   - rest    → subtle bottom rule
//   - hover   → field fades to the interactive surface (mono-inversion), no ring
//   - focus   → same fill; keyboard focus also shows the accent ring (click does
//                not — matches a Button's :focus-visible, faked via a global
//                focus-modality signal since inputs can't use :focus-visible)
//   - invalid → bottom rule is danger-colored and persists through the fill
//                ("color with intent")
//
// Fill is a FADE (background-color transition), not the Button's sliding bar —
// a deliberate choice for inputs. Heights share Button's size scale so a field
// and a Button align in a row.
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
 */
const wrapperKeyboardRing = [
  "outline-none",
  "[[data-focus-source=keyboard]_&]:has-[input:focus]:outline-solid",
  "[[data-focus-source=keyboard]_&]:has-[input:focus]:outline-2",
  "[[data-focus-source=keyboard]_&]:has-[input:focus]:outline-accent",
  "[[data-focus-source=keyboard]_&]:has-[input:focus]:z-1",
].join(" ");

/**
 * Wrapper box + fade fill. Owns the surface, the mono-inversion fill on hover
 * (gated to enabled inputs) and focus, the disabled dimming, and the keyboard
 * ring. The bottom-rule color is applied per-state (valid/invalid) at the call
 * site so it persists through the fill as the resting/error affordance.
 */
const wrapperBase = cn(
  "group/field relative flex w-full items-stretch rounded-none border-b",
  "bg-surface-input transition-[background-color] duration-200",
  "not-has-[input:disabled]:hover:bg-interactive-bg",
  "has-[input:focus]:bg-interactive-bg",
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
  "not-disabled:group-hover/field:text-surface-base not-disabled:group-hover/field:placeholder:text-surface-base",
  "focus:text-surface-base focus:placeholder:text-surface-base",
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
          invalid ? "border-danger" : "border-rule-subtle",
          wrapperClassName,
        )}
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
