"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { childDetailSchema, observationSchema, type Observation } from "@kinder/contracts";
import { ObservationDetailDialog } from "@/components/child/child-observations";
import { useToast } from "@/components/ui/toast";
import { A79NotReady } from "@/components/assessment/a79-group-summary";
import { ChildAvatar } from "@/components/media/media-image";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TableShell, Td, Th } from "@/components/ui/table";
import { Ring } from "@/components/ui/chart/ring";
import { Field, Select } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import type { A79Domain } from "@/lib/a79-assessment";
import {
  A79_BAND_LABEL,
  A79_DOMAIN_FILL,
  A79_LEVEL_KEYS,
  A79_STATUSES,
  A79_STATUS_LABEL,
  a79Band,
  a79Csv,
  a79Level,
  a79LevelForAge,
  a79ProgressSchema,
  a79Score,
  type A79Band,
  type A79Evidence,
  type A79LevelKey,
  type A79Progress,
  type A79Status,
} from "@/lib/a79-progress";
import { ageInYears, formatDate, fullName } from "@/lib/format";
import { cn } from "@/lib/utils";

const BAND_TONE: Record<A79Band, "mint" | "sun" | "peach"> = {
  MASTERED: "mint",
  PROGRESSING: "sun",
  DEVELOPING: "peach",
};

/** The cell the child is in now, tinted in its status's colour. */
const STATUS_CELL: Record<A79Status, string> = {
  INDEPENDENT: "bg-mint/50",
  SUPPORTED: "bg-sky/50",
  DEVELOPING: "bg-sun/50",
  NOT_YET: "bg-canvas",
};

/**
 * One child's А/79 result — the client's design, 2026-10-08: the share of the
 * level's criteria shown «Бие даан», by part, and every criterion with its
 * latest evidence. Read from `GET /children/:id/a79-progress`
 * (`lib/a79-progress.ts`); a 404 draws `A79NotReady`, never sample evidence
 * (`a79-group-summary.tsx` says why).
 */
export default function ChildResultPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <ChildResult />
    </RequireRole>
  );
}

function ChildResult() {
  const { groupId, childId } = useParams<{ groupId: string; childId: string }>();
  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });
  const age = ageInYears(child.data?.dateOfBirth);
  const [chosenLevel, setChosenLevel] = useState<A79LevelKey | "">("");
  const level = chosenLevel || a79LevelForAge(age);

  const progress = useQuery({
    queryKey: [...qk.child(childId), "a79-progress", level],
    queryFn: () => get(`/children/${childId}/a79-progress?level=${level}`, a79ProgressSchema),
    enabled: child.isSuccess,
    retry: false,
  });
  const notReady = progress.isError && isNotFound(progress.error);
  const data: A79Progress | undefined = progress.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Үр дүнгийн үнэлгээ" backHref={`/groups/${groupId}/results`} />

      {child.isLoading ? <LoadingState rows={4} /> : null}
      {child.isError ? <ErrorState description={errorMessage(child.error)} /> : null}

      {child.data ? (
        // ★ No card behind it, pulled up under the title — 2026-10-08, the client.
        <div className="-mt-2 flex flex-wrap items-center gap-3">
          <ChildAvatar child={child.data} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lead font-semibold text-ink">{fullName(child.data)}</p>
            <p className="text-caption text-muted">
              {age !== null ? `${age} нас · ` : ""}
              {level} түвшин
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-40">
              <Field label="Түвшин" labelHidden>
                {({ id }) => (
                  <Select
                    id={id}
                    value={level}
                    onChange={(e) => setChosenLevel(e.target.value as A79LevelKey)}
                  >
                    {A79_LEVEL_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {key} түвшин
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!data}
              onClick={() => data && downloadCsv(child.data!, age, data)}
            >
              <Download size={16} aria-hidden="true" /> Excel
            </Button>
          </div>
        </div>
      ) : null}

      {notReady ? <A79NotReady /> : null}
      {progress.isLoading ? <LoadingState rows={4} /> : null}
      {progress.isError && !notReady ? (
        <ErrorState description={errorMessage(progress.error)} />
      ) : null}

      {data ? <ResultBody progress={data} childId={childId} /> : null}
    </div>
  );
}

