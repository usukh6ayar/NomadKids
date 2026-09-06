"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { z } from "zod";
import {
  assessmentConfigSchema,
  groupColumnSchema,
  groupSchema,
  schoolYearSchema,
  termSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { useSwitchableGroups } from "@/components/shell/group-switcher";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";
import { Eye, Images, MessageCircle } from "lucide-react";
import { GRADIENT_TONE_STYLE, type GradientTone } from "@/lib/gradient-tones";
import { observationTypeSchema } from "@kinder/contracts";

/** The kindergarten's configured record kinds — one shortcut button each. */
const observationTypesSchema = z.array(observationTypeSchema);
import { Card, SectionHeader } from "@/components/ui/card";
import { GroupCoverage } from "@/components/assessment/group-coverage";
import { RegisterProgress } from "@/components/register/register-progress";
import { RegisterSaveBar } from "@/components/register/save-bar";
import { TONE_SURFACE, type Tone } from "@/components/ui/tone";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { formatDate, fullName } from "@/lib/format";
import { cn } from "@/lib/utils";

const termsSchema = z.array(termSchema);
const yearsSchema = z.array(schoolYearSchema);
const savedSchema = z.object({ saved: z.number() });

/**
 * ★ Assess one group, one term, ONE development domain.
 *
 * This is the screen the scope rules protect. The obvious design — children
 * down the side, all nine domains across the top — was explicitly cancelled:
 * a 9-column matrix is unusable on a phone, and it asks a teacher to hold nine
 * different rubrics in mind at once while scanning a roster.
 *
 * One domain at a time matches how the work is actually done: pick "Хэл яриа",
 * go down the list, done. `domainId` is a **required** query parameter on the
 * API for the same reason — it is what stops this endpoint quietly becoming
 * the matrix.
 *
 * The whole column saves in one request, so a teacher taps through twenty
 * children and saves once rather than firing twenty writes.
 */
export default function GroupAssessmentPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <Suspense fallback={<LoadingState rows={4} />}>
        <GroupAssessment />
      </Suspense>
    </RequireRole>
  );
}

