"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { BookOpen, Heart, MessageCircle, Pencil, Ruler, Sparkles, Sun, Weight } from "lucide-react";
import {
  aboutMeSchema,
  ageProfileSchema,
  birthdayNoteSchema,
  childDetailSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors, isNotFound } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { ChildHeader } from "@/components/child/child-header";
import { cn } from "@/lib/utils";

const PORTFOLIO_AGES = [2, 3, 4, 5] as const;

/**
 * One soft accent per age — the client's front-v2 redesign gives each year its
 * own colour so the row reads as a progression rather than four identical
 * buttons. The accents are the ones already in the palette; no new colours.
 */
const AGE_TONE: Record<number, string> = {
  2: "border-mint bg-mint text-mint-ink hover:opacity-90",
  3: "border-sky bg-sky text-sky-ink hover:opacity-90",
  4: "border-sun bg-sun text-sun-ink hover:opacity-90",
  5: "border-peach bg-peach text-peach-ink hover:opacity-90",
};

/** Whether an age section has anything in it yet — drives the filled dot. */
function hasAgeContent(profile?: z.infer<typeof ageProfileSchema>): boolean {
  if (!profile) return false;
  return Object.entries(profile).some(
    ([key, value]) => key !== "age" && typeof value === "string" && value.trim().length > 0,
  );
}

// `/about-me` answers with `{ exists: false }` when nothing is written yet.
const aboutMeResponseSchema = aboutMeSchema.extend({ exists: z.boolean().nullish() });
const ageProfilesSchema = z.array(ageProfileSchema);
const birthdayNotesSchema = z.array(birthdayNoteSchema);

/**
 * The portfolio — RFP §4.3.
 *
 * "Миний тухай", then one section per age from 2 to 5, then birthday notes.
 * Edited **one section at a time, in place**. Not a wizard: this record is
 * filled in over four years, a few fields at a time, usually by whoever is
 * looking at it — a form that insists on walking through all of it would be
 * abandoned halfway.
 *
 * ★ The two-voices rule (RFP §4.3) is visible here: a guardian sees and writes
 * "Эцэг эхийн тэмдэглэл"; a teacher sees and writes "Багшийн тэмдэглэл"; each
 * reads the other's as text. The API rejects a write to the wrong one with a
 * 400 naming the field — this UI simply never renders the field it may not
 * write, so that rejection is unreachable through normal use.
 *
 * Whether someone is "the guardian" is decided by their **relationship to this
 * child**, not their role: a teacher whose own child attends the same
 * kindergarten writes the parent note for their own child. That is exactly how
 * the API decides it, so the two cannot disagree.
 */
