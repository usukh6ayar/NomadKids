"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  type SurveyQuestion,
  surveyResultsSchema,
  surveySchema,
  SURVEY_QUESTION_TYPE_LABEL,
  hasOptionList,
  type MatrixOptions,
  type SurveyQuestionType,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { SurveyResultsView } from "@/components/survey/survey-results-view";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { BackButton } from "@/components/ui/back-button";
import { RequireRole } from "@/components/shell/require-role";
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Copy,
  Download,
  Eye,
  LockKeyhole,
  LockKeyholeOpen,
  Plus,
  Printer,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Card, SectionHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";

type DraftQuestion = {
  order: number;
  type: SurveyQuestionType;
  prompt: string;
  /**
   * CHECKBOX's choices, one entry each.
   *
   * ★ A list, where this was a comma-separated string — 2026-08-29.
   *
   * "Улаан, Ногоон, Хөх" in one field is a data format a teacher has to know:
   * it cannot hold a choice containing a comma, gives no way to reorder or
   * delete one without editing around the punctuation, and shows nothing of
   * what the parent will actually see. Every form builder gives an option its
   * own row for those reasons.
   */
  options: string[];
  /** MATRIX's rows, one per line as `key: Шошго`. */
  rowsText: string;
  /** MATRIX's columns, comma separated as `1=Сул`. */
  columnsText: string;
  indicatorKey: string;
};

/**
 * The labels live in `@kinder/contracts` so the composer here and the answering
 * form a parent sees name the same type identically. They were duplicated here
 * until `SINGLE_CHOICE` was added and only one copy learned about it.
 */
const TYPE_LABEL = SURVEY_QUESTION_TYPE_LABEL;

/**
 * The status as the client's own header card words it.
 *
 * ★ "Идэвхтэй", not "Нийтэлсэн" — 2026-09-12, from their drawing. The board's
 * three tabs are already named Идэвхтэй · Дууссан · Ноорог, so the card now
 * agrees with the tab a teacher found it under; the board's own badge keeps
 * saying what *happened* to the survey, which is the right word in a list of
 * them.
 */
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Ноорог",
  PUBLISHED: "Идэвхтэй",
  CLOSED: "Дууссан",
};

/** The word's own colour, since the card writes the state rather than badging it. */
const STATUS_INK: Record<string, string> = {
  DRAFT: "text-muted",
  PUBLISHED: "text-mint-ink",
  CLOSED: "text-sun-ink",
};

export default function SurveyDetailPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <SurveyDetail />
    </RequireRole>
  );
}

