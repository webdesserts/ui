import { forwardRef, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "../utils/cn";
import {
  installFocusModalityTracker,
  spreadSetupBase,
  spreadBarClasses,
} from "./shared";
import type { ButtonSize } from "./shared";

// ---------------------------------------------------------------------------
// TextArea — multi-line text field
//
// TextInput's treatment around a <textarea>: the wrapper owns the surface,
// the sliding bottom bar, the danger rule and the keyboard-only ring; the
// textarea is the transparent editable interior. See TextInput for the state
// language.
//
// Auto-grow uses CSS `field-sizing: content` (Safari 18.2+, Chrome 123+): the
// textarea is as tall as its text, between `rows` and `maxRows` lines, and
// scrolls beyond that. Where `field-sizing` is unsupported, a layout effect
// sets the height from scrollHeight instead.
// ---------------------------------------------------------------------------

/** Line height of the textarea's text, in em; rows and maxRows are measured in these lines. */
const LINE_HEIGHT = 1.4;

/** Minimum wrapper height — matched to Button (h-8/h-10/h-12) so a one-line field aligns with a Button in a row. */
const wrapperHeights: Record<ButtonSize, string> = {
  sm: "min-h-8",
  md: "min-h-10",
  lg: "min-h-12",
};

/**
 * Textarea padding + text size per tier. Touch screens get 16px text on sm/md
 * so iOS Safari does not zoom in on focus.
 */
const textareaSizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-base pointer-fine:text-sm",
  md: "px-4 py-2 text-base pointer-fine:text-sm",
  lg: "px-5 py-2.5 text-base",
};

/** Top + bottom padding per tier, matching `textareaSizes`, for the row-based height bounds. */
const verticalPadding: Record<ButtonSize, string> = {
  sm: "0.75rem",
  md: "1rem",
  lg: "1.25rem",
};

/** The accent ring, shown only for keyboard focus (see TextInput's wrapperKeyboardRing). */
const wrapperKeyboardRing = [
  "outline-none",
  "[[data-ui-focus-source=keyboard]_&]:has-[textarea:focus]:outline-solid",
  "[[data-ui-focus-source=keyboard]_&]:has-[textarea:focus]:outline-2",
  "[[data-ui-focus-source=keyboard]_&]:has-[textarea:focus]:outline-accent",
  "[[data-ui-focus-source=keyboard]_&]:has-[textarea:focus]:z-1",
].join(" ");

/** Wrapper box + sliding bar, driven by the textarea's state (see TextInput's wrapperBase). */
const wrapperBase = cn(
  "group/field flex w-full items-stretch rounded-t-sm",
  spreadSetupBase,
  spreadBarClasses.bottom,
  "not-has-[textarea:disabled]:hover:after:inset-0 not-has-[textarea:disabled]:hover:after:w-full not-has-[textarea:disabled]:hover:after:h-full not-has-[textarea:disabled]:hover:after:m-0",
  "not-has-[textarea:disabled]:hover:after:bg-[var(--spread-bg-hover,var(--interactive-bg))]",
  "not-has-[textarea:disabled]:hover:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
  "has-[textarea:focus]:after:inset-0 has-[textarea:focus]:after:w-full has-[textarea:focus]:after:h-full has-[textarea:focus]:after:m-0",
  "has-[textarea:focus]:after:bg-[var(--spread-bg-hover,var(--interactive-bg))]",
  "has-[textarea:focus]:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
  "has-[textarea:disabled]:opacity-50",
  wrapperKeyboardRing,
);

/** The transparent editable interior; text and placeholder invert with the wrapper's fill. */
const textareaBase = cn(
  "block w-full bg-transparent border-0 outline-none",
  "text-text-primary placeholder:text-text-secondary",
  "transition-[color] duration-200",
  "placeholder:transition-[color,opacity] placeholder:duration-200",
  "not-disabled:group-hover/field:text-surface-base not-disabled:group-hover/field:placeholder:text-surface-base not-disabled:group-hover/field:placeholder:opacity-60",
  "focus:text-surface-base focus:placeholder:text-surface-base focus:placeholder:opacity-60",
  "disabled:cursor-not-allowed",
);

/** Whether this browser sizes form fields to their content in CSS. */
function supportsFieldSizing(): boolean {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" &&
    CSS.supports("field-sizing", "content");
}

interface TextAreaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> {
  /** Shared height scale with Button. Defaults to "md". */
  size?: ButtonSize;
  /** Error state — the bottom rule turns danger-colored. */
  invalid?: boolean;
  /** Translucent surface, for fields over a blurred (glass) backdrop. */
  glass?: boolean;
  /** Lines always shown. Defaults to 1. */
  rows?: number;
  /** Lines shown before the text scrolls, when `autoGrow` is on. Defaults to 6. */
  maxRows?: number;
  /** Grow with the text from `rows` up to `maxRows` lines. Defaults to true. */
  autoGrow?: boolean;
  /** Class names for the outer wrapper (the box). Use `className` for the textarea. */
  wrapperClassName?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea(
    {
      size = "md",
      invalid = false,
      glass = false,
      rows = 1,
      maxRows = 6,
      autoGrow = true,
      className,
      wrapperClassName,
      style,
      ...props
    },
    ref,
  ) {
    const own = useRef<HTMLTextAreaElement | null>(null);
    useEffect(() => installFocusModalityTracker(), []);

    // Fallback auto-grow for browsers without `field-sizing: content`.
    const value = props.value;
    useLayoutEffect(() => {
      const el = own.current;
      if (!autoGrow || el === null || supportsFieldSizing()) return;
      const fit = () => {
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      };
      fit();
      el.addEventListener("input", fit);
      return () => {
        el.removeEventListener("input", fit);
        el.style.height = "";
      };
    }, [autoGrow, value, rows, maxRows, size]);

    const lines = (n: number) => `calc(${n} * ${LINE_HEIGHT}em + ${verticalPadding[size]})`;

    return (
      <div
        data-ui-text-area=""
        className={cn(
          wrapperBase,
          glass ? "bg-surface-input/65" : "bg-surface-input",
          wrapperHeights[size],
          // A persistent danger rule painted over the hover/focus fill (see TextInput).
          invalid && "shadow-[inset_0_-2px_0_var(--danger)]",
          wrapperClassName,
        )}
        style={
          invalid
            ? ({ "--spread-bg-rest": "var(--danger)" } as React.CSSProperties)
            : undefined
        }
      >
        <textarea
          ref={(el) => {
            own.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) ref.current = el;
          }}
          rows={rows}
          aria-invalid={invalid || undefined}
          className={cn(textareaBase, textareaSizes[size], autoGrow && "[field-sizing:content]", className)}
          style={{
            lineHeight: LINE_HEIGHT,
            resize: "none",
            overflowY: "auto",
            minHeight: lines(rows),
            ...(autoGrow ? { maxHeight: lines(Math.max(rows, maxRows)) } : {}),
            ...style,
          }}
          {...props}
        />
      </div>
    );
  },
);

export type { TextAreaProps };
