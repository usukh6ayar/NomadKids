"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, Eye, EyeOff, Minus } from "lucide-react";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
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
    <div data-ui="field" className={cn("flex flex-col gap-1.5", className)}>
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

/*
 * ★ REDESIGN 2026-09-03 — a control now looks like something you type into.
 *
 * It was a white box with a slate-200 hairline, identical at rest to the card
 * behind it, and on focus the border changed to blue with the global 2px
 * outline over the top. Two things were wrong with that:
 *
 *  - **At rest a form read as a list of outlines.** A field on a white card
 *    with a white fill has only its 1px border to say "this is editable", and
 *    on the observation screen — six textareas stacked — that is a page of
 *    empty rectangles. `bg-sunken` inverts the relationship the way every
 *    considered form does: the *input* is the recessed thing, the card is the
 *    surface. It also makes the placeholder legible as placeholder.
 *
 *  - **The focus state was doing the work twice.** The border went blue *and*
 *    the global focus ring drew 2px outside it, so a focused field grew a
 *    double blue edge. The fill now lifts to white on focus — the field
 *    "opens" — and the ring alone marks focus.
 *
 * `placeholder:text-faint` rather than `text-muted`: muted is secondary *text*,
 * and a placeholder set at the same weight as a filled value is how a form
 * looks pre-filled when it is empty.
 */
const controlBase =
  "w-full rounded-control border bg-sunken px-3.5 text-ink placeholder:text-faint " +
  "transition-colors duration-150 focus:bg-surface " +
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-border-soft";

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
        invalid ? "border-danger" : "border-border focus:border-faint",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A password field you can read back.
 *
 * ★ Added 2026-09-04, at the client's request: "password-оо hide/show хийж
 * хардаг байх".
 *
 * Every password input in the product was a bare `type="password"` — eight of
 * them across four screens — so the only way to check what you had typed was
 * to delete it and start again. That matters more here than in most products:
 * the passwords are **Mongolian Cyrillic** (`Нууцүг123` is the documented
 * example), typed on a phone keyboard that switches layouts, by parents at
 * pick-up time. A typo you cannot see is a lockout you cannot explain.
 *
 * ★★ The toggle is a real `<button>`, not an icon with a click handler.
 *
 * It is reachable by keyboard, it announces its state, and its label says what
 * pressing it will *do* rather than what is currently true — "Нууц үг харуулах"
 * while hidden. `tabIndex={-1}` deliberately keeps it out of the tab order
 * between the two password fields on the change-password form: somebody
 * tabbing from "new password" expects to land on "repeat", not on a toggle.
 * It stays clickable and stays announced.
 *
 * ★★★ `pr-12` on the input, so the text never runs under the button. The
 * button is 44px (the tap floor) inside a 48px control, centred.
 */
export function PasswordInput({
  className,
  invalid,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { invalid?: boolean }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        invalid={invalid}
        type={visible ? "text" : "password"}
        className={cn("pr-12", className)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? "Нууц үг нуух" : "Нууц үг харуулах"}
        className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-control text-muted transition-colors hover:text-ink"
      >
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
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
        invalid ? "border-danger" : "border-border focus:border-faint",
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
          // Open, the trigger takes the surface fill its own popup has, so the
          // two read as one object rather than as a grey box under a white one.
          "data-[state=open]:bg-surface data-[placeholder]:text-faint",
          invalid ? "border-danger" : "border-border data-[state=open]:border-faint",
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
            // ★ Was a hand-rolled `shadow-[0_8px_28px_…]` — the exact thing
            // globals.css argues against, since it put a fourth elevation in
            // the product that no token knew about. `shadow-lg` is the popover
            // step and every raised surface now spells one of three names.
            "shadow-lg",
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

/**
 * The box itself — one drawing, every checkbox in the product.
 *
 * ★ Restyled, and this reverses a decision recorded a few lines below.
 *
 * `Checkbox` used to argue for the bare native control: "a restyled one loses
 * the platform's own focus ring and checked state". That was a real cost and it
 * is paid back here rather than ignored — the client asked for rounded boxes on
 * 2026-09-04, and a native checkbox cannot be rounded at all, because
 * `border-radius` does not apply to a control the browser paints itself.
 *
 * What the note was protecting is kept:
 *
 *   · It is still `<input type="checkbox">`. Assistive tech, form submission,
 *     the space bar, `indeterminate` and label association are the browser's,
 *     not a `role="checkbox"` div's — which is the version of "restyled" that
 *     actually loses things.
 *   · The focus ring comes back explicitly. `globals.css` sets a 2px
 *     `:focus-visible` outline on everything, and `appearance-none` does not
 *     remove it — so a keyboard user still sees the same ring they see on every
 *     other control, following this box's own corners.
 *   · The checked state is drawn rather than assumed: a tick at 3px stroke on
 *     `--color-primary`, which `ui-foundation.test.tsx` measures for contrast
 *     against `--color-surface`.
 *
 * ★★ `indeterminate` is a DOM property with no HTML attribute, so it can only
 * be set imperatively — there is no JSX prop for it, and the effect below is
 * the only way to reach it.
 *
 * ★★★ The tick and the dash are siblings of the input, not children.
 *
 * An `<input>` is a void element and cannot contain anything, so the mark is
 * positioned over it and made `pointer-events-none` — a click that landed on
 * the tick instead of the box would do nothing at all.
 */
export function CheckControl({
  indeterminate = false,
  className,
  ...props
}: ComponentProps<"input"> & {
  /** Renders the dash: some of the things below this are checked, not all. */
  indeterminate?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !props.checked;
  }, [indeterminate, props.checked]);

  return (
    <span className="relative inline-flex shrink-0">
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          "peer size-5 shrink-0 appearance-none rounded-check border-2 border-border bg-surface transition-colors",
          "checked:border-primary checked:bg-primary",
          "indeterminate:border-primary indeterminate:bg-primary",
          "hover:border-faint checked:hover:border-primary",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />

      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto hidden size-3.5 text-surface peer-checked:block"
      />
      <Minus
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto hidden size-3.5 text-surface peer-indeterminate:block"
      />
    </span>
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
      <CheckControl id={id} className="mt-1" {...props} />
      <span className="text-body leading-snug">
        <span className="font-medium text-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-caption text-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
