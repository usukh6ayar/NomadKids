"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, History } from "lucide-react";
import { useState } from "react";
import {
  esisReferenceSyncOutcomeSchema,
  esisRosterSyncOutcomeSchema,
  esisSyncRunsPageSchema,
  type EsisSyncRun,
  type EsisSyncTier,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EsisConnectionSummary } from "@/components/esis/esis-connection-summary";
import { EsisWriteQueue } from "@/components/esis/esis-write-queue";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

/**
 * Which tier a run belongs to, read off `EsisSyncRun.summary` — the only
 * place it is recorded (`runReferenceSync` writes `{ kind: "REFERENCE", … }`,
 * `runRosterSync` writes `{ kind: "ROSTER", … }`).
 *
 * ★ `null` is a real answer, not a parsing failure: the platform operator's
 * "Синк шалгалт" dry run writes to this same `EsisSyncRun` table with a
 * summary of `{ mode: "LIVE", resources: {...} }` and no `kind` at all — a
 * preview and a tier sync sit in the same history and are told apart only by
 * this field. `sync-runs` is tenant-scoped, so an ADMIN's own dry-run
 * previews (run from `/platform/[id]/esis` while they also hold that role)
 * can appear here too.
 */
function runTier(summary: unknown): "REFERENCE" | "ROSTER" | null {
  if (summary && typeof summary === "object" && "kind" in summary) {
    const kind = (summary as { kind?: unknown }).kind;
    if (kind === "REFERENCE" || kind === "ROSTER") return kind;
  }
  return null;
}

function tierLabel(summary: unknown): string {
  const tier = runTier(summary);
  if (tier === "REFERENCE") return "Лавлах мэдээлэл";
  if (tier === "ROSTER") return "Ажилтны бүртгэл";
  return "Синк шалгалт";
}

/** `runReferenceSync`'s summary, read defensively — see `runTier`'s note. */
function referenceTotals(
  summary: unknown,
): { stored: number; skipped: number; count: number } | null {
  if (runTier(summary) !== "REFERENCE") return null;
  const resources = (summary as { resources?: unknown }).resources;
  if (!Array.isArray(resources)) return null;
  let stored = 0;
  let skipped = 0;
  for (const entry of resources) {
    if (!entry || typeof entry !== "object") continue;
    stored += Number((entry as { stored?: unknown }).stored) || 0;
    skipped += Number((entry as { skipped?: unknown }).skipped) || 0;
  }
  return { stored, skipped, count: resources.length };
}

/** `runRosterSync`'s summary, read defensively — see `runTier`'s note. */
function rosterTotals(
  summary: unknown,
): { stored: number; skipped: number; movementCount: number | null } | null {
  if (runTier(summary) !== "ROSTER") return null;
  const roster = (summary as { roster?: { stored?: unknown; skipped?: unknown } | null }).roster;
  const movements = (summary as { movements?: { count?: unknown } | null }).movements;
  return {
    stored: roster ? Number(roster.stored) || 0 : 0,
    skipped: roster ? Number(roster.skipped) || 0 : 0,
    movementCount: movements && typeof movements.count === "number" ? movements.count : null,
  };
}

/**
 * One line, in Mongolian, describing what a tier's last run stored — `null`
 * when there is nothing to say (no run yet, or a run of the other tier).
 */
function summaryText(
  totals:
    | { stored: number; skipped: number; count: number }
    | { stored: number; skipped: number; movementCount: number | null }
    | null
    | undefined,
): string | null {
  if (!totals) return null;
  if ("count" in totals) {
    return `${totals.count} багц · ${totals.stored} мөр хадгалав, ${totals.skipped} алгассан`;
  }
  const movements = totals.movementCount === null ? "" : ` · ${totals.movementCount} шилжилт`;
  return `${totals.stored} бүртгэгдэв, ${totals.skipped} алгассан${movements}`;
}

/**
 * The director's manual ESIS pull — one card per tier, and the full run
 * history behind it.
 *
 * ★ **This screen, not `/platform/[id]/esis`, is where the "Татах" buttons
 * live — 2026-09-17.** They briefly sat on the platform operator's screen
 * (`929fd0b`), calling `POST /kindergartens/:id/esis/sync`, which sits behind
 * `KindergartenEsisController`'s tenant `ADMIN` membership check
 * (`TenantAccessService.assertAdmin`), not the platform flag that screen is
 * gated on. `PlatformAccessService`'s own doc comment is explicit that
 * `isSuperAdmin` grants platform-level resources and deliberately nothing
 * tenant-scoped — the client's 2026-09-14 rule for the rest of this screen's
 * move ("системийн зүйл" belongs to the superadmin, "ажлын гадаргуу" stays
 * with the kindergarten) settles this the other way: a sync refreshes *this*
 * kindergarten's roster, spends *its* token allotment, and feeds *its*
 * screens — a working-surface action a director presses, exactly like the
 * "ESIS-ээс татах" buttons on the roster and the day sheet. The API did not
 * change; only which screen calls it did.
 *
 * ★★ **The tier cards read `sync-runs` (page 1), not a separate `recentRuns`
 * feed** — unlike the platform screen's history tab, no tenant-scoped route
 * carries a `recentRuns`-style summary, so this is the only source available
 * here. `runsPage` (the table's own pagination) and a fixed page-1 read share
 * one React Query cache entry whenever the table is on page 1, so this is
 * one network call, not two, for the common case.
 */
