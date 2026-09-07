"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleAlert,
  Database,
  Eye,
  FlaskConical,
  History,
  Network,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import {
  esisOverviewSchema,
  esisPreviewResultSchema,
  type EsisOverview,
  type EsisPreviewResourceKey,
  type EsisPreviewResult,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader, SunkenPanel } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";

type Tab = "overview" | "apis" | "preview" | "history";

const TABS: { value: Tab; label: string; icon: typeof Database }[] = [
  { value: "overview", label: "Ерөнхий", icon: Network },
  { value: "apis", label: "API эрх", icon: ShieldCheck },
  { value: "preview", label: "Туршилтын импорт", icon: FlaskConical },
  { value: "history", label: "Түүх", icon: History },
];

const DOMAIN_LABEL: Record<EsisOverview["endpoints"][number]["domain"], string> = {
  ORGANIZATION: "Байгууллага",
  ROSTER: "Хүүхэд ба хүний нөөц",
  ATTENDANCE: "Ирц",
  FOOD: "Хоолны лавлах",
};

export default function EsisIntegrationPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <EsisIntegration />
    </RequireRole>
  );
}

function EsisIntegration() {
  const { primaryKindergartenId } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<EsisPreviewResourceKey[]>([
    "organization",
    "academicYearStatuses",
  ]);
  const [preview, setPreview] = useState<EsisPreviewResult | null>(null);

  const overview = useQuery({
    queryKey: qk.esis(primaryKindergartenId ?? "none"),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis`, esisOverviewSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  const runPreview = useMutation({
    mutationFn: () =>
      mutate(
        `/kindergartens/${primaryKindergartenId}/esis/preview`,
        esisPreviewResultSchema,
        {
          method: "POST",
          body: { resources: selected },
        },
      ),
    onSuccess: (result) => {
      setPreview(result);
      void queryClient.invalidateQueries({ queryKey: qk.esis(primaryKindergartenId!) });
    },
  });

  const header = (
    <PageHeader
      title="ESIS холболт"
      lede="Боловсролын салбарын мэдээллийн системтэй өгөгдөл солилцох бэлэн байдал."
      icon={<IconChip icon={<Database />} tone="primary" size="lg" />}
      actions={
        <Button
          size="sm"
          variant="secondary"
          disabled={overview.isFetching}
          onClick={() => void overview.refetch()}
        >
          <RefreshCw className={cn(overview.isFetching && "animate-spin")} aria-hidden />
          Шинэчлэх
        </Button>
      }
    />
  );

  if (!primaryKindergartenId) {
    return (
      <div className="page-band">
        {header}
        <EmptyState title="Цэцэрлэг олдсонгүй" description="Танд удирдах цэцэрлэг алга." />
      </div>
    );
  }

  if (overview.isPending) {
    return (
      <div className="page-band">
        {header}
        <LoadingState rows={4} shape="cards" />
      </div>
    );
  }

  if (overview.isError) {
    return (
      <div className="page-band">
        {header}
        <ErrorState
          description={errorMessage(overview.error)}
          action={
            <Button variant="secondary" onClick={() => void overview.refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      </div>
    );
  }

  const data = overview.data;

  return (
    <div className="page-band">
      {header}

      <section aria-label="ESIS бэлэн байдлын үе шат" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {data.stages.map((stage) => (
          <Card key={stage.code} pad="compact" tone={stage.status === "READY" ? "mint" : "sun"}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-caption font-semibold text-muted">{stage.code}</p>
                <p className="mt-1 text-body font-semibold text-ink">{stage.label}</p>
              </div>
              {stage.status === "READY" ? (
                <CheckCircle2 className="shrink-0 text-mint-ink" aria-hidden />
              ) : (
                <CircleAlert className="shrink-0 text-sun-ink" aria-hidden />
              )}
            </div>
            <Badge className="mt-3" tone={stage.status === "READY" ? "mint" : "sun"}>
              {stage.status === "READY" ? "Бэлэн" : "Хүлээгдэж байна"}
            </Badge>
          </Card>
        ))}
      </section>

      <div
        role="tablist"
        aria-label="ESIS удирдлагын харагдац"
        className="mt-6 flex max-w-full gap-1 overflow-x-auto rounded-control border border-border bg-surface p-1"
      >
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => setTab(item.value)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-control px-4 text-body font-medium transition-colors",
                tab === item.value
                  ? "bg-primary text-primary-ink shadow-sm"
                  : "text-muted hover:bg-canvas hover:text-ink",
              )}
            >
              <Icon size={17} aria-hidden />
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {tab === "overview" ? <Overview data={data} /> : null}
        {tab === "apis" ? <ApiScope data={data} /> : null}
        {tab === "preview" ? (
          <PreviewPanel
            data={data}
            selected={selected}
            onSelectedChange={setSelected}
            result={preview}
            pending={runPreview.isPending}
            error={runPreview.isError ? errorMessage(runPreview.error) : null}
            onRun={() => runPreview.mutate()}
          />
        ) : null}
        {tab === "history" ? <RunHistory runs={data.recentRuns} /> : null}
      </div>
    </div>
  );
}

function Overview({ data }: { data: EsisOverview }) {
  const domainCounts = data.endpoints.reduce<Record<string, number>>((counts, endpoint) => {
    counts[endpoint.domain] = (counts[endpoint.domain] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="esis-connection-heading">
        <SectionHeader id="esis-connection-heading" title="Холболтын төлөв" />
        <Card pad="roomy">
          <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Definition label="Орчин" value={data.connection.environment ?? "Тохируулаагүй"} />
            <Definition
              label="Байгууллагын код"
              value={data.connection.institutionId ?? "Холбоогүй"}
            />
            <Definition
              label="Token"
              value={data.deployment.hasToken ? "Server дээр байна" : "Тохируулаагүй"}
            />
            <Definition
              label="API хаяг"
              value={data.deployment.baseUrl || "Тохируулаагүй"}
              breakAll
            />
          </dl>
        </Card>
      </section>

      {data.blockers.length > 0 ? (
        <section aria-labelledby="esis-blockers-heading">
          <SectionHeader id="esis-blockers-heading" title="Үлдсэн тохиргоо" />
          <Card pad="roomy" tone="sun">
            <ul className="flex flex-col gap-3">
              {data.blockers.map((blocker) => (
                <li key={blocker} className="flex items-start gap-3 text-body text-ink">
                  <CircleAlert className="mt-0.5 shrink-0 text-sun-ink" size={18} aria-hidden />
                  {blocker}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="esis-domains-heading">
        <SectionHeader id="esis-domains-heading" title="Ашиглах мэдээллийн хүрээ" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(DOMAIN_LABEL).map(([domain, label]) => (
            <Card key={domain} pad="compact">
              <p className="text-body font-semibold text-ink">{label}</p>
              <p className="mt-1 text-title font-semibold text-primary">
                {domainCounts[domain] ?? 0} API
              </p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function ApiScope({ data }: { data: EsisOverview }) {
  return (
    <section aria-labelledby="esis-api-heading">
      <SectionHeader
        id="esis-api-heading"
        title="API эрхийн матриц"
        lede={`${data.endpoints.length} сонгосон endpoint · access status-ыг token олгосны дараа шалгана.`}
      />
      <TableShell caption="ESIS endpoint-ийн ашиглалт ба эрхийн төлөв" minWidth="min-w-[940px]">
        <thead>
          <tr>
            <Th>API</Th>
            <Th>Мэдээлэл</Th>
            <Th>Ашиглах хэсэг</Th>
            <Th>Method</Th>
            <Th>Эрх</Th>
          </tr>
        </thead>
        <tbody>
          {data.endpoints.map((endpoint) => (
            <tr key={endpoint.key}>
              <Td>
                <p className="font-semibold text-ink">{endpoint.slug}</p>
                <p className="text-caption text-muted">ID {endpoint.apiId}</p>
              </Td>
              <Td>
                <p className="font-medium text-ink">{endpoint.name}</p>
                <p className="text-caption text-muted">{DOMAIN_LABEL[endpoint.domain]}</p>
              </Td>
              <Td>{endpoint.usage}</Td>
              <Td>
                <Badge tone={endpoint.method === "GET" ? "sky" : "peach"}>{endpoint.method}</Badge>
              </Td>
              <Td>
                <Badge tone="sun">Шалгаагүй</Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </section>
  );
}

function PreviewPanel({
  data,
  selected,
  onSelectedChange,
  result,
  pending,
  error,
  onRun,
}: {
  data: EsisOverview;
  selected: EsisPreviewResourceKey[];
  onSelectedChange: (next: EsisPreviewResourceKey[]) => void;
  result: EsisPreviewResult | null;
  pending: boolean;
  error: string | null;
  onRun: () => void;
}) {
  const resources = data.endpoints.filter(
    (endpoint): endpoint is typeof endpoint & { key: EsisPreviewResourceKey } => endpoint.previewable,
  );

  function toggle(key: EsisPreviewResourceKey) {
    if (selected.includes(key)) {
      onSelectedChange(selected.filter((item) => item !== key));
      return;
    }
    if (selected.length < 4) onSelectedChange([...selected, key]);
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="esis-preview-heading">
        <SectionHeader
          id="esis-preview-heading"
          title="Read-only dry-run"
          lede="Нэг удаад 4 хүртэл мэдээллийн багц шалгана. Дотоод бүртгэл өөрчлөгдөхгүй."
          action={
            <Button
              disabled={!data.canPreview || selected.length === 0 || pending}
              onClick={onRun}
            >
              <Eye aria-hidden />
              {pending ? "Шалгаж байна…" : "Preview ажиллуулах"}
            </Button>
          }
        />

        {!data.canPreview ? (
          <Card pad="compact" tone="sun" className="mb-4">
            <p className="text-body font-medium text-ink">
              Байгууллагын mapping болон server token бэлэн болсны дараа dry-run нээгдэнэ.
            </p>
          </Card>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {resources.map((resource) => {
            const checked = selected.includes(resource.key);
            const disabled = !checked && selected.length >= 4;
            return (
              <label
                key={resource.key}
                className={cn(
                  "flex min-h-24 cursor-pointer items-start gap-3 rounded-row border bg-surface p-4 shadow-sm transition-colors",
                  checked ? "border-primary bg-primary-soft/30" : "border-border",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(resource.key)}
                  className="mt-1 size-4 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-body font-semibold text-ink">{resource.name}</span>
                  <span className="mt-1 block text-caption text-muted">{resource.usage}</span>
                </span>
              </label>
            );
          })}
        </div>

        {error ? (
          <p role="alert" className="mt-4 rounded-control bg-danger-soft px-4 py-3 text-body text-danger">
            {error}
          </p>
        ) : null}
      </section>

      {result ? (
        <section aria-labelledby="esis-result-heading">
          <SectionHeader
            id="esis-result-heading"
            title="Шалгалтын үр дүн"
            lede={`Run ${result.runId} · дотоод мэдээлэлд өөрчлөлт оруулаагүй`}
          />
          <div className="grid gap-3 lg:grid-cols-2">
            {result.results.map((item) => {
              const endpoint = data.endpoints.find((candidate) => candidate.key === item.resource);
              return (
                <Card
                  key={item.resource}
                  pad="compact"
                  tone={item.status === "SUCCEEDED" ? "mint" : "peach"}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-body font-semibold text-ink">
                        {endpoint?.name ?? item.resource}
                      </p>
                      <p className="mt-1 text-title font-semibold text-ink">{item.count} бичлэг</p>
                    </div>
                    <Badge tone={item.status === "SUCCEEDED" ? "mint" : "danger"}>
                      {item.status === "SUCCEEDED" ? "Амжилттай" : item.errorCode}
                    </Badge>
                  </div>
                  {item.preview.length > 0 ? (
                    <SunkenPanel className="mt-4">
                      <ul className="flex flex-col gap-1 text-caption text-muted">
                        {item.preview.map((row, index) => (
                          <li key={`${row.label}-${index}`}>{row.label}</li>
                        ))}
                      </ul>
                    </SunkenPanel>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RunHistory({ runs }: { runs: EsisOverview["recentRuns"] }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        title="Dry-run хийгдээгүй байна"
        description="Холболт бэлэн болсны дараа туршилтын импортын үр дүн энд хадгалагдана."
        icon={<History aria-hidden />}
      />
    );
  }

  return (
    <section aria-labelledby="esis-history-heading">
      <SectionHeader id="esis-history-heading" title="Сүүлийн ажиллагаа" />
      <TableShell caption="ESIS dry-run ажиллагааны түүх" minWidth="min-w-[720px]">
        <thead>
          <tr>
            <Th>Эхэлсэн</Th>
            <Th>Мэдээллийн багц</Th>
            <Th>Ажиллуулсан</Th>
            <Th>Төлөв</Th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <Td>{formatRelative(run.startedAt)}</Td>
              <Td>{run.resources.length} багц</Td>
              <Td>{run.initiatedBy}</Td>
              <Td>
                <RunStatus status={run.status} />
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </section>
  );
}

function RunStatus({ status }: { status: EsisOverview["recentRuns"][number]["status"] }) {
  const config = {
    RUNNING: ["Ажиллаж байна", "sun"],
    SUCCEEDED: ["Амжилттай", "mint"],
    PARTIAL: ["Хэсэгчлэн", "peach"],
    FAILED: ["Алдаатай", "danger"],
  } as const;
  const [label, tone] = config[status];
  return <Badge tone={tone}>{label}</Badge>;
}

function Definition({ label, value, breakAll = false }: { label: string; value: string; breakAll?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption font-semibold text-muted">{label}</dt>
      <dd className={cn("mt-1 text-body font-medium text-ink", breakAll && "break-all")}>{value}</dd>
    </div>
  );
}
