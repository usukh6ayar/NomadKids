"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { childDetailSchema, termReportSchema, termSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { ChildObservations } from "@/components/child/child-observations";
import { ReportNotePicker } from "@/components/assessment/report-note-picker";
import { cn } from "@/lib/utils";

/**
 * The term report — a teacher's narrative about one child, one term.
 *
 * ★ Phase 1's tenth acceptance item, with no screen until now.
 *
 * `GET/PUT /children/:id/term-report` and `.../finalize` have been in the API
 * since Phase 8, and `qk.childTermReport` has been sitting in the query keys
 * with nothing calling it. The PDF generator can render one; nobody could write
 * one.
 *
 * ★ The same route serves staff and families, because the API already
 * distinguishes them.
 *
 * `findTermReport` filters a guardian to `status: FINAL` — a draft is the
 * teacher's working text and a family must not read it half-written. So a
 * parent opening this URL gets the finished report or an empty state, never a
 * form, and that is enforced server-side rather than by hiding a button.
 *
 * ★ A finalised report is read-only, and the API enforces it.
 *
 * `PUT` answers 409 once the report is FINAL, so this screen not offering the
 * form is a courtesy rather than the guarantee — "final" that could change
 * underneath the family who read it would not be final. Finalising twice is a
 * no-op on the server, so a double-click cannot move the timestamp the family
 * were told about.
 */
const termsSchema = z.array(termSchema);

export default function TermReportPage() {
  const params = useParams<{ childId: string }>();
  return <TermReport childId={params.childId} />;
}

