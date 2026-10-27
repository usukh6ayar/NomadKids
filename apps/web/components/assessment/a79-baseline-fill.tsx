"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { A79_DOMAINS, surveySchema, type A79Domain } from "@kinder/contracts";
import { teacherSheetRowSchema, type TeacherSheetRow } from "@/components/survey/teacher-sheet";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckControl } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { TabButton, Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import {
  baselineForm,
  isA79BaselineSurvey,
  type BaselineCriterion,
  type BaselineQuestion,
} from "@/lib/a79-baseline";
import {
  answersBody,
  domainProgress,
  finishAnswers,
  isMet,
  rowAnswers,
  saveKind,
  settleDomain,
  type FillAnswers,
  type FillQuestion,
} from "@/lib/a79-baseline-fill";
import { formatDate, shortName } from "@/lib/format";
import { staffSurveysSchema } from "@/lib/survey-access";
import { cn } from "@/lib/utils";

const sheetSchema = z.object({ survey: surveySchema, rows: z.array(teacherSheetRowSchema) });
const savedSchema = z.object({ saved: z.number() });

/** Ten children per request — the teacher sheet's limit, for the same 49 questions. */
const SAVE_CHUNK = 10;

/** One level's baseline of the group, ready to fill in. */
export interface BaselineSheetData {
  surveyId: string;
  level: string;
  /** «IV түвшин» — with its date when the group has two of one level (the wizard's). */
  label: string;
  editable: boolean;
  questions: FillQuestion[];
  criteria: BaselineCriterion[];
  others: FillQuestion[];
  rows: TeacherSheetRow[];
}

/**
 * The group's А/79 baselines with their sheets — the same survey list and
 * sheet reads as the report (`a79-baseline.tsx`), so one cache serves both.
 * A survey addressed to no one group counts for each, its rows narrowed to
 * this group's children.
 */
export function useBaselineSheets(groupId: string) {
  const { primaryKindergartenId } = useSession();
  const surveys = useQuery({
    queryKey: qk.kindergartenSurveys(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/surveys`, staffSurveysSchema),
    enabled: Boolean(primaryKindergartenId),
  });
  const baselines = (surveys.data ?? []).filter(
    (s) => isA79BaselineSurvey(s) && (!s.groupId || s.groupId === groupId),
  );
  const sheets = useQueries({
    queries: baselines.map((survey) => ({
      queryKey: ["survey", survey.id, "teacher-sheet"],
      queryFn: () => get(`/surveys/${survey.id}/teacher-sheet`, sheetSchema),
    })),
  });

  const data: (Omit<BaselineSheetData, "label"> & { createdAt: string })[] = baselines.flatMap(
    (survey, i) => {
      const sheet = sheets[i]?.data;
      if (!sheet) return [];
      const questions: FillQuestion[] = sheet.survey.questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        type: q.type,
        options: q.options,
      }));
      const form = baselineForm(questions);
      if (!form) return [];
      const otherIds = new Set(form.others.map((q: BaselineQuestion) => q.id));
      return [
        {
          surveyId: survey.id,
          level: form.level.key,
          createdAt: survey.createdAt,
          editable: sheet.survey.status === "PUBLISHED",
          questions,
          criteria: form.criteria,
          others: questions.filter((q) => otherIds.has(q.id)),
          rows: sheet.rows.filter((row) => !row.group || row.group.id === groupId),
        },
      ];
    },
  );

  return {
    isLoading: surveys.isLoading || sheets.some((q) => q.isLoading),
    error: surveys.error ?? sheets.find((q) => q.isError)?.error ?? null,
    sheets: data.map(({ createdAt, ...sheet }) => ({
      ...sheet,
      label:
        data.filter((other) => other.level === sheet.level).length > 1
          ? `${sheet.level} түвшин · ${formatDate(createdAt)}`
          : `${sheet.level} түвшин`,
    })),
  };
}

/**
 * The answers a row starts from. ★ A recorded response counts an unanswered
 * criterion as not met — the report's rule (`baselineSummary`) — so it opens
 * with every domain saved, and is corrected whole as the server keeps it. A
 * response from before every question was required (the wizard's) is one.
 */
function startingAnswers(sheet: BaselineSheetData, row: TeacherSheetRow): FillAnswers {
  const answers = rowAnswers(row);
  return row.response ? finishAnswers(sheet.criteria, sheet.others, answers) : answers;
}

/** When a row was last saved — its response, else its draft. */
function savedAt(row: TeacherSheetRow): string {
  return row.response?.submittedAt ?? row.draft?.updatedAt ?? "";
}

/** Saves rows to one sheet: a complete row as the child's response, any other as a draft. */
async function saveRows(
  sheet: BaselineSheetData,
  rows: { childId: string; answers: FillAnswers; hasResponse: boolean }[],
) {
  const responses = rows.filter(
    (r) => saveKind(sheet.questions, r.answers, r.hasResponse) === "response",
  );
  const drafts = rows.filter(
    (r) => saveKind(sheet.questions, r.answers, r.hasResponse) === "draft",
  );
  for (let start = 0; start < responses.length; start += SAVE_CHUNK) {
    await mutate(`/surveys/${sheet.surveyId}/teacher-sheet`, savedSchema, {
      method: "PUT",
      body: {
        responses: responses.slice(start, start + SAVE_CHUNK).map((r) => ({
          childId: r.childId,
          answers: answersBody(sheet.questions, r.answers),
        })),
      },
    });
  }
  for (let start = 0; start < drafts.length; start += SAVE_CHUNK) {
    await mutate(`/surveys/${sheet.surveyId}/teacher-sheet/drafts`, savedSchema, {
      method: "PUT",
      body: {
        drafts: drafts.slice(start, start + SAVE_CHUNK).map((r) => ({
          childId: r.childId,
          answers: answersBody(sheet.questions, r.answers),
        })),
      },
    });
  }
  return { finished: responses.length, drafted: drafts.length };
}

/** The floating Буцах · actions — the teacher sheet's corner, above the bottom bar. */
function useChatLift() {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--chat-lift", "3.75rem");
    return () => {
      root.style.removeProperty("--chat-lift");
    };
  }, []);
}

const FLOATING_BAR =
  "fixed bottom-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom)+0.5rem)] right-4 z-30 flex items-center gap-1.5 rounded-pill border border-border bg-surface p-1.5 shadow-lg lg:bottom-6 lg:right-6";

/** «Мэдлэг ✓», «Чадвар 12/28», «Төлөвшил —» — how far a child's row is. */
function DomainMarks({
  criteria,
  answers,
}: {
  criteria: BaselineCriterion[];
  answers: FillAnswers;
}) {
  return (
    <span className="flex flex-wrap gap-1">
      {domainProgress(criteria, answers).map((d) => (
        <Badge key={d.domain} tone={d.done ? "mint" : d.answered > 0 ? "sun" : "neutral"}>
          {d.domain} {d.done ? <Check aria-label="бөглөсөн" className="inline size-3.5" /> : null}
          {!d.done && d.answered > 0 ? `${d.answered}/${d.total}` : null}
          {d.answered === 0 ? "—" : null}
        </Badge>
      ))}
    </span>
  );
}

function rowStatus(row: TeacherSheetRow): { label: string; tone: "mint" | "sun" | "neutral" } {
  if (row.response) return { label: "Дууссан", tone: "mint" };
  if (row.draft) return { label: "Дутуу", tone: "sun" };
  return { label: "Эхлээгүй", tone: "neutral" };
}

/**
 * The children on the group's baselines, each with how far their row is —
 * the way into filling one child in (2026-10-27, the user: «хүүхэд дээр
 * дарахад зөвхөн тухайн хүүхдийг засаж үргэлжлүүлнэ»).
 */
export function A79BaselineChildList({
  groupId,
  sheets,
}: {
  groupId: string;
  sheets: BaselineSheetData[];
}) {
  // One line a child — on two baselines (the wizard's), the one saved last.
  const byChild = new Map<string, { sheet: BaselineSheetData; row: TeacherSheetRow }>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const seen = byChild.get(row.child.id);
      if (!seen || savedAt(row) > savedAt(seen.row)) byChild.set(row.child.id, { sheet, row });
    }
  }
  const entries = [...byChild.values()];
  if (entries.length === 0) return null;
  return (
    <ul aria-label="Гарааны үнэлгээний хүүхдүүд" className="flex flex-col gap-2">
      {entries.map(({ sheet, row }) => {
        const status = rowStatus(row);
        return (
          <li key={row.child.id}>
            <Link
              href={`/groups/${groupId}/baseline/${row.child.id}`}
              className="flex min-h-[56px] flex-col gap-1.5 rounded-card border border-border bg-surface px-3 py-2.5 transition-colors hover:border-faint sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="flex items-center gap-2">
                <span className="text-body font-semibold text-ink">{shortName(row.child)}</span>
                <span className="text-caption text-muted">{sheet.label}</span>
                <Badge tone={status.tone}>{status.label}</Badge>
              </span>
              <span className="flex items-center gap-2">
                <DomainMarks criteria={sheet.criteria} answers={startingAnswers(sheet, row)} />
                <ChevronRight aria-hidden className="hidden size-4 text-faint sm:block" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function DomainTabs({
  criteria,
  active,
  onSelect,
}: {
  criteria: BaselineCriterion[];
  active: A79Domain;
  onSelect: (domain: A79Domain) => void;
}) {
  return (
    <Tabs label="Салбар">
      {A79_DOMAINS.map((domain) => {
        const count = criteria.filter((c) => c.domain === domain).length;
        return count === 0 ? null : (
          <TabButton
            key={domain}
            active={active === domain}
            onClick={() => onSelect(domain)}
            count={count}
          >
            {domain}
          </TabButton>
        );
      })}
    </Tabs>
  );
}

function firstDomain(criteria: BaselineCriterion[]): A79Domain {
  return A79_DOMAINS.find((d) => criteria.some((c) => c.domain === d)) ?? "Мэдлэг";
}

function nextDomain(criteria: BaselineCriterion[], domain: A79Domain): A79Domain | null {
  const present = A79_DOMAINS.filter((d) => criteria.some((c) => c.domain === d));
  return present[present.indexOf(domain) + 1] ?? null;
}

/**
 * One child's baseline, a domain at a time — 2026-10-27, the user: «мэдлэг
 * гээд тэндээс сонгож, чадвар гээд тусдаа». A tick is «биелсэн».
 *
 * ★ «Хадгалах» saves the domains the teacher worked on (ticked or not) — what
 * the row then lacks is continued later. «Дуусгах» saves the row whole: an
 * unticked criterion is not met, and a domain never opened is asked about
 * first. A child on two baselines (the wizard's, before 2026-10-27) picks one.
 */
export function A79BaselineChildFill({ groupId, childId }: { groupId: string; childId: string }) {
  const { isLoading, error, sheets } = useBaselineSheets(groupId);
  const [chosen, setChosen] = useState<string | null>(null);

  if (isLoading) return <LoadingState rows={6} />;
  if (error) return <ErrorState description={errorMessage(error)} />;

  const own = sheets.filter((s) => s.rows.some((r) => r.child.id === childId));
  if (own.length === 0) {
    return (
      <EmptyState
        title="Энэ хүүхэд гарааны үнэлгээнд ороогүй байна"
        description="«Гарааны үнэлгээ» хуудаснаас «Хүүхэд нэмэх» товчоор түвшинг нь сонгож нэмнэ үү."
        action={
          <Link
            href={`/groups/${groupId}/baseline`}
            className={buttonVariants({ variant: "secondary" })}
          >
            Гарааны үнэлгээ
          </Link>
        }
      />
    );
  }
  const latest = (sheet: BaselineSheetData) =>
    savedAt(sheet.rows.find((r) => r.child.id === childId)!);
  const fallback = [...own].sort((x, y) => latest(y).localeCompare(latest(x)))[0]!;
  const sheet = own.find((s) => s.surveyId === chosen) ?? fallback;
  const row = sheet.rows.find((r) => r.child.id === childId)!;

  // The next child in the list the group page draws, for «Дараагийн хүүхэд».
  const order = sheets.flatMap((s) => s.rows.map((r) => r.child.id));
  const nextId = order.slice(order.indexOf(childId) + 1).find((id) => id !== childId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      {own.length > 1 ? (
        <div role="group" aria-label="Түвшин" className="flex flex-wrap gap-2">
          {own.map((s) => (
            <Button
              key={s.surveyId}
              type="button"
              size="sm"
              variant={s.surveyId === sheet.surveyId ? "primary" : "secondary"}
              aria-pressed={s.surveyId === sheet.surveyId}
              onClick={() => setChosen(s.surveyId)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      ) : null}
      <ChildForm
        // Not keyed on the saved row: a save reloads the sheet, and the tab stays.
        key={`${sheet.surveyId}-${childId}`}
        groupId={groupId}
        sheet={sheet}
        row={row}
        nextHref={nextId ? `/groups/${groupId}/baseline/${nextId}` : null}
      />
    </div>
  );
}

function ChildForm({
  groupId,
  sheet,
  row,
  nextHref,
}: {
  groupId: string;
  sheet: BaselineSheetData;
  row: TeacherSheetRow;
  nextHref: string | null;
}) {
  useChatLift();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const backHref = `/groups/${groupId}/baseline`;
  const [answers, setAnswers] = useState<FillAnswers>(() => startingAnswers(sheet, row));
  const [domain, setDomain] = useState<A79Domain>(() => firstDomain(sheet.criteria));
  const [touched, setTouched] = useState<Set<A79Domain>>(new Set());
  const [finished, setFinished] = useState(Boolean(row.response));
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const inDomain = sheet.criteria.filter((c) => c.domain === domain);
  const progress = domainProgress(sheet.criteria, answers);
  const unopened = progress.filter((d) => !d.done && !touched.has(d.domain) && d.domain !== domain);
  const dirty = touched.size > 0;
  const next = nextDomain(sheet.criteria, domain);

  const save = useMutation({
    mutationFn: async (mode: { finish: boolean; then?: A79Domain }) => {
      let settled = answers;
      if (mode.finish) settled = finishAnswers(sheet.criteria, sheet.others, answers);
      else
        for (const d of new Set([...touched, domain]))
          settled = settleDomain(sheet.criteria, settled, d);
      const kind = saveKind(sheet.questions, settled, Boolean(row.response));
      if (kind === "blocked")
        throw new Error("Хадгалагдсан үнэлгээг засахдаа бүх асуултад хариулна уу.");
      await saveRows(sheet, [
        { childId: row.child.id, answers: settled, hasResponse: Boolean(row.response) },
      ]);
      return { settled, kind, mode };
    },
    onSuccess: ({ settled, kind, mode }) => {
      setAnswers(settled);
      setTouched(new Set());
      if (kind === "response") setFinished(true);
      toast.success(
        kind === "response"
          ? `${shortName(row.child)}-ын гарааны үнэлгээ хадгалагдлаа.`
          : "Хадгалагдлаа — дараа нь үргэлжлүүлж бөглөнө.",
      );
      if (mode.then) setDomain(mode.then);
      if (mode.finish && kind !== "response") {
        toast.error("Энэ судалгааны А/79-ийн бус асуултыг «Судалгаа» хэсгээс бөглөнө үү.");
      }
      void queryClient.invalidateQueries({ queryKey: ["survey", sheet.surveyId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggle = (questionId: string) => {
    setAnswers((current) => ({ ...current, [questionId]: isMet(current[questionId]) ? "0" : "1" }));
    setTouched((current) => new Set(current).add(domain));
  };

  return (
    <form
      className="flex flex-col gap-3 pb-20"
      onSubmit={(e) => {
        e.preventDefault();
      }}
      noValidate
    >
      <div className="flex flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-2 text-body text-ink">
          <span className="font-semibold">{shortName(row.child)}</span>
          <span className="text-muted">{sheet.label}</span>
          {finished ? <Badge tone="mint">Дууссан</Badge> : null}
        </p>
        <DomainMarks criteria={sheet.criteria} answers={answers} />
      </div>
      {!sheet.editable ? (
        <p role="status" className="rounded-control bg-sun px-3 py-2 text-caption text-sun-ink">
          Энэ гарааны үнэлгээ хаагдсан тул засах боломжгүй.
        </p>
      ) : null}
      <FormError message={save.isError ? errorMessage(save.error) : null} />

      <DomainTabs criteria={sheet.criteria} active={domain} onSelect={setDomain} />
      <p className="text-caption text-muted">
        Хүүхэд биелүүлсэн шалгуурыг чагтална уу. Чагтлаагүй шалгуур биелээгүйд тооцогдоно.
      </p>
      <ul aria-label={domain} className="flex flex-col gap-2">
        {inDomain.map((criterion, index) => {
          const id = `c-${criterion.questionId}`;
          const checked = isMet(answers[criterion.questionId]);
          return (
            <li key={criterion.questionId}>
              <label
                htmlFor={id}
                className={cn(
                  "flex min-h-[52px] cursor-pointer select-none items-start gap-3 rounded-card border px-3 py-3 transition-colors",
                  checked ? "border-primary bg-primary-soft" : "border-border bg-surface",
                  !sheet.editable && "cursor-not-allowed opacity-70",
                )}
              >
                <CheckControl
                  id={id}
                  className="mt-0.5"
                  checked={checked}
                  disabled={!sheet.editable || save.isPending}
                  onChange={() => toggle(criterion.questionId)}
                />
                <span className="text-body leading-snug text-ink">
                  <span className="mr-1 tabular-nums text-muted">{index + 1}.</span>
                  {criterion.text}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {finished && nextHref && !dirty ? (
        <Link
          href={nextHref}
          className={cn(buttonVariants({ variant: "secondary" }), "self-start")}
        >
          Дараагийн хүүхэд
          <ChevronRight aria-hidden />
        </Link>
      ) : null}

      <div data-print-hide className={FLOATING_BAR}>
        {dirty ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-9 rounded-pill px-3"
            onClick={() => setLeaving(true)}
          >
            <ChevronLeft aria-hidden />
            Буцах
          </Button>
        ) : (
          <Button asChild variant="secondary" size="sm" className="h-9 rounded-pill px-3">
            <Link href={backHref}>
              <ChevronLeft aria-hidden />
              Буцах
            </Link>
          </Button>
        )}
        {sheet.editable ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-9 rounded-pill px-3"
              disabled={save.isPending}
              onClick={() => save.mutate({ finish: false })}
            >
              Хадгалах
            </Button>
            {next ? (
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-pill px-3"
                disabled={save.isPending}
                onClick={() => save.mutate({ finish: false, then: next })}
              >
                {next}
                <ChevronRight aria-hidden />
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-pill px-4"
                disabled={save.isPending}
                onClick={() =>
                  unopened.length > 0 ? setAsking(true) : save.mutate({ finish: true })
                }
              >
                {save.isPending ? "Хадгалж байна…" : "Дуусгах"}
              </Button>
            )}
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Бөглөөгүй хэсэг байна"
        description={`${unopened.map((d) => d.domain).join(", ")} хэсгийг бөглөөгүй байна. Дуусгавал чагтлаагүй шалгуурууд биелээгүйд тооцогдоно.`}
        confirmLabel="Дуусгах"
        cancelLabel="Буцаж бөглөх"
        pending={save.isPending}
        onConfirm={() => {
          setAsking(false);
          save.mutate({ finish: true });
        }}
      />
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Хадгалаагүй өөрчлөлт байна"
        description="Хадгалахгүйгээр гарвал энэ хүүхдийн өөрчлөлт алга болно."
        confirmLabel="Хадгалахгүй гарах"
        cancelLabel="Үлдэх"
        tone="danger"
        onConfirm={() => {
          setLeaving(false);
          router.push(backHref);
        }}
      />
    </form>
  );
}

/**
 * The whole group at once, a domain at a time — a card per criterion with the
 * level's children under it as chips (2026-10-27, the user: «утсан дээр
 * харагдах боломжийг бас тусга»). A table of 49 criteria by 20 children does
 * not fit a phone; a card does, and a tap marks the child «биелсэн».
 *
 * ★ Saved per child as by the child: a child the teacher marked in a domain,
 * or whose domain was already saved, has that domain saved whole. A child
 * marked nowhere in it is left as they were — they may not have been looked
 * at — and is filled from their own page.
 */
export function A79BaselineGroupFill({ groupId }: { groupId: string }) {
  const { isLoading, error, sheets } = useBaselineSheets(groupId);
  const [chosen, setChosen] = useState<string | null>(null);

  if (isLoading) return <LoadingState rows={6} />;
  if (error) return <ErrorState description={errorMessage(error)} />;
  const withChildren = sheets.filter((s) => s.rows.length > 0);
  if (withChildren.length === 0) {
    return (
      <EmptyState
        title="Гарааны үнэлгээ хараахан эхлээгүй байна"
        description="«Гарааны үнэлгээ» хуудаснаас «Шинэ гарааны үнэлгээ» товчоор хүүхдүүдээ сонгож эхлүүлнэ үү."
        action={
          <Link
            href={`/groups/${groupId}/baseline`}
            className={buttonVariants({ variant: "secondary" })}
          >
            Гарааны үнэлгээ
          </Link>
        }
      />
    );
  }
  const sheet = withChildren.find((s) => s.surveyId === chosen) ?? withChildren[0]!;

  return (
    <div className="flex flex-col gap-3">
      {withChildren.length > 1 ? (
        <Tabs label="Түвшин">
          {withChildren.map((s) => (
            <TabButton
              key={s.surveyId}
              active={s.surveyId === sheet.surveyId}
              onClick={() => setChosen(s.surveyId)}
              count={s.rows.length}
            >
              {s.label}
            </TabButton>
          ))}
        </Tabs>
      ) : (
        <p className="text-body text-muted">
          {sheet.label} · {sheet.rows.length} хүүхэд
        </p>
      )}
      <GroupForm key={sheet.surveyId} groupId={groupId} sheet={sheet} />
    </div>
  );
}

function GroupForm({ groupId, sheet }: { groupId: string; sheet: BaselineSheetData }) {
  useChatLift();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const backHref = `/groups/${groupId}/baseline`;
  const [answers, setAnswers] = useState<Record<string, FillAnswers>>(() =>
    Object.fromEntries(sheet.rows.map((row) => [row.child.id, startingAnswers(sheet, row)])),
  );
  const [domain, setDomain] = useState<A79Domain>(() => firstDomain(sheet.criteria));
  /** `childId|domain` the teacher marked something in. */
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState(false);

  const inDomain = sheet.criteria.filter((c) => c.domain === domain);
  const touchedChildren = new Set([...touched].map((key) => key.split("|")[0]!));
  const blocked = sheet.rows.filter((row) => {
    if (!touchedChildren.has(row.child.id)) return false;
    return saveKind(sheet.questions, settledFor(row.child.id), Boolean(row.response)) === "blocked";
  });

  function settledFor(childId: string): FillAnswers {
    let next = answers[childId] ?? {};
    for (const key of touched) {
      const [id, d] = key.split("|") as [string, A79Domain];
      if (id === childId) next = settleDomain(sheet.criteria, next, d);
    }
    return next;
  }

  const toggle = (childId: string, questionId: string) => {
    setAnswers((current) => {
      const own = current[childId] ?? {};
      return {
        ...current,
        [childId]: { ...own, [questionId]: isMet(own[questionId]) ? "0" : "1" },
      };
    });
    setTouched((current) => new Set(current).add(`${childId}|${domain}`));
  };

  const toggleAll = (questionId: string) => {
    const all = sheet.rows.every((row) => isMet(answers[row.child.id]?.[questionId]));
    setAnswers((current) =>
      Object.fromEntries(
        sheet.rows.map((row) => [
          row.child.id,
          { ...(current[row.child.id] ?? {}), [questionId]: all ? "0" : "1" },
        ]),
      ),
    );
    setTouched((current) => {
      const next = new Set(current);
      for (const row of sheet.rows) next.add(`${row.child.id}|${domain}`);
      return next;
    });
  };

  const save = useMutation({
    mutationFn: () =>
      saveRows(
        sheet,
        sheet.rows
          .filter((row) => touchedChildren.has(row.child.id))
          .map((row) => ({
            childId: row.child.id,
            answers: settledFor(row.child.id),
            hasResponse: Boolean(row.response),
          })),
      ),
    onSuccess: ({ finished, drafted }) => {
      setAnswers((current) =>
        Object.fromEntries(
          sheet.rows.map((row) => [
            row.child.id,
            touchedChildren.has(row.child.id) ? settledFor(row.child.id) : current[row.child.id]!,
          ]),
        ),
      );
      setTouched(new Set());
      toast.success(
        [
          finished > 0 ? `${finished} хүүхдийн гарааны үнэлгээ хадгалагдлаа.` : null,
          drafted > 0 ? `${drafted} хүүхдийнх дутуу хадгалагдлаа — дараа нь үргэлжлүүлнэ.` : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
      void queryClient.invalidateQueries({ queryKey: ["survey", sheet.surveyId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <form
      className="flex flex-col gap-3 pb-20"
      onSubmit={(e) => {
        e.preventDefault();
        if (!save.isPending && touched.size > 0 && blocked.length === 0) save.mutate();
      }}
      noValidate
    >
      {!sheet.editable ? (
        <p role="status" className="rounded-control bg-sun px-3 py-2 text-caption text-sun-ink">
          Энэ гарааны үнэлгээ хаагдсан тул засах боломжгүй.
        </p>
      ) : null}
      <FormError message={save.isError ? errorMessage(save.error) : null} />
      <DomainTabs criteria={sheet.criteria} active={domain} onSelect={setDomain} />
      <p className="text-caption text-muted">
        Шалгуурыг биелүүлсэн хүүхдийн нэр дээр дарна уу. Хадгалахад тэмдэглэсэн хүүхдийн энэ хэсгийн
        чагтлаагүй шалгуур биелээгүйд тооцогдоно.
      </p>
      {blocked.length > 0 ? (
        <p role="status" className="rounded-control bg-sun px-3 py-2 text-caption text-sun-ink">
          Хадгалагдсан үнэлгээг засахдаа бүх асуултад хариулна уу:{" "}
          {blocked.map((row) => shortName(row.child)).join(", ")}.
        </p>
      ) : null}

      <ul aria-label={domain} className="flex flex-col gap-2">
        {inDomain.map((criterion, index) => {
          const all = sheet.rows.every((row) =>
            isMet(answers[row.child.id]?.[criterion.questionId]),
          );
          const count = sheet.rows.filter((row) =>
            isMet(answers[row.child.id]?.[criterion.questionId]),
          ).length;
          return (
            <li key={criterion.questionId}>
              <Card pad="compact" className="flex flex-col gap-2">
                <p className="text-body leading-snug text-ink">
                  <span className="mr-1 tabular-nums text-muted">{index + 1}.</span>
                  {criterion.text}
                </p>
                <div
                  role="group"
                  aria-label={`${index + 1}-р шалгуур`}
                  className="flex flex-wrap gap-1.5"
                >
                  {sheet.rows.map((row) => {
                    const on = isMet(answers[row.child.id]?.[criterion.questionId]);
                    const name = shortName(row.child);
                    return (
                      <button
                        key={row.child.id}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${name} — ${index + 1}-р шалгуур биелсэн`}
                        disabled={!sheet.editable || save.isPending}
                        onClick={() => toggle(row.child.id, criterion.questionId)}
                        className={cn(
                          "inline-flex h-[44px] items-center gap-1 rounded-pill border px-3 text-body transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                          on
                            ? "border-primary bg-primary-soft font-semibold text-primary"
                            : "border-border bg-surface text-ink",
                        )}
                      >
                        {on ? <Check aria-hidden className="size-4" /> : null}
                        {name}
                      </button>
                    );
                  })}
                  {sheet.rows.length > 1 ? (
                    <button
                      type="button"
                      aria-pressed={all}
                      disabled={!sheet.editable || save.isPending}
                      onClick={() => toggleAll(criterion.questionId)}
                      className="inline-flex h-[44px] items-center rounded-pill px-3 text-caption font-semibold text-primary disabled:opacity-60"
                    >
                      {all ? "Бүгдийг болиулах" : "Бүгд"}
                    </button>
                  ) : null}
                </div>
                <p className="text-caption text-muted">
                  {count}/{sheet.rows.length} хүүхэд биелүүлсэн
                </p>
              </Card>
            </li>
          );
        })}
      </ul>

      <div data-print-hide className={FLOATING_BAR}>
        {touched.size > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-9 rounded-pill px-3"
            onClick={() => setLeaving(true)}
          >
            <ChevronLeft aria-hidden />
            Буцах
          </Button>
        ) : (
          <Button asChild variant="secondary" size="sm" className="h-9 rounded-pill px-3">
            <Link href={backHref}>
              <ChevronLeft aria-hidden />
              Буцах
            </Link>
          </Button>
        )}
        {sheet.editable ? (
          <Button
            type="submit"
            size="sm"
            className="h-9 rounded-pill px-4"
            disabled={save.isPending || touched.size === 0 || blocked.length > 0}
          >
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Хадгалаагүй өөрчлөлт байна"
        description={`${touchedChildren.size} хүүхдийн өөрчлөлт хадгалагдаагүй байна. Хадгалахгүйгээр гарвал алга болно.`}
        confirmLabel="Хадгалахгүй гарах"
        cancelLabel="Үлдэх"
        tone="danger"
        onConfirm={() => {
          setLeaving(false);
          router.push(backHref);
        }}
      />
    </form>
  );
}
