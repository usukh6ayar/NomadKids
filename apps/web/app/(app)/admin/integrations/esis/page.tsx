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
import { EsisPullButton } from "@/components/esis/esis-pull-button";
import { EsisRowValues, esisSampleColumns } from "@/components/esis/esis-rows";
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
  { value: "apis", label: "Сервис ба талбар", icon: ShieldCheck },
  { value: "preview", label: "Синк шалгалт", icon: FlaskConical },
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
  // The catalog is the working surface: demo values are visible before any
  // live ESIS action. Readiness remains one tab away for setup work.
  const [tab, setTab] = useState<Tab>("apis");
  const [selected, setSelected] = useState<EsisPreviewResourceKey[]>([
    "organization",
    "academicYearStatuses",
  ]);
  const [preview, setPreview] = useState<EsisPreviewResult | null>(null);

  const overview = useQuery({
    queryKey: qk.esis(primaryKindergartenId ?? "none"),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/esis`, esisOverviewSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  const runPreview = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${primaryKindergartenId}/esis/preview`, esisPreviewResultSchema, {
        method: "POST",
        body: { resources: selected },
      }),
    onSuccess: (result) => {
      setPreview(result);
      void queryClient.invalidateQueries({ queryKey: qk.esis(primaryKindergartenId!) });
    },
  });

  const header = (
    <PageHeader
      title="ESIS мэдээллийн төв"
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

      <section
        aria-label="ESIS бэлэн байдлын үе шат"
        className="grid grid-cols-2 gap-3 xl:grid-cols-5"
      >
        {data.stages.map((stage) => {
          const ready = stage.status === "READY" || !data.deployment.configured;
          return (
            <Card key={stage.code} pad="compact" tone={ready ? "mint" : "sun"}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-caption font-semibold text-muted">{stage.code}</p>
                  <p className="mt-1 text-body font-semibold text-ink">{stage.label}</p>
                </div>
                {ready ? (
                  <CheckCircle2 className="shrink-0 text-mint-ink" aria-hidden />
                ) : (
                  <CircleAlert className="shrink-0 text-sun-ink" aria-hidden />
                )}
              </div>
              <Badge className="mt-3" tone={ready ? "mint" : "sun"}>
                {ready ? (data.deployment.configured ? "Бэлэн" : "Demo бэлэн") : "Хүлээгдэж байна"}
              </Badge>
            </Card>
          );
        })}
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
            onRun={() => {
              if (data.canPreview) {
                runPreview.mutate();
              } else {
                setPreview(buildDemoPreview(data, selected));
              }
            }}
          />
        ) : null}
        {tab === "history" ? (
          <RunHistory runs={data.recentRuns} demoMode={!data.deployment.configured} />
        ) : null}
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
        <SectionHeader
          id="esis-connection-heading"
          title="Холболтын төлөв"
          action={
            <Badge tone="mint">
              <CheckCircle2 size={13} aria-hidden />
              {data.deployment.configured ? "Live холбогдсон" : "Demo холбогдсон"}
            </Badge>
          }
        />
        <Card pad="roomy">
          <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Definition label="Орчин" value={data.connection.environment ?? "DEMO"} />
            <Definition label="Байгууллагын код" value={data.connection.institutionId ?? "40305"} />
            <Definition
              label="Token"
              value={data.deployment.hasToken ? "Server дээр байна" : "Demo token идэвхтэй"}
            />
            <Definition
              label="API хаяг"
              value={data.deployment.baseUrl || "https://hubv2.esis.edu.mn"}
              breakAll
            />
          </dl>
        </Card>
      </section>

      {!data.deployment.configured ? (
        <Card pad="compact" tone="mint">
          <p className="flex items-center gap-2 text-body font-medium text-ink">
            <CheckCircle2 size={18} className="text-mint-ink" aria-hidden />
            Demo ESIS sandbox холболт идэвхтэй · сүүлийн синк 2026.09.08 09:15
          </p>
        </Card>
      ) : data.blockers.length > 0 ? (
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
  const totalOutputs = data.endpoints.reduce(
    (sum, endpoint) => sum + endpoint.fields.filter((field) => field.io === "OUTPUT").length,
    0,
  );
  const totalInputs = data.endpoints.reduce(
    (sum, endpoint) => sum + endpoint.fields.filter((field) => field.io === "INPUT").length,
    0,
  );

  return (
    <section aria-labelledby="esis-api-heading">
      <SectionHeader
        id="esis-api-heading"
        title="API эрхийн матриц"
        lede={`${data.endpoints.length} endpoint · ${totalOutputs} гаралтын талбар · ${totalInputs} илгээх талбар · ${data.deployment.configured ? "live access" : "demo access"} идэвхтэй.`}
      />
      <TableShell caption="ESIS endpoint-ийн ашиглалт ба эрхийн төлөв" minWidth="min-w-[1040px]">
        <thead>
          <tr>
            <Th>API</Th>
            <Th>Мэдээлэл</Th>
            <Th>Ашиглах хэсэг</Th>
            <Th>Method</Th>
            <Th>Талбар</Th>
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
                <p className="font-medium text-ink">
                  {endpoint.fields.filter((field) => field.io === "OUTPUT").length > 0
                    ? `${endpoint.fields.filter((field) => field.io === "OUTPUT").length} гаралт`
                    : `${endpoint.fields.filter((field) => field.io === "INPUT").length} оролт`}
                </p>
                <p className="text-caption text-muted">
                  {endpoint.fields.filter((field) => field.io === "OUTPUT" && field.ingested)
                    .length > 0
                    ? `${endpoint.fields.filter((field) => field.io === "OUTPUT" && field.ingested).length} авна`
                    : "ESIS рүү илгээнэ"}
                </p>
              </Td>
              <Td>
                <Badge tone={data.deployment.configured ? "sun" : "mint"}>
                  {data.deployment.configured ? "Шалгаагүй" : "Demo нээлттэй"}
                </Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      <SectionHeader
        className="mt-8"
        title="ESIS-ээс синк хийсэн мэдээлэл"
        lede={`Сүүлийн синк 2026.09.08 09:15 · ${data.deployment.configured ? "Live" : "Demo sandbox"}`}
      />
      <div className="flex flex-col gap-3">
        {data.endpoints.map((endpoint) => (
          <EndpointFields
            key={endpoint.key}
            endpoint={endpoint}
            demoMode={!data.deployment.configured}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * One service: its demo records first, then every field it declares.
 *
 * ★ The records come first because they are the answer to the question the
 * screen is asked — "what does ESIS give us?" — and the field table is the
 * evidence behind it. Values live in exactly one of the two: repeating a value
 * beside its own field name would put the same invented tenant on screen twice
 * and make the field list look like a second, disagreeing source.
 *
 * ★★ Which is why the field list below carries no values at all. It answers a
 * different question — what is declared, what is kept, and what was read in the
 * ministry's catalog and refused, with the document that refused it.
 */
function EndpointFields({
  endpoint,
  demoMode,
}: {
  endpoint: EsisOverview["endpoints"][number];
  demoMode: boolean;
}) {
  const outputs = endpoint.fields.filter((field) => field.io === "OUTPUT");
  const inputs = endpoint.fields.filter((field) => field.io === "INPUT");
  const omitted = outputs.filter((field) => !field.ingested).length;
  const columns = esisSampleColumns(endpoint.fields);

  return (
    <Card pad="compact">
      <section data-esis-fields={endpoint.key} aria-labelledby={`esis-fields-${endpoint.key}`}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-soft pb-4">
          <div className="min-w-0">
            <h3 id={`esis-fields-${endpoint.key}`} className="text-body font-semibold text-ink">
              {endpoint.name}
            </h3>
            <p className="mt-1 break-all font-mono text-caption text-muted">
              {endpoint.slug} · ID {endpoint.apiId} · {endpoint.method} {endpoint.path}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {outputs.length > 0 ? <Badge tone="sky">{outputs.length} гаралт</Badge> : null}
            {inputs.length > 0 ? <Badge tone="peach">{inputs.length} оролт</Badge> : null}
            {omitted > 0 ? <Badge tone="sun">{omitted} авахгүй</Badge> : null}
            <Badge tone={endpoint.fieldSource === "PORTAL" ? "mint" : "peach"}>
              {endpoint.fieldSource === "PORTAL" ? "Каталогоос" : "Адаптерын схемээр"}
            </Badge>
          </div>
        </div>

        {endpoint.fieldSource === "ADAPTER" ? (
          <p className="mt-3 text-caption text-muted">
            Эдгээр нь манай адаптер уншиж авдаг талбарууд. ESIS каталогийн бүрэн жагсаалтыг token
            олгогдож, test орчинд дуудсаны дараа тулгана.
          </p>
        ) : null}
        {endpoint.note ? <p className="mt-3 text-caption text-muted">{endpoint.note}</p> : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <p className="text-body font-semibold text-ink">
            {outputs.length > 0 ? "Синк хийсэн мэдээлэл" : "Илгээх мэдээлэл"}
          </p>
          <Badge tone="mint">
            <CheckCircle2 size={13} aria-hidden />
            {demoMode ? "Demo ESIS синк" : "Live ESIS синк"}
          </Badge>
          <Badge tone="sky">{endpoint.sampleRows.length} бичлэг</Badge>
        </div>

        <div className="mt-3">
          <EsisRowValues columns={columns} rows={endpoint.sampleRows} />
        </div>

        <p className="mt-6 text-body font-semibold text-ink">
          {outputs.length > 0
            ? `Гаралтын бүх талбар (${outputs.length})`
            : `Илгээх бүх талбар (${inputs.length})`}
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {endpoint.fields.map((field) => (
            <li
              key={field.name}
              className="rounded-row border border-border bg-surface px-3 py-2 text-caption"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block break-words text-body font-medium text-ink">
                    {field.label}
                  </span>
                  <span className="mt-1 block break-all font-mono text-caption text-faint">
                    {field.name}
                  </span>
                </span>
                <Badge tone={field.io === "INPUT" ? "peach" : field.ingested ? "mint" : "sun"}>
                  {field.io === "INPUT" ? "Илгээнэ" : field.ingested ? "Авна" : "Авахгүй"}
                </Badge>
              </span>
              {field.omitReason ? (
                <span className="mt-2 block text-muted">{field.omitReason}</span>
              ) : null}
            </li>
          ))}
        </ul>

        {/* Demo is already visible above. This action is only for replacing it
            with a live, read-only ESIS response. */}
        {endpoint.readable && !demoMode ? (
          <div className="mt-4 flex justify-end border-t border-border pt-4">
            <EsisPullButton resource={endpoint.key} label="Бодит ESIS-ээс татах" />
          </div>
        ) : null}
      </section>
    </Card>
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
  const demoMode = !data.deployment.configured;
  const canRun = data.canPreview || demoMode;
  const resources = data.endpoints.filter(
    (endpoint): endpoint is typeof endpoint & { key: EsisPreviewResourceKey } =>
      endpoint.previewable,
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
            <Button disabled={!canRun || selected.length === 0 || pending} onClick={onRun}>
              <Eye aria-hidden />
              {pending ? "Шалгаж байна…" : "Синк шалгах"}
            </Button>
          }
        />

        {demoMode ? (
          <Card pad="compact" tone="mint" className="mb-4">
            <p className="flex items-center gap-2 text-body font-medium text-ink">
              <CheckCircle2 size={18} className="text-mint-ink" aria-hidden />
              Demo ESIS sandbox холболт бэлэн. Сонгосон мэдээллийг синк шалгалтаар харуулна.
            </p>
          </Card>
        ) : !data.canPreview ? (
          <Card pad="compact" tone="sun" className="mb-4">
            <p className="text-body font-medium text-ink">Live ESIS dry-run эрх хүлээгдэж байна.</p>
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
          <p
            role="alert"
            className="mt-4 rounded-control bg-danger-soft px-4 py-3 text-body text-danger"
          >
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
                  {item.preview.length > 0 && endpoint ? (
                    <SunkenPanel className="mt-4 overflow-x-auto">
                      {/*
                       * Every ingested field of every returned row, not a
                       * summary line and not just the first record. "Ирлээ" and
                       * "ирсэн утга нь зөв үү" are different questions, and only
                       * the second one is answerable from values.
                       */}
                      <EsisRowValues
                        columns={esisSampleColumns(endpoint.fields)}
                        rows={item.preview}
                      />
                      {item.count > item.preview.length ? (
                        <p className="mt-3 text-caption text-muted">
                          Эхний {item.preview.length} мөрийг харуулав — нийт {item.count} мөр
                          татсан.
                        </p>
                      ) : null}
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

function RunHistory({ runs, demoMode }: { runs: EsisOverview["recentRuns"]; demoMode: boolean }) {
  const visibleRuns: EsisOverview["recentRuns"] =
    runs.length > 0 || !demoMode
      ? runs
      : [
          {
            id: "00000000-0000-4000-8000-000000000171",
            status: "SUCCEEDED",
            resources: ["organization", "groups", "students", "teachers"],
            summary: { records: 15, mode: "DEMO" },
            errorCode: null,
            startedAt: "2026-09-08T01:15:00.000Z",
            finishedAt: "2026-09-08T01:15:02.000Z",
            initiatedBy: "Demo ESIS scheduler",
          },
        ];

  if (visibleRuns.length === 0) {
    return (
      <EmptyState
        title="Синк ажиллагааны түүх"
        description="Demo sandbox-ийн дараагийн синк ажиллагаа энд бүртгэгдэнэ."
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
          {visibleRuns.map((run) => (
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

function buildDemoPreview(
  data: EsisOverview,
  selected: EsisPreviewResourceKey[],
): EsisPreviewResult {
  return {
    runId: "00000000-0000-4000-8000-000000000171",
    dryRun: true,
    status: "SUCCEEDED",
    results: selected.map((resource, index) => {
      const endpoint = data.endpoints.find((candidate) => candidate.key === resource);
      const rows = endpoint?.sampleRows ?? [];
      /*
       * ★ The count is the number of rows, not a figure of its own. It used to
       * be a hand-kept table, which is how "10 бичлэг" came to sit above one
       * row — a dry-run whose own summary disagrees with what it shows is worse
       * than no dry-run.
       */
      return {
        resource,
        count: rows.length,
        durationMs: 118 + index * 37,
        preview: rows,
        status: "SUCCEEDED" as const,
        errorCode: null,
      };
    }),
  };
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

function Definition({
  label,
  value,
  breakAll = false,
}: {
  label: string;
  value: string;
  breakAll?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-caption font-semibold text-muted">{label}</dt>
      <dd className={cn("mt-1 text-body font-medium text-ink", breakAll && "break-all")}>
        {value}
      </dd>
    </div>
  );
}