function ResultBody({ progress, childId }: { progress: A79Progress; childId: string }) {
  const toast = useToast();
  const [opening, setOpening] = useState<A79Evidence | null>(null);
  /*
    ★ Pressing a piece of evidence opens the note in the same enlarged view
    «Явцын үнэлгээ» uses — 2026-10-08, the client. Fetched on the press,
    not with the table: a level holds dozens of notes and a teacher opens two.
  */
  const note = useQuery({
    queryKey: [...qk.child(childId), "observation", opening?.observationId],
    queryFn: () =>
      get(`/children/${childId}/observations/${opening!.observationId}`, observationSchema),
    enabled: Boolean(opening),
    retry: false,
  });
  useEffect(() => {
    if (note.isError) {
      toast.error(errorMessage(note.error));
      setOpening(null);
    }
  }, [note.isError, note.error, toast]);
  const shown: Observation | null = opening ? (note.data ?? null) : null;

  const score = a79Score(progress);
  const band = a79Band(score.percent);
  const byNumber = new Map(progress.criteria.map((row) => [row.number, row]));
  /**
   * Where each part's criteria are now, by status — «Бие даан 23%» in the
   * column heads (client, 2026-10-08). A criterion with no note counts as
   * «Хараахан ажиглагдаагүй», so the four add up to the part.
   */
  const shareByDomain = (domain: A79Domain, status: A79Status) => {
    const numbers = criteria.filter((c) => c.domain === domain).map((c) => c.number);
    const hits = numbers.filter((n) => (byNumber.get(n)?.status ?? "NOT_YET") === status).length;
    return numbers.length ? Math.round((hits / numbers.length) * 100) : 0;
  };
  const criteria = a79Level(progress.level).criteria.map((c, i) => ({ ...c, number: i + 1 }));
  const domains = [...new Set(criteria.map((c) => c.domain))] as A79Domain[];
  const [only, setOnly] = useState<A79Domain | "">("");

  return (
    <>
      <Card pad="roomy" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <Ring
            percent={score.percent}
            size="lg"
            fadeTo="var(--color-violet-chart)"
            className="shadow-[0_6px_20px_-8px_var(--color-violet-chart)]"
          />
          <div className="min-w-0 flex-1">
            <Badge tone={BAND_TONE[band]}>{A79_BAND_LABEL[band]}</Badge>
            <p className="mt-2 text-body text-ink">
              {score.total} шалгуураас <b>{score.achieved}</b>-г бие даан илрүүлсэн.
            </p>
            <p className="text-caption text-muted">
              80%-аас дээш Хангалттай · 50–79% Ахиж байна · 50%-аас доош Хөгжиж байна
            </p>
          </div>
        </div>

        <section aria-labelledby="by-domain">
          <h2 id="by-domain" className="mb-2 text-body font-semibold text-ink">
            Хэсгээр
          </h2>
          <ul className="flex flex-col gap-2">
            {score.byDomain.map((row) => {
              const rowBand = a79Band(row.percent);
              return (
                <li key={row.domain} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3">
                  <span className="text-body text-ink">{row.domain}</span>
                  <span
                    role="progressbar"
                    aria-label={`${row.domain}: ${row.percent}%`}
                    aria-valuenow={row.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-2 overflow-hidden rounded-pill bg-track"
                  >
                    <span
                      className="block h-full rounded-pill"
                      style={{ width: `${row.percent}%`, background: A79_DOMAIN_FILL[row.domain] }}
                    />
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-10 text-right text-caption font-semibold tabular-nums text-ink">
                      {row.percent}%
                    </span>
                    <Badge tone={BAND_TONE[rowBand]} className="hidden sm:inline-flex">
                      {A79_BAND_LABEL[rowBand]}
                    </Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </Card>

      {/*
        ★ Бүгд · Мэдлэг · Чадвар · Төлөвшил — 2026-10-08, the client:
        "анхаарал татахааргүй". Small text tabs with an underline, as on
        «Санал хүсэлт», not a row of buttons competing with the tables.
      */}
      <div
        role="group"
        aria-label="Хэсгээр шүүх"
        className="flex flex-wrap border-b border-border-soft"
      >
        {(["", ...domains] as const).map((value) => (
          <button
            key={value || "all"}
            type="button"
            aria-pressed={only === value}
            onClick={() => setOnly(value)}
            className={cn(
              "-mb-px min-h-[40px] border-b-2 px-2.5 text-caption transition-colors",
              only === value
                ? "border-ink font-semibold text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {value || "Бүгд"}
          </button>
        ))}
      </div>

      {/*
        ★ Each criterion a row, the four statuses its columns, each linked note
        under the status it was given there — 2026-10-08, the client. The
        tinted cell is where the child is now (the latest note).
      */}
      {domains
        .filter((domain) => !only || domain === only)
        .map((domain) => (
          <section
            key={domain}
            aria-labelledby={`domain-${domain}`}
            className="flex flex-col gap-2"
          >
            <h2 id={`domain-${domain}`} className="text-lead font-semibold text-ink">
              {domain}
            </h2>
            <TableShell caption={`${domain} — шалгуур ба нотолгоо`} minWidth="min-w-[860px]">
              <thead>
                <tr>
                  <Th className="w-10">№</Th>
                  <Th className="w-[30%]">Шалгуур</Th>
                  {A79_STATUSES.map((status) => (
                    <Th key={status}>
                      <span className="block">{A79_STATUS_LABEL[status]}</span>
                      <span className="block text-lead font-semibold tabular-nums text-ink">
                        {shareByDomain(domain, status)}%
                      </span>
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {criteria
                  .filter((c) => c.domain === domain)
                  .map((c) => {
                    const row = byNumber.get(c.number);
                    const now = row?.status ?? "NOT_YET";
                    return (
                      <tr key={c.number} className="align-top">
                        <Td className="tabular-nums text-muted">{c.number}</Td>
                        <Td className="text-ink">{c.text}</Td>
                        {A79_STATUSES.map((status) => {
                          const items = (row?.evidence ?? []).filter((e) => e.status === status);
                          return (
                            <Td
                              key={status}
                              aria-label={
                                status === now
                                  ? `${A79_STATUS_LABEL[status]} — одоогийн`
                                  : undefined
                              }
                              className={cn(status === now && STATUS_CELL[status])}
                            >
                              {items.length > 0 ? (
                                <ul className="flex flex-col gap-2">
                                  {items.map((item) => (
                                    <li key={item.observationId}>
                                      <button
                                        type="button"
                                        onClick={() => setOpening(item)}
                                        aria-label={`${formatDate(item.observedOn)} ${item.typeName ?? "тэмдэглэл"} — нээх`}
                                        className="flex w-full flex-col gap-0.5 rounded-row p-1 text-left hover:bg-surface/80 focus-visible:ring-2 focus-visible:ring-primary/40"
                                      >
                                        <span className="flex flex-wrap items-center gap-1.5 text-caption">
                                          <span className="font-semibold tabular-nums text-ink">
                                            {formatDate(item.observedOn)}
                                          </span>
                                          {item.typeName ? (
                                            <span className="text-muted">{item.typeName}</span>
                                          ) : null}
                                        </span>
                                        {item.note ? (
                                          <span className="line-clamp-2 text-caption text-muted">
                                            {item.note}
                                          </span>
                                        ) : null}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : !row && status === "NOT_YET" ? (
                                <span className="text-caption text-muted">
                                  Ажиглалт холбогдоогүй
                                </span>
                              ) : null}
                            </Td>
                          );
                        })}
                      </tr>
                    );
                  })}
              </tbody>
            </TableShell>
          </section>
        ))}
      <ObservationDetailDialog
        observation={shown}
        showTeacherMetadata
        onClose={() => setOpening(null)}
      />
    </>
  );
}

function downloadCsv(
  child: { lastName?: string | null; firstName?: string | null },
  age: number | null,
  progress: A79Progress,
) {
  const csv = a79Csv({ name: fullName(child), age }, progress, formatDate);
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `A79-${fullName(child)}-${progress.level}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
