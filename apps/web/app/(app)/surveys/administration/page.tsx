"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { BackButton } from "@/components/ui/back-button";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatDate, formatDayMonth } from "@/lib/format";
import { TableShell, Td, Th } from "@/components/ui/table";
import { SURVEY_CATEGORY_META } from "@/lib/survey-meta";
import { cn } from "@/lib/utils";
import {
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
      <header className="flex items-center gap-3 !bg-transparent !backdrop-blur-none">
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
        ★ A table, the same columns as «Судалгаа» and «Санал асуулга» — client,
        2026-10-04: "нөгөө хэсэгтэй адил хүснэгтэн болго". It replaces the
        2026-09-25 card rows. Read-only, so no ⋯ column; an unread survey keeps
        its «Шинэ», the same signal the bell uses.
      */}
      {surveys.data && surveys.data.items.length > 0 ? (
        /*
          ★ No Бүлэг column, and the title gets the room — 2026-10-07, the
          client, as on «Бүлгийн судалгаа» above it.
        */
        <TableShell caption="Удирдлагын судалгаа" minWidth="min-w-[700px]">
          <thead>
            <tr>
              <Th className="min-w-[16rem]">Гарчиг</Th>
              <Th>Ангилал</Th>
              <Th>Судалгаа авсан</Th>
              <Th numeric>Хариулт</Th>
              <Th numeric>Хувь</Th>
              <Th numeric>Огноо</Th>
            </tr>
          </thead>
          <tbody>
            {surveys.data.items.map((survey) => {
              const percent =
                survey.expectedCount > 0
                  ? Math.round((survey.respondedCount / survey.expectedCount) * 100)
                  : 0;
              return (
                <tr key={survey.id}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <Link
                        href={`/surveys/administration/${survey.id}`}
                        className={cn(
                          "text-ink hover:text-primary hover:underline",
                          survey.isRead ? "font-medium" : "font-bold",
                        )}
                      >
                        {survey.title}
                      </Link>
                      {!survey.isRead ? (
                        <span className="shrink-0 rounded-pill bg-danger px-2 text-caption font-bold leading-5 text-white">
                          Шинэ
                        </span>
                      ) : null}
                    </span>
                  </Td>
                  <Td className="text-muted">{SURVEY_CATEGORY_META[survey.category].label}</Td>
                  <Td className="whitespace-nowrap text-caption text-muted">Удирдлага</Td>
                  <Td numeric className="text-muted">
                    {survey.respondedCount} / {survey.expectedCount}
                  </Td>
                  <Td numeric className="font-medium text-ink">
                    {percent}%
                  </Td>
                  <Td numeric className="whitespace-nowrap text-caption text-muted">
                    <span
                      title={formatDate(survey.closedAt ?? survey.publishedAt ?? survey.createdAt)}
                    >
                      {formatDayMonth(survey.closedAt ?? survey.publishedAt ?? survey.createdAt)}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      ) : null}

      {surveys.data ? (
        <Pagination page={page} totalPages={surveys.data.totalPages} onPage={setPage} />
      ) : null}
    </div>
  );
}
