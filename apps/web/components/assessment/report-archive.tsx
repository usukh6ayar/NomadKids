"use client";

import { useQueries } from "@tanstack/react-query";
import { z } from "zod";
import { termReportSchema, termSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { formatDayMonthLong, fullName, capitalize } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A term report as a family reads it, and the tabs and list around it.
 *
 * ★ Lifted out of `children/[childId]/term-report/page.tsx` on 2026-09-14,
 * unchanged, because a second screen now asks the same question.
 *
 * The client's ask for the record hub — "багш бичсэн ажиглалт, тэмдэглэл,
 * ярилцлагаасаа сонгон дүгнэлт бичнэ" — is the Дүгнэлт half of the pair the
 * term report screen already draws. Copying it would leave two lists of the
 * same rows to drift apart, and the one nobody edits is the one a teacher is
 * looking at.
 */

/** One pill in an Ажиглалт · Дүгнэлт tab strip. */
export function ArchiveTab({
  active,
  controls,
  onSelect,
  className,
  children,
}: {
  active: boolean;
  /** The id of the panel this tab opens. */
  controls: string;
  onSelect: () => void;
  /** For a strip that fills its row rather than sitting at its own width. */
  className?: string;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onSelect}
      className={cn(
        "min-h-[44px] rounded-pill px-4 text-body font-medium transition-colors",
        active
          ? "bg-primary text-primary-ink"
          : "bg-surface text-muted hover:bg-canvas hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function ReadOnlyReport({ report }: { report: z.infer<typeof termReportSchema> }) {
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
      {report.author ? <Badge tone="sky">{fullName(report.author)}</Badge> : null}

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
 * Every term's conclusion, in term order, with what each one cites.
 *
 * ★ One report per term rather than a list endpoint.
 *
 * There is no `GET /children/:id/term-reports`, and a kindergarten's school
 * year has two to four terms — so this is a handful of parallel reads with a
 * hard ceiling, not an unbounded fan-out. `useQueries` shares the same cache
 * entries the term report form fills, so switching terms costs nothing twice.
 *
 * ★★ A guardian sees the same list, and the API decides what is in it:
 * `findTermReport` filters them to `FINAL`. Nothing is hidden here.
 */
export function WrittenReports({
  childId,
  terms,
  emptyDescription = "Улирал сонгоод дээрх маягтад дүгнэлтээ бичнэ үү.",
  showCitedNotes = false,
}: {
  childId: string;
  terms: z.infer<typeof termSchema>[];
  /** What to do next, which differs by the screen this list sits on. */
  emptyDescription?: string;
  /** Name the notes each conclusion was written from, not just how many. */
  showCitedNotes?: boolean;
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
    return <EmptyState title="Дүгнэлт бичигдээгүй байна" description={emptyDescription} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {written.map(({ term, report }) => (
        <Card key={term.id} pad="roomy" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-body font-semibold text-ink">
              {term.number}. {capitalize(term.name)}
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

          {/*
            ★ The citation by name, on the screen where the notes themselves
            live.

            A teacher reading a conclusion beside their own records asks which
            of them it was written from, and a count cannot answer that. The
            term report screen keeps the count: it draws every note of the term
            in the tab next door, so naming four of forty there adds a list
            without adding an answer.
          */}
          {showCitedNotes && report!.observations.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {report!.observations.map((note) => (
                <li
                  key={note.id}
                  className="rounded-pill bg-canvas px-2.5 py-1 text-caption text-muted"
                >
                  {formatDayMonthLong(note.observedOn)}
                  {note.type?.name ? ` · ${note.type.name}` : ""}
                  {note.activityName ? ` · ${note.activityName}` : ""}
                </li>
              ))}
            </ul>
          ) : null}

          <ReadOnlyReport report={report!} />
        </Card>
      ))}
    </div>
  );
}
