"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { z } from "zod";
import {
  BookOpen,
  ChevronDown,
  Droplet,
  Heart,
  MapPin,
  MessageCircle,
  Sparkles,
  Sun,
  Tag,
  Users,
} from "lucide-react";
import {
  ageInYears,
  aboutMeSchema,
  birthFacts,
  type BirthdaySection,
  childDetailSchema,
  SEX_LABEL,
  YEAR_ANIMALS,
  ZODIAC_SIGNS,
} from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { yearAnimalIcon, zodiacIcon } from "@/lib/zodiac-icons";
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
 *
 * ★ Four of six got that art, 2026-09-08 — the client's delivered set has an
 * eye drawing for Хар/Бор/Ногоон/Цэнхэр but not for Хүрэн or Саарал, so those
 * two keep the plain colour swatch rather than a fabricated drawing. `icon`
 * is optional for exactly that reason; both render sites fall back to the
 * hex swatch when it is absent.
 */
const EYE_COLOR_OPTIONS = [
  { label: "Хар", hex: "#2b2118", icon: "/icons/eyes/black.png" },
  { label: "Бор", hex: "#6b3f1d", icon: "/icons/eyes/brown.png" },
  { label: "Хүрэн", hex: "#8b5a2b", icon: undefined },
  { label: "Ногоон", hex: "#4a7c59", icon: "/icons/eyes/green.png" },
  { label: "Цэнхэр", hex: "#4a7ba6", icon: "/icons/eyes/blue.png" },
  { label: "Саарал", hex: "#8a8f94", icon: undefined },
] as const;

