"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { esisResourceReadSchema, type EsisResourceKey } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { EsisRowValues, esisSampleColumns } from "@/components/esis/esis-rows";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

/**
 * Хөтөлбөр → Үе шат → Төлөвлөгөө → Хичээл, as one chain.
 *
 * ★ **Why this is not four `EsisDataPanel`s.** Each service takes the id the
 * one above it returned: `program/stage/list/:programOfStudyId`,
 * `…/plan/list/:programOfStudyId/:programStageId`, and the course list needs
 * all three. Four independent panels can only ask the reader to *type* those
 * ids, which is what the first version of `/admin/curriculum` did — the plan
 * and course panels were standalone, pre-filled in demo mode with `501`, `12`
 * and `780`. That is a hardcoded id wearing a form field, and it breaks the
 * moment a real token returns a programme numbered anything else.
 *
 * So the selection *is* the parameter. Picking a programme reads its stages;
 * picking a stage reads its plans; picking a plan reads its courses. Nothing
 * below a level exists until that level has been chosen, and clearing a level
 * clears everything under it — otherwise a stage from programme A could be
 * shown under programme B.
 *
 * ★★ One read per selection, never per row. Each level fetches once when its
 * parent id changes; `staleTime: Infinity` and the disabled refetches match
 * every other ESIS read in this product, for the same reason — each of these
 * is an outbound call to the ministry and an `AuditLog` VIEW row.
 */

interface Level {
  key: EsisResourceKey;
  title: string;
  /** The row field that names the record, and the one that identifies it. */
  labelField: string;
  idField: string;
  empty: string;
}

const LEVELS: Level[] = [
  {
    key: "programs",
    title: "Хөтөлбөр",
    labelField: "programOfStudyName",
    idField: "programOfStudyId",
    empty: "ЭСИС энэ цэцэрлэгт хөтөлбөр буцаасангүй.",
  },
  {
    key: "programStages",
    title: "Үе шат",
    labelField: "programStageName",
    idField: "programStageId",
    empty: "Энэ хөтөлбөрт үе шат бүртгэгдээгүй байна.",
  },
  {
    key: "programPlans",
    title: "Сургалтын төлөвлөгөө",
    labelField: "programPlanName",
    idField: "programPlanId",
    empty: "Энэ үе шатанд төлөвлөгөө бүртгэгдээгүй байна.",
  },
];

const COURSES: Level = {
  key: "programCourses",
  title: "Хичээл",
  labelField: "courseName",
  idField: "courseId",
  empty: "Энэ төлөвлөгөөнд хичээл бүртгэгдээгүй байна.",
};

