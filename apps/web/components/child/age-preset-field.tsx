"use client";

import { Check } from "lucide-react";
import Image from "next/image";
import { Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * "Сонгож эсвэл шинээр бичээрэй" — a checklist of age-appropriate options over
 * a plain textarea, for `newSkills`/`familyMembers` on the parent's per-age
 * page.
 *
 * ★ REDESIGN — bordered checkbox rows, not pill buttons. The client's
 * reference screenshot draws each option as its own outlined row with a
 * circle to the left, in a two-column grid, rather than a wrapped run of
 * filled pills. The option *content* is unchanged (`AGE_SKILL_OPTIONS`/
 * `AGE_FAMILY_OPTIONS` in `age-content.ts`, still each age's own flat list) —
 * this only changes how a row looks, not what it says.
 *
 * ★★ One value, not two. A row only ever *sets the textarea's text* — there
 * is no separate "chosen option" state to reconcile with "custom text"; the
 * field is a plain string on the wire either way (`ChildAgeProfile.newSkills`
 * / `.familyMembers`), so typing over a row's text or picking a different row
 * both just change that one string. `id` lands on the textarea, since it is
 * what a `<Field>` wrapping this points its `<label htmlFor>` at.
 */
export function AgePresetField({
  id,
  describedBy,
  invalid,
  options,
  value,
  onChange,
}: {
  id: string;
  describedBy?: string;
  invalid?: boolean;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div role="radiogroup" aria-label="Санал болгож буй сонголтууд" className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const active = value.trim() === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(active ? "" : option)}
              className={cn(
                "flex min-h-[44px] items-center gap-2.5 rounded-control border px-3.5 py-2 text-left text-body transition-colors",
                active
                  ? "border-primary bg-primary-soft text-primary-strong"
                  : "border-border bg-surface text-ink hover:border-faint",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-pill border-2",
                  active ? "border-primary bg-primary" : "border-border bg-surface",
                )}
              >
                {active ? <Check size={12} strokeWidth={3} className="text-surface" /> : null}
              </span>
              <span className="min-w-0">{option}</span>
            </button>
          );
        })}
      </div>

      <Textarea
        id={id}
        aria-describedby={describedBy}
        invalid={invalid}
        value={value}
        placeholder="Эсвэл өөрөө бичнэ үү…"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** One option in an `IconMultiPickerField` — a badge and the label under it. */
export interface IconOption {
  label: string;
  icon: string;
}

/**
 * A row of round icon badges, multi-select — "Миний зан аранши"'s emotion
 * picker and "Гэр бүл"'s family-member picker, client reference screenshot,
 * 2026-09-08. Unlike `AgePresetField`, more than one badge can be active at
 * once: a child's temperament and the people in a household are both
 * naturally plural, not a single pick.
 *
 * ★ The value is still one plain string on the wire — the active labels,
 * comma-joined — so this needs no schema change of its own. Toggling a badge
 * adds or removes its label from that list; there is no separate free-text
 * entry here; the way `AgePresetField` has one, since the client's reference
 * pairs this picker with its *own*, separately-labelled textarea next to it
 * (`personality`, `familyMembers`'s "тухай" field) rather than one shared
 * with the badges.
 *
 * ★★ Icons are Unicode emoji, not custom illustration — confirmed with the
 * client 2026-09-08 rather than blocking this on new artwork.
 * `CHARACTER_TRAIT_OPTIONS` still is.
 *
 * ★★★ `FAMILY_MEMBER_OPTIONS` switched to real artwork, 2026-09-08 — the
 * client's own character set, one drawing per relation, delivered square
 * portraits and full-length figures both. An `icon` starting with `/` is a
 * path and renders as `<Image>`; anything else is still read as the emoji
 * text `CHARACTER_TRAIT_OPTIONS` uses. `object-cover` + `object-top` inside
 * the round badge is what makes a full-length figure (`dad.png`,
 * `older-sister.png` — the source art has no head-only crop for those) work
 * beside a portrait crop (`boy.png`, `girl.png`) without the caller needing
 * to know which is which: the badge is a fixed circle, so it always shows
 * the top of whichever the file is.
 */
export function IconMultiPickerField({
  id,
  describedBy,
  invalid,
  options,
  value,
  onChange,
}: {
  id: string;
  describedBy?: string;
  invalid?: boolean;
  options: IconOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const toggle = (label: string) => {
    const next = selected.includes(label)
      ? selected.filter((s) => s !== label)
      : [...selected, label];
    onChange(next.join(", "));
  };

  return (
    <div
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      role="group"
      className="flex flex-wrap gap-3"
    >
      {options.map((option) => {
        const active = selected.includes(option.label);
        const isImage = option.icon.startsWith("/");
        return (
          <button
            key={option.label}
            type="button"
            role="checkbox"
            aria-checked={active}
            onClick={() => toggle(option.label)}
            className="flex w-16 flex-col items-center gap-1.5"
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-14 items-center justify-center overflow-hidden rounded-pill border-2 text-heading transition-colors",
                active ? "border-primary bg-primary-soft" : "border-border bg-sunken",
              )}
            >
              {isImage ? (
                <Image
                  src={option.icon}
                  alt=""
                  width={56}
                  height={56}
                  className="size-full object-cover object-top"
                />
              ) : (
                option.icon
              )}
            </span>
            <span
              className={cn(
                "text-center text-caption leading-tight",
                active ? "font-medium text-primary-strong" : "text-muted",
              )}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
