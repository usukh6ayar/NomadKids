"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { SURVEY_KIND_LABEL } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { BackButton } from "@/components/ui/back-button";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";
import { SURVEY_KIND_TEXT } from "@/components/survey/survey-hub-parts";
import { cn } from "@/lib/utils";
import {
  ADMINISTRATION_AUTHOR,
  administrationSurveysSchema,
  useReadsAdministrationSurveys,
} from "@/lib/administration-surveys";

const PAGE_SIZE = 20;

/**
 * Удирдлагын судалгаа — the administration's surveys, for a teacher.
 * Client, 2026-09-17.
 *
 * ★ Read-only — nothing a teacher can change, because the survey is not
 * theirs. The list is who asked, when, what, and which kind; how many have
 * answered is on the survey's own page.
 */
export default function AdministrationSurveysPage() {
  return (
    <RequireRole roles={["TEACHER"]}>
      <AdministrationSurveys />
    </RequireRole>
  );
}

function AdministrationSurveys() {
  const { enabled, kindergartenId } = useReadsAdministrationSurveys();
  const [page, setPage] = useState(1);

  const surveys = useQuery({
    queryKey: qk.administrationSurveys(kindergartenId, page),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/surveys/administration?page=${page}&pageSize=${PAGE_SIZE}`,
        administrationSurveysSchema,
      ),
    enabled,
  });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <BackButton href="/surveys/parents" />
        <h1 className="min-w-0 text-title font-bold leading-heading text-ink">
          Удирдлагын судалгаа
        </h1>
      </header>

      {surveys.isLoading ? <LoadingState rows={3} /> : null}
      {surveys.isError ? <ErrorState description={errorMessage(surveys.error)} /> : null}

      {surveys.data && surveys.data.items.length === 0 ? (
        <EmptyState
          title="Удирдлагаас судалгаа ирээгүй байна"
          description="Цэцэрлэгийн захиргаа судалгаа нийтлэхэд энд харагдаж, хонхонд мэдэгдэл ирнэ."
        />
      ) : null}

      {/*
        ★ The client's 2026-09-25 drawing: who asked, small and italic in the
        corner, the date opposite, the title, a chevron, and the kind in its
        own colour underneath — the families' hub's rows, with the author in
        the corner they leave empty. An unread one keeps its "Шинэ", the same
        signal the bell uses; nothing else is on the row.
      */}
      <ul className="flex flex-col gap-3">
        {surveys.data?.items.map((survey) => (
          <li key={survey.id}>
            <Link
              href={`/surveys/administration/${survey.id}`}
              className="group grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-card border border-border-soft bg-surface px-3 py-2 shadow-sm transition-all hover:border-primary hover:shadow-md sm:px-4"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-caption italic text-primary/70 sm:text-body">
                  {ADMINISTRATION_AUTHOR}
                </span>
                {!survey.isRead ? (
                  <span className="shrink-0 rounded-pill bg-danger px-2 text-caption font-bold leading-5 text-white">
                    Шинэ
                  </span>
                ) : null}
              </span>
              <span className="text-body tabular-nums text-ink">
                {formatDate(survey.publishedAt ?? survey.createdAt)}
              </span>
              <span
                className={cn(
                  "min-w-0 py-2 ps-4 text-lead leading-snug text-ink transition-colors group-hover:text-primary sm:ps-12",
                  survey.isRead ? "font-semibold" : "font-bold",
                )}
              >
                {survey.title}
              </span>
              <ChevronRight
                size={20}
                aria-hidden="true"
                className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
              />
              <span
                className={cn(
                  "col-span-2 justify-self-end text-caption italic sm:text-body",
                  SURVEY_KIND_TEXT[survey.kind],
                )}
              >
                {SURVEY_KIND_LABEL[survey.kind]}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {surveys.data ? (
        <Pagination page={page} totalPages={surveys.data.totalPages} onPage={setPage} />
      ) : null}
    </div>
  );
}