/** One level's read. Disabled until every id above it has been chosen. */
function useLevel(resource: EsisResourceKey, params: Record<string, string>, enabled: boolean) {
  const { primaryKindergartenId } = useSession();
  const query = new URLSearchParams({ resource, ...params });

  return useQuery({
    queryKey: qk.esisResource(primaryKindergartenId ?? "none", resource, query.toString()),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis/resource?${query}`, esisResourceReadSchema),
    enabled: enabled && Boolean(primaryKindergartenId),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    retry: false,
  });
}

export function EsisCurriculumChain() {
  const [program, setProgram] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);

  const programs = useLevel("programs", {}, true);
  const stages = useLevel(
    "programStages",
    program ? { programOfStudyId: program } : {},
    Boolean(program),
  );
  const plans = useLevel(
    "programPlans",
    program && stage ? { programOfStudyId: program, programStageId: stage } : {},
    Boolean(program && stage),
  );
  const courses = useLevel(
    "programCourses",
    program && stage && plan
      ? { programOfStudyId: program, programStageId: stage, programPlanId: plan }
      : {},
    Boolean(program && stage && plan),
  );

  /* Clearing a level clears everything under it — see the note above. */
  const pickProgram = (id: string) => {
    setProgram((current) => (current === id ? null : id));
    setStage(null);
    setPlan(null);
  };
  const pickStage = (id: string) => {
    setStage((current) => (current === id ? null : id));
    setPlan(null);
  };
  const pickPlan = (id: string) => setPlan((current) => (current === id ? null : id));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <SelectLevel
          level={LEVELS[0]!}
          query={programs}
          selected={program}
          onSelect={pickProgram}
          waitingFor={null}
        />
        <SelectLevel
          level={LEVELS[1]!}
          query={stages}
          selected={stage}
          onSelect={pickStage}
          waitingFor={program ? null : "Эхлээд хөтөлбөрөө сонгоно уу."}
        />
        <SelectLevel
          level={LEVELS[2]!}
          query={plans}
          selected={plan}
          onSelect={pickPlan}
          waitingFor={stage ? null : "Эхлээд үе шатаа сонгоно уу."}
        />
      </div>

      {/*
        The leaf. Courses are read, not chosen, so they get the full record
        table every other ESIS surface uses rather than a fourth picker.
      */}
      <section aria-label={COURSES.title}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-ink">{COURSES.title}</h3>
          {courses.data?.status === "SUCCEEDED" ? (
            <Badge tone="sky">{courses.data.count} бичлэг</Badge>
          ) : null}
        </div>
        {!plan ? (
          <Card pad="compact">
            <p className="text-body text-muted">Эхлээд төлөвлөгөөгөө сонгоно уу.</p>
          </Card>
        ) : courses.isFetching ? (
          <LoadingState rows={3} />
        ) : courses.isError ? (
          <Card pad="compact" tone="peach">
            <p className="text-body text-ink">{errorMessage(courses.error)}</p>
          </Card>
        ) : courses.data?.status === "FAILED" ? (
          <Card pad="compact" tone="peach">
            <p className="text-body font-semibold text-ink">ЭСИС хариу өгсөнгүй</p>
            <p className="mt-1 text-caption text-muted">{courses.data.errorCode}</p>
          </Card>
        ) : !courses.data || courses.data.rows.length === 0 ? (
          <EmptyState title="Хичээл алга" description={COURSES.empty} />
        ) : (
          <EsisRowValues
            columns={esisSampleColumns(courses.data.fields)}
            rows={courses.data.rows}
          />
        )}
      </section>
    </div>
  );
}

/** One selectable level of the chain. */
function SelectLevel({
  level,
  query,
  selected,
  onSelect,
  waitingFor,
}: {
  level: Level;
  query: ReturnType<typeof useLevel>;
  selected: string | null;
  onSelect: (id: string) => void;
  /** What the reader must choose first, when this level cannot run yet. */
  waitingFor: string | null;
}) {
  return (
    <section aria-label={level.title} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-ink">{level.title}</h3>
        {query.data?.status === "SUCCEEDED" ? <Badge tone="sky">{query.data.count}</Badge> : null}
      </div>

      {waitingFor ? (
        <Card pad="compact">
          <p className="text-body text-muted">{waitingFor}</p>
        </Card>
      ) : query.isFetching ? (
        <LoadingState rows={2} />
      ) : query.isError ? (
        <Card pad="compact" tone="peach">
          <p className="text-body text-ink">{errorMessage(query.error)}</p>
        </Card>
      ) : query.data?.status === "FAILED" ? (
        <Card pad="compact" tone="peach">
          <p className="text-body font-semibold text-ink">ЭСИС хариу өгсөнгүй</p>
          <p className="mt-1 text-caption text-muted">{query.data.errorCode}</p>
        </Card>
      ) : !query.data || query.data.rows.length === 0 ? (
        <Card pad="compact">
          <p className="text-body text-muted">{level.empty}</p>
        </Card>
      ) : (
        <Card pad="none" className="overflow-hidden">
          <ul className="flex flex-col">
            {query.data.rows.map((row, index) => {
              const id = row[level.idField];
              const label = row[level.labelField] ?? id ?? "—";
              // A record ESIS returned without the id the level below keys on
              // cannot lead anywhere, so it is shown and not offered.
              const selectable = Boolean(id);
              const isOpen = selected !== null && id === selected;

              return (
                <li key={id ?? index} className="border-b border-border-soft last:border-b-0">
                  <button
                    type="button"
                    disabled={!selectable}
                    aria-pressed={isOpen}
                    onClick={() => id && onSelect(id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left",
                      selectable ? "hover:bg-canvas" : "cursor-default opacity-60",
                      isOpen && "bg-primary-soft",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block break-words text-body font-medium text-ink">
                        {label}
                      </span>
                      <span className="block font-mono text-caption text-muted">{id ?? "—"}</span>
                    </span>
                    {selectable ? (
                      <ChevronRight
                        size={18}
                        aria-hidden
                        className={cn("shrink-0 text-muted", isOpen && "text-primary")}
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}
