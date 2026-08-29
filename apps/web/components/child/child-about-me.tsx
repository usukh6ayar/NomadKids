"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  Droplet,
  Heart,
  MapPin,
  MessageCircle,
  Pencil,
  Ruler,
  Sparkles,
  Sun,
  Tag,
  Users,
  Weight,
} from "lucide-react";
import {
  aboutMeSchema,
  childDetailSchema,
  SEX_LABEL,
  YEAR_ANIMALS,
  ZODIAC_SIGNS,
} from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, FormError, LoadingState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";
import { YEAR_ANIMAL_ICON, ZODIAC_ICON } from "@/lib/zodiac-icons";
import { cn } from "@/lib/utils";

// `/about-me` answers with `{ exists: false }` when nothing is written yet.
export const aboutMeResponseSchema = aboutMeSchema.extend({ exists: z.boolean().nullish() });
export type AboutMeResponse = z.infer<typeof aboutMeResponseSchema>;

/**
 * ★ The "story" fields, rendered as icon cards — the client's front-v2
 * redesign (PR #5, `about-story`).
 *
 * These are keepsake details, not statistics. The previous treatment was a
 * two-column definition list, which read as a form somebody had filled in; a
 * card with an icon and a heading reads as something written *about a child*.
 * The icon is decorative and paired with a visible label, never on its own.
 *
 * ★★ `clanName` through `eyeColor` added 2026-08-28, on the client's
 * instruction — identity facts a reference build showed (`ChildProfile`'s
 * own doc comment has the detail) that RFP §4.1 does not list. Short,
 * one-line facts, so `long: false` throughout — unlike the five above, none
 * of these is a sentence.
 */
const ABOUT_FIELDS = [
  { key: "introduction", label: "Танилцуулга", long: true, Icon: BookOpen, tone: "sky" },
  { key: "nameMeaning", label: "Нэрний утга", long: false, Icon: Heart, tone: "peach" },
  { key: "dream", label: "Миний мөрөөдөл", long: false, Icon: Sun, tone: "sun" },
  { key: "distinguishingTraits", label: "Миний онцлог", long: true, Icon: Sparkles, tone: "mint" },
  {
    key: "memorableSayings",
    label: "Сонирхолтой үг",
    long: true,
    Icon: MessageCircle,
    tone: "sky",
  },
  { key: "clanName", label: "Ургийн овог", long: false, Icon: Users, tone: "mint" },
  { key: "nickname", label: "Өхөөрддөг нэр", long: false, Icon: Tag, tone: "peach" },
  { key: "birthplace", label: "Төрсөн газар", long: false, Icon: MapPin, tone: "sun" },
  { key: "bloodType", label: "Цусны бүлэг", long: false, Icon: Droplet, tone: "sky" },
  // `eyeColor` is not here — it gets its own swatch picker, `EYE_COLOR_OPTIONS`
  // below, rather than this array's plain-text card.
] as const;

const STORY_TONE: Record<string, string> = {
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  sun: "bg-sun text-sun-ink",
  peach: "bg-peach text-peach-ink",
};

/**
 * A swatch stands in for a photo of the child's own eyes — 2026-08-28, on
 * the client's instruction, with the swatch itself named as a placeholder
 * for real art the client is supplying later. The label renders in the same
 * hex the swatch does ("Бор" in brown, literally), which is the reason this
 * is a fixed list rather than the free-text field it replaces: colouring
 * arbitrary typed text would need to guess a colour from a word.
 */
const EYE_COLOR_OPTIONS = [
  { label: "Хар", hex: "#2b2118" },
  { label: "Бор", hex: "#6b3f1d" },
  { label: "Хүрэн", hex: "#8b5a2b" },
  { label: "Ногоон", hex: "#4a7c59" },
  { label: "Цэнхэр", hex: "#4a7ba6" },
  { label: "Саарал", hex: "#8a8f94" },
] as const;

/**
 * "Миний тухай" — RFP §4.1, its own page since 2026-08-29.
 *
 * ★ The two-voices rule (RFP §4.3) does not apply here — that is an
 * age-section thing (`child-growth-ages.tsx`). This card is the child's own
 * identity, written once by whoever is looking at it.
 *
 * `PATCH /about-me` also writes `Child`'s own name/DOB/sex — the reference
 * build groups "who this child is" as one form, and this port now matches it:
 * a guardian edits Овог/Нэр/Төрсөн өдөр/Хүйс through the same "Засах" a
 * teacher uses, rather than needing the separate `/edit` screen for facts
 * that live on their own child.
 */
