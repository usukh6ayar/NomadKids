"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  BookOpen,
  ArrowLeft,
  Cake,
  CalendarDays,
  Check,
  ChevronDown,
  Droplet,
  Eye,
  FileText,
  Heart,
  MapPin,
  MessageCircle,
  Pencil,
  Ruler,
  Sparkles,
  Star,
  Sun,
  Tag,
  Users,
  Weight,
} from "lucide-react";
import {
  aboutMeSchema,
  ageProfileSchema,
  birthdayNoteSchema,
  birthdaySectionSchema,
  childDetailSchema,
  SEX_LABEL,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors, isNotFound } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { AgeSectionShell } from "@/components/child/age-section-shell";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { ChildGallery } from "@/components/media/child-gallery";
import { ChildMilestones } from "@/components/child/child-milestones";
import { ChildConsent } from "@/components/child/child-consent";
import { ReportDialog } from "@/components/reports/report-dialog";
import { ageInYears, formatDate, fullName } from "@/lib/format";
import { GRADIENT_TONE_STYLE, type GradientTone } from "@/lib/gradient-tones";
import { PORTFOLIO } from "@/lib/vocabulary";
import { cn } from "@/lib/utils";

const PORTFOLIO_AGES = [2, 3, 4, 5] as const;

/*
 * ★ A per-age tint is back, 2026-08-28 — deliberately reversing the
 * 2026-08-24 removal below, not reintroducing the bug it removed.
 *
 * The original `AGE_TONE` failed because the *only* place "has content"
 * showed up was a 6px dot at 25% opacity — the meaningful variable was the
 * faintest mark on the page, WCAG-safe only because `aria-label` carried the
 * state a sighted user could not actually see. This version's fill signal is
 * a real icon at full size and full contrast (`Check`, same as the
 * mint-only version that replaced `AGE_TONE`), so removing the colour was
 * never required to fix that — only making the *signal* loud enough was.
 * Colour now does what Gestalt similarity says a set of peers doing the
 * same job can do without lying: distinguish four things that are, in fact,
 * four different ages, the same way `GRADIENT_TONE_STYLE`'s five tones
 * distinguish five different destinations on `/home`'s own tile grid.
 *
 * The tones themselves are the reference build's own (`GRADIENT_TONE_STYLE`'s
 * doc comment has the source) — matching its 2/3/4 нас colours from
 * `growing_up_index.html`, not independently chosen.
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

// `/about-me` answers with `{ exists: false }` when nothing is written yet.
const aboutMeResponseSchema = aboutMeSchema.extend({ exists: z.boolean().nullish() });
const ageProfilesSchema = z.array(ageProfileSchema);

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
  const { session, hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

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
    queryFn: () => get(`/children/${childId}/birthday-notes`, birthdaySectionSchema),
    enabled: child.isSuccess,
  });

  if (child.isLoading) return <LoadingState rows={4} />;

  if (child.isError) {
    return (
      <div className="py-6">
        <ErrorState
          title={isNotFound(child.error) ? "Олдсонгүй" : "Алдаа гарлаа"}
          description={
            isNotFound(child.error) ? `${PORTFOLIO} олдсонгүй.` : errorMessage(child.error)
          }
          action={
            <Button asChild variant="secondary">
              <Link href="/children">Жагсаалт руу буцах</Link>
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

  /*
   * ★ Which years are already lived, so the sections for the rest arrive
   * collapsed. RFP §4.3 keeps all four; only their default state changes.
   */
  const currentAge = ageInYears(data.dateOfBirth);

  return (
    <div className="flex flex-col gap-6 py-2">
      {/*
        The way back. This screen is reached from the child's record and had no
        return path — `ChildHeroProfile` renders identity, not navigation, so
        the link sits above it rather than becoming a slot on that component.
      */}
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/children/${childId}/general`}>
          <ArrowLeft size={18} />
          Хүүхдийн бүртгэл
        </Link>
      </Button>

      {/*
        ★ The PDF lives here now, not on the child hub.

        `type: "CHILD_PORTFOLIO"` exports this record — the RFP §4 document this
        screen *is*. On the hub it sat in a row of five buttons next to
        "Улирлын тайлан", which is a different document, and nothing in the row
        said which one the PDF would contain.
      */}
      <ChildHeroProfile
        child={data}
        /*
          ★ The same hero as the child hub, not a stripped copy of it.

          This rendered `<ChildHeroProfile child={data} />` and nothing else, so
          a teacher moving from the record to the portfolio lost the health-note
          badge and every action, and the screen had no way back to the record it
          belongs to. The block whose stated purpose is "a teacher moving between
          screens never loses track of whose record is open" was changing shape
          between those screens.
        */
        showHealthAlert={isStaff}
        actions={
          <ReportDialog
            childId={childId}
            // The current enrolment's year — what the annual report compares.
            schoolYearId={
              data.enrollments?.find((e) => e.status === "ACTIVE")?.schoolYear?.id ??
              data.enrollments?.[0]?.schoolYear?.id
            }
            trigger={
              <Button variant="secondary" size="sm">
                <FileText size={18} />
                PDF татах
              </Button>
            }
          />
        }
      />

      {/*
        ★ One navigation, not two.

        A row of three jump pills (Миний тухай / Зургийн цомог / Төрсөн өдөр) sat
        above this, so the screen opened with seven links to content that was
        directly below them — a full phone screen of navigation for a page you
        were about to scroll anyway. "Миний тухай" was the first thing under its
        own pill.

        The age row earns its place where the pills did not: the four years are
        the one part of this record that is *collapsed*, so these are the only
        links that reveal something rather than scrolling to it.
      */}
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
                    // Holds the line's height so the four buttons stay the same
                    // size whether or not they are filled.
                    <span aria-hidden="true" className="block h-[14px]" />
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <AboutMeSection
        childId={childId}
        child={data}
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
          currentAge={currentAge}
        />
      ))}

      {/*
        Photographs and work, between the age timeline and the birthday notes.
        A guardian may add to it — the API decides that, through
        `assertCanRecord`; this only decides whether to offer the control.
      */}
      <ChildGallery
        childId={childId}
        childName={fullName(data)}
        canEdit={isStaff || isGuardian}
        photoMediaFileId={data.photoMediaFileId}
      />

      {/*
        RFP §4.5 sits inside §4 — the child's portfolio — so the section lives
        here rather than on the child hub, next to the birthday notes it reads
        like. The hub is a teacher's working screen; this is the family's.
      */}
      <ChildMilestones childId={childId} isStaff={isStaff} />

      {/*
        RFP §16. On the portfolio rather than the child hub: it is the family's
        decision about the family's record, and this is the family's screen.
      */}
      <ChildConsent childId={childId} isGuardian={isGuardian} />

      <BirthdaySection
        childId={childId}
        section={birthdays.data ?? null}
        isLoading={birthdays.isLoading}
        currentAge={currentAge}
      />
    </div>
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
  { key: "nickname", label: "Өвөрддөг нэр", long: false, Icon: Tag, tone: "peach" },
  { key: "birthplace", label: "Төрсөн газар", long: false, Icon: MapPin, tone: "sun" },
  { key: "bloodType", label: "Цусны бүлэг", long: false, Icon: Droplet, tone: "sky" },
  { key: "eyeColor", label: "Нүдний өнгө", long: false, Icon: Eye, tone: "mint" },
] as const;

const STORY_TONE: Record<string, string> = {
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  sun: "bg-sun text-sun-ink",
  peach: "bg-peach text-peach-ink",
};

function AboutMeSection({
  childId,
  child,
  data,
  isLoading,
  error,
}: {
  childId: string;
  /** `PATCH /about-me` also writes `Child`'s own name/DOB/sex — see the
   * form's own doc comment for why those four fields live here now. */
  child: z.infer<typeof childDetailSchema>;
  data?: z.infer<typeof aboutMeResponseSchema>;
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
    },
  });

  const errors = fieldErrors(save.error);
  const filled = ABOUT_FIELDS.some((f) => data?.[f.key]);

  return (
    <section id="about-me" aria-labelledby="about-me-heading" className="scroll-mt-20">
      <SectionHeader
        id="about-me-heading"
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
              fields). Saved through this same form, on the client's
              instruction — see this component's own doc comment and
              `PortfolioService.updateAboutMe`'s for the authorization change
              that makes it possible for a guardian, not only staff.
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

// ── Ages 2–5 ────────────────────────────────────────────────────────────────

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
 * That is the mirror image of the mock-data problem this project keeps
 * refusing: real storage with no interface, rather than an interface with no
 * storage. Both leave the screen disagreeing with the database.
 *
 * ★★ Still short of the RFP by two: дуртай кино/хүүхэлдэйн кино and дуртай
 * хувцас have no column, so adding them is a migration rather than a list edit
 * — deliberately left out of a frontend change. "Тухайн насны зураг" is the
 * gallery, which is already on the page.
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
  /** Decides which years open by default. See `AgeSectionShell`. */
  currentAge: number | null;
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
    <AgeSectionShell
      age={age}
      anchor={`age-${age}`}
      headingId={`age-${age}-heading`}
      filled={hasContent}
      currentAge={currentAge}
      /*
        The edit control moved out of the section heading and into the panel.
        A `<summary>` may not usefully contain a button — clicking it toggles
        the disclosure instead — and "open the year, then edit it" is the right
        order anyway.
      */
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

              {otherNote ? (
                <NoteBlock label={otherNoteLabel} text={otherNote} tone="other" />
              ) : null}
            </div>
          ) : (
            // Says what to do next, not only what is absent — CLAUDE.md §5.
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
    <div
      className={cn(
        "rounded-control px-3.5 py-3",
        tone === "own" ? "bg-primary-soft" : "bg-canvas",
      )}
    >
      <p className="text-caption font-medium text-muted">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-body text-ink">{text}</p>
    </div>
  );
}

// ── Birthday notes ──────────────────────────────────────────────────────────

function BirthdaySection({
  childId,
  section,
  isLoading,
  currentAge,
}: {
  childId: string;
  section: z.infer<typeof birthdaySectionSchema> | null;
  isLoading: boolean;
  /** Birthdays not yet had arrive collapsed, as the age sections do. */
  currentAge: number | null;
}) {
  const queryClient = useQueryClient();
  const [editingAge, setEditingAge] = useState<number | null>(null);
  const [text, setText] = useState("");
  const notes = section?.notes ?? [];

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
      <SectionHeader id="birthdays-heading" title="Төрсөн өдрийн тэмдэглэл" />

      {isLoading ? (
        <LoadingState rows={1} />
      ) : (
        <>
          {section ? <BirthFacts section={section} /> : null}

          <div className="grid gap-3 md:grid-cols-2">
            {PORTFOLIO_AGES.map((age) => {
              const note = notes.find((n) => n.age === age);
              const isEditing = editingAge === age;

              /*
               * ★ A birthday that has not happened arrives closed.
               *
               * The four cards rendered open regardless, so a two-year-old's
               * portfolio ended with three "Тэмдэглэл бичээгүй байна." boxes for
               * birthdays up to three years away, each offering to write the note
               * early. An existing note opens the card whatever the age — see
               * `AgeSectionShell` for why content outranks the date.
               */
              const reached = currentAge === null || age <= currentAge;

              return (
                <Card key={age} pad="roomy">
                  <details
                    open={Boolean(note?.note) || reached}
                    className="flex flex-col gap-2 [&[open]_svg.chevron]:rotate-180"
                  >
                    <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                      <h3 className="font-medium text-ink">{age} нас</h3>
                      {!reached && !note?.note ? <Badge tone="neutral">Ирээдүйд</Badge> : null}
                      <ChevronDown
                        size={18}
                        aria-hidden="true"
                        className="chevron ml-auto shrink-0 text-faint transition-transform"
                      />
                    </summary>

                    <div className="mt-2 flex flex-col gap-2">
                      {!isEditing ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="self-start"
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
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setEditingAge(null)}
                            >
                              Цуцлах
                            </Button>
                          </div>
                        </form>
                      ) : note?.note ? (
                        <p className="whitespace-pre-wrap text-body text-ink">{note.note}</p>
                      ) : (
                        // Says what to do next, not only what is absent.
                        // Not `EmptyState`: it renders a `Card`, and this sits
                        // inside one already. A card nested in a card reads as a
                        // rendering mistake rather than as an empty state.
                        <p className="text-body text-muted">
                          Тэмдэглэл бичээгүй. «Засах» дарж нэмнэ үү.
                        </p>
                      )}
                    </div>
                  </details>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The four facts RFP §4.2 asks for above the notes: the birth date, the age,
 * the өрнийн орд and the монгол жилийн амьтан.
 *
 * ★ The lunar-new-year caveat is rendered, not hidden.
 *
 * The animal year turns at Цагаан сар, which falls between late January and
 * early March and moves every year. For a child born inside that window the API
 * sets `beforeLunarNewYear`, and this note is the honest version of that: a
 * printed portfolio asserting the wrong animal is worse than one that says
 * which two it lies between. Five births in six are outside the window and get
 * no note at all.
 */
function BirthFacts({ section }: { section: z.infer<typeof birthdaySectionSchema> }) {
  const facts = [
    { icon: Cake, label: "Төрсөн огноо", value: formatDate(section.dateOfBirth) },
    { icon: Sun, label: "Нас", value: `${section.ageYears} нас` },
    { icon: Sparkles, label: "Өрнийн орд", value: section.zodiac.name },
    { icon: Star, label: "Монгол жил", value: `${section.yearAnimal.name} жил` },
  ];

  return (
    <Card pad="roomy" className="mb-3">
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {facts.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex flex-col gap-1">
            <dt className="flex items-center gap-1.5 text-caption text-muted">
              <Icon size={14} aria-hidden="true" className="shrink-0" />
              {label}
            </dt>
            <dd className="text-body font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {section.yearAnimal.beforeLunarNewYear ? (
        <p className="mt-3 text-caption text-muted">
          Цагаан сараас өмнө төрсөн тул монгол жил нь өмнөх жилийнх байж болно. Нягтлан
          баталгаажуулна уу.
        </p>
      ) : null}
    </Card>
  );
}