function SurveyDetail() {
  const params = useParams<{ surveyId: string }>();
  const surveyId = params.surveyId;
  const queryClient = useQueryClient();
  /** Whether the parent's-eye-view card is open — see the eye button below. */
  const [previewing, setPreviewing] = useState(false);

  const survey = useQuery({
    queryKey: qk.survey(surveyId),
    queryFn: () => get(`/surveys/${surveyId}`, surveySchema),
  });

  /*
    ★ The roster, for the header card's "1А бүлэг · 25 хүүхэд" — 2026-09-12,
    from the client's drawing.

    It is the same query `SurveyResultsView` reads below, on the same key, so
    the two share one request rather than each asking — and the headcount over
    the card cannot disagree with the ring inside it. A draft has nobody to
    count yet, so it is not asked for.
  */
  const results = useQuery({
    queryKey: qk.surveyResults(surveyId, ""),
    queryFn: () => get(`/surveys/${surveyId}/results`, surveyResultsSchema),
    enabled: survey.data ? survey.data.status !== "DRAFT" : false,
  });

  /*
    ★ A way back, on every branch — 2026-09-12, at the client's request:
    "дэлгэрэнгүй гэдэг дээр дарахаар буцаж болохгүй байна."

    This screen is reached from one of the two boards and had no exit of its
    own, so a teacher opening a survey to read its answers was left with the
    browser's own button — which this product does not rely on anywhere else.
    The fallback is the board the survey belongs to, and the hub while the
    survey is still loading and its kind unknown.
  */
  if (survey.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton href="/surveys" />
        <LoadingState rows={4} />
      </div>
    );
  }

  if (survey.isError) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton href="/surveys" />
        <ErrorState description={errorMessage(survey.error)} />
      </div>
    );
  }

  const data = survey.data!;

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      {/*
        ★ The drawing's own header — 2026-09-12.

        `PageHeader` put the survey's title across the top with the controls
        beside it, which is the shape every screen in the product uses for a
        *page*. The client's is a screen called "Судалгааны дүн" with the survey
        as a **card** inside it: icon, title, the dates it runs between, whether
        it is live, and who it went to. That card is the thing a teacher is
        looking at; the page is just where it sits.
      */}
      <div className="flex items-center gap-2">
        <BackButton href={data.kind === "POLL" ? "/surveys/polls" : "/surveys/forms"} />
        <h1 className="min-w-0 flex-1 truncate text-center text-title font-semibold text-ink">
          Судалгааны дүн
        </h1>
        <span className="size-11 shrink-0" aria-hidden="true" />
      </div>

      {/*
        ★ The card as the client drew it — 2026-09-12, second pass.

        Three rows: the icon and the title with the clone period beside it; the
        date and the state under it; then the audience on the left of a row of
        round controls. What moved from the first attempt is that the controls
        left the top — they are what you do *after* reading the card, so they
        sit at its foot — and the state stopped being a badge, which is a shape
        for a list of twenty surveys rather than for the one on screen.
      */}
      <Card pad="roomy" className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-card bg-cornflower text-cornflower-ink"
          >
            <ClipboardList size={22} />
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-title font-bold leading-tight text-ink">{data.title}</h2>

            <p className="flex flex-wrap items-baseline gap-x-3 text-body tabular-nums text-muted">
              {data.publishedAt || data.closesAt ? (
                <span>
                  {[data.publishedAt, data.closesAt ?? data.closedAt]
                    .filter(Boolean)
                    .map((value) => formatDate(value as string))
                    .join(" - ")}
                </span>
              ) : null}
              <span className={cn("font-medium italic", STATUS_INK[data.status])}>
                {STATUS_LABEL[data.status]}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-body text-muted">
            {data.group?.name ?? "Бүх бүлэг"}
            {results.data ? ` · ${results.data.expectedResponses} хүүхэд` : ""}
          </p>

          {/*
            ★ Round, via `[&_button]` rather than a prop on each: six components
            render their own `Button`, and threading a shape through all of them
            would put one style decision in six files that share nothing else.
          */}
          <div
            data-ui="survey-actions"
            className="ms-auto flex max-w-full items-center gap-2 overflow-x-auto [&_a]:rounded-pill [&_button]:rounded-pill"
          >
            {/*
              ★ The eye comes first, before Хувилах — 2026-09-12, at the
              client's request: "хувилах гэдгийн урд нүдний зураг нэм, тэрэн
              дээр дарахаар эцэг эхэд ямар харагдаж байгааг харуул."
            */}
            {data.questions.length > 0 ? (
              <Button
                size="icon"
                variant={previewing ? "primary" : "secondary"}
                className="shrink-0"
                aria-pressed={previewing}
                aria-label="Эцэг эхэд харагдах байдал"
                title="Эцэг эхэд харагдах байдал"
                onClick={() => setPreviewing((current) => !current)}
              >
                <Eye size={15} aria-hidden="true" />
              </Button>
            ) : null}

            {data.status !== "DRAFT" ? (
              <>
                <CloneButton surveyId={surveyId} schoolYear={data.schoolYear ?? null} />
                <PrintButton />
                <ExportButton surveyId={surveyId} />
              </>
            ) : null}
            {data.status === "DRAFT" ? (
              <PublishButton surveyId={surveyId} />
            ) : data.status === "PUBLISHED" ? (
              <CloseButton surveyId={surveyId} />
            ) : data.status === "CLOSED" ? (
              <ReopenButton surveyId={surveyId} />
            ) : null}
            <DeleteSurveyButton surveyId={surveyId} title={data.title} />
          </div>
        </div>

        {data.purpose?.trim() ? (
          <p className="text-caption text-muted">{data.purpose.trim()}</p>
        ) : null}
      </Card>

      {previewing && data.questions.length > 0 ? (
        <SurveyFormPreview questions={data.questions} />
      ) : null}

      {data.status === "DRAFT" ? (
        <QuestionEditor
          surveyId={surveyId}
          initialQuestions={data.questions}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: qk.survey(surveyId) })}
        />
      ) : (
        <PublishedSurvey surveyId={surveyId} />
      )}
    </div>
  );
}