function TermReport({ childId }: { childId: string }) {
  const { hasRole, primaryKindergartenId } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");
  const [termId, setTermId] = useState("");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  const terms = useQuery({
    queryKey: qk.adminTerms(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/terms`, termsSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  const termItems = terms.data ?? [];

  // Default to the term today falls inside, and to the last one otherwise —
  // which in June is the term a teacher is actually writing up.
  useEffect(() => {
    if (termId || termItems.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const current = termItems.find(
      (term) => (term.startsOn ?? "") <= today && today <= (term.endsOn ?? ""),
    );
    setTermId((current ?? termItems[termItems.length - 1]!).id);
  }, [termItems, termId]);

  if (child.isLoading || terms.isLoading) return <LoadingState rows={4} />;
  if (child.isError) return <ErrorState description={errorMessage(child.error)} />;

  return (
    <div className="page-band">
      <PageHeader title="Улирлын тайлан" />

      {termItems.length === 0 ? (
        <EmptyState
          title="Улирал бүртгэгдээгүй байна"
          description={
            isStaff
              ? "Улирлын тайлан улиралд харьяалагддаг. Захирал эхлээд улирал үүсгэнэ."
              : "Улирал тохируулсны дараа тайлан харагдана."
          }
        />
      ) : (
        <>
          <Field label="Улирал">
            {({ id }) => (
              <Select
                id={id}
                value={termId}
                onChange={(e) => setTermId(e.target.value)}
                className="max-w-[280px]"
              >
                {termItems.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.number}. {term.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {termId ? (
            <ReportBody
              childId={childId}
              term={termItems.find((row) => row.id === termId)!}
              isStaff={isStaff}
            />
          ) : null}

          {/*
            ★ Ажиглалт / Дүгнэлт at the foot — the client's 2026-09-11 ask.

            "Доод хэсэгт ажиглалт дүгнэлт гэсэн 2 хэсэг нэмээд. Ажиглалт дээр
            дарахаар бичсэн ажиглалтууд. Харин дүгнэлтээр дарахаар нэгдсэн
            тайлан бичсэн дүгнэлтүүд гарч ирнэ." One is the raw material, the
            other is what was made from it, and having both under the form is
            what lets a teacher check their summary against the term.
          */}
          <ReportArchive childId={childId} terms={termItems} isStaff={isStaff} />
        </>
      )}
    </div>
  );
}

function ReportBody({
  childId,
  term,
  isStaff,
}: {
  childId: string;
  term: z.infer<typeof termSchema>;
  isStaff: boolean;
}) {
  const termId = term.id;
  const queryClient = useQueryClient();

  const report = useQuery({
    queryKey: qk.termReport(childId, termId),
    queryFn: () => get(`/children/${childId}/term-report?termId=${termId}`, termReportSchema),
  });

  const [form, setForm] = useState({
    strengths: "",
    needsSupport: "",
    nextGoals: "",
    adviceForParents: "",
  });

  /**
   * The notes this report cites.
   *
   * ★ Held here rather than inside the picker, because it is part of the form:
   * it is saved by the same button as the four paragraphs, and a selection that
   * lived in the picker would be lost every time the strand filter remounted it.
   */
  const [citedIds, setCitedIds] = useState<string[]>([]);

  // Seeded from the server, and re-seeded when the term changes — otherwise
  // switching terms would show the previous term's text in the new one's form.
  useEffect(() => {
    setForm({
      strengths: report.data?.strengths ?? "",
      needsSupport: report.data?.needsSupport ?? "",
      nextGoals: report.data?.nextGoals ?? "",
      adviceForParents: report.data?.adviceForParents ?? "",
    });
    setCitedIds((report.data?.observations ?? []).map((row) => row.id));
  }, [report.data, termId]);

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/term-report`, termReportSchema, {
        method: "PUT",
        body: {
          termId,
          strengths: form.strengths.trim() || null,
          needsSupport: form.needsSupport.trim() || null,
          nextGoals: form.nextGoals.trim() || null,
          adviceForParents: form.adviceForParents.trim() || null,
          // Always sent, so unticking the last note is expressible. The API
          // treats an omitted field as "leave the citation alone".
          observationIds: citedIds,
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.termReport(childId, termId) }),
  });

  const finalize = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/term-report/finalize`, z.unknown(), {
        method: "POST",
        body: { termId },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.termReport(childId, termId) }),
  });

  if (report.isLoading) return <LoadingState rows={3} />;
  if (report.isError) return <ErrorState description={errorMessage(report.error)} />;

  const isFinal = report.data?.status === "FINAL";
  const errors = fieldErrors(save.error);

  // A guardian sees only a finalised report; the API already refuses them a
  // draft, so an empty answer here means "not written yet, or not finished".
  if (!isStaff) {
    if (!isFinal) {
      return (
        <EmptyState
          title="Тайлан хараахан бэлэн болоогүй"
          description="Багш улирлын тайланг бичиж дуусгасны дараа энд харагдана."
        />
      );
    }
    return <ReadOnlyReport report={report.data!} />;
  }

  if (isFinal) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-control bg-mint px-3.5 py-2.5 text-body text-mint-ink">
          Энэ тайлан баталгаажсан тул засах боломжгүй. Эцэг эх үүнийг харж байна.
        </p>
        <ReadOnlyReport report={report.data!} />
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!save.isPending) save.mutate();
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      {/*
        ★ The notes first, then the conclusion drawn from them.

        The client's order and the working order both: a teacher reads the term
        back, ticks what they are about to summarise, and writes. Putting the
        paragraphs first would ask for the conclusion before the evidence.

        `key` on the term — see the picker's own note about the strand filter.
      */}
      <ReportNotePicker
        key={termId}
        childId={childId}
        term={term}
        selected={citedIds}
        onChange={setCitedIds}
        disabled={save.isPending}
      />

      <Card pad="roomy" className="flex flex-col gap-4">
        <FormError message={save.isError ? errorMessage(save.error) : null} />
        <FormError message={finalize.isError ? errorMessage(finalize.error) : null} />

        {save.isSuccess ? (
          <p
            role="status"
            className="rounded-control bg-mint px-3.5 py-2.5 text-body text-mint-ink"
          >
            Ноорог хадгалагдлаа.
          </p>
        ) : null}

        <ReportField
          label="Давуу тал"
          hint="Энэ улиралд хүүхэд юунд онцгой сайн байсан бэ."
          error={errors.strengths}
          value={form.strengths}
          onChange={(v) => setForm((f) => ({ ...f, strengths: v }))}
        />
        <ReportField
          label="Дэмжлэг шаардлагатай"
          hint="Юун дээр илүү дадлага хэрэгтэй байгаа вэ."
          error={errors.needsSupport}
          value={form.needsSupport}
          onChange={(v) => setForm((f) => ({ ...f, needsSupport: v }))}
        />
        <ReportField
          label="Дараагийн зорилт"
          error={errors.nextGoals}
          value={form.nextGoals}
          onChange={(v) => setForm((f) => ({ ...f, nextGoals: v }))}
        />
        <ReportField
          label="Эцэг эхэд өгөх зөвлөмж"
          hint="Гэртээ юу хийвэл дэмжлэг болох вэ."
          error={errors.adviceForParents}
          value={form.adviceForParents}
          onChange={(v) => setForm((f) => ({ ...f, adviceForParents: v }))}
        />

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="submit" variant="secondary" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Ноорог хадгалах"}
          </Button>
          {/*
            Confirmed, because it is one-way: finalising publishes the text to
            the family and this screen stops offering the form afterwards.
          */}
          <Button
            type="button"
            disabled={finalize.isPending || !report.data?.exists}
            onClick={() => {
              if (window.confirm("Баталгаажуулсны дараа засах боломжгүй. Үргэлжлүүлэх үү?")) {
                finalize.mutate();
              }
            }}
          >
            {finalize.isPending ? "Баталгаажуулж байна…" : "Баталгаажуулах"}
          </Button>
        </div>

        {!report.data?.exists ? (
          <p className="text-caption text-muted">
            Баталгаажуулахын өмнө ноорогоо нэг удаа хадгална уу.
          </p>
        ) : null}
      </Card>
    </form>
  );
}

function ReportField({
  label,
  hint,
  error,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <Textarea
          id={id}
          aria-describedby={describedBy}
          invalid={invalid}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

function ReadOnlyReport({ report }: { report: z.infer<typeof termReportSchema> }) {
  const sections = [
    { title: "Давуу тал", body: report.strengths },
    { title: "Дэмжлэг шаардлагатай", body: report.needsSupport },
    { title: "Дараагийн зорилт", body: report.nextGoals },
    { title: "Эцэг эхэд өгөх зөвлөмж", body: report.adviceForParents },
  ].filter((section) => section.body);

  if (sections.length === 0) {
    return <EmptyState title="Тайлан хоосон байна" />;
  }

  return (
    <div className="flex flex-col gap-4">
      {report.author ? (
        <Badge tone="sky">
          {report.author.lastName} {report.author.firstName}
        </Badge>
      ) : null}

      {sections.map((section) => (
        <section key={section.title}>
          <SectionHeader title={section.title} as="h3" />
          <Card pad="compact">
            {/* Preserves the line breaks a teacher typed. */}
            <p className="whitespace-pre-wrap text-body text-ink">{section.body}</p>
          </Card>
        </section>
      ))}
    </div>
  );
}

/**
 * Ажиглалт · Дүгнэлт — the term's raw material and what was made from it.
 *
 * ★ Two tabs at the foot of the report, 2026-09-11 at the client's request.
 *
 * "Ажиглалт дээр дарахаар бичсэн ажиглалтууд. Харин дүгнэлтээр дарахаар нэгдсэн
 * тайлан бичсэн дүгнэлтүүд гарч ирнэ." The form above is about one term; this
 * is the child's whole record on both sides of it, which is what a teacher
 * checks a summary against.
 *
 * ★★ The Дүгнэлт tab reads one report per term rather than a list endpoint.
 *
 * There is no `GET /children/:id/term-reports`, and a kindergarten's school year
 * has two to four terms — so this is a handful of parallel reads with a hard
 * ceiling, not an unbounded fan-out. `useQueries` shares the same cache entries
 * the form above already fills, so switching terms costs nothing twice.
 *
 * ★★★ A guardian sees the same two tabs, and the API decides what is in them:
 * `findTermReport` filters them to `FINAL`, and the notes list to those marked
 * visible. Neither is hidden here.
 */
function ReportArchive({
  childId,
  terms,
  isStaff,
}: {
  childId: string;
  terms: z.infer<typeof termSchema>[];
  isStaff: boolean;
}) {
  const [tab, setTab] = useState<"notes" | "reports">("notes");

  return (
    <section aria-label="Ажиглалт ба дүгнэлт" className="flex flex-col gap-3">
      <div role="tablist" aria-label="Ажиглалт ба дүгнэлт" className="flex gap-2">
        <ArchiveTab current={tab} value="notes" onSelect={setTab}>
          Ажиглалт
        </ArchiveTab>
        <ArchiveTab current={tab} value="reports" onSelect={setTab}>
          Дүгнэлт
        </ArchiveTab>
      </div>

      {tab === "notes" ? (
        <div id="archive-notes" role="tabpanel" aria-label="Ажиглалт">
          <ChildObservations childId={childId} isStaff={isStaff} />
        </div>
      ) : (
        <div id="archive-reports" role="tabpanel" aria-label="Дүгнэлт">
          <WrittenReports childId={childId} terms={terms} />
        </div>
      )}
    </section>
  );
}

function ArchiveTab({
  current,
  value,
  onSelect,
  children,
}: {
  current: "notes" | "reports";
  value: "notes" | "reports";
  onSelect: (next: "notes" | "reports") => void;
  children: string;
}) {
  const active = current === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={value === "notes" ? "archive-notes" : "archive-reports"}
      onClick={() => onSelect(value)}
      className={cn(
        "min-h-[44px] rounded-pill px-4 text-body font-medium transition-colors",
        active
          ? "bg-primary text-primary-ink"
          : "bg-surface text-muted hover:bg-canvas hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Every term's conclusion, in term order, with what each one cites. */
function WrittenReports({
  childId,
  terms,
}: {
  childId: string;
  terms: z.infer<typeof termSchema>[];
}) {
  const results = useQueries({
    queries: terms.map((term) => ({
      queryKey: qk.termReport(childId, term.id),
      queryFn: () => get(`/children/${childId}/term-report?termId=${term.id}`, termReportSchema),
    })),
  });

  if (results.some((row) => row.isLoading)) return <LoadingState rows={3} />;

  const written = terms
    .map((term, index) => ({ term, report: results[index]?.data }))
    // `exists: false` is the API's "nothing here" shape for both a missing
    // report and a draft a guardian may not read — see `getTermReport`.
    .filter((row) => row.report && row.report.exists !== false);

  if (written.length === 0) {
    return (
      <EmptyState
        title="Дүгнэлт бичигдээгүй байна"
        description="Улирал сонгоод дээрх маягтад дүгнэлтээ бичнэ үү."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {written.map(({ term, report }) => (
        <Card key={term.id} pad="roomy" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-body font-semibold text-ink">
              {term.number}. {term.name}
            </h3>
            <Badge tone={report!.status === "FINAL" ? "mint" : "sun"}>
              {report!.status === "FINAL" ? "Баталгаажсан" : "Ноорог"}
            </Badge>
          </div>

          {report!.observations.length > 0 ? (
            <p className="text-caption text-muted">
              {report!.observations.length} тэмдэглэл дээр үндэслэсэн
            </p>
          ) : null}

          <ReadOnlyReport report={report!} />
        </Card>
      ))}
    </div>
  );
}