function GroupAssessment() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { primaryKindergartenId } = useSession();

  // The selection lives in the URL, so a teacher can bookmark "this term, this
  // domain" and a reload does not throw them back to the first option.
  const termId = searchParams.get("termId") ?? "";
  const domainId = searchParams.get("domainId") ?? "";

  function setSelection(next: { termId?: string; domainId?: string }) {
    const updated = new URLSearchParams(searchParams.toString());
    if (next.termId !== undefined) updated.set("termId", next.termId);
    if (next.domainId !== undefined) updated.set("domainId", next.domainId);
    router.replace(`?${updated.toString()}`, { scroll: false });
  }

  /*
   * ★ The same key the other two registers use, so switching from Ирц to
   * Үнэлгээ for the same group does not refetch the list of groups.
   */
  const switchable = useSwitchableGroups();

  const group = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => get(`/groups/${groupId}`, groupSchema),
  });

  const kindergartenId = group.data?.kindergartenId ?? primaryKindergartenId ?? "";

  const config = useQuery({
    queryKey: qk.assessmentConfig(kindergartenId),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/assessment-config`, assessmentConfigSchema),
    enabled: Boolean(kindergartenId),
  });

  const terms = useQuery({
    queryKey: qk.terms(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/terms`, termsSchema),
    enabled: Boolean(kindergartenId),
  });

  /*
   * ★ The school years, by name and by date — 2026-09-06.
   *
   * The term picker was one flat list reading "Өмнөх жил · Улирал 1", and the
   * client's report was exactly that: "явцын үнэлгээ-д өмнөх жил гэх мэт зүйлс
   * байна (огноотой болгох)". A year called "Өмнөх жил" tells a teacher
   * nothing in September and something wrong in January, and a kindergarten
   * that has run for four years has four such names in one dropdown.
   *
   * `term.schoolYear` is a `namedRefSchema` — an id and a name, no dates — so
   * the dates come from the years endpoint and are joined on the id here.
   */
  const years = useQuery({
    queryKey: qk.schoolYears(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/school-years`, yearsSchema),
    enabled: Boolean(kindergartenId),
    staleTime: 5 * 60_000,
  });

  const yearById = new Map((years.data ?? []).map((year) => [year.id, year]));

  /*
   * Which year's terms the term picker offers. Derived from the chosen term
   * rather than held separately: one piece of state cannot drift from the
   * other, and a URL carrying only `termId` still opens on the right year.
   */
  const selectedTerm = (terms.data ?? []).find((term) => term.id === termId);
  const yearId = selectedTerm?.schoolYear?.id ?? "";
  const termsInYear = (terms.data ?? []).filter(
    (term) => !yearId || term.schoolYear?.id === yearId,
  );

  // Default to the first term and domain once they are known, rather than
  // rendering an empty grid with two unset selects.
  useEffect(() => {
    if (!termId && terms.data?.length) setSelection({ termId: terms.data[0]!.id });
    // Intentionally keyed on the loaded data only: including `setSelection`
    // or `termId` would re-run this on every URL change and fight the user's
    // own choice.
  }, [terms.data]);

  useEffect(() => {
    if (!domainId && config.data?.domains.length) {
      setSelection({ domainId: config.data.domains[0]!.id });
    }
    // Same reasoning as the term default above.
  }, [config.data]);

  const column = useQuery({
    queryKey: qk.groupAssessment(groupId, termId, domainId),
    queryFn: () =>
      get(
        `/groups/${groupId}/assessments?termId=${termId}&domainId=${domainId}`,
        groupColumnSchema,
      ),
    enabled: Boolean(termId && domainId),
  });

  /** Pending level choices, keyed by child. Empty until something is tapped. */
  const [draft, setDraft] = useState<Record<string, string>>({});

  // Cleared whenever the column changes: a pending choice for "Хэл яриа" must
  // not be carried into "Танин мэдэхүй" and saved against the wrong domain.
  useEffect(() => {
    setDraft({});
  }, [termId, domainId, groupId]);

  /**
   * ★ The result is announced, not left to be inferred.
   *
   * This screen saved silently apart from a green line rendered *below the
   * roster* — and the control that triggers it is a sticky bar pinned to the
   * bottom of the viewport, so a teacher who pressed Хадгалах after scrolling
   * through thirty children had the confirmation somewhere off-screen. The
   * report was simply "багш хадгалж байгаа эсэхээ мэдэхгүй байна", which is
   * exactly what that arrangement produces.
   *
   * CLAUDE.md §5 asks for a toast after a save, `ToastProvider` has been in the
   * shell the whole time, and eight other screens already use it. This one did
   * not.
   *
   * ★★ Both outcomes, and the failure keeps its inline message too.
   *
   * `toast.ts` argues that an error is read rather than glanced at and that a
   * screen whose error is actionable should keep rendering it — so the
   * `FormError` above the roster stays, and the toast is what draws the eye to
   * it from the foot of a long list. A success needs no second copy.
   */
  const toast = useToast();

  const save = useMutation({
    mutationFn: () => {
      const entries = Object.entries(draft).map(([childId, levelId]) => ({ childId, levelId }));
      return mutate(`/groups/${groupId}/assessments`, savedSchema, {
        method: "PUT",
        body: { termId, domainId, entries },
      });
    },
    onSuccess: (_data, _vars) => {
      const saved = Object.keys(draft).length;
      setDraft({});
      toast.success(
        saved > 0 ? `${saved} хүүхдийн үнэлгээ хадгалагдлаа.` : "Үнэлгээ хадгалагдлаа.",
      );
      void queryClient.invalidateQueries({
        queryKey: qk.groupAssessment(groupId, termId, domainId),
      });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.teacher() });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (group.isLoading) return <LoadingState rows={4} />;

  if (group.isError) {
    return (
      <div className="py-6">
        <ErrorState description={errorMessage(group.error)} />
      </div>
    );
  }

  const pendingCount = Object.keys(draft).length;

  /*
   * ★ How far through the column, and what the group's spread looks like.
   *
   * The strip counts through the draft the same way the meal register does —
   * this screen batches behind a sticky save bar, so a summary reading only
   * saved rows would sit still while a teacher taps down the list and jump at
   * the moment they save, which is the one moment it tells them nothing new.
   *
   * ★★ The levels are configuration (`AssessmentLevel` is a table, CLAUDE.md
   * §2.3), so their colours cannot be hard-coded per name. What *is* fixed is
   * that they are ordered, worst to best — so the tone is taken from the level's
   * position in that order along a fixed ramp. Three levels or six, the lowest
   * is the attention tone and the highest is the complete one.
   */
  const children = column.data?.children ?? [];
  const levels = column.data?.levels ?? [];
  const levelFor = (child: (typeof children)[number]) =>
    draft[child.childId] ?? child.assessment?.levelId ?? null;

  const assessed = children.filter((child) => levelFor(child) !== null).length;
  const breakdown = levels.map((level, index) => ({
    key: level.id,
    label: level.label,
    count: children.filter((child) => levelFor(child) === level.id).length,
    tone: levelTone(index, levels.length),
  }));

  return (
    /*
      ★ `gap-4` — 2026-09-06. It was `gap-5 lg:gap-6`.

      The client's report on this screen was that it wastes vertical space
      ("хэт их хэрэггүй зай эзэлж байна"), and the gap was the cheapest half of
      it: six stacked blocks at 24px apart is 144px of nothing on a screen a
      teacher scrolls through twenty children on. The other half was the three
      separate narrowing controls, now one card.
    */
    <div className="flex flex-col gap-4">
      {/*
        ★ `PageHeader`, not a hand-rolled `<header>` — 2026-08-29.

        This screen opened with its own `<h1 className="text-heading">` over a
        `<p>`. Every other screen in the product uses `PageHeader`, which is
        `text-heading` on a phone and `text-display` from `md` up: so this one
        title stayed 22px on a desktop while the rest grew to 24px, and it was
        the only page heading that did not. The same mistake `dashboard/page.tsx`
        records fixing in its own three branches.
      */}
      <PageHeader title="Явцын үнэлгээ" lede={group.data?.name ?? "Бүлгийн үнэлгээ"} />

      {/*
        ★ The client's 2026-08-31 top strip: pick a child, then start a record.

        Their note asked for the desktop pattern on the phone too — a child
        selector and the three "Шинэ тэмдэглэл" actions above the dashboard,
        replacing the two large selection cards a phone reader used to meet
        first. Those selects have not been deleted: they are what the register
        below is keyed on, and dropping them would remove the screen's whole
        function. They have moved *under* the summary instead, so the first
        thing on the screen is what the group looks like rather than two
        dropdowns to configure before anything appears.
      */}
      <NewRecordStrip children={children} />

      <GroupCoverage groupId={groupId} />

      {/* `pad="roomy"` rather than four inline padding values — `card.tsx`
          documents the two named steps and why call sites stopped inventing
          their own. */}
      {/*
        ★ Four dropdowns in one card — 2026-09-06, at the client's request:
        "хичээлийн жил бүлэг сонгох нь choose хийдэг байх хэрэгтэй".

        The group used to be `GroupSwitcher`'s row of chips above this card,
        and the school year was not a control at all — it was a prefix on the
        term's own name. So the screen had three ways of narrowing, drawn three
        different ways, in three places, and the one a director changes most
        (the group) was the one that looked least like a control.

        ★★ Changing the group still navigates. That was `GroupSwitcher`'s
        strongest argument and it survives the change of drawing: the group is
        in the URL (`/groups/:id/assessment`), which is what makes a register
        linkable and what lets the back button walk the groups somebody looked
        at. A select that swapped the data underneath one address would break
        both — so this select pushes a route, and the chips are gone rather
        than the addressing.
      */}
      <Card pad="roomy" className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Бүлэг">
            {({ id }) => (
              <Select
                id={id}
                value={groupId}
                onChange={(e) => router.push(`/groups/${e.target.value}/assessment`)}
                disabled={switchable.isLoading}
              >
                {(switchable.data?.items ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {/*
            ★ Choosing a year jumps to that year's first term.

            The year is not stored separately — it is read off the chosen term
            (see `yearId` above) — so "select a year" has to mean "select a
            term within it", and the first is the only defensible one to land
            on. Without this the picker would be a control that changes
            nothing until a second one is touched.
          */}
          <Field label="Хичээлийн жил">
            {({ id }) => (
              <Select
                id={id}
                value={yearId}
                onChange={(e) => {
                  const first = (terms.data ?? []).find(
                    (term) => term.schoolYear?.id === e.target.value,
                  );
                  if (first) setSelection({ termId: first.id });
                }}
                disabled={terms.isLoading}
              >
                {[...new Map(
                  (terms.data ?? [])
                    .filter((term) => term.schoolYear)
                    .map((term) => [term.schoolYear!.id, term.schoolYear!]),
                ).values()].map((year) => (
                  <option key={year.id} value={year.id}>
                    {yearLabel(year.name, yearById.get(year.id))}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Улирал">
            {({ id }) => (
              <Select
                id={id}
                value={termId}
                onChange={(e) => setSelection({ termId: e.target.value })}
                disabled={terms.isLoading}
              >
                {termsInYear.map((term) => (
                  <option key={term.id} value={term.id}>
                    {termLabel(term)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Хөгжлийн чиглэл" hint="Нэг удаад нэг чиглэлээр үнэлнэ.">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={domainId}
                onChange={(e) => setSelection({ domainId: e.target.value })}
                disabled={config.isLoading}
              >
                {(config.data?.domains ?? []).map((domain) => (
                  <option key={domain.id} value={domain.id}>
                    {domain.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {column.data && children.length > 0 ? (
          <RegisterProgress
            inset
            recorded={assessed}
            total={children.length}
            verb="үнэлсэн"
            breakdown={breakdown}
          />
        ) : null}
      </Card>

      {terms.data?.length === 0 ? (
        <EmptyState
          title="Улирал тохируулаагүй байна"
          description="Цэцэрлэгийн удирдлага улирал үүсгэсний дараа үнэлгээ хийх боломжтой."
        />
      ) : null}

      {column.isLoading ? <LoadingState rows={6} shape="register" /> : null}

      {column.isError ? (
        <ErrorState
          description={errorMessage(column.error)}
          action={
            <Button variant="secondary" onClick={() => void column.refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      ) : null}

      {column.data ? (
        <>
          {/* The headcount moved into the strip above — see the meal
              register's note on not printing one figure twice. */}
          <SectionHeader title={column.data.domain.name} />

          {column.data.children.length === 0 ? (
            <EmptyState
              title="Бүлэгт хүүхэд алга"
              description="Энэ хичээлийн жилд идэвхтэй бүртгэлтэй хүүхэд байхгүй байна."
            />
          ) : (
            <Card className="divide-y divide-border">
              {column.data.children.map((child) => (
                <ChildRow
                  key={child.childId}
                  child={child}
                  levels={column.data!.levels}
                  selectedLevelId={draft[child.childId] ?? child.assessment?.levelId ?? null}
                  isDirty={Boolean(draft[child.childId])}
                  onSelect={(levelId) =>
                    setDraft((current) => ({ ...current, [child.childId]: levelId }))
                  }
                />
              ))}
            </Card>
          )}

          <FormError message={save.isError ? errorMessage(save.error) : null} />

          {/*
            A sticky save bar. On a phone the roster is longer than the
            viewport, so a button at the bottom of the page is a scroll away
            from wherever the teacher just tapped.
          */}
          {pendingCount > 0 ? (
            <RegisterSaveBar
              message={`${pendingCount} хүүхдийн үнэлгээ хадгалагдаагүй байна`}
              saving={save.isPending}
              onSave={() => save.mutate()}
              onCancel={() => setDraft({})}
            />
          ) : null}

          {/*
            ★ The static green line that used to sit here is gone.

            It rendered on `save.isSuccess` and never cleared, so a teacher who
            saved once saw "Үнэлгээ хадгалагдлаа." under the roster for the rest
            of the session — including while making a second set of changes it
            was not describing. A toast says it once, at the moment it is true.
          */}
        </>
      ) : null}
    </div>
  );
}

/**
 * One child's row.
 *
 * The levels are buttons, not a dropdown: choosing is the whole task, and a
 * select costs two taps and hides the options. Four or five levels fit across a
 * phone at 44px each, and wrap when they do not.
 */
function ChildRow({
  child,
  levels,
  selectedLevelId,
  isDirty,
  onSelect,
}: {
  child: {
    childId: string;
    lastName: string;
    firstName: string;
    photoMediaFileId?: string | null;
  };
  levels: { id: string; label: string; value: number; color?: string | null }[];
  selectedLevelId: string | null;
  isDirty: boolean;
  onSelect: (levelId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ChildAvatar child={child} size={40} />
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink">{fullName(child)}</span>
          {isDirty ? <span className="text-caption text-primary">Хадгалаагүй</span> : null}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label={`${fullName(child)} — үнэлгээний түвшин`}
        className="flex flex-wrap gap-2"
      >
        {levels.map((level, index) => {
          const selected = level.id === selectedLevelId;
          return (
            <button
              key={level.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(level.id)}
              className={cn(
                /*
                  ★ REDESIGN 2026-09-03 — the chosen level takes its position's
                  tint instead of one flat brand blue.

                  This is the densest screen in the product and the one that
                  must read fastest. Every selected pill was `bg-primary`, so a
                  sheet of thirty-five assessed children was thirty-five
                  identical blue rectangles: "how is this group doing" could
                  only be answered by reading every label, one row at a time.
                  With the ramp, a column of mint and a column of peach are
                  distinguishable without reading anything — which is the whole
                  job of the screen.

                  `levelTone(index, levels.length)` is the *same* function the
                  breakdown chips above the roster already use, so a level is
                  the same colour in the summary and in the row it came from.
                  It walks the ramp by proportion, so this holds for three
                  levels or six, whatever a kindergarten has named them —
                  nothing here hard-codes a count, a name or a colour (§2.3,
                  constraint 20).

                  State is still not carried by colour alone: `aria-checked` is
                  on the control and the selected pill also gains weight and
                  elevation.
                */
                "min-h-[44px] rounded-control border px-3 text-body font-medium transition-all duration-150 active:translate-y-[1px]",
                selected
                  ? cn(
                      TONE_SURFACE[levelTone(index, levels.length)],
                      "border-transparent font-semibold shadow-sm",
                    )
                  : "border-border bg-surface text-muted hover:border-faint hover:bg-canvas hover:text-ink",
              )}
            >
              {level.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A level's tone, from its position in the ordered scale.
 *
 * ★ Position, not name. `AssessmentLevel` is a table an administrator edits
 * (CLAUDE.md §2.3) — a kindergarten may call its levels "Эхлэн", "Хөгжиж буй",
 * "Эзэмшсэн" or anything else, and may have three of them or six. What never
 * changes is that they are ordered worst to best, so the ramp is walked in
 * proportion: the lowest level always reads as attention and the highest always
 * as complete, whatever they are called and however many there are.
 */
const LEVEL_RAMP: Tone[] = ["peach", "sun", "sky", "mint"];

function levelTone(index: number, count: number): Tone {
  if (count <= 1) return "mint";
  const slot = Math.round((index / (count - 1)) * (LEVEL_RAMP.length - 1));
  return LEVEL_RAMP[slot] ?? "sky";
}

/**
 * Pick a child, then start a record about them.
 *
 * ★ Three doors, drawn the way the family's own screen draws them —
 * 2026-09-06, at the client's request.
 *
 * They found the shape they wanted already in the product and said so by
 * naming the path to it: эцэг эх → home → Цахим хуудас → Хөгжил, which is
 * `parent-growth-launcher.tsx` — Ажиглалт, Ярилцлага and Бүтээл as three
 * large, tinted, unmistakable doors. This screen offered the same idea as a
 * row of small grey secondary buttons carrying five invented names
 * ("Үйл ажиллагааны ажиглалт", "Анхаарал шаардсан"), which is the "ойлгомжгүй"
 * in their report. The names are fixed in the catalogue
 * (`prisma/system-config.ts`); the drawing is fixed here.
 *
 * ★★ Still one door per *configured* type, not three literals.
 *
 * That was the previous note's argument and it is still right: types are a
 * table so an administrator can rename or add one (§2.3), and hard-coding the
 * three would make `/admin/assessment-config` a screen that edits nothing. What
 * changed is the catalogue's contents, not this component's contract.
 *
 * ★★★ `parent` is filtered out. A note from a family arrives through the
 * family's own screen, which files it under that code
 * (`ObservationsService.parentObservationType`). A teacher choosing the label
 * "Гэр бүлээс ирсэн" for something they wrote themselves would make the one
 * field that says where a note came from unreliable.
 *
 * ★★★★ The types are fetched against the group's first child, and any child
 * would do: `GET /children/:id/observations/types` is scoped to the child's
 * kindergarten, and every child in this group shares one. It is child-addressed
 * because that is the endpoint's authorization path, not because the answer
 * varies per child.
 *
 * ★★★★★ Defaults to nobody rather than to the first child. "Шинэ тэмдэглэл"
 * against a name the teacher did not choose is how a note lands on the wrong
 * child, and this control's only job is to make that choice explicit.
 */

/**
 * A school year, with the dates that say which one it is.
 *
 * ★ The reason this exists: a kindergarten's years are named by hand, and the
 * names go stale. "Өмнөх жил" is the client's own example — accurate for a
 * year, then wrong forever, and unusable the moment there are two of them.
 * The dates are the fact; the name is a label somebody typed.
 *
 * Falls back to the bare name when the year carries no dates, rather than
 * printing an empty bracket.
 */
function yearLabel(name: string, year?: { startsOn?: string | null; endsOn?: string | null }) {
  const range = dateRange(year?.startsOn, year?.endsOn);
  return range ? `${name} · ${range}` : name;
}

/** A term, with its own dates for the same reason. */
function termLabel(term: { name: string; startsOn?: string | null; endsOn?: string | null }) {
  const range = dateRange(term.startsOn, term.endsOn);
  return range ? `${term.name} · ${range}` : term.name;
}

/**
 * `2025.09.01 — 2025.12.31`, or one end of it, or nothing.
 *
 * `formatDate` is the product's own formatter; an open-ended range prints the
 * end it knows rather than a dash against a blank, which reads as a rendering
 * fault.
 */
function dateRange(startsOn?: string | null, endsOn?: string | null): string | null {
  if (startsOn && endsOn) return `${formatDate(startsOn)} — ${formatDate(endsOn)}`;
  if (startsOn) return `${formatDate(startsOn)}-ээс`;
  if (endsOn) return `${formatDate(endsOn)} хүртэл`;
  return null;
}

/**
 * The three kinds, drawn exactly as the family's own screen draws them.
 *
 * ★ Same gradients, same icons, same order — `parent-growth-launcher.tsx`'s
 * `BUCKETS`, keyed here by the catalogue's `code` instead of by a literal.
 *
 * The client asked for parity by naming the path to the screen they meant
 * (эцэг эх → home → Цахим хуудас → Хөгжил), and parity means the *same
 * picture*: a saturated bar, a white circle with a glyph in it, "+ Ажиглалт".
 * A quieter version in the product's own tints would have been the same idea
 * drawn differently, which is what "яг л тийм болгох" rules out.
 *
 * `GRADIENT_TONE_STYLE` is shared with that file, so the two cannot drift.
 */
const KIND_STYLE: Record<string, { tone: GradientTone; Icon: typeof Eye }> = {
  daily: { tone: "green", Icon: Eye },
  conversation: { tone: "blue", Icon: MessageCircle },
  artwork: { tone: "orange", Icon: Images },
};

/** A kind an administrator invented. It gets a door, in the fifth gradient. */
const KIND_FALLBACK = { tone: "purple" as GradientTone, Icon: Eye };

function NewRecordStrip({
  children,
}: {
  children: { childId: string; lastName?: string | null; firstName: string }[];
}) {
  const [childId, setChildId] = useState("");

  const anyChildId = children[0]?.childId;
  const types = useQuery({
    queryKey: qk.observationTypes(anyChildId ?? ""),
    queryFn: () => get(`/children/${anyChildId}/observations/types`, observationTypesSchema),
    enabled: Boolean(anyChildId),
    staleTime: 5 * 60_000,
  });

  const selected = children.find((child) => child.childId === childId);
  const doors = (types.data ?? []).filter((type) => type.code !== "parent");

  if (children.length === 0) return null;

  return (
    <Card pad="roomy" className="flex flex-col gap-4">
      <div>
        <h2 className="text-lead font-semibold text-ink">Шинэ тэмдэглэл</h2>
        <p className="mt-0.5 text-body text-muted">
          Хүүхдээ сонгоод, ямар төрлийн тэмдэглэл хөтлөхөө сонгоно уу.
        </p>
      </div>

      <Field label="Хүүхэд">
        {({ id }) => (
          <Select id={id} value={childId} onChange={(e) => setChildId(e.target.value)}>
            <option value="">Хүүхэд сонгох…</option>
            {children.map((child) => (
              <option key={child.childId} value={child.childId}>
                {child.lastName ? `${child.lastName} ` : ""}
                {child.firstName}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {/*
        ★ Rendered as a door whether or not a child is chosen, and inert until
        one is.

        Hiding them until the select is touched would change the screen's shape
        underneath somebody; three dimmed doors with one line underneath saying
        what to do first is the version that explains itself. `aria-disabled`
        and no `href`, rather than a `<Link>` to nowhere.
      */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        {doors.map((type) => {
          const style = KIND_STYLE[type.code ?? ""] ?? KIND_FALLBACK;
          const gradient = GRADIENT_TONE_STYLE[style.tone];

          const content = (
            <>
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-white/25"
              >
                <style.Icon size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 truncate text-body font-semibold">
                + {type.name}
              </span>
            </>
          );

          const className = cn(
            "flex min-h-13 items-center gap-3 rounded-card px-3.5 py-3 text-left text-white",
            gradient.gradient,
            gradient.shadow,
          );

          return selected ? (
            <Link
              key={type.id}
              href={`/children/${selected.childId}/observations/new?typeId=${type.id}`}
              className={cn(className, "transition-transform hover:scale-[1.01]")}
            >
              {content}
            </Link>
          ) : (
            /*
              Dimmed rather than greyed: the colour is how the three are told
              apart, and washing it out would leave three identical grey bars
              that say nothing about which is which while you read the line
              telling you to pick a child.
            */
            <div key={type.id} aria-disabled="true" className={cn(className, "opacity-45")}>
              {content}
            </div>
          );
        })}
      </div>

      {!selected ? (
        <p className="text-caption text-muted">
          Шинэ тэмдэглэл хөтлөхийн тулд эхлээд хүүхдээ сонгоно уу.
        </p>
      ) : null}
    </Card>
  );
}
