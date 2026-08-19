"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Form controls.
 *
 * ★ `Field` wires the label, the error and the control together itself, so a
 * screen cannot ship an input whose label is only visually adjacent. Every
 * field has a visible label — placeholders are not labels; they vanish the
 * moment someone types, which is exactly when a form is hardest to re-read.
 *
 * The error is `role="alert"` and referenced by `aria-describedby`, so a screen
 * reader announces it rather than leaving a red border as the only signal.
 */

export function Field({
  label,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  /** Receives the ids to bind. */
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <LabelPrimitive.Root htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {" *"}
          </span>
        ) : null}
      </LabelPrimitive.Root>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlBase =
  "w-full rounded-[12px] border bg-surface px-3.5 text-ink placeholder:text-muted " +
  "transition-colors disabled:opacity-60 disabled:bg-canvas";

export function Input({
  className,
  invalid,
  ...props
}: ComponentProps<"input"> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        controlBase,
        "h-[48px]",
        invalid ? "border-danger" : "border-border focus:border-primary",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: ComponentProps<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        controlBase,
        "min-h-[112px] resize-y py-3 leading-relaxed",
        invalid ? "border-danger" : "border-border focus:border-primary",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A native `<select>`, deliberately.
 *
 * A custom listbox would need focus management, type-ahead and virtual
 * scrolling to match what the platform already gives free — and on a phone the
 * native control is the OS picker, which is the one every parent already knows.
 */
export function Select({
  className,
  invalid,
  children,
  ...props
}: ComponentProps<"select"> & { invalid?: boolean }) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(
        controlBase,
        "h-[48px] appearance-none bg-[length:16px] bg-[right_14px_center] bg-no-repeat pr-10",
        // Inline chevron: an SVG data URI avoids a network request and a
        // wrapper element that would complicate the label association.
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2377737D%22 stroke-width=%222%22 stroke-linecap=%22round%22><path d=%22M6 9l6 6 6-6%22/></svg>')]",
        invalid ? "border-danger" : "border-border focus:border-primary",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/** A checkbox with its label as one 44px target. */
export function Checkbox({
  label,
  description,
  className,
  ...props
}: ComponentProps<"input"> & { label: string; description?: string }) {
  const id = useId();

  return (
    <div className={cn("flex min-h-[44px] items-start gap-3 py-1", className)}>
      <input id={id} type="checkbox" className="mt-1 size-5 shrink-0 accent-primary" {...props} />
      <label htmlFor={id} className="cursor-pointer select-none text-sm leading-snug">
        <span className="font-medium text-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-muted">{description}</span>
        ) : null}
      </label>
    </div>
  );
}
