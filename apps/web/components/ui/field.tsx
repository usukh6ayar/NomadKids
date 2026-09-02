"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import {
  Children,
  isValidElement,
  useId,
  type ChangeEvent,
  type ComponentProps,
  type OptionHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
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
      <LabelPrimitive.Root htmlFor={id} className="text-body font-medium text-ink">
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {" *"}
          </span>
        ) : null}
      </LabelPrimitive.Root>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {hint ? (
        <p id={hintId} className="text-caption text-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-caption font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlBase =
  "w-full rounded-control border bg-surface px-3.5 text-ink placeholder:text-muted " +
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
 * A `<select>`-shaped listbox, built on Radix so the open popup is a styled
 * part of the product rather than the OS's own list — the closed control is
 * the only part CSS can reach on a native `<select>`.
 *
 * ★ The call-site contract is unchanged from the native version this
 * replaced: pass `<option value="…">Label</option>` children, `value` and
 * `onChange` exactly as before. Every existing `<Select>` call site keeps
 * working without edits — this reads those `<option>` elements and drives
 * Radix's `Root`/`Item` API from them, rather than every screen learning a
 * second, Radix-flavoured API. `""` is a common placeholder value here
 * ("Сонгоно уу", "Бүх эрх" …) but Radix's `Select.Item` rejects an empty
 * string outright, so it is swapped for `EMPTY_SENTINEL` at the Radix
 * boundary only — `value`/`onChange` on the outside still see `""`.
 */

const EMPTY_SENTINEL = "__EMPTY__";
const toRadixValue = (value: string) => (value === "" ? EMPTY_SENTINEL : value);
const fromRadixValue = (value: string) => (value === EMPTY_SENTINEL ? "" : value);

function isOptionElement(
  node: ReactNode,
): node is ReactElement<OptionHTMLAttributes<HTMLOptionElement>> {
  return isValidElement(node) && node.type === "option";
}

function isOptGroupElement(
  node: ReactNode,
): node is ReactElement<{ label?: string; children?: ReactNode }> {
  return isValidElement(node) && node.type === "optgroup";
}

type OptionEl = ReactElement<OptionHTMLAttributes<HTMLOptionElement>>;
type SelectEntry =
  { kind: "option"; option: OptionEl } | { kind: "group"; label: string; options: OptionEl[] };

/**
 * Flattens the children into options and labelled groups.
 *
 * ★ `<optgroup>` support was added 2026-09-02, and the reason is worth
 * stating: before it, this component filtered children with
 * `node.type === "option"` at the top level only, so an `<optgroup>` was
 * **silently dropped along with every option inside it**. A caller who wrote
 * grouped markup — as `<select>` has always allowed — got a picker containing
 * only its placeholder, with no error anywhere. A shared control that quietly
 * discards valid children is worse than one that never accepted them.
 *
 * Ungrouped call sites are untouched: every existing `<Select>` passes bare
 * `<option>` children and takes the first branch, exactly as before.
 */
function readEntries(children: ReactNode): SelectEntry[] {
  const entries: SelectEntry[] = [];
  for (const node of Children.toArray(children)) {
    if (isOptionElement(node)) {
      entries.push({ kind: "option", option: node });
    } else if (isOptGroupElement(node)) {
      const options = Children.toArray(node.props.children).filter(isOptionElement);
      if (options.length > 0) {
        entries.push({ kind: "group", label: node.props.label ?? "", options });
      }
    }
  }
  return entries;
}

/** An `<option>`'s value, falling back to its own text as a native select does. */
function valueOf(option: OptionEl): string {
  const raw = option.props.value;
  return raw === null || raw === undefined ? String(option.props.children) : String(raw);
}

const keyFor = (option: OptionEl, index: number) => valueOf(option) || index;

function SelectItem({ option }: { option: OptionEl }) {
  return (
    <SelectPrimitive.Item
      value={toRadixValue(valueOf(option))}
      disabled={option.props.disabled}
      className={cn(
        "flex min-h-[44px] cursor-pointer select-none items-center justify-between gap-2",
        "rounded-control px-3 py-2 text-body text-ink outline-none",
        "data-[highlighted]:bg-canvas data-[state=checked]:font-medium",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      )}
    >
      <SelectPrimitive.ItemText>{option.props.children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="shrink-0 text-primary">
        <Check size={16} aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export function Select({
  className,
  invalid,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  name,
  id,
  required,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: ComponentProps<"select"> & { invalid?: boolean }) {
  const entries = readEntries(children);

  return (
    <SelectPrimitive.Root
      value={value !== null && value !== undefined ? toRadixValue(String(value)) : undefined}
      defaultValue={
        defaultValue !== null && defaultValue !== undefined
          ? toRadixValue(String(defaultValue))
          : undefined
      }
      onValueChange={(next) => {
        onChange?.({
          target: { value: fromRadixValue(next) },
        } as unknown as ChangeEvent<HTMLSelectElement>);
      }}
      disabled={disabled}
      name={name}
      required={required}
    >
      <SelectPrimitive.Trigger
        id={id}
        type="button"
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        className={cn(
          controlBase,
          "flex h-[48px] items-center justify-between gap-2 outline-none",
          "data-[placeholder]:text-muted",
          invalid ? "border-danger" : "border-border data-[state=open]:border-primary",
          className,
        )}
      >
        <SelectPrimitive.Value className="truncate" />
        <SelectPrimitive.Icon className="shrink-0 text-muted">
          <ChevronDown size={16} aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className={cn(
            "z-[100] overflow-hidden rounded-row border border-border bg-surface py-1",
            "shadow-[0_8px_28px_rgba(15,23,42,.12)]",
            "w-[var(--radix-select-trigger-width)] max-h-[var(--radix-select-content-available-height)]",
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-muted">
            <ChevronDown size={14} className="rotate-180" aria-hidden />
          </SelectPrimitive.ScrollUpButton>

          <SelectPrimitive.Viewport className="p-1">
            {entries.map((entry, index) =>
              entry.kind === "option" ? (
                <SelectItem key={keyFor(entry.option, index)} option={entry.option} />
              ) : (
                <SelectPrimitive.Group key={`group-${entry.label}-${index}`}>
                  <SelectPrimitive.Label className="px-3 pb-1 pt-2.5 text-caption font-semibold uppercase tracking-wide text-faint">
                    {entry.label}
                  </SelectPrimitive.Label>
                  {entry.options.map((option, i) => (
                    <SelectItem key={keyFor(option, i)} option={option} />
                  ))}
                </SelectPrimitive.Group>
              ),
            )}
          </SelectPrimitive.Viewport>

          <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-muted">
            <ChevronDown size={14} aria-hidden />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
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
    /*
     * ★ The whole row is the label, not just the text beside the box.
     *
     * The box itself is 20px — the native control, deliberately, because a
     * restyled one loses the platform's own focus ring and checked state. What
     * makes it tappable is that the entire 44px row toggles it, so a thumb
     * landing anywhere on the line hits the target. With the label wrapping
     * only the text, the gap and the row's trailing space were dead pixels.
     */
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-[44px] cursor-pointer select-none items-start gap-3 py-1",
        className,
      )}
    >
      <input id={id} type="checkbox" className="mt-1 size-5 shrink-0 accent-primary" {...props} />
      <span className="text-body leading-snug">
        <span className="font-medium text-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-caption text-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
