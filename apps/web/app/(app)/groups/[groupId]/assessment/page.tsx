"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { z } from "zod";
import {
  assessmentConfigSchema,
  assessmentRadarSchema,
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
import { RowMenu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";
import { Eye, Images, MessageCircle, Printer, Users } from "lucide-react";
import {
  MAX_PAGE_SIZE,
  childSummarySchema,
  observationTypeSchema,
  paginated,
} from "@kinder/contracts";

/** The kindergarten's configured record kinds — one shortcut button each. */
const observationTypesSchema = z.array(observationTypeSchema);
/** The group's roster — one request, independent of term and domain. */
const childrenPageSchema = paginated(childSummarySchema);
import { Card, SectionHeader } from "@/components/ui/card";
import { GroupCoverage } from "@/components/assessment/group-coverage";
import { RegisterProgress } from "@/components/register/register-progress";
import { RegisterSaveBar } from "@/components/register/save-bar";
import { TONE_SURFACE, type Tone } from "@/components/ui/tone";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState, Skeleton } from "@/components/ui/states";
import { FormDialog } from "@/components/ui/form-dialog";
import { SearchField } from "@/components/ui/search-field";
import { DevelopmentRadar } from "@/components/assessment/development-radar";
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
  /**
   * Which of the two readings is open.
   *
   * ★ Component state, not the URL, unlike `termId` and `domainId`.
   *
   * Those two are what makes a register linkable — "this term, this domain" is
   * worth bookmarking and worth surviving a reload. Which tab you were looking
   * at is not: it is a glance, and putting it in the address bar would add a
   * history entry every time somebody looked at the summary.
   */
  // The page is now one documentation overview. The old Үнэлэх tab is kept
  // out of the interface; `tab` remains fixed only while the legacy register
  // code below is retired without changing its data contract.
  const [tab] = useState<"overview" | "assess">("overview");
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
  const groupSchoolYear = yearById.get(group.data?.schoolYearId ?? "");

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
    enabled: Boolean(termId && domainId && tab === "assess"),
  });

  /** Pending level choices, keyed by child. Empty until something is tapped. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  /*
   * ★ Declared here, beside `draft`, and not beside the code that uses them
   * three hundred lines down — this component early-returns for the loading
   * and error states (`if (group.isLoading) return …`), so a `useState` below
   * one of those changes the hook order between renders. React says so out
   * loud, and `flows.test.tsx` catches it, which is how this was found.
   */
  const [childQuery, setChildQuery] = useState("");
  const [progressChildId, setProgressChildId] = useState<string | null>(null);

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

  /*
   * ★ The child search and the progress drawer — 2026-09-09, matching the
   * reference's teacher screen ("Хүүхэд хайх, эсвэл сонгох..." and its
   * "ХҮҮХДИЙН АХИЦ" dialog).
   *
   * Both are client-side over `children`, which is already the whole group in
   * one payload — a round trip per keystroke would be slower and would drop
   * the teacher's unsaved level chips, which live in `draft` and are keyed by
   * child id.
   */
  const normalizedChildQuery = childQuery.trim().toLocaleLowerCase("mn");
  const visibleChildren = normalizedChildQuery
    ? children.filter((child) =>
        fullName(child).toLocaleLowerCase("mn").includes(normalizedChildQuery),
      )
    : children;

  const progressChild = children.find((child) => child.childId === progressChildId) ?? null;

  /*
   * ★ Counted over the whole group, never over the filtered view.
   *
   * "12 of 20 assessed" is a fact about the group; recomputing it as the
   * teacher types would make the summary agree with the search box instead of
   * with the register, and a headcount that moves while you look for one child
   * is the kind of number nobody trusts again.
   */
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
      {/*
        ★ The overflow menu carries what the screen does *to* the whole group —
        2026-09-10, the ⋮ on the client's design.

        Both entries were reachable before and both are one press from here
        now: the term report is the document this register feeds, and the
        printable sheet is what a director asks for. Neither belongs among the
        controls that change what is on screen, which is what a header menu is
        for.
      */}
      <PageHeader
        title="Явцын үнэлгээ"
        actions={
          <RowMenu
            ariaLabel="Явцын үнэлгээний үйлдэл"
            items={[
              {
                label: "Хэвлэх",
                icon: <Printer size={16} />,
                onSelect: () => window.print(),
              },
              {
                label: "Бүлгийн мэдээлэл",
                icon: <Users size={16} />,
                onSelect: () => router.push(`/groups/${groupId}`),
              },
            ]}
          />
        }
      />

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
      {/*
        ★ Hidden on Тойм — 2026-09-10, at the client's request ("энэ байх
        шаардлагагүй").

        Бүлэг, Хичээлийн жил, Улирал and Хөгжлийн чиглэл are what the *column*
        is keyed on: they decide which children and which criterion the
        register below lists. Тойм answers a different question — how is the
        group doing this month — and reports across every criterion, so all
        four of these narrowed nothing a reader could see while taking most of
        the first screen on a phone.

        Hidden rather than unmounted: the selection is what the Үнэлэх tab
        needs the moment it opens, and re-mounting these would drop it.
      */}
      <Card pad="roomy" className={cn("flex-col gap-4", tab === "assess" ? "flex" : "hidden")}>
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
                {[
                  ...new Map(
                    (terms.data ?? [])
                      .filter((term) => term.schoolYear)
                      .map((term) => [term.schoolYear!.id, term.schoolYear!]),
                  ).values(),
                ].map((year) => (
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

          {/*
            ★ Hidden on Тойм, because Тойм is every domain at once.

            A select that narrows nothing on the view in front of you is a
            control that invites a press and changes the screen you are not
            looking at — and worse, it would then be set to something
            unexpected when Үнэлэх opens.
          */}
          <Field
            label="Хөгжлийн чиглэл"
            hint="Нэг удаад нэг чиглэлээр үнэлнэ."
            className={tab === "overview" ? "hidden" : undefined}
          >
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

        {tab === "assess" && column.data && children.length > 0 ? (
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

      {/*
        ★ Тойм opens first — the client's 2026-09-10 design.

        The question a teacher brings to this screen is "what is left", and
        until now the only answer was to pick a domain and count the blanks
        down a column — once per domain. Тойм answers it across every domain at
        once, and Үнэлэх is where the work is then done.

        ★★ Tabs rather than two routes: they are one dataset read two ways, the
        selection above (group, year, term) belongs to both, and duplicating it
        on a second page is how the two come to disagree about which term is
        open.
      */}
      {tab === "overview" ? (
        <GroupCoverage
          groupId={groupId}
          termId={termId}
          startsOn={groupSchoolYear?.startsOn}
          endsOn={groupSchoolYear?.endsOn}
          recordComposer={<NewRecordStrip groupId={groupId} embedded />}
        />
      ) : null}

      {tab === "assess" && column.isLoading ? <LoadingState rows={6} shape="register" /> : null}

      {tab === "assess" && column.isError ? (
        <ErrorState
          description={errorMessage(column.error)}
          action={
            <Button variant="secondary" onClick={() => void column.refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      ) : null}

      {tab === "assess" && column.data ? (
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
            <>
              {/*
                Offered only where it earns its line. Under about a dozen rows
                a teacher finds a name faster by looking than by typing, and
                the box would cost more vertical space than it saves on the
                screen the client already called cramped.
              */}
              {column.data.children.length > 8 ? (
                <SearchField
                  label="Хүүхдийн нэр, овгоор хайх"
                  placeholder="Хүүхэд хайх"
                  value={childQuery}
                  onChange={setChildQuery}
                />
              ) : null}

              {visibleChildren.length === 0 ? (
                <EmptyState
                  title="Хайлтад тохирох хүүхэд алга"
                  description={`«${childQuery.trim()}» гэсэн нэртэй хүүхэд энэ бүлэгт байхгүй байна.`}
                  action={
                    <Button variant="secondary" onClick={() => setChildQuery("")}>
                      Хайлтыг цэвэрлэх
                    </Button>
                  }
                />
              ) : (
                <Card className="divide-y divide-border">
                  {visibleChildren.map((child) => (
                    <ChildRow
                      key={child.childId}
                      child={child}
                      previous={child.previous ?? null}
                      levels={column.data!.levels}
                      selectedLevelId={draft[child.childId] ?? child.assessment?.levelId ?? null}
                      isDirty={Boolean(draft[child.childId])}
                      onSelect={(levelId) =>
                        setDraft((current) => ({ ...current, [child.childId]: levelId }))
                      }
                      onOpenProgress={() => setProgressChildId(child.childId)}
                    />
                  ))}
                </Card>
              )}
            </>
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

      {/*
        ★ ХҮҮХДИЙН АХИЦ — the reference's dialog, with the radar it only drew a
        placeholder for.

        `term` is the one on screen, so the drawer answers "how is this child
        doing in the term I am assessing" rather than opening a second term
        picker over the first.
      */}
      {progressChild && termId ? (
        <ChildProgressDrawer
          child={progressChild}
          termId={termId}
          onClose={() => setProgressChildId(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One child's progress, over the term the grid is showing.
 *
 * ★ No new endpoint. `GET /children/:id/assessment-radar` has existed since the
 * child's own screen shipped, and `DevelopmentRadar` is the same hand-drawn SVG
 * that screen uses — so a teacher meets one radar in this product, not two that
 * drift apart.
 *
 * ★★ `FormDialog` rather than a new drawer primitive. It already owns the
 * focus trap, the Escape handler and the labelled title, and a second component
 * that did those slightly differently is how a keyboard user finds one dialog
 * they cannot leave.
 */
function ChildProgressDrawer({
  child,
  termId,
  onClose,
}: {
  child: { childId: string; lastName: string; firstName: string };
  termId: string;
  onClose: () => void;
}) {
  const radar = useQuery({
    queryKey: qk.assessmentRadar(child.childId, termId),
    queryFn: () =>
      get(`/children/${child.childId}/assessment-radar?termId=${termId}`, assessmentRadarSchema),
  });

  const nothingAssessed = radar.data?.axes.every((axis) => axis.score === null) ?? false;

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={fullName(child)}
      description="Энэ улирлын хөгжлийн ахиц"
      footer={
        <Button asChild variant="secondary">
          <Link href={`/children/${child.childId}/assessments`}>Бүрэн түүхийг харах</Link>
        </Button>
      }
    >
      {radar.isPending ? <Skeleton className="h-[220px] w-full" /> : null}

      {radar.isError ? <ErrorState description={errorMessage(radar.error)} /> : null}

      {/*
        ★ An empty radar is not drawn. Five axes all at the origin is a dot,
        which reads as a broken chart rather than as "not assessed yet" — the
        same reason `child-assessments.tsx` skips it.
      */}
      {radar.data && nothingAssessed ? (
        <EmptyState
          title="Энэ улиралд үнэлгээ алга"
          description="Доорх мөрөнд түвшин сонгоод хадгалснаар ахиц энд харагдана."
        />
      ) : null}

      {radar.data && !nothingAssessed ? <DevelopmentRadar radar={radar.data} /> : null}
    </FormDialog>
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
  previous,
  levels,
  selectedLevelId,
  isDirty,
  onSelect,
  onOpenProgress,
}: {
  child: {
    childId: string;
    lastName: string;
    firstName: string;
    photoMediaFileId?: string | null;
  };
  /** The same domain, the previous term of the same year — RFP §6.3. */
  previous: { id: string; value: number; label: string } | null;
  levels: { id: string; label: string; value: number; color?: string | null }[];
  selectedLevelId: string | null;
  isDirty: boolean;
  onSelect: (levelId: string) => void;
  /** Opens this child's progress — the radar for the term on screen. */
  onOpenProgress: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ChildAvatar child={child} size={40} />
        <span className="min-w-0">
          {/*
            ★ The name is the control, not a separate "Ахиц" button.

            The row already carries a `radiogroup` of level chips, so making
            the whole row clickable would put a second meaning on every press
            a teacher makes to assess. The name is the one part of the row that
            does nothing else, and "press a person to see the person" needs no
            label. A real `<button>` rather than a click handler on the span,
            so it is reachable by keyboard and announced as a control.
          */}
          <button
            type="button"
            onClick={onOpenProgress}
            className="block max-w-full truncate text-start font-medium text-ink hover:text-primary hover:underline"
          >
            {fullName(child)}
          </button>

          {/*
            ★ RFP §6.3 — "өмнөх үнэлгээтэй харьцуулах".

            Under the name rather than in a column of its own. The reference
            system draws this as a four-column grid, which is a desktop shape:
            this screen is mobile-first (§5), and a third column at 390 px
            would push the level chips onto their own line and halve how many
            children fit on a screen.

            ★★ Rendered even when there is nothing — "Өмнөх: —". A row that
            simply omits it reads as a row where the teacher forgot to look,
            and the whole point of the line is to be scanned down the column.
            The first term of a year has no previous term at all and every row
            says "—", which is honest and costs no query (the service skips it).
          */}
          <span className="block truncate text-caption text-muted">
            Өмнөх: {previous ? `${previous.value}. ${previous.label}` : "—"}
          </span>

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

/** The configured kinds in the compact quick-entry strip. */
const KIND_STYLE: Record<string, { tone: Tone; Icon: typeof Eye }> = {
  daily: { tone: "mint", Icon: Eye },
  conversation: { tone: "sky", Icon: MessageCircle },
  artwork: { tone: "sun", Icon: Images },
};

const KIND_FALLBACK = { tone: "cornflower" as Tone, Icon: Eye };

function NewRecordStrip({ groupId, embedded = false }: { groupId: string; embedded?: boolean }) {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<{
    id: string;
    name: string;
  } | null>(null);

  /*
    ★ The group's own roster, not the assessment column's — fixed 2026-09-10.

    This strip took its children from `column.data`, which is the roster
    *joined to one term and one development domain*. So it could not appear
    until three requests had finished in sequence — terms, then the config that
    seeds the domain, then the column keyed on both — and it renders nothing
    while `children` is empty, so a teacher opening the screen watched an empty
    space where the child picker belonged. Worse, a kindergarten with no domain
    configured never got past step two and the strip never appeared at all.

    Which child to write a note about has nothing to do with which domain is
    selected. One request, keyed on the group, and it arrives with the page.

    ★★ `MAX_PAGE_SIZE`, not a number picked by eye. `pagination.ts` caps it at
    100 and answers 400 above that — the mistake `audience-picker.tsx` records
    making with `?pageSize=200`.
  */
  const roster = useQuery({
    queryKey: qk.children({ groupId, page: 1, pageSize: MAX_PAGE_SIZE }),
    queryFn: () =>
      get(`/children?groupId=${groupId}&page=1&pageSize=${MAX_PAGE_SIZE}`, childrenPageSchema),
    enabled: Boolean(groupId),
    staleTime: 60_000,
  });

  const children = (roster.data?.items ?? []).map((child) => ({
    childId: child.id,
    lastName: child.lastName,
    firstName: child.firstName,
  }));

  const anyChildId = children[0]?.childId;
  const types = useQuery({
    queryKey: qk.observationTypes(anyChildId ?? ""),
    queryFn: () => get(`/children/${anyChildId}/observations/types`, observationTypesSchema),
    enabled: Boolean(anyChildId),
    staleTime: 5 * 60_000,
  });

  const doors = (types.data ?? []).filter((type) =>
    ["daily", "conversation", "artwork"].includes(type.code ?? ""),
  );

  /*
    ★ A skeleton while the roster loads, not nothing.

    Returning null until the names arrive is what made this look broken: the
    strip is the first thing under the heading, and an empty space there reads
    as a screen that failed rather than one that is loading.
  */
  if (roster.isLoading) return <LoadingState rows={1} />;
  if (children.length === 0) return null;

  const content = (
    <div className="min-w-0">
      <div className="grid grid-cols-3 gap-2">
        {doors.map((type) => {
          const style = KIND_STYLE[type.code ?? ""] ?? KIND_FALLBACK;
          return (
            <button
              key={type.id}
              type="button"
              onClick={() => setSelectedType({ id: type.id, name: type.name })}
              className={cn(
                "flex min-h-[48px] min-w-0 items-center justify-center gap-1.5 rounded-control border border-transparent px-2 text-caption font-semibold transition-transform hover:-translate-y-0.5 sm:text-body",
                TONE_SURFACE[style.tone],
              )}
            >
              <style.Icon size={18} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{type.name}</span>
            </button>
          );
        })}
      </div>

      {selectedType ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedType.name} тэмдэглэлд хүүхэд сонгох`}
          className="fixed inset-0 z-50 grid items-end bg-ink/45 sm:place-items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedType(null);
          }}
        >
          <div className="flex max-h-[78dvh] w-full max-w-[440px] flex-col rounded-t-card border border-border bg-surface p-4 shadow-lg sm:rounded-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-title font-semibold text-ink">Хүүхэд сонгох</h2>
                <p className="text-caption text-muted">{selectedType.name} тэмдэглэл бичнэ.</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelectedType(null)}>
                Хаах
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {children.map((child) => (
                <button
                  key={child.childId}
                  type="button"
                  onClick={() =>
                    router.push(
                      `/children/${child.childId}/observations/new?typeId=${selectedType.id}`,
                    )
                  }
                  className="min-h-12 rounded-control border border-border bg-sunken px-3 py-2 text-left text-body font-medium text-ink transition-colors hover:border-primary hover:bg-surface"
                >
                  {child.lastName ? `${child.lastName} ` : ""}
                  {child.firstName}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  if (embedded) return content;
  return <Card pad="compact">{content}</Card>;
}
