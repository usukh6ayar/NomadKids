"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
    <div className="flex flex-col gap-5 lg:gap-7">
      <PageHeader
        title="Улирлын тайлан"
        lede={`${child.data!.lastName} ${child.data!.firstName}`}
      />

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

          {termId ? <ReportBody childId={childId} termId={termId} isStaff={isStaff} /> : null}
        </>
      )}
    </div>
  );
}

function ReportBody({
  childId,
  termId,
  isStaff,
}: {
  childId: string;
  termId: string;
  isStaff: boolean;
}) {
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

  // Seeded from the server, and re-seeded when the term changes — otherwise
  // switching terms would show the previous term's text in the new one's form.
  useEffect(() => {
    setForm({
      strengths: report.data?.strengths ?? "",
      needsSupport: report.data?.needsSupport ?? "",
      nextGoals: report.data?.nextGoals ?? "",
      adviceForParents: report.data?.adviceForParents ?? "",
    });
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
        <p role="status" className="rounded-[12px] bg-mint px-3.5 py-2.5 text-sm text-mint-ink">
          Энэ тайлан баталгаажсан тул засах боломжгүй. Эцэг эх үүнийг харж байна.
        </p>
        <ReadOnlyReport report={report.data!} />
      </div>
    );
  }

  return (
    <Card className="px-4 py-4 sm:px-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!save.isPending) save.mutate();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <FormError message={save.isError ? errorMessage(save.error) : null} />
        <FormError message={finalize.isError ? errorMessage(finalize.error) : null} />

        {save.isSuccess ? (
          <p role="status" className="rounded-[12px] bg-mint px-3.5 py-2.5 text-sm text-mint-ink">
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
          <p className="text-xs text-muted">Баталгаажуулахын өмнө ноорогоо нэг удаа хадгална уу.</p>
        ) : null}
      </form>
    </Card>
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
          <Card className="px-4 py-3.5">
            {/* Preserves the line breaks a teacher typed. */}
            <p className="whitespace-pre-wrap text-sm text-ink">{section.body}</p>
          </Card>
        </section>
      ))}
    </div>
  );
}
