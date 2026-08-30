"use client";

import { Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * "Сонгож эсвэл шинээр бичээрэй" — a row of age-appropriate chips over a plain
 * textarea, for `newSkills`/`familyMembers` on the parent's per-age page.
 *
 * ★ Same `role="radiogroup"`/`role="radio"` pattern `child-about-me.tsx`'s
 * `EYE_COLOR_OPTIONS` swatches already use for "pick one of a fixed set,
 * tapping the selected one again clears it" — this is that same shape with
 * text chips instead of colour swatches.
 *
 * ★★ One value, not two. A chip only ever *sets the textarea's text* — there
 * is no separate "chosen option" state to reconcile with "custom text"; the
 * field is a plain string on the wire either way (`ChildAgeProfile.newSkills`
 * / `.familyMembers`), so typing over a chip's text or picking a different
 * chip both just change that one string. `id` lands on the textarea, since it
 * is what a `<Field>` wrapping this points its `<label htmlFor>` at.
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
      <div role="radiogroup" aria-label="Санал болгож буй сонголтууд" className="flex flex-wrap gap-2">
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
                "rounded-pill border px-3 py-1.5 text-body font-medium transition-colors",
                active
                  ? "border-primary bg-primary-soft text-primary-strong"
                  : "border-border bg-surface text-ink hover:border-primary",
              )}
            >
              {option}
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
