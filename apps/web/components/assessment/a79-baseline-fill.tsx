"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { A79_DOMAINS, surveySchema, type A79Domain, type A79LevelKey } from "@kinder/contracts";

type TeacherSheetQuestion = z.infer<typeof surveySchema>["questions"][number];
import { A79SummaryChart, a79ChildRows } from "@/components/assessment/a79-group-summary";
import {
  TeacherSheet,
  teacherSheetRowSchema,
  type TeacherSheetRow,
} from "@/components/survey/teacher-sheet";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
  isAnswered,
  isMet,
  rowAnswers,
  saveKind,
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
  /** The survey's questions whole — what the teacher sheet's table draws. */
  surveyQuestions: TeacherSheetQuestion[];
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
          surveyQuestions: sheet.survey.questions,
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
    /** The last sheet read — a save reloads the table from it, as «Судалгаа» does. */
    dataUpdatedAt: Math.max(0, ...sheets.map((q) => q.dataUpdatedAt)),
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

/**
 * The children on the group's baselines whom the report's table does not
 * name yet — never started — each a way into filling them in (2026-10-27,
 * the user: the table is the list; a child on it opens by their name).
 */
export function A79BaselineNotStarted({
  groupId,
  listed,
}: {
  groupId: string;
  /** The children the table already names. */
  listed: ReadonlySet<string>;
}) {
  const { sheets } = useBaselineSheets(groupId);
  const children = new Map<string, TeacherSheetRow["child"]>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      if (!listed.has(row.child.id)) children.set(row.child.id, row.child);
    }
  }
  if (children.size === 0) return null;
  return (
    <p className="text-caption text-muted">
      Бөглөж эхлээгүй:{" "}
      {[...children.values()].map((child, index) => (
        <span key={child.id}>
          {index > 0 ? ", " : null}
          <Link
            href={`/groups/${groupId}/baseline/${child.id}`}
            className="font-medium text-primary hover:underline"
          >
            {shortName(child)}
          </Link>
        </span>
      ))}
    </p>
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

/** The child's figures now, as the group's table and chart read a row — a blank not met. */
function childResult(sheet: BaselineSheetData, row: TeacherSheetRow, answers: FillAnswers) {
  const progress = domainProgress(sheet.criteria, answers);
  return {
    childId: row.child.id,
    firstName: row.child.firstName,
    lastName: row.child.lastName ?? "",
    level: sheet.level as A79LevelKey,
    feeDue: false,
    achieved: progress.reduce((sum, d) => sum + d.met, 0),
    total: progress.reduce((sum, d) => sum + d.total, 0),
    byDomain: progress.map((d) => ({ domain: d.domain, achieved: d.met, total: d.total })),
  };
}

/**
 * One child, a domain at a time — № · Шалгуур · 0 · 1, the teacher sheet's
 * cells (2026-10-27, the user: «тоо шалгуур ард нь 0 1 гэсэн чеклэх хэсэг»),
 * under the child's total drawn as the group's chart is.
 *
 * ★ «Хадгалах» saves what is marked — the rest is continued later.
 * «Дуусгах» saves the row whole: a criterion left blank is asked about
 * first, then counted «0».
 */
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
  const [dirty, setDirty] = useState(false);
  const [finished, setFinished] = useState(Boolean(row.response));
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const inDomain = sheet.criteria.filter((c) => c.domain === domain);
  const blank = sheet.criteria.filter((c) => !isAnswered(answers[c.questionId])).length;
  const next = nextDomain(sheet.criteria, domain);
  const name = shortName(row.child);
  const result = a79ChildRows({ children: [childResult(sheet, row, answers)] });

  const save = useMutation({
    mutationFn: async (mode: { finish: boolean; then?: A79Domain }) => {
      const settled = mode.finish ? finishAnswers(sheet.criteria, sheet.others, answers) : answers;
      const kind = saveKind(sheet.questions, settled, Boolean(row.response));
      if (kind === "blocked")
        throw new Error("Хадгалагдсан үнэлгээг засахдаа бүх шалгуурыг бөглөнө үү.");
      await saveRows(sheet, [
        { childId: row.child.id, answers: settled, hasResponse: Boolean(row.response) },
      ]);
      return { settled, kind, mode };
    },
    onSuccess: ({ settled, kind, mode }) => {
      setAnswers(settled);
      setDirty(false);
      if (kind === "response") setFinished(true);
      toast.success(
        kind === "response"
          ? `${name}-ын гарааны үнэлгээ хадгалагдлаа.`
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

  const mark = (questionId: string, value: "0" | "1" | undefined) => {
    setAnswers((current) => {
      const nextAnswers = { ...current };
      if (value === undefined) delete nextAnswers[questionId];
      else nextAnswers[questionId] = value;
      return nextAnswers;
    });
    setDirty(true);
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
          <span className="font-semibold">{name}</span>
          <span className="text-muted">{sheet.label}</span>
          {finished ? <Badge tone="mint">Дууссан</Badge> : null}
        </p>
      </div>
      {!sheet.editable ? (
        <p role="status" className="rounded-control bg-sun px-3 py-2 text-caption text-sun-ink">
          Энэ гарааны үнэлгээ хаагдсан тул засах боломжгүй.
        </p>
      ) : null}
      <FormError message={save.isError ? errorMessage(save.error) : null} />

      <A79SummaryChart
        title="Нийт дүн"
        rows={result}
        averageLabel={`${name}-ын гарааны дүн`}
        description={name}
      />

      <DomainTabs criteria={sheet.criteria} active={domain} onSelect={setDomain} />
      <div className="table-scroll rounded-control border border-border">
        <table className="w-full border-collapse text-body">
          <caption className="sr-only">{domain}</caption>
          <thead>
            <tr className="bg-canvas">
              <th
                scope="col"
                className="w-10 px-2 py-2.5 text-left text-caption font-semibold text-muted"
              >
                №
              </th>
              <th
                scope="col"
                className="px-2 py-2.5 text-left text-caption font-semibold text-muted"
              >
                Шалгуур
              </th>
              {(["0", "1"] as const).map((value) => (
                <th
                  key={value}
                  scope="col"
                  className="w-12 px-2 py-2.5 text-center text-caption font-semibold text-ink"
                >
                  {value}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inDomain.map((criterion, index) => (
              <tr key={criterion.questionId} className="border-t border-border-soft">
                <td className="px-2 py-2.5 align-top tabular-nums text-muted">{index + 1}</td>
                <th scope="row" className="px-2 py-2.5 text-left font-normal leading-snug text-ink">
                  {criterion.text}
                </th>
                {(["0", "1"] as const).map((value) => {
                  const selected =
                    answers[criterion.questionId] !== undefined &&
                    (isMet(answers[criterion.questionId]) ? "1" : "0") === value;
                  return (
                    <td key={value} className="px-2 py-2.5 text-center">
                      <input
                        type="radio"
                        name={`c-${criterion.questionId}`}
                        aria-label={`${index + 1}-р шалгуур: ${value}`}
                        checked={selected}
                        onClick={(event) => {
                          if (selected) {
                            event.preventDefault();
                            mark(criterion.questionId, undefined);
                          }
                        }}
                        onChange={() => mark(criterion.questionId, value)}
                        disabled={!sheet.editable || save.isPending}
                        className="size-5 cursor-pointer align-middle accent-primary disabled:cursor-default"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
                onClick={() => (blank > 0 ? setAsking(true) : save.mutate({ finish: true }))}
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
        title="Бөглөөгүй шалгуур байна"
        description={`${blank} шалгуурыг бөглөөгүй байна. Дуусгавал тэдгээр нь биелээгүй («0») гэж тооцогдоно.`}
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
 * «Бүлгээр бөглөх» — the teacher sheet's own table, the one «Судалгаа» fills
 * a survey in with (2026-10-27, the user: «хуучин байсан хүснэгтээр
 * бөглөх»), for each level's baseline of the group in turn.
 */
export function A79BaselineGroupFill({ groupId }: { groupId: string }) {
  const { isLoading, error, sheets, dataUpdatedAt } = useBaselineSheets(groupId);
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
      {!sheet.editable ? (
        <p className="rounded-card bg-sunken px-4 py-3 text-body text-muted">
          Энэ гарааны үнэлгээ хаагдсан тул зөвхөн харах боломжтой.
        </p>
      ) : null}
      <TeacherSheet
        key={`${sheet.surveyId}-${dataUpdatedAt}`}
        surveyId={sheet.surveyId}
        questions={sheet.surveyQuestions}
        rows={sheet.rows}
        editable={sheet.editable}
        backHref={`/groups/${groupId}/baseline`}
      />
    </div>
  );
}