export default function PortfolioPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;
  const { session } = useSession();

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  const aboutMe = useQuery({
    queryKey: qk.aboutMe(childId),
    queryFn: () => get(`/children/${childId}/about-me`, aboutMeResponseSchema),
    enabled: child.isSuccess,
  });

  const ageProfiles = useQuery({
    queryKey: qk.ageProfiles(childId),
    queryFn: () => get(`/children/${childId}/age-profiles`, ageProfilesSchema),
    enabled: child.isSuccess,
  });

  const birthdays = useQuery({
    queryKey: qk.birthdayNotes(childId),
    queryFn: () => get(`/children/${childId}/birthday-notes`, birthdayNotesSchema),
    enabled: child.isSuccess,
  });

  if (child.isLoading) return <LoadingState rows={4} />;

  if (child.isError) {
    return (
      <div className="py-6">
        <ErrorState
          title={isNotFound(child.error) ? "Олдсонгүй" : "Алдаа гарлаа"}
          description={
            isNotFound(child.error) ? "Энэ хавтас олдсонгүй." : errorMessage(child.error)
          }
          action={
            <Button asChild variant="secondary">
              <Link href="/children">Буцах</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const data = child.data!;

  // Relationship, not role — see the note above.
  const isGuardian = data.guardianships.some(
    (g) => g.guardian?.id === session?.user.id && g.canView !== false,
  );

  return (
    <div className="flex flex-col gap-6 py-2">
      <ChildHeader child={data} />

      <nav aria-label="Хавтасны хэсгүүд" className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <SectionLink href="#about-me" label="Миний тухай" />
          <SectionLink href="#birthdays" label="Төрсөн өдөр" />
        </div>

        {/*
          ★ The age row, carried over from the client's front-v2 redesign
          (PR #5, `age-buttons`). Four years is a fixed, tiny set, so a row of
          coloured buttons reads as a timeline in a way identical grey pills do
          not — and the filled/empty dot answers "how much of this is done"
          without a progress bar.

          The dot is paired with `aria-label` text, never colour alone.
        */}
        <ul className="grid grid-cols-4 gap-2">
          {PORTFOLIO_AGES.map((age) => {
            const filled = hasAgeContent(ageProfiles.data?.find((p) => p.age === age));
            return (
              <li key={age}>
                <a
                  href={`#age-${age}`}
                  aria-label={`${age} нас — ${filled ? "мэдээлэлтэй" : "хоосон"}`}
                  className={cn(
                    "flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[14px] border px-2 py-2 text-sm font-semibold transition-colors",
                    AGE_TONE[age],
                  )}
                >
                  <span>{age} нас</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 rounded-full",
                      filled ? "bg-current opacity-80" : "bg-current opacity-25",
                    )}
                  />
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <AboutMeSection
        childId={childId}
        data={aboutMe.data}
        isLoading={aboutMe.isLoading}
        error={aboutMe.error}
      />

      {PORTFOLIO_AGES.map((age) => (
        <AgeSection
          key={age}
          childId={childId}
          age={age}
          profile={ageProfiles.data?.find((p) => p.age === age)}
          isLoading={ageProfiles.isLoading}
          isGuardian={isGuardian}
        />
      ))}

      <BirthdaySection
        childId={childId}
        notes={birthdays.data ?? []}
        isLoading={birthdays.isLoading}
      />
    </div>
  );
}

function SectionLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-[44px] items-center rounded-[999px] border border-border bg-surface px-3.5 text-sm font-medium text-muted hover:bg-canvas hover:text-ink"
    >
      {label}
    </a>
  );
}

// ── Миний тухай ─────────────────────────────────────────────────────────────

/**
 * ★ The "story" fields, rendered as icon cards — the client's front-v2
 * redesign (PR #5, `about-story`).
 *
 * These are keepsake details, not statistics. The previous treatment was a
 * two-column definition list, which read as a form somebody had filled in; a
 * card with an icon and a heading reads as something written *about a child*.
 * The icon is decorative and paired with a visible label, never on its own.
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
] as const;

const STORY_TONE: Record<string, string> = {
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  sun: "bg-sun text-sun-ink",
  peach: "bg-peach text-peach-ink",
};

function AboutMeSection({
  childId,
  data,
  isLoading,
  error,
}: {
  childId: string;
  data?: z.infer<typeof aboutMeResponseSchema>;
  isLoading: boolean;
  error: unknown;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  // Re-seeded whenever the server data changes, so opening the editor shows
  // what is actually stored rather than a stale copy from an earlier render.
  useEffect(() => {
    if (!data) return;
    setForm({
      introduction: data.introduction ?? "",
      nameMeaning: data.nameMeaning ?? "",
      dream: data.dream ?? "",
      distinguishingTraits: data.distinguishingTraits ?? "",
      memorableSayings: data.memorableSayings ?? "",
      heightCm: data.heightCm === null || data.heightCm === undefined ? "" : String(data.heightCm),
      weightKg: data.weightKg === null || data.weightKg === undefined ? "" : String(data.weightKg),
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/about-me`, aboutMeResponseSchema, {
        method: "PATCH",
        body: {
          introduction: form.introduction?.trim() || null,
          nameMeaning: form.nameMeaning?.trim() || null,
          dream: form.dream?.trim() || null,
          distinguishingTraits: form.distinguishingTraits?.trim() || null,
          memorableSayings: form.memorableSayings?.trim() || null,
          // Empty means "clear it", which the API models as null. Sending ""
          // would fail the numeric coercion.
          heightCm: form.heightCm?.trim() ? Number(form.heightCm) : null,
          weightKg: form.weightKg?.trim() ? Number(form.weightKg) : null,
        },
      }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: qk.aboutMe(childId) });
    },
  });

  const errors = fieldErrors(save.error);
  const filled = ABOUT_FIELDS.some((f) => data?.[f.key]);

  return (
    <section id="about-me" aria-labelledby="about-me-heading" className="scroll-mt-20">
      <SectionHeader
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

      <Card className="px-4 py-4 sm:px-5">
        {isLoading ? <LoadingState rows={2} /> : null}
        {error ? <p className="text-sm text-danger">{errorMessage(error)}</p> : null}

        {!isLoading && !editing ? (
          filled || data?.heightCm || data?.weightKg ? (
            <div className="flex flex-col gap-4">
              {/* Height and weight are measurements, so they stay compact facts. */}
              {data?.heightCm || data?.weightKg ? (
                <div className="flex flex-wrap gap-2">
                  {data?.heightCm ? (
                    <span className="inline-flex items-center gap-2 rounded-[12px] bg-canvas px-3 py-2 text-sm">
                      <Ruler size={16} aria-hidden="true" className="text-muted" />
                      <span className="text-muted">Өндөр</span>
                      <strong className="font-semibold text-ink">{String(data.heightCm)} см</strong>
                    </span>
                  ) : null}
                  {data?.weightKg ? (
                    <span className="inline-flex items-center gap-2 rounded-[12px] bg-canvas px-3 py-2 text-sm">
                      <Weight size={16} aria-hidden="true" className="text-muted" />
                      <span className="text-muted">Жин</span>
                      <strong className="font-semibold text-ink">{String(data.weightKg)} кг</strong>
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                {ABOUT_FIELDS.filter((f) => data?.[f.key]).map((field) => (
                  <article
                    key={field.key}
                    className={cn(
                      "rounded-[14px] border border-border bg-canvas px-4 py-3.5",
                      field.long && "sm:col-span-2",
                    )}
                  >
                    <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-ink">
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-[8px]",
                          STORY_TONE[field.tone],
                        )}
                      >
                        <field.Icon size={13} aria-hidden="true" />
                      </span>
                      {field.label}
                    </h3>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                      {String(data?.[field.key])}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">
              Хараахан бөглөөгүй байна. «Засах» дарж эхлүүлнэ үү.
            </p>
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

            <div className="grid gap-4 sm:grid-cols-2">
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

// ── Ages 2–5 ────────────────────────────────────────────────────────────────

const AGE_FIELDS = [
  { key: "favoriteColor", label: "Дуртай өнгө", long: false },
  { key: "favoriteFood", label: "Дуртай хоол", long: false },
  { key: "favoriteToy", label: "Дуртай тоглоом", long: false },
  { key: "favoriteBook", label: "Дуртай ном", long: false },
  { key: "favoriteSong", label: "Дуртай дуу", long: false },
  { key: "favoriteActivity", label: "Дуртай үйл ажиллагаа", long: false },
  { key: "personality", label: "Зан чанар", long: true },
  { key: "newSkills", label: "Шинээр эзэмшсэн чадвар", long: true },
] as const;

function AgeSection({
  childId,
  age,
  profile,
  isLoading,
  isGuardian,
}: {
  childId: string;
  age: number;
  profile?: z.infer<typeof ageProfileSchema>;
  isLoading: boolean;
  isGuardian: boolean;
}) {
  const queryClient = useQueryClient();
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
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: qk.ageProfiles(childId) });
    },
  });

  const errors = fieldErrors(save.error);
  const otherNote = profile?.[otherNoteKey as keyof typeof profile] as string | null | undefined;
  const hasContent =
    AGE_FIELDS.some((f) => profile?.[f.key]) ||
    Boolean(profile?.[ownNoteKey as keyof typeof profile]) ||
    Boolean(otherNote);

  return (
    <section id={`age-${age}`} aria-labelledby={`age-${age}-heading`} className="scroll-mt-20">
      <SectionHeader
        title={`${age} нас`}
        action={
          !editing ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={16} />
              Засах
            </Button>
          ) : null
        }
      />

      <Card className={cn("px-4 py-4 sm:px-5", !hasContent && !editing && "border-dashed")}>
        {isLoading ? <LoadingState rows={1} /> : null}

        {!isLoading && !editing ? (
          hasContent ? (
            <div className="flex flex-col gap-3">
              <dl className="grid gap-3 sm:grid-cols-2">
                {AGE_FIELDS.filter((f) => profile?.[f.key]).map((field) => (
                  <div key={field.key} className={field.long ? "sm:col-span-2" : undefined}>
                    <dt className="text-xs font-medium text-muted">{field.label}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm text-ink">
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

              {otherNote ? (
                <NoteBlock label={otherNoteLabel} text={otherNote} tone="other" />
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">Энэ насны мэдээлэл хараахан бөглөөгүй байна.</p>
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

            <div className="grid gap-4 sm:grid-cols-2">
              {AGE_FIELDS.map((field) => (
                <Field
                  key={field.key}
                  label={field.label}
                  error={errors[field.key]}
                  className={field.long ? "sm:col-span-2" : undefined}
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
      </Card>
    </section>
  );
}

function NoteBlock({ label, text, tone }: { label: string; text: string; tone: "own" | "other" }) {
  return (
    <div
      className={cn("rounded-[12px] px-3.5 py-3", tone === "own" ? "bg-primary-soft" : "bg-canvas")}
    >
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{text}</p>
    </div>
  );
}

// ── Birthday notes ──────────────────────────────────────────────────────────

function BirthdaySection({
  childId,
  notes,
  isLoading,
}: {
  childId: string;
  notes: z.infer<typeof birthdayNotesSchema>;
  isLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const [editingAge, setEditingAge] = useState<number | null>(null);
  const [text, setText] = useState("");

  const save = useMutation({
    mutationFn: (age: number) =>
      mutate(`/children/${childId}/birthday-notes/${age}`, birthdayNoteSchema, {
        method: "PATCH",
        body: { note: text.trim() || null },
      }),
    onSuccess: () => {
      setEditingAge(null);
      void queryClient.invalidateQueries({ queryKey: qk.birthdayNotes(childId) });
    },
  });

  return (
    <section id="birthdays" aria-labelledby="birthdays-heading" className="scroll-mt-20">
      <SectionHeader title="Төрсөн өдрийн тэмдэглэл" />

      {isLoading ? (
        <LoadingState rows={1} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {PORTFOLIO_AGES.map((age) => {
            const note = notes.find((n) => n.age === age);
            const isEditing = editingAge === age;

            return (
              <Card key={age} className="flex flex-col gap-2 px-4 py-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium text-ink">{age} нас</h3>
                  {!isEditing ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingAge(age);
                        setText(note?.note ?? "");
                        save.reset();
                      }}
                    >
                      <Pencil size={16} />
                      Засах
                    </Button>
                  ) : null}
                </div>

                {isEditing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!save.isPending) save.mutate(age);
                    }}
                    className="flex flex-col gap-3"
                  >
                    <FormError message={save.isError ? errorMessage(save.error) : null} />
                    <Field label={`${age} насны төрсөн өдрийн тэмдэглэл`}>
                      {({ id, describedBy }) => (
                        <Textarea
                          id={id}
                          aria-describedby={describedBy}
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          autoFocus
                        />
                      )}
                    </Field>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={save.isPending}>
                        {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setEditingAge(null)}>
                        Цуцлах
                      </Button>
                    </div>
                  </form>
                ) : note?.note ? (
                  <p className="whitespace-pre-wrap text-sm text-ink">{note.note}</p>
                ) : (
                  <p className="text-sm text-muted">Тэмдэглэл бичээгүй байна.</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
