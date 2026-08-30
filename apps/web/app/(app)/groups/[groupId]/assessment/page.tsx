"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { z } from "zod";
import {
  assessmentConfigSchema,
  groupColumnSchema,
  groupSchema,
  termSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { GroupSwitcher, useSwitchableGroups } from "@/components/shell/group-switcher";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Card, SectionHeader } from "@/components/ui/card";
import { RegisterProgress } from "@/components/register/register-progress";
import type { Tone } from "@/components/ui/tone";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { fullName } from "@/lib/format";
import { cn } from "@/lib/utils";

const termsSchema = z.array(termSchema);
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
    <div className="flex flex-col gap-5 lg:gap-6">
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

      <GroupSwitcher
        groups={switchable.data?.items ?? []}
        activeGroupId={groupId}
        href={(id) => `/groups/${id}/assessment`}
      />

      {/* `pad="roomy"` rather than four inline padding values — `card.tsx`
          documents the two named steps and why call sites stopped inventing
          their own. */}
      <Card pad="roomy" className="grid gap-4 sm:grid-cols-2">
        <Field label="Улирал">
          {({ id }) => (
            <Select
              id={id}
              value={termId}
              onChange={(e) => setSelection({ termId: e.target.value })}
              disabled={terms.isLoading}
            >
              {(terms.data ?? []).map((term) => (
                <option key={term.id} value={term.id}>
                  {term.schoolYear ? `${term.schoolYear.name} · ` : ""}
                  {term.name}
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
      </Card>

      {terms.data?.length === 0 ? (
        <EmptyState
          title="Улирал тохируулаагүй байна"
          description="Цэцэрлэгийн удирдлага улирал үүсгэсний дараа үнэлгээ хийх боломжтой."
        />
      ) : null}

      {column.isLoading ? <LoadingState rows={5} /> : null}

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

      {column.data && children.length > 0 ? (
        <RegisterProgress
          recorded={assessed}
          total={children.length}
          verb="үнэлсэн"
          breakdown={breakdown}
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
            <div className="sticky bottom-[var(--size-bottom-nav)] z-10 lg:bottom-4">
              <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 shadow-lg">
                <p className="text-body text-ink" aria-live="polite">
                  {pendingCount} хүүхдийн үнэлгээ хадгалагдаагүй байна
                </p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
                    {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setDraft({})}>
                    Болих
                  </Button>
                </div>
              </Card>
            </div>
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
        {levels.map((level) => {
          const selected = level.id === selectedLevelId;
          return (
            <button
              key={level.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(level.id)}
              className={cn(
                "min-h-[44px] rounded-control border px-3 text-body font-medium transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-ink"
                  : "border-border bg-surface text-muted hover:bg-canvas hover:text-ink",
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
