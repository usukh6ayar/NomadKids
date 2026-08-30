"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Check, Pencil } from "lucide-react";
import { ageProfileSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { AgeSectionShell } from "@/components/child/age-section-shell";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { GRADIENT_TONE_STYLE, type GradientTone } from "@/lib/gradient-tones";
import { cn } from "@/lib/utils";

const ageProfilesSchema = z.array(ageProfileSchema);

/*
 * ★ A per-age tint, matching the reference build's own 2/3/4 нас colours
 * (`GRADIENT_TONE_STYLE`'s doc comment has the source). The fill signal
 * itself is the `Check` icon at full size and contrast — colour only
 * distinguishes which of four different ages a tile is, the same job
 * `GRADIENT_TONE_STYLE`'s five tones do on `/home`'s own tile grid.
 */
const AGE_TONE: Record<(typeof PORTFOLIO_AGES)[number], GradientTone> = {
  2: "green",
  3: "blue",
  4: "orange",
  5: "purple",
};

/** Whether an age section has anything in it yet — drives the filled dot. */
function hasAgeContent(profile?: z.infer<typeof ageProfileSchema>): boolean {
  if (!profile) return false;
  return Object.entries(profile).some(
    ([key, value]) => key !== "age" && typeof value === "string" && value.trim().length > 0,
  );
}

/**
 * RFP §4.3's fields, in the RFP's own order.
 *
 * ★ Four of these were stored, accepted and never shown.
 *
 * `ChildAgeProfile` has carried `favoriteStory`, `emotionalTraits`,
 * `familyMembers` and `learningInterest` since the schema was written;
 * `PATCH /age-profiles/:age` validates and persists all of them; the Zod
 * contract declares them. Only this array was short, so four RFP-mandated
 * fields could be written by any other client and were invisible here — and a
 * teacher had no way to enter them at all.
 *
 * ★★ Still short of the RFP by two: дуртай кино/хүүхэлдэйн кино and дуртай
 * хувцас have no column, so adding them is a migration rather than a list edit
 * — deliberately left out of a frontend change. "Тухайн насны зураг" is the
 * gallery, which lives on the child's own "Зураг" page.
 */
const AGE_FIELDS = [
  { key: "favoriteColor", label: "Дуртай өнгө", long: false },
  { key: "favoriteFood", label: "Дуртай хоол", long: false },
  { key: "favoriteToy", label: "Дуртай тоглоом", long: false },
  { key: "favoriteBook", label: "Дуртай ном", long: false },
  { key: "favoriteSong", label: "Дуртай дуу", long: false },
  { key: "favoriteStory", label: "Дуртай үлгэр", long: false },
  { key: "favoriteActivity", label: "Дуртай үйл ажиллагаа", long: false },
  { key: "familyMembers", label: "Гэр бүлийн гишүүд", long: true },
  { key: "personality", label: "Зан чанар", long: true },
  { key: "emotionalTraits", label: "Сэтгэл хөдлөлийн онцлог", long: true },
  { key: "learningInterest", label: "Суралцах сонирхол", long: true },
  { key: "newSkills", label: "Шинээр эзэмшсэн чадвар", long: true },
] as const;

/**
 * The age 2–5 quick-nav row plus the four sections themselves — the
 * "Насны онцлог" pane of the "Хөгжил" page (`portfolio/growth/page.tsx`).
 *
 * ★ Self-contained, like every other `Child*` component: it queries
 * `age-profiles` itself rather than asking the page to fetch and hand it
 * down, so mounting it — and only it — is what makes the query fire. That
 * matters here specifically: this pane sits behind a Radix tab, and an
 * inactive `Tabs.Content` unmounts, so the query cannot run before the pane
 * is actually opened (see `growth/page.tsx`'s own doc comment).
 */
export function ChildGrowthAges({
  childId,
  isGuardian,
  currentAge,
}: {
  childId: string;
  isGuardian: boolean;
  /** Decides which years open by default and which age tiles show a check. */
  currentAge: number | null;
}) {
  const ageProfiles = useQuery({
    queryKey: qk.ageProfiles(childId),
    queryFn: () => get(`/children/${childId}/age-profiles`, ageProfilesSchema),
  });

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Насны хэсгүүд рүү шилжих">
        <ul className="grid grid-cols-4 gap-2">
          {PORTFOLIO_AGES.map((age) => {
            const filled = hasAgeContent(ageProfiles.data?.find((p) => p.age === age));
            const tone = GRADIENT_TONE_STYLE[AGE_TONE[age]];
            return (
              <li key={age}>
                <a
                  href={`#age-${age}`}
                  aria-label={`${age} нас — ${filled ? "мэдээлэлтэй" : "хоосон"}`}
                  className={cn(
                    "flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-row border border-white/30 px-1.5 py-2 text-caption font-bold text-white transition-transform hover:scale-[1.02] md:min-h-[64px] md:px-2 md:text-body",
                    tone.gradient,
                    tone.shadow,
                  )}
                >
                  <span>{age} нас</span>
                  {filled ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    // Holds the line's height so the four buttons stay the
                    // same size whether or not they are filled.
                    <span aria-hidden="true" className="block h-[14px]" />
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {PORTFOLIO_AGES.map((age) => (
        <AgeSection
          key={age}
          childId={childId}
          age={age}
          profile={ageProfiles.data?.find((p) => p.age === age)}
          isLoading={ageProfiles.isLoading}
          isGuardian={isGuardian}
          currentAge={currentAge}
        />
      ))}
    </div>
  );
}

function AgeSection({
  childId,
  age,
  profile,
  isLoading,
  isGuardian,
  currentAge,
}: {
  childId: string;
  age: number;
  profile?: z.infer<typeof ageProfileSchema>;
  isLoading: boolean;
  isGuardian: boolean;
  currentAge: number | null;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  // ★ The field this actor owns. The other side's note is read-only text.
  const ownNoteKey = isGuardian ? "parentNote" : "teacherNote";
  const ownNoteLabel = isGuardian ? "Эцэг эхийн тэмдэглэл" : "Багшийн тэмдэглэл";
  const otherNoteKey = isGuardian ? "teacherNote" : "parentNote";
  const otherNoteLabel = isGuardian ? "Багшийн тэмдэглэл" : "Эцэг эхийн тэмдэглэл";

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const field of AGE_FIELDS) next[field.key] = (profile?.[field.key] as string) ?? "";
    next[ownNoteKey] = (profile?.[ownNoteKey as keyof typeof profile] as string) ?? "";
    setForm(next);
  }, [profile, ownNoteKey]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, string | null> = {};
      for (const field of AGE_FIELDS) body[field.key] = form[field.key]?.trim() || null;
      // ★ Only ever the actor's own note. Including the other key would be a
      // 400 naming the field — the API checks, and this UI never sends it.
      body[ownNoteKey] = form[ownNoteKey]?.trim() || null;

      return mutate(`/children/${childId}/age-profiles/${age}`, ageProfileSchema, {
        method: "PATCH",
        body,
      });
    },
    onSuccess: () => {
      toast.success("Хадгаллаа.");
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: qk.ageProfiles(childId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(save.error);
  const otherNote = profile?.[otherNoteKey as keyof typeof profile] as string | null | undefined;
  const hasContent =
    AGE_FIELDS.some((f) => profile?.[f.key]) ||
    Boolean(profile?.[ownNoteKey as keyof typeof profile]) ||
    Boolean(otherNote);

  return (
    <AgeSectionShell
      age={age}
      anchor={`age-${age}`}
      headingId={`age-${age}-heading`}
      filled={hasContent}
      currentAge={currentAge}
      action={
        !editing ? (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={16} />
            Засах
          </Button>
        ) : null
      }
    >
      <>
        {isLoading ? <LoadingState rows={1} /> : null}

        {!isLoading && !editing ? (
          hasContent ? (
            <div className="flex flex-col gap-3">
              <dl className="grid gap-3 md:grid-cols-2">
                {AGE_FIELDS.filter((f) => profile?.[f.key]).map((field) => (
                  <div key={field.key} className={field.long ? "md:col-span-2" : undefined}>
                    <dt className="text-caption font-medium text-muted">{field.label}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-body text-ink">
                      {String(profile?.[field.key])}
                    </dd>
                  </div>
                ))}
              </dl>

              {profile?.[ownNoteKey as keyof typeof profile] ? (
                <NoteBlock
                  label={ownNoteLabel}
                  text={String(profile[ownNoteKey as keyof typeof profile])}
                  tone="own"
                />
              ) : null}

              {otherNote ? <NoteBlock label={otherNoteLabel} text={otherNote} tone="other" /> : null}
            </div>
          ) : (
            <EmptyState
              icon={<Image src="/background/mascot-boy-green.webp" alt="" width={96} height={96} />}
              title="Энэ насны тэмдэглэл хоосон байна"
              description="Дуртай зүйлс, зан чанар, шинэ чадварууд — «Засах» дарж бөглөнө үү."
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

            <div className="grid gap-4 md:grid-cols-2">
              {AGE_FIELDS.map((field) => (
                <Field
                  key={field.key}
                  label={field.label}
                  error={errors[field.key]}
                  className={field.long ? "md:col-span-2" : undefined}
                >
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
            </div>

            {/* Only the actor's own voice is editable. */}
            <Field
              label={ownNoteLabel}
              hint={
                isGuardian
                  ? "Багшийн тэмдэглэлийг зөвхөн багш засна."
                  : "Эцэг эхийн тэмдэглэлийг зөвхөн эцэг эх засна."
              }
              error={errors[ownNoteKey]}
            >
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form[ownNoteKey] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [ownNoteKey]: e.target.value }))}
                />
              )}
            </Field>

            {otherNote ? <NoteBlock label={otherNoteLabel} text={otherNote} tone="other" /> : null}

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
      </>
    </AgeSectionShell>
  );
}

function NoteBlock({ label, text, tone }: { label: string; text: string; tone: "own" | "other" }) {
  return (
    <div className={cn("rounded-control px-3.5 py-3", tone === "own" ? "bg-primary-soft" : "bg-canvas")}>
      <p className="text-caption font-medium text-muted">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-body text-ink">{text}</p>
    </div>
  );
}