/** The edit screen's exact, user-facing order before the two visual pickers. */
const EDIT_FIELDS = [
  { key: "clanName", label: "Ургийн овог", kind: "text" },
  { key: "lastName", label: "Овог", kind: "text" },
  { key: "firstName", label: "Нэр", kind: "text" },
  { key: "dateOfBirth", label: "Төрсөн өдөр", kind: "date" },
  { key: "sex", label: "Хүйс", kind: "sex" },
  { key: "nameMeaning", label: "Нэрний утга", kind: "text" },
  { key: "nickname", label: "Өхөөрддөг нэр", kind: "text" },
  { key: "birthplace", label: "Төрсөн газар", kind: "text" },
  { key: "bloodType", label: "Цусны бүлэг", kind: "text" },
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
 *
 * ★★ No `<Card>` of its own, as of the 2026-09-04 merge — `about-me/page.tsx`
 * wraps this together with `AboutMeSummaryCard` in one shared card, so the
 * page reads as a single "Миний тухай" surface rather than two stacked ones.
 *
 * ★★★ No heading or "Засах" button of its own, as of a same-week follow-up —
 * `AboutMeSummaryCard`'s "…" button is now the single edit entry for the
 * whole merged card, identity tiles and these detailed fields alike, so a
 * second "Засах" beside a "Дэлгэрэнгүй мэдээлэл" label it introduced was a
 * second door into the same form. `editing` is a controlled prop rather than
 * local state for exactly that reason: `about-me/page.tsx` owns it and flips
 * it from the "…" button, this component only reads it.
 */
export function ChildAboutMe({
  childId,
  child,
  data,
  isLoading,
  error,
  editing,
  onEditingChange,
}: {
  childId: string;
  child: z.infer<typeof childDetailSchema>;
  data?: AboutMeResponse;
  isLoading: boolean;
  error: unknown;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
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
      nameMeaning: data.nameMeaning ?? "",
      clanName: data.clanName ?? "",
      nickname: data.nickname ?? "",
      birthplace: data.birthplace ?? "",
      bloodType: data.bloodType ?? "",
      eyeColor: data.eyeColor ?? "",
      yearAnimalCode: data.yearAnimalCode ?? "",
      zodiacCode: data.zodiacCode ?? "",
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
          clanName: form.clanName?.trim() || null,
          nameMeaning: form.nameMeaning?.trim() || null,
          nickname: form.nickname?.trim() || null,
          birthplace: form.birthplace?.trim() || null,
          bloodType: form.bloodType?.trim() || null,
          eyeColor: form.eyeColor?.trim() || null,
          // Empty clears the override and returns the field to the computed
          // fact — see `PortfolioService.listBirthdayNotes`.
          yearAnimalCode: form.yearAnimalCode?.trim() || null,
          zodiacCode: form.zodiacCode?.trim() || null,
        },
      }),
    onSuccess: (saved) => {
      // The PATCH response is the new source of truth. Write it into every
      // cache this merged screen reads before closing the editor; otherwise
      // the preview briefly reappears with the old name/profile while three
      // background refetches are still in flight.
      queryClient.setQueryData<AboutMeResponse>(qk.aboutMe(childId), (current) => ({
        ...current,
        ...saved,
        exists: true,
      }));

      queryClient.setQueryData<z.infer<typeof childDetailSchema>>(qk.child(childId), (current) => ({
        ...(current ?? child),
        lastName: form.lastName?.trim() || (current ?? child).lastName,
        firstName: form.firstName?.trim() || (current ?? child).firstName,
        dateOfBirth: form.dateOfBirth?.trim() || (current ?? child).dateOfBirth,
        sex: form.sex === "MALE" || form.sex === "FEMALE" ? form.sex : (current ?? child).sex,
      }));

      queryClient.setQueryData<BirthdaySection>(qk.birthdayNotes(childId), (current) => {
        const dateOfBirth = form.dateOfBirth?.trim() || current?.dateOfBirth || child.dateOfBirth;
        const computed = birthFacts(dateOfBirth);
        const yearAnimal = YEAR_ANIMALS.find(
          (animal) => animal.code === form.yearAnimalCode?.trim(),
        );
        const zodiac = ZODIAC_SIGNS.find((sign) => sign.code === form.zodiacCode?.trim());

        return {
          dateOfBirth,
          ageYears: ageInYears(dateOfBirth),
          zodiac: zodiac ?? computed.zodiac,
          yearAnimal: yearAnimal
            ? { ...yearAnimal, beforeLunarNewYear: false }
            : computed.yearAnimal,
          notes: current?.notes ?? [],
        };
      });

      toast.success("Хадгаллаа.");
      onEditingChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(save.error);
  const filled = ABOUT_FIELDS.some((f) => data?.[f.key]) || Boolean(data?.eyeColor);

  return (
    <div>
      {isLoading ? <LoadingState rows={2} /> : null}
      {error ? <p className="text-body text-danger">{errorMessage(error)}</p> : null}

      {!isLoading && !editing ? (
        filled ? (
          <div
            role="list"
            aria-label="Миний тухай мэдээллүүд"
            className="grid grid-cols-2 gap-2.5 md:gap-3"
          >
            {ABOUT_FIELDS.filter((f) => data?.[f.key]).map((field) => (
              <article
                key={field.key}
                role="listitem"
                className="min-w-0 rounded-row border border-border bg-canvas px-2.5 py-3 md:px-4 md:py-3.5"
              >
                <h3 className="mb-1.5 flex min-w-0 items-center gap-1.5 text-caption font-semibold text-ink md:gap-2">
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-check",
                      STORY_TONE[field.tone],
                    )}
                  >
                    <field.Icon size={13} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 break-words">{field.label}</span>
                </h3>
                <p className="break-words whitespace-pre-wrap text-caption leading-relaxed text-ink md:text-body">
                  {String(data?.[field.key])}
                </p>
              </article>
            ))}

            {data?.eyeColor ? (
              <article
                role="listitem"
                className="min-w-0 rounded-row border border-border bg-canvas px-2.5 py-3 md:px-4 md:py-3.5"
              >
                <h3 className="mb-1.5 flex items-center gap-2 text-caption font-semibold text-ink">
                  {(() => {
                    const option = EYE_COLOR_OPTIONS.find((o) => o.label === data.eyeColor);
                    return option?.icon ? (
                      <span
                        aria-hidden="true"
                        className="size-6 shrink-0 overflow-hidden rounded-check border border-border/60"
                      >
                        <Image
                          src={option.icon}
                          alt=""
                          width={24}
                          height={24}
                          className="size-full object-cover"
                        />
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        className="size-6 shrink-0 rounded-check border border-border/60"
                        style={{ backgroundColor: option?.hex ?? "var(--color-border)" }}
                      />
                    );
                  })()}
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
          aria-label="Миний тухай мэдээлэл засах"
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

          <div className="grid gap-4 md:grid-cols-2">
            {EDIT_FIELDS.map((field) => (
              <Field key={field.key} label={field.label} error={errors[field.key]}>
                {({ id, describedBy, invalid }) =>
                  field.kind === "sex" ? (
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={form[field.key] ?? ""}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, [field.key]: event.target.value }))
                      }
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
                  ) : (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      type={field.kind === "date" ? "date" : "text"}
                      value={form[field.key] ?? ""}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                    />
                  )
                }
              </Field>
            ))}
          </div>

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
                      {option.icon ? (
                        <span
                          aria-hidden="true"
                          className="size-8 overflow-hidden rounded-pill border border-border/60"
                        >
                          <Image
                            src={option.icon}
                            alt=""
                            width={32}
                            height={32}
                            className="size-full object-cover"
                          />
                        </span>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="size-8 rounded-pill border border-border/60"
                          style={{ backgroundColor: option.hex }}
                        />
                      )}
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
            iconFor={yearAnimalIcon}
            value={form.yearAnimalCode ?? ""}
            onChange={(code) => setForm((f) => ({ ...f, yearAnimalCode: code }))}
          />

          <CyclePicker
            label="Одны орд"
            options={ZODIAC_SIGNS}
            iconFor={zodiacIcon}
            value={form.zodiacCode ?? ""}
            onChange={(code) => setForm((f) => ({ ...f, zodiacCode: code }))}
          />

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                onEditingChange(false);
                save.reset();
              }}
            >
              Цуцлах
            </Button>
          </div>
        </form>
      ) : null}
    </div>
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
  iconFor: (code: string, size: number) => ReactNode;
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
            <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center">
              {current ? iconFor(current.code, 24) : <span className="text-title leading-none">⭐</span>}
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
                <span aria-hidden="true" className="grid size-8 place-items-center">
                  {iconFor(option.code, 32)}
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