/** What a parent will actually see, placed before results and editing controls. */
function SurveyFormPreview({ questions }: { questions: SurveyQuestion[] }) {
  return (
    <Card pad="compact" className="flex flex-col gap-3" aria-labelledby="survey-preview-title">
      <SectionHeader id="survey-preview-title" title="Асуулгын харагдац" />
      <div className="flex flex-col gap-2.5">
        {questions.map((question, index) => {
          const options = Array.isArray(question.options)
            ? question.options.filter((option): option is string => typeof option === "string")
            : [];
          return (
            <div key={question.id} className="rounded-card border border-border bg-canvas p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="text-body font-medium leading-snug text-ink">
                  {index + 1}. {question.prompt}
                </p>
                <span className="shrink-0 rounded-pill bg-primary-soft px-2 py-1 text-caption font-medium text-primary">
                  {SURVEY_QUESTION_TYPE_LABEL[question.type]}
                </span>
              </div>
              {options.length > 0 ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {options.map((option) => (
                    <span
                      key={option}
                      className="rounded-control border border-border bg-surface px-2.5 py-2 text-compact text-muted"
                    >
                      {question.type === "CHECKBOX" ? "□" : "○"} {option}
                    </span>
                  ))}
                </div>
              ) : question.type === "RATING" ? (
                <div className="grid grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <span
                      key={value}
                      className="rounded-control border border-border bg-surface py-2 text-center text-compact text-muted"
                    >
                      {value}
                    </span>
                  ))}
                </div>
              ) : question.type === "YES_NO" ? (
                <div className="grid grid-cols-2 gap-1.5 text-center text-compact text-muted">
                  <span className="rounded-control border border-border bg-surface py-2">Тийм</span>
                  <span className="rounded-control border border-border bg-surface py-2">Үгүй</span>
                </div>
              ) : (
                <div
                  className="h-10 rounded-control border border-border bg-surface"
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * A published survey, in three tabs — the client's 2026-09-10 design:
 * Тойм · Асуултууд · Хариултууд.
 *
 * ★ Tabs here where the survey list got two *screens*, and the difference is
 * real.
 *
 * A poll and a questionnaire are two instruments; these three are one dataset
 * read three ways, and a reader moves between them constantly — "60% replied,
 * which question was that, what did they say". Separate routes would put a
 * navigation between glances at the same numbers. The query is shared, so
 * switching costs nothing.
 *
 * ★★ Тойм opens first, and it is the only one that fits on a phone unscrolled.
 *
 * The headline a teacher came for is "did enough people reply" — the rest is
 * what they read after deciding the answer is worth reading. The button at the
 * foot of Тойм goes straight to Хариултууд rather than asking them to find the
 * tab again.
 */
/**
 * A published survey's results.
 *
 * ★ REDESIGN 2026-09-12 — the three tabs became two, in `SurveyResultsView`.
 *
 * Тойм · Асуултууд · Хариултууд answered one question between them and split it
 * three ways: the first was four tiles, the second a list whose rows scrolled
 * the third into view, and the third every chart stacked down one page. The
 * client's own drawing asks it as "Ерөнхий дүн" and "Асуулт тус бүр" — how many
 * replied, then what they said to the question you picked — and the roster of
 * who has not replied moved to a screen of its own.
 *
 * `questionCount` is no longer read here: the results payload carries the
 * questions, and a count passed down beside them was a second source for the
 * same fact.
 */
function PublishedSurvey({ surveyId }: { surveyId: string }) {
  return <SurveyResultsView surveyId={surveyId} />;
}

/**
 * Хэвлэх — the client's fourth action on the survey screen.
 *
 * ★ `window.print()`, not a generated PDF, and that is the right tool here.
 *
 * The report worker exists for documents that must look identical everywhere
 * and be stored — it needs Chromium, a gigabyte of RAM and system Cyrillic
 * fonts (CLAUDE.md §6), and it runs as a queued job with a `ReportJob` row. A
 * teacher printing the results they are looking at wants this page on paper
 * now, which the browser already does perfectly and instantly.
 *
 * The `data-print-hide` attribute on the sidebar, the bottom bar, the desktop
 * header and the chat button — with the `@media print` block in `globals.css`
 * that acts on it — is what makes the output a results sheet rather than a
 * screenshot of an app.
 */
function PrintButton() {
  return (
    <Button
      className="shrink-0"
      size="icon"
      variant="secondary"
      aria-label="Хэвлэх"
      title="Хэвлэх"
      onClick={() => window.print()}
    >
      <Printer size={15} aria-hidden="true" />
    </Button>
  );
}

/**
 * The five-sheet workbook — RFP Module 1.3.
 *
 * A link, not a fetch: the session cookie rides along on a navigation and the
 * browser handles the download itself. `download` is deliberately absent — the
 * server sends the Mongolian filename in `Content-Disposition`, and setting it
 * here would override that with the URL's last segment.
 */
function ExportButton({ surveyId }: { surveyId: string }) {
  return (
    <Button asChild className="shrink-0" size="icon" variant="secondary">
      <a
        href={downloadUrl(`/surveys/${surveyId}/export`)}
        aria-label="Excel татах"
        title="Excel татах"
      >
        <Download size={15} aria-hidden="true" />
      </a>
    </Button>
  );
}

/**
 * Copies the survey into the next wave — RFP Module 1.2.
 *
 * ★ This is how the comparison becomes possible. Retyping the questions in May
 * makes a survey that only looks like September's — different rows, no shared
 * indicator keys, nothing to pair.
 */
/**
 * Хувилах — this questionnaire again, as the next wave.
 *
 * ★ No period picker — 2026-09-12, at the client's instruction ("харшлын
 * судалгаа гэсний ард байгаа хайрцаг хэсэг арилга").
 *
 * It was a select beside the title choosing between "Явцын үнэлгээ" and "Үр
 * дүнгийн үнэлгээ". A copy is filed as the midline, which is what the great
 * majority of copies are; the wave a survey belongs to is editable on the copy
 * itself, which is the screen somebody is already looking at once they have
 * made one.
 */
function CloneButton({ surveyId, schoolYear }: { surveyId: string; schoolYear: string | null }) {
  const toast = useToast();
  const router = useRouter();
  const period = "MIDLINE" as const;

  const clone = useMutation({
    mutationFn: () =>
      mutate(`/surveys/${surveyId}/clone`, surveySchema, {
        method: "POST",
        body: { period, schoolYear },
      }),
    onSuccess: (created) => {
      toast.success("Судалгааг хуулбарлалаа.");
      router.push(`/surveys/${created.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Button
      size="icon"
      variant="secondary"
      disabled={clone.isPending}
      onClick={() => clone.mutate()}
      className="shrink-0"
      aria-label={clone.isPending ? "Хувилж байна…" : "Хувилах"}
      title="Хувилах"
    >
      <Copy size={15} aria-hidden="true" />
    </Button>
  );
}

function PublishButton({ surveyId }: { surveyId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const publish = useMutation({
    mutationFn: () => mutate(`/surveys/${surveyId}/publish`, surveySchema, { method: "POST" }),
    /*
      ★ `invalidateQueries`, not `router.refresh()` — which did nothing here.

      This page reads its survey through `useQuery`, and `router.refresh()`
      re-renders *server* components. Nothing on this screen is one, so
      publishing left the badge reading "Ноорог" and the buttons unchanged
      until a hard reload: the action worked and the screen denied it. Two
      symptoms of one cause, and the toast is the other half of the fix.
    */
    onSuccess: () => {
      toast.success("Судалгааг нийтэллээ. Эцэг эхчүүд бөглөж эхэлнэ.");
      void queryClient.invalidateQueries({ queryKey: qk.survey(surveyId) });
      void queryClient.invalidateQueries({ queryKey: qk.kindergartenSurveys("") });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate()}>
        {publish.isPending ? "Нийтэлж байна…" : "Нийтлэх"}
      </Button>
      {publish.isError ? (
        <p className="text-caption text-danger">{errorMessage(publish.error)}</p>
      ) : null}
    </div>
  );
}

function CloseButton({ surveyId }: { surveyId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const close = useMutation({
    mutationFn: () => mutate(`/surveys/${surveyId}/close`, surveySchema, { method: "POST" }),
    // Same repair as `publish` above — see the note there.
    onSuccess: () => {
      toast.success("Судалгааг хаалаа. Шинэ хариулт хүлээж авахгүй.");
      void queryClient.invalidateQueries({ queryKey: qk.survey(surveyId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Button
      className="shrink-0"
      size="icon"
      variant="secondary"
      disabled={close.isPending}
      onClick={() => close.mutate()}
      aria-label={close.isPending ? "Хааж байна…" : "Хаах"}
      title="Хаах"
    >
      <LockKeyhole size={15} aria-hidden="true" />
    </Button>
  );
}

/**
 * Takes the lock off — 2026-09-12, at the client's request: "цоожоо онгойлгоод
 * нээж болдог бай."
 *
 * ★ A second button rather than a toggle on the first. `POST .../reopen` is its
 * own route for the same reason: a "flip it" press would close a survey a
 * colleague had just re-opened, and the audit row would say the opposite of
 * what happened.
 */
function ReopenButton({ surveyId }: { surveyId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const reopen = useMutation({
    mutationFn: () => mutate(`/surveys/${surveyId}/reopen`, surveySchema, { method: "POST" }),
    onSuccess: () => {
      toast.success("Судалгааг дахин нээлээ. Хариулт хүлээж авна.");
      void queryClient.invalidateQueries({ queryKey: qk.survey(surveyId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Button
      className="shrink-0"
      size="icon"
      variant="secondary"
      disabled={reopen.isPending}
      onClick={() => reopen.mutate()}
      aria-label={reopen.isPending ? "Нээж байна…" : "Дахин нээх"}
      title="Дахин нээх"
    >
      <LockKeyholeOpen size={15} aria-hidden="true" />
    </Button>
  );
}

function DeleteSurveyButton({ surveyId, title }: { surveyId: string; title: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () => mutate(`/surveys/${surveyId}`, surveySchema.optional(), { method: "DELETE" }),
    onSuccess: () => {
      setOpen(false);
      toast.success("Судалгаа устгагдлаа.");
      void queryClient.invalidateQueries({ queryKey: ["surveys"] });
      router.replace("/surveys");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <Button
        className="shrink-0 text-danger hover:text-danger"
        size="icon"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label="Устгах"
        title="Устгах"
      >
        <Trash2 size={15} aria-hidden="true" />
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`“${title}” судалгааг устгах уу?`}
        description="Судалгаа жагсаалтаас хасагдана. Өгсөн хариултууд бүртгэлд хэвээр үлдэнэ."
        confirmLabel="Устгах"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

function QuestionEditor({
  surveyId,
  initialQuestions,
  onSaved,
}: {
  surveyId: string;
  initialQuestions: {
    order: number;
    type: SurveyQuestionType;
    prompt: string;
    options?: string[] | MatrixOptions | null;
    indicatorKey?: string | null;
  }[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [questions, setQuestions] = useState<DraftQuestion[]>(() =>
    initialQuestions.length > 0
      ? initialQuestions
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((q) => ({
            order: q.order,
            type: q.type,
            prompt: q.prompt,
            options: Array.isArray(q.options) && q.options.length > 0 ? [...q.options] : [""],
            rowsText: isMatrix(q.options)
              ? q.options.rows.map((r) => `${r.key}: ${r.label}`).join("\n")
              : "",
            columnsText: isMatrix(q.options)
              ? q.options.columns.map((c) => `${c.value}=${c.label}`).join(", ")
              : "",
            indicatorKey: q.indicatorKey ?? "",
          }))
      : [BLANK_QUESTION],
  );

  const save = useMutation({
    mutationFn: () =>
      mutate(`/surveys/${surveyId}/questions`, surveySchema, {
        method: "PUT",
        body: {
          questions: questions.map((q, index) => ({
            order: index,
            type: q.type,
            prompt: q.prompt,
            options: hasOptionList(q.type)
              ? q.options.map((o) => o.trim()).filter(Boolean)
              : q.type === "MATRIX"
                ? { rows: parseRows(q.rowsText), columns: parseColumns(q.columnsText) }
                : undefined,
            // Empty means "not comparable" — the honest answer for a one-off
            // poll question, and what the API stores as null.
            indicatorKey: q.indicatorKey.trim() || null,
          })),
        },
      }),
    onSuccess: () => {
      toast.success("Асуултууд хадгалагдлаа.");
      onSaved();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /**
   * Why the form cannot be saved yet, or null.
   *
   * ★ Checked here rather than left to the API — which does reject it, with a
   * 400 the teacher meets *after* pressing the button.
   *
   * `prompt: z.string().min(1)` and the CHECKBOX refinement are the server's
   * rules and they stay authoritative; this is the same two rules stated where
   * a person can act on them, which is what a form builder does. Found by a
   * browser test that filled in the choices and left the question blank: the
   * save round-tripped to a validation error for a mistake visible on screen.
   */
  const blocker = ((): string | null => {
    const empty = questions.findIndex((q) => !q.prompt.trim());
    if (empty !== -1) return `${empty + 1}-р асуултын текст хоосон байна.`;

    const noChoice = questions.findIndex(
      (q) => hasOptionList(q.type) && q.options.every((o) => !o.trim()),
    );
    if (noChoice !== -1) return `${noChoice + 1}-р асуултад сонголт оруулна уу.`;

    return null;
  })();

  function update(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((current) => current.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  return (
    <section aria-labelledby="questions-heading">
      <SectionHeader id="questions-heading" title="Асуултууд" />

      <div className="flex flex-col gap-3">
        {questions.map((question, index) => (
          <Card key={index} className="flex flex-col gap-3 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
              <Field
                label={`Асуулт ${index + 1}`}
                error={question.prompt.trim() ? undefined : "Асуултаа бичнэ үү"}
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={question.prompt}
                    onChange={(e) => update(index, { prompt: e.target.value })}
                    placeholder="Жишээ нь: Цэцэрлэгийн үйл ажиллагаанд хэр сэтгэл ханамжтай байна вэ?"
                  />
                )}
              </Field>
              <Field label="Төрөл">
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={question.type}
                    onChange={(e) => update(index, { type: e.target.value as SurveyQuestionType })}
                  >
                    {Object.entries(TYPE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            {/*
              Shown for both option-bearing types. `hasOptionList` is imported
              rather than spelled `=== "CHECKBOX" || === "SINGLE_CHOICE"` here and
              again in the validation below — two copies of the same predicate is
              how one of them misses the next type that carries options.
            */}
            {hasOptionList(question.type) ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-body font-medium text-ink">Сонголтууд</legend>
                {question.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="flex items-center gap-2">
                    {/*
                      ★ The empty circle a parent will actually tap.

                      It is `aria-hidden` decoration here — this row is a text
                      field, not a choice — but it is what makes the editor read
                      as the form it is building rather than as a list of
                      strings. `/children/:id/surveys/:id` draws the real one.
                    */}
                    <span
                      aria-hidden="true"
                      className="size-4 shrink-0 rounded-pill border-2 border-border"
                    />
                    <Input
                      aria-label={`${optionIndex + 1}-р сонголт`}
                      value={option}
                      onChange={(e) =>
                        update(index, {
                          options: question.options.map((o, i) =>
                            i === optionIndex ? e.target.value : o,
                          ),
                        })
                      }
                      placeholder={`Сонголт ${optionIndex + 1}`}
                    />
                    {/* The last remaining row keeps its field: a CHECKBOX with
                        no options is a question nobody can answer. */}
                    {question.options.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`${optionIndex + 1}-р сонголтыг хасах`}
                        onClick={() =>
                          update(index, {
                            options: question.options.filter((_, i) => i !== optionIndex),
                          })
                        }
                        className="grid size-11 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-danger"
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => update(index, { options: [...question.options, ""] })}
                  className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-body font-medium text-primary hover:text-primary-strong"
                >
                  <Plus size={16} aria-hidden="true" />
                  Сонголт нэмэх
                </button>
              </fieldset>
            ) : null}

            {/*
              A matrix — RFP Module 1.1.

              ★ Rows carry a stable `key` beside their label. The key is what an
              answer is stored against and what next year's comparison pairs on,
              so fixing a typo in the label must not orphan the answers already
              given. Typed as `key: Шошго`, one per line.
            */}
            {question.type === "MATRIX" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Мөрүүд"
                  hint="Мөр бүрд нэг: түлхүүр: шошго. Түлхүүр латинаар, жилээс жилд өөрчлөгдөхгүй."
                >
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      rows={4}
                      value={question.rowsText}
                      onChange={(e) => update(index, { rowsText: e.target.value })}
                      placeholder={"speech: Хэл яриа\nmotor: Бие бялдар"}
                    />
                  )}
                </Field>
                <Field label="Багана (үнэлгээ)" hint="Таслалаар: оноо=шошго.">
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      rows={4}
                      value={question.columnsText}
                      onChange={(e) => update(index, { columnsText: e.target.value })}
                      placeholder="1=Сул, 3=Дунд, 5=Сайн"
                    />
                  )}
                </Field>
              </div>
            ) : null}

            {/*
              ★ The field that makes Module 1.2 possible at all.

              Editing a draft's questions deletes and recreates every row, so
              the pairing between September and May cannot rest on a question
              id. This key travels through an edit and through a clone, and is
              what says "these two questions measure the same thing".
            */}
            {question.type !== "TEXT" ? (
              <Field
                label="Үзүүлэлтийн түлхүүр"
                hint="Жил бүрийн харьцуулалтад хэрэглэнэ. Хоосон бол харьцуулагдахгүй."
              >
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={question.indicatorKey}
                    onChange={(e) => update(index, { indicatorKey: e.target.value })}
                    placeholder="social_skills"
                  />
                )}
              </Field>
            ) : null}

            {/*
              ★ Order is the thing this editor could not change until now.

              `order: index` is written on save, so the array's position *is*
              the question number a parent sees — and there was no way to move
              one. Rewriting three prompts to swap two questions is the kind of
              work a pair of arrows removes entirely.

              Buttons rather than drag: this list is edited on a phone as often
              as on a desktop, and a drag handle at 375px is a scroll gesture
              fighting a reorder gesture.
            */}
            <div className="flex flex-wrap items-center gap-1 border-t border-border-soft pt-3">
              <button
                type="button"
                aria-label={`${index + 1}-р асуултыг дээш`}
                disabled={index === 0}
                onClick={() => setQuestions((current) => swap(current, index, index - 1))}
                className="grid size-11 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink disabled:text-faint disabled:hover:bg-transparent"
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`${index + 1}-р асуултыг доош`}
                disabled={index === questions.length - 1}
                onClick={() => setQuestions((current) => swap(current, index, index + 1))}
                className="grid size-11 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink disabled:text-faint disabled:hover:bg-transparent"
              >
                <ArrowDown size={16} aria-hidden="true" />
              </button>

              {questions.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setQuestions((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Устгах
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setQuestions((current) => [...current, { ...BLANK_QUESTION, order: current.length }])
          }
        >
          Асуулт нэмэх
        </Button>
      </div>

      <FormError message={save.isError ? errorMessage(save.error) : null} />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={save.isPending || Boolean(blocker)} onClick={() => save.mutate()}>
          {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
        </Button>
        {/* `aria-live`, so a keyboard user who tabs to a disabled button is
            told why rather than finding a dead control. */}
        {blocker ? (
          <p aria-live="polite" className="text-body text-muted">
            {blocker}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Two questions traded, without mutating the array React is rendering. */
function swap<T>(items: T[], a: number, b: number): T[] {
  if (b < 0 || b >= items.length) return items;
  const next = [...items];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}

const BLANK_QUESTION: DraftQuestion = {
  order: 0,
  type: "RATING",
  prompt: "",
  options: [""],
  rowsText: "",
  columnsText: "",
  indicatorKey: "",
};

function isMatrix(options: unknown): options is MatrixOptions {
  return (
    typeof options === "object" &&
    options !== null &&
    !Array.isArray(options) &&
    Array.isArray((options as MatrixOptions).rows)
  );
}

/** `speech: Хэл яриа`, one per line. A line with no colon is skipped. */
function parseRows(text: string): { key: string; label: string }[] {
  return text
    .split("\n")
    .map((line) => {
      const at = line.indexOf(":");
      if (at === -1) return null;

      const key = line.slice(0, at).trim();
      const label = line.slice(at + 1).trim();

      return key && label ? { key, label } : null;
    })
    .filter((row): row is { key: string; label: string } => row !== null);
}

/** `1=Сул, 3=Дунд, 5=Сайн`. */
function parseColumns(text: string): { value: number; label: string }[] {
  return text
    .split(",")
    .map((part) => {
      const at = part.indexOf("=");
      if (at === -1) return null;

      const value = Number(part.slice(0, at).trim());
      const label = part.slice(at + 1).trim();

      return Number.isFinite(value) && label ? { value, label } : null;
    })
    .filter((column): column is { value: number; label: string } => column !== null);
}