function EsisSyncPanel() {
  const { primaryKindergartenId } = useSession();
  const kindergartenId = primaryKindergartenId ?? "";
  const queryClient = useQueryClient();
  const toast = useToast();
  const [runsPage, setRunsPage] = useState(1);

  const latestRuns = useQuery({
    queryKey: qk.esisSyncRuns(kindergartenId, 1),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/esis/sync-runs?page=1&pageSize=10`,
        esisSyncRunsPageSchema,
      ),
    enabled: Boolean(kindergartenId),
  });

  const syncRuns = useQuery({
    queryKey: qk.esisSyncRuns(kindergartenId, runsPage),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/esis/sync-runs?page=${runsPage}&pageSize=10`,
        esisSyncRunsPageSchema,
      ),
    enabled: Boolean(kindergartenId),
  });

  function invalidateRuns() {
    void queryClient.invalidateQueries({ queryKey: qk.esisSyncRunsAll(kindergartenId) });
  }

  const runReferenceSync = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/esis/sync`, esisReferenceSyncOutcomeSchema, {
        method: "POST",
        body: { tier: "REFERENCE" satisfies EsisSyncTier },
      }),
    onSuccess: (result) => {
      const succeeded = result.results.filter((entry) => entry.status === "SUCCEEDED").length;
      toast.success(
        `Лавлах мэдээллийг татлаа: ${succeeded}/${result.results.length} багц амжилттай.`,
      );
      invalidateRuns();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const runRosterSync = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/esis/sync`, esisRosterSyncOutcomeSchema, {
        method: "POST",
        body: { tier: "ROSTER" satisfies EsisSyncTier },
      }),
    onSuccess: (result) => {
      toast.success(
        `Ажилтны бүртгэл шинэчлэгдлээ: ${result.roster.stored} бүртгэгдэв, ${result.roster.skipped} алгассан.`,
      );
      invalidateRuns();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const latestItems = latestRuns.data?.items ?? [];
  const lastReference = latestItems.find((run) => runTier(run.summary) === "REFERENCE") ?? null;
  const lastRoster = latestItems.find((run) => runTier(run.summary) === "ROSTER") ?? null;
  const referenceTotalsText = summaryText(lastReference && referenceTotals(lastReference.summary));
  const rosterTotalsText = summaryText(lastRoster && rosterTotals(lastRoster.summary));

  // Neither route can run while the other's is in flight — the server holds
  // one run lock per kindergarten, so a second press while one tier is
  // running would only come back as a 409. Disabling both while either is
  // pending says so before the round trip rather than after it.
  const anyPending = runReferenceSync.isPending || runRosterSync.isPending;

  return (
    <div className="flex w-full flex-col gap-6 lg:gap-8">
      <PageHeader title="ЭСИС холболт" lede="ЭСИС-ээс энэ цэцэрлэгийн мэдээллийг гараар татах" />

      {/*
        ★ Where the integration stands, at the head of the integration screen —
        2026-09-23. It was readable in four places and stated in none: the
        institution number on `/admin/kindergarten`, the group and child counts
        on `/admin`, the staff count on `/admin/users`, and "are we connected"
        only from whether some panel elsewhere happened to draw rows.
      */}
      {kindergartenId ? <EsisConnectionSummary kindergartenId={kindergartenId} /> : null}

      <section aria-labelledby="esis-writes-heading">
        <SectionHeader
          id="esis-writes-heading"
          title="Бичих"
          lede="Бүлгийн дэлгэцээс бэлтгэж, энд баталгаажсан илгээлтүүд — ЭСИС-ийн хариуг бүтнээр нь харуулна."
        />
        {kindergartenId ? <EsisWriteQueue kindergartenId={kindergartenId} /> : null}
      </section>

      <section aria-labelledby="esis-sync-tiers-heading">
        <SectionHeader
          id="esis-sync-tiers-heading"
          title="Гараар татах"
          lede="Хоёр тохиргоо шөнөөр өөрсдөө ажилладаг — энд шаардлагатай үед гараар ажиллуулна."
        />
        <div className="grid gap-3 md:grid-cols-2">
          <SyncTierCard
            title="Лавлах мэдээлэл"
            description="ЭСИС-ийн үндэсний болон байгууллагын лавлах (хоолны бүтээгдэхүүн, өрөө, хөтөлбөр…) — сард нэг удаа."
            lastRun={lastReference}
            totalsText={referenceTotalsText}
            onRun={() => runReferenceSync.mutate()}
            pending={runReferenceSync.isPending}
            disabled={anyPending || !kindergartenId}
            error={runReferenceSync.isError ? errorMessage(runReferenceSync.error) : null}
          />
          <SyncTierCard
            title="Ажилтны бүртгэл"
            description="Багш, ажилтны жагсаалт болон хүүхдийн шилжилт хөдөлгөөн — өдөр бүр."
            lastRun={lastRoster}
            totalsText={rosterTotalsText}
            onRun={() => runRosterSync.mutate()}
            pending={runRosterSync.isPending}
            disabled={anyPending || !kindergartenId}
            error={runRosterSync.isError ? errorMessage(runRosterSync.error) : null}
          />
        </div>
      </section>

      <section aria-labelledby="esis-sync-history-heading">
        <SectionHeader id="esis-sync-history-heading" title="Синкийн түүх" />

        {syncRuns.isPending ? <LoadingState rows={3} /> : null}

        {syncRuns.isError ? (
          <ErrorState
            description={errorMessage(syncRuns.error)}
            action={
              <Button variant="secondary" onClick={() => void syncRuns.refetch()}>
                Дахин оролдох
              </Button>
            }
          />
        ) : null}

        {!syncRuns.isPending && !syncRuns.isError && syncRuns.data ? (
          syncRuns.data.items.length === 0 ? (
            <EmptyState
              title="Синк ажиллагааны түүх"
              description="Дээрх товчоор эхний синкээ ажиллуулаарай — түүх энд бүртгэгдэнэ."
              icon={<History aria-hidden />}
            />
          ) : (
            <>
              <TableShell caption="ESIS синк ажиллагааны түүх" minWidth="min-w-0" stacked>
                <thead>
                  <tr>
                    <Th>Эхэлсэн</Th>
                    <Th>Төрөл</Th>
                    <Th>Мэдээллийн багц</Th>
                    <Th>Ажиллуулсан</Th>
                    <Th>Төлөв</Th>
                  </tr>
                </thead>
                <tbody>
                  {syncRuns.data.items.map((run) => (
                    <tr key={run.id}>
                      <Td data-label="Эхэлсэн">{formatRelative(run.startedAt)}</Td>
                      <Td data-label="Төрөл">{tierLabel(run.summary)}</Td>
                      <Td data-label="Мэдээллийн багц">{run.resources.length} багц</Td>
                      <Td data-label="Ажиллуулсан">{run.initiatedBy ?? "хуваарь"}</Td>
                      <Td data-label="Төлөв">
                        <RunStatus status={run.status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
              <Pagination
                className="mt-4"
                page={syncRuns.data.page}
                totalPages={syncRuns.data.totalPages}
                onPage={setRunsPage}
              />
            </>
          )
        ) : null}
      </section>
    </div>
  );
}

function SyncTierCard({
  title,
  description,
  lastRun,
  totalsText,
  onRun,
  pending,
  disabled,
  error,
}: {
  title: string;
  description: string;
  lastRun: EsisSyncRun | null;
  totalsText: string | null;
  onRun: () => void;
  pending: boolean;
  disabled: boolean;
  error: string | null;
}) {
  return (
    <Card pad="roomy">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body font-semibold text-ink">{title}</p>
          <p className="mt-1 text-caption text-muted">{description}</p>
        </div>
        {lastRun ? <RunStatus status={lastRun.status} /> : null}
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-caption font-semibold text-muted">Сүүлд ажилласан</dt>
          <dd className="mt-1 text-body font-medium text-ink">
            {lastRun ? formatRelative(lastRun.startedAt) : "Ажиллуулаагүй"}
          </dd>
        </div>
        <div>
          <dt className="text-caption font-semibold text-muted">Хадгалсан</dt>
          <dd className="mt-1 text-body font-medium text-ink">{totalsText ?? "—"}</dd>
        </div>
      </dl>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-control bg-danger-soft px-3 py-2 text-caption text-danger"
        >
          {error}
        </p>
      ) : null}

      <Button className="mt-4" size="sm" onClick={onRun} disabled={disabled}>
        <CloudDownload aria-hidden />
        {pending ? "Татаж байна…" : "Татах"}
      </Button>
    </Card>
  );
}

function RunStatus({ status }: { status: EsisSyncRun["status"] }) {
  const config = {
    RUNNING: ["Ажиллаж байна", "sun"],
    SUCCEEDED: ["Амжилттай", "mint"],
    PARTIAL: ["Хэсэгчлэн", "peach"],
    FAILED: ["Алдаатай", "danger"],
  } as const;
  const [label, tone] = config[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export default function AdminEsisSyncPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <EsisSyncPanel />
    </RequireRole>
  );
}