export function ChildAboutMe({
  childId,
  child,
  data,
  isLoading,
  error,
}: {
  childId: string;
  child: z.infer<typeof childDetailSchema>;
  data?: AboutMeResponse;
  isLoading: boolean;
  error: unknown;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  // Re-seeded whenever the server data changes, so opening the editor shows
  // what is actually stored rather than a stale copy from an earlier render.
  // `lastName`/`firstName`/`dateOfBirth`/`sex` seed from `child`, not `data`
  // — they live on `Child`, and `GET /about-me` only ever answers for
  // `ChildProfile`.
  useEffect(() => {
    if (!data) return;
    setForm({
      lastName: child.lastName ?? "",
      firstName: child.firstName ?? "",
      dateOfBirth: child.dateOfBirth ? String(child.dateOfBirth).slice(0, 10) : "",
      sex: child.sex ?? "",
      introduction: data.introduction ?? "",
      nameMeaning: data.nameMeaning ?? "",
      dream: data.dream ?? "",
      distinguishingTraits: data.distinguishingTraits ?? "",
      memorableSayings: data.memorableSayings ?? "",
      clanName: data.clanName ?? "",
      nickname: data.nickname ?? "",
      birthplace: data.birthplace ?? "",
      bloodType: data.bloodType ?? "",
      eyeColor: data.eyeColor ?? "",
      yearAnimalCode: data.yearAnimalCode ?? "",
      zodiacCode: data.zodiacCode ?? "",
      heightCm: data.heightCm === null || data.heightCm === undefined ? "" : String(data.heightCm),
      weightKg: data.weightKg === null || data.weightKg === undefined ? "" : String(data.weightKg),
      // `<input type="date">` wants `YYYY-MM-DD`; the API sends an ISO stamp.
      recordedOn: data.recordedOn ? String(data.recordedOn).slice(0, 10) : "",
    });
  }, [data, child]);

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/about-me`, aboutMeResponseSchema, {
        method: "PATCH",
        body: {
          // Sent only when actually filled — `lastName`/`firstName` are
          // required on `Child` and an empty string would fail there, not
          // silently clear a name the way the optional fields below can.
          lastName: form.lastName?.trim() || undefined,
          firstName: form.firstName?.trim() || undefined,
          dateOfBirth: form.dateOfBirth?.trim() || undefined,
          sex: form.sex?.trim() || undefined,
          introduction: form.introduction?.trim() || null,
          nameMeaning: form.nameMeaning?.trim() || null,
          dream: form.dream?.trim() || null,
          distinguishingTraits: form.distinguishingTraits?.trim() || null,
          memorableSayings: form.memorableSayings?.trim() || null,
          clanName: form.clanName?.trim() || null,
          nickname: form.nickname?.trim() || null,
          birthplace: form.birthplace?.trim() || null,
          bloodType: form.bloodType?.trim() || null,
          eyeColor: form.eyeColor?.trim() || null,
          // Empty clears the override and returns the field to the computed
          // fact — see `PortfolioService.listBirthdayNotes`.
          yearAnimalCode: form.yearAnimalCode?.trim() || null,
          zodiacCode: form.zodiacCode?.trim() || null,
          // Empty means "clear it", which the API models as null. Sending ""
          // would fail the numeric coercion.
          heightCm: form.heightCm?.trim() ? Number(form.heightCm) : null,
          weightKg: form.weightKg?.trim() ? Number(form.weightKg) : null,
          recordedOn: form.recordedOn?.trim() || null,
        },
      }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: qk.aboutMe(childId) });
      // Also invalidates `Child` — `lastName`/`firstName`/`dateOfBirth`/`sex`
      // may have changed, and `ChildHeroProfile` above this section reads
      // the same query key.
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      // And the birthday facts — a yearAnimalCode/zodiacCode override changes
      // what `ChildBirthdayFacts` (rendered from this same query) shows.
      void queryClient.invalidateQueries({ queryKey: qk.birthdayNotes(childId) });
    },
  });

  const errors = fieldErrors(save.error);
  const filled = ABOUT_FIELDS.some((f) => data?.[f.key]) || Boolean(data?.eyeColor);

  return (
    <section aria-labelledby="about-me-heading">
      <SectionHeader
        id="about-me-heading"
        as="h1"
        title="Миний тухай"
        action={
          !editing ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={16} />
              Засах
            </Button>
          ) : null
        }
      />

      <Card pad="roomy">
        {isLoading ? <LoadingState rows={2} /> : null}
        {error ? <p className="text-body text-danger">{errorMessage(error)}</p> : null}

        {!isLoading && !editing ? (
          filled || data?.heightCm || data?.weightKg || data?.recordedOn ? (
            <div className="flex flex-col gap-4">
              {/* Height and weight are measurements, so they stay compact facts. */}
              {data?.heightCm || data?.weightKg || data?.recordedOn ? (
                <div className="flex flex-wrap gap-2">
                  {data?.heightCm ? (
                    <span className="inline-flex items-center gap-2 rounded-control bg-canvas px-2.5 py-1.5 text-caption md:px-3 md:py-2 md:text-body">
                      <Ruler size={16} aria-hidden="true" className="text-muted" />
                      <span className="text-muted">Өндөр</span>
                      <strong className="font-semibold text-ink">{String(data.heightCm)} см</strong>
                    </span>
                  ) : null}
                  {data?.weightKg ? (
                    <span className="inline-flex items-center gap-2 rounded-control bg-canvas px-2.5 py-1.5 text-caption md:px-3 md:py-2 md:text-body">
                      <Weight size={16} aria-hidden="true" className="text-muted" />
                      <span className="text-muted">Жин</span>
                      <strong className="font-semibold text-ink">{String(data.weightKg)} кг</strong>
                    </span>
                  ) : null}
                  {/*
                    RFP §4.1's "оруулсан огноо", beside the numbers it dates
                    rather than in a row of its own — a height with no date is a
                    measurement of a growing child that nobody can place in time.
                  */}
                  {data?.recordedOn ? (
                    <span className="inline-flex items-center gap-2 rounded-control bg-canvas px-2.5 py-1.5 text-caption md:px-3 md:py-2 md:text-body">
                      <CalendarDays size={16} aria-hidden="true" className="text-muted" />
                      <span className="text-muted">Хэмжсэн</span>
                      <strong className="font-semibold text-ink">
                        {formatDate(data.recordedOn)}
                      </strong>
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                {ABOUT_FIELDS.filter((f) => data?.[f.key]).map((field) => (
                  <article
                    key={field.key}
                    className={cn(
                      "rounded-row border border-border bg-canvas px-3 py-3 md:px-4 md:py-3.5",
                      field.long && "md:col-span-2",
                    )}
                  >
                    <h3 className="mb-1.5 flex items-center gap-2 text-caption font-semibold text-ink">
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-control",
                          STORY_TONE[field.tone],
                        )}
                      >
                        <field.Icon size={13} aria-hidden="true" />
                      </span>
                      {field.label}
                    </h3>
                    <p className="whitespace-pre-wrap text-body leading-relaxed text-ink">
                      {String(data?.[field.key])}
                    </p>
                  </article>
                ))}

                {data?.eyeColor ? (
                  <article className="rounded-row border border-border bg-canvas px-3 py-3 md:px-4 md:py-3.5">
                    <h3 className="mb-1.5 flex items-center gap-2 text-caption font-semibold text-ink">
                      <span
                        aria-hidden="true"
                        className="size-6 shrink-0 rounded-control border border-border/60"
                        style={{
                          backgroundColor:
                            EYE_COLOR_OPTIONS.find((o) => o.label === data.eyeColor)?.hex ??
                            "var(--color-border)",
                        }}
                      />
                      Нүдний өнгө
                    </h3>
                    <p
                      className="text-body font-medium"
                      style={{
                        color: EYE_COLOR_OPTIONS.find((o) => o.label === data.eyeColor)?.hex,
                      }}
                    >
                      {data.eyeColor}
                    </p>
                  </article>
                ) : null}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<BookOpen size={28} aria-hidden="true" />}
              title="Хараахан бөглөөгүй байна"
              description="Танилцуулга, нэрний утга, мөрөөдөл — «Засах» дарж эхлүүлнэ үү."
            />
          )
        ) : null}

        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!save.isPending) save.mutate();
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <FormError
              message={
                save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
              }
            />

            {/*
              ★ `Child`'s own columns, first — matching the reference build's
              own field order (identity facts before the portfolio's story
              fields).
            */}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Овог" error={errors.lastName}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={form.lastName ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  />
                )}
              </Field>
              <Field label="Нэр" error={errors.firstName}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={form.firstName ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  />
                )}
              </Field>
              <Field label="Төрсөн өдөр" error={errors.dateOfBirth}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    type="date"
                    value={form.dateOfBirth ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                  />
                )}
              </Field>
              <Field label="Хүйс" error={errors.sex}>
                {({ id, describedBy, invalid }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={form.sex ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, sex: e.target.value }))}
                  >
                    <option value="" disabled>
                      Сонгох…
                    </option>
                    {Object.entries(SEX_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            {ABOUT_FIELDS.map((field) => (
              <Field key={field.key} label={field.label} error={errors[field.key]}>
                {({ id, describedBy, invalid }) =>
                  field.long ? (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={form[field.key] ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                    />
                  ) : (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={form[field.key] ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                    />
                  )
                }
              </Field>
            ))}

            {/*
              ★ Swatches, not a select — the point is to show the colour, not
              read a word. Each button is the placeholder image slot itself
              (see `EYE_COLOR_OPTIONS`'s doc comment); the selected one's
              label repeats below in the same hex, which is the literal
              instruction this followed ("бор" written in brown).
            */}
            <Field label="Нүдний өнгө" error={errors.eyeColor}>
              {() => (
                <div role="radiogroup" aria-label="Нүдний өнгө" className="flex flex-wrap gap-2.5">
                  {EYE_COLOR_OPTIONS.map((option) => {
                    const selected = form.eyeColor === option.label;
                    return (
                      <button
                        key={option.label}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            eyeColor: selected ? "" : option.label,
                          }))
                        }
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-control border px-2 py-2 transition-colors",
                          selected
                            ? "border-primary bg-primary-soft"
                            : "border-border bg-surface hover:border-primary",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="size-8 rounded-pill border border-border/60"
                          style={{ backgroundColor: option.hex }}
                        />
                        <span className="text-caption font-medium" style={{ color: option.hex }}>
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>

            {/*
              ★ 2026-08-28: a guardian picks these directly, on the client's
              instruction — a pick overrides `birthFacts()`'s computed answer
              server-side (`PortfolioService.listBirthdayNotes`); clearing it
              here (tapping the selected tile again) returns to the computed
              one rather than leaving the field visibly empty.
            */}
            <CyclePicker
              label="Арван хоёр жил"
              options={YEAR_ANIMALS}
              iconFor={(code) => YEAR_ANIMAL_ICON[code] ?? "⭐"}
              value={form.yearAnimalCode ?? ""}
              onChange={(code) => setForm((f) => ({ ...f, yearAnimalCode: code }))}
            />

            <CyclePicker
              label="Одны орд"
              options={ZODIAC_SIGNS}
              iconFor={(code) => ZODIAC_ICON[code] ?? "✨"}
              value={form.zodiacCode ?? ""}
              onChange={(code) => setForm((f) => ({ ...f, zodiacCode: code }))}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Өндөр (см)" error={errors.heightCm}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={form.heightCm ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, heightCm: e.target.value }))}
                  />
                )}
              </Field>
              <Field label="Хэмжсэн огноо" error={errors.recordedOn}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    type="date"
                    value={form.recordedOn ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, recordedOn: e.target.value }))}
                  />
                )}
              </Field>

              <Field label="Жин (кг)" error={errors.weightKg}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={form.weightKg ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, weightKg: e.target.value }))}
                  />
                )}
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  save.reset();
                }}
              >
                Цуцлах
              </Button>
            </div>
          </form>
        ) : null}
      </Card>
    </section>
  );
}

/**
 * A 12-tile grid behind a disclosure trigger, shared by the year-animal and
 * zodiac pickers — same options-in/code-out shape, same layout, so one
 * component rather than two that could drift apart.
 *
 * `<details>`, not a Radix popover: the trigger and the grid are both
 * always in the DOM (nothing to portal), and `<details>` gets the
 * keyboard/click toggle for free.
 */
function CyclePicker({
  label,
  options,
  iconFor,
  value,
  onChange,
}: {
  label: string;
  options: { code: string; name: string }[];
  iconFor: (code: string) => string;
  value: string;
  onChange: (code: string) => void;
}) {
  const current = options.find((option) => option.code === value);

  return (
    <div>
      <span className="mb-1.5 block text-caption font-medium text-ink">{label}</span>
      <details
        aria-label={label}
        className="group rounded-control border border-border [&[open]]:border-primary"
      >
        <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-body text-ink [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="text-title leading-none">
              {current ? iconFor(current.code) : "⭐"}
            </span>
            <span className={cn("truncate", !current && "text-muted")}>
              {current?.name ?? "Сонгох…"}
            </span>
          </span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className="shrink-0 text-faint transition-transform group-open:rotate-180"
          />
        </summary>

        <div className="grid grid-cols-4 gap-2 border-t border-border p-2.5">
          {options.map((option) => {
            const selected = option.code === value;
            return (
              <button
                key={option.code}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(selected ? "" : option.code)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-control border px-1.5 py-2 text-caption font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary-soft text-primary-strong"
                    : "border-border bg-surface text-ink hover:border-primary",
                )}
              >
                <span aria-hidden="true" className="text-heading leading-none">
                  {iconFor(option.code)}
                </span>
                {option.name}
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}
