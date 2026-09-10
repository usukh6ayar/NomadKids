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
  type EsisResourceKey,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth/session";
import { EsisPullButton } from "@/components/esis/esis-pull-button";
import { esisApiIdLabel } from "@/components/esis/esis-params";
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

      {data.deployment.demoMode ? (
        <Card pad="compact" tone="sun" className="mb-6">
          <div className="flex items-start gap-3">
            <FlaskConical className="mt-0.5 shrink-0 text-sun-ink" size={20} aria-hidden />
            <div>
              <p className="text-body font-semibold text-ink">ESIS integration demo / Mock data</p>
              <p className="mt-1 text-caption text-muted">
                Жинхэнэ ESIS холболт хийгдээгүй. Энэ горимд production request огт илгээгдэхгүй,
                зөвхөн зохиомол test өгөгдөл ашиглана.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <section
        aria-label="ESIS бэлэн байдлын үе шат"
        className="grid grid-cols-2 gap-3 xl:grid-cols-5"
      >
        {data.stages.map((stage) => {
          const ready = stage.status === "READY";
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
                {ready ? "Бэлэн" : "Хүлээгдэж байна"}
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
        <SectionHeader
          id="esis-connection-heading"
          title="Холболтын төлөв"
          action={
            <Badge tone={data.deployment.demoMode ? "sun" : "mint"}>
              {data.deployment.demoMode ? (
                <FlaskConical size={13} aria-hidden />
              ) : (
                <CheckCircle2 size={13} aria-hidden />
              )}
              {data.deployment.demoMode ? "Mock data · холболтгүй" : "Live холбогдсон"}
            </Badge>
          }
        />
        <Card pad="roomy">
          <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Definition
              label="Орчин"
              value={
                data.deployment.demoMode ? "DEMO / TEST" : (data.connection.environment ?? "LIVE")
              }
            />
            <Definition label="Байгууллагын код" value={data.connection.institutionId ?? "40305"} />
            <Definition
              label="Token"
              value={data.deployment.hasToken ? "Server дээр байна" : "Token хүлээгдэж байна"}
            />
            <Definition
              label="API хаяг"
              value={data.deployment.baseUrl || "https://hubv2.esis.edu.mn"}
              breakAll
            />
          </dl>
        </Card>
      </section>

      {data.deployment.demoMode ? (
        <Card pad="compact" tone="sun">
          <p className="flex items-center gap-2 text-body font-medium text-ink">
            <CircleAlert size={18} className="text-sun-ink" aria-hidden />
            MOCK transport идэвхтэй · ESIS сервер рүү сүлжээний дуудлага хийхгүй
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
  const [selectedKey, setSelectedKey] = useState<EsisResourceKey>("groups");
  const totalOutputs = data.endpoints.reduce(
    (sum, endpoint) => sum + endpoint.fields.filter((field) => field.io === "OUTPUT").length,
    0,
  );
  const totalInputs = data.endpoints.reduce(
    (sum, endpoint) => sum + endpoint.fields.filter((field) => field.io === "INPUT").length,
    0,
  );
  const selected =
    data.endpoints.find((endpoint) => endpoint.key === selectedKey) ?? data.endpoints[0]!;

  return (
    <section aria-labelledby="esis-api-heading">
      <SectionHeader
        id="esis-api-heading"
        title="API эрхийн матриц"
        lede={`${data.endpoints.length} endpoint · ${totalOutputs} гаралтын талбар · ${totalInputs} илгээх талбар · ${data.deployment.demoMode ? "mock transport" : "live access"} идэвхтэй.`}
      />
      <TableShell
        caption="ESIS endpoint-ийн ашиглалт ба эрхийн төлөв"
        /*
          ★ 2026-09-10: the four tables on this screen all carried a pixel
          floor (1040, 900, 760, 720) and therefore all scrolled sideways on
          anything narrower than a laptop. `stacked` gives each row a
          labelled block per column below `md` — the rule is defined once in
          `globals.css`.
        */
        minWidth="min-w-0"
        stacked
      >
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
              <Td data-label="API">
                <p className="font-semibold text-ink">{endpoint.slug}</p>
                <p className="text-caption text-muted">{esisApiIdLabel(endpoint.apiId)}</p>
              </Td>
              <Td data-label="Мэдээлэл">
                <p className="font-medium text-ink">{endpoint.name}</p>
                <p className="text-caption text-muted">{DOMAIN_LABEL[endpoint.domain]}</p>
              </Td>
              <Td data-label="Ашиглах хэсэг">{endpoint.usage}</Td>
              <Td data-label="Method">
                <Badge tone={endpoint.method === "GET" ? "sky" : "peach"}>{endpoint.method}</Badge>
              </Td>
              <Td data-label="Талбар">
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
              <Td data-label="Эрх">
                <Badge tone={accessTone(endpoint.accessStatus)}>
                  {endpoint.accessStatus.replace("_", " ")}
                </Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      <SectionHeader
        className="mt-8"
        title="Endpoint шалгах"
        lede="Endpoint сонгоод Request → Response → Field Mapping → Sync Log дарааллаар бүрэн шалгана."
      />
      <label className="mb-3 block max-w-2xl">
        <span className="mb-1.5 block text-caption font-semibold text-muted">API endpoint</span>
        <select
          value={selected.key}
          onChange={(event) => setSelectedKey(event.target.value as EsisResourceKey)}
          className="h-11 w-full rounded-control border border-border bg-surface px-3 text-body text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        >
          {data.endpoints.map((endpoint) => (
            <option key={endpoint.key} value={endpoint.key}>
              {endpoint.slug} · {endpoint.name} · {endpoint.method}
            </option>
          ))}
        </select>
      </label>
      <EndpointFields endpoint={selected} demoMode={data.deployment.demoMode} />

      <RoleCoverage />
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
  const [view, setView] = useState<"request" | "response" | "mapping" | "log">("response");
  const outputs = endpoint.fields.filter((field) => field.io === "OUTPUT");
  const inputs = endpoint.fields.filter((field) => field.io === "INPUT");
  const omitted = outputs.filter((field) => !field.ingested).length;
  const columns = esisSampleColumns(endpoint.fields);
  const mapped = endpoint.mappings.filter((mapping) =>
    ["DIRECT", "MATCH", "TRANSFORM", "REQUEST"].includes(mapping.strategy),
  ).length;

  return (
    <Card pad="compact">
      <section data-esis-fields={endpoint.key} aria-labelledby={`esis-fields-${endpoint.key}`}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-soft pb-4">
          <div className="min-w-0">
            <h3 id={`esis-fields-${endpoint.key}`} className="text-body font-semibold text-ink">
              {endpoint.name}
            </h3>
            <p className="mt-1 break-all font-mono text-caption text-muted">
              {endpoint.slug} · {esisApiIdLabel(endpoint.apiId)} · {endpoint.method} {endpoint.path}
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

        <dl className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2 xl:grid-cols-4">
          <Definition label="API нэр" value={endpoint.name} />
          <Definition label="Method" value={endpoint.method} />
          <Definition
            label="Direction"
            value={
              endpoint.direction === "ESIS_TO_NOMADKIDS" ? "ESIS → NomadKids" : "NomadKids → ESIS"
            }
          />
          <Definition
            label="Request parameter"
            value={requestParameterNames(endpoint).join(", ") || "Body ашиглахгүй"}
          />
          <Definition
            label="HTTP status"
            value={
              endpoint.httpStatus === null
                ? "Хариу хүлээгдэж байна"
                : `${endpoint.httpStatus} ${demoMode ? "MOCK" : ""}`.trim()
            }
          />
          <Definition label="Response mode" value={endpoint.responseMode} />
          <Definition label="NomadKids model" value={endpoint.targetModel} />
          <Definition
            label="Сүүлийн sync"
            value={endpoint.lastSyncAt ? formatRelative(endpoint.lastSyncAt) : "Ажиллуулаагүй"}
          />
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge tone={demoMode ? "sun" : "mint"}>
            {demoMode ? (
              <FlaskConical size={13} aria-hidden />
            ) : (
              <CheckCircle2 size={13} aria-hidden />
            )}
            {demoMode ? "ESIS DEMO DATA — LIVE CONNECTION NOT ACTIVE" : "LIVE"}
          </Badge>
          <Badge
            tone={
              endpoint.syncStatus === "FAILED"
                ? "danger"
                : endpoint.syncStatus === "PENDING"
                  ? "sun"
                  : "mint"
            }
          >
            {endpoint.syncStatus}
          </Badge>
          <Badge tone="sky">
            Mapped {mapped} / {endpoint.mappings.length} fields
          </Badge>
        </div>

        <div
          role="tablist"
          aria-label={`${endpoint.name} endpoint detail`}
          className="mt-5 flex max-w-full gap-1 overflow-x-auto border-b border-border"
        >
          {(
            [
              ["request", "Request"],
              ["response", "Response"],
              ["mapping", "Field Mapping"],
              ["log", "Sync Log"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className={cn(
                "h-10 shrink-0 border-b-2 px-3 text-body font-medium",
                view === value
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "request" ? (
          <div className="mt-4">
            <p className="text-body font-semibold text-ink">{endpoint.method} request</p>
            <JsonBlock value={requestExample(endpoint)} />
          </div>
        ) : null}

        {view === "response" ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-body font-semibold text-ink">Response output · бүх safe field</p>
              <Badge tone={endpoint.httpStatus === null ? "peach" : demoMode ? "sun" : "mint"}>
                {endpoint.httpStatus === null
                  ? "NOT ENABLED"
                  : demoMode
                    ? `${endpoint.httpStatus} MOCK`
                    : "LIVE"}
              </Badge>
              <Badge tone="sky">{endpoint.sampleRows.length} бичлэг</Badge>
            </div>
            <JsonBlock value={responseExample(endpoint)} />
            {outputs.length > 0 ? (
              <div className="mt-4">
                <EsisRowValues columns={columns} rows={endpoint.sampleRows} />
              </div>
            ) : null}
            <p className="mt-5 text-body font-semibold text-ink">
              {outputs.length > 0
                ? `Гаралтын бүх талбар (${outputs.length})`
                : `Илгээх бүх талбар (${inputs.length})`}
            </p>
            <FieldList fields={endpoint.fields} />
          </div>
        ) : null}

        {view === "mapping" ? (
          <div className="mt-4">
            <TableShell caption={`${endpoint.name} field mapping`} minWidth="min-w-0" stacked>
              <thead>
                <tr>
                  <Th>ESIS field</Th>
                  <Th>NomadKids model / field</Th>
                  <Th>Strategy</Th>
                  <Th>Тайлбар</Th>
                </tr>
              </thead>
              <tbody>
                {endpoint.mappings.map((mapping) => (
                  <tr key={mapping.sourceField}>
                    <Td data-label="ESIS field">
                      <code>{mapping.sourceField}</code>
                    </Td>
                    <Td data-label="NomadKids model / field">{mapping.targetField}</Td>
                    <Td data-label="Strategy">
                      <Badge tone={mappingTone(mapping.strategy)}>{mapping.strategy}</Badge>
                    </Td>
                    <Td data-label="Тайлбар">{mapping.note}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
        ) : null}

        {view === "log" ? (
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Definition label="Sync status" value={endpoint.syncStatus} />
            <Definition
              label="HTTP"
              value={
                endpoint.httpStatus === null
                  ? "—"
                  : `${endpoint.httpStatus} ${demoMode ? "MOCK" : ""}`.trim()
              }
            />
            <Definition label="Mode" value={endpoint.responseMode} />
            <Definition label="Error code" value={endpoint.syncErrorCode ?? "—"} />
          </dl>
        ) : null}

        {endpoint.readable && endpoint.accessStatus !== "NOT_ENABLED" ? (
          <div className="mt-4 flex justify-end border-t border-border pt-4">
            <EsisPullButton
              resource={endpoint.key}
              label={demoMode ? "Mock response шалгах" : "Бодит ESIS-ээс татах"}
            />
          </div>
        ) : null}
      </section>
    </Card>
  );
}

function FieldList({ fields }: { fields: EsisOverview["endpoints"][number]["fields"] }) {
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {fields.map((field) => (
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
  );
}

type Endpoint = EsisOverview["endpoints"][number];

const DEMO_PARAMETER: Record<string, string> = {
  studentGroupId: "10001",
  productId: "51001",
  dayDate: "2026-09-08",
  beginDate: "2026-09-01",
};

function requestParameterNames(endpoint: Endpoint): string[] {
  if (endpoint.method === "POST") return endpoint.fields.map((field) => field.name);
  return endpoint.domain === "FOOD" ? endpoint.params : ["institutionId", ...endpoint.params];
}

function requestExample(endpoint: Endpoint): unknown {
  if (endpoint.method === "POST") {
    return {
      institutionId: 40305,
      studentGroupId: 10001,
      dayDate: "2026-09-08",
      attendanceList: [
        {
          personId: 99000000000001,
          attendReasonCode: "PRESENT",
          tardyMinutes: 0,
          attendReasonList: [],
        },
      ],
    };
  }

  return Object.fromEntries(
    requestParameterNames(endpoint).map((name) => [
      name,
      name === "institutionId" ? "40305" : (DEMO_PARAMETER[name] ?? "DEMO_VALUE"),
    ]),
  );
}

function responseExample(endpoint: Endpoint): unknown {
  if (endpoint.method === "POST") {
    return {
      SUCCESS_CODE: 200,
      RESPONSE_MESSAGE: "DEMO_SUCCESS",
      RESULT: {
        status: "MOCK",
        accepted: true,
        acceptedCount: 1,
        referenceId: "MOCK-ATTENDANCE-20260908-001",
      },
    };
  }
  return {
    SUCCESS_CODE: 200,
    RESPONSE_MESSAGE: "DEMO_SUCCESS",
    RESULT: endpoint.sampleRows,
  };
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-3 max-h-[520px] overflow-auto rounded-control border border-border bg-ink p-4 font-mono text-caption leading-6 text-white">
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}

function accessTone(status: Endpoint["accessStatus"]): "mint" | "sun" | "peach" | "sky" {
  if (status === "ENABLED") return "mint";
  if (status === "MOCK") return "sun";
  if (status === "NOT_ENABLED") return "peach";
  return "sky";
}

function mappingTone(
  strategy: Endpoint["mappings"][number]["strategy"],
): "mint" | "sky" | "sun" | "peach" {
  if (strategy === "DIRECT" || strategy === "REQUEST") return "mint";
  if (strategy === "MATCH" || strategy === "TRANSFORM") return "sky";
  if (strategy === "REJECTED") return "peach";
  return "sun";
}

function RoleCoverage() {
  const rows = [
    ["Удирдлага", "Байгууллага, бүлэг, багш, хүүхэд, enrollment, progression", "ENABLED"],
    ["Багш", "Өөрийн профайл, бүлэг, хүүхэд, хөтөлбөр, ирцийн request/response", "ENABLED"],
    ["Эцэг эх", "Өөрийн хүүхдэд sync болсон safe талбар; raw API болон token харахгүй", "LIMITED"],
    ["Тогооч", "Food catalog endpoint-ийн service access баталгаажаагүй", "NOT ENABLED"],
    [
      "Нягтлан",
      "ESIS finance/payment endpoint тодорхойлогдоогүй; fake endpoint үүсгээгүй",
      "NOT ENABLED",
    ],
  ] as const;

  return (
    <section className="mt-8" aria-labelledby="esis-role-coverage">
      <SectionHeader
        id="esis-role-coverage"
        title="Role тус бүрийн ESIS харагдац"
        lede="Raw endpoint мэдээллийг зөвхөн удирдлага харна; бусад role ажлын хүрээндээ багасгасан мэдээлэл авна."
      />
      <TableShell caption="Role бүрийн ESIS мэдээллийн хүрээ" minWidth="min-w-0" stacked>
        <thead>
          <tr>
            <Th>Role</Th>
            <Th>Харагдах мэдээлэл</Th>
            <Th>Төлөв</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([role, scope, status]) => (
            <tr key={role}>
              <Td data-label="Role">
                <span className="font-semibold text-ink">{role}</span>
              </Td>
              <Td data-label="Харагдах мэдээлэл">{scope}</Td>
              <Td data-label="Төлөв">
                <Badge
                  tone={status === "ENABLED" ? "mint" : status === "LIMITED" ? "sky" : "peach"}
                >
                  {status}
                </Badge>
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
  const demoMode = data.deployment.demoMode;
  const canRun = data.canPreview;
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
          <Card pad="compact" tone="sun" className="mb-4">
            <p className="flex items-center gap-2 text-body font-medium text-ink">
              <FlaskConical size={18} className="text-sun-ink" aria-hidden />
              Mock dry-run ажиллана. ESIS сервер рүү request илгээгдэхгүй.
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
            lede={`Run ${result.runId} · ${result.mode} · дотоод мэдээлэлд өөрчлөлт оруулаагүй`}
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
                      {item.status === "SUCCEEDED"
                        ? item.source === "MOCK"
                          ? "DEMO_SUCCESS · MOCK"
                          : "Амжилттай"
                        : item.errorCode}
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

function RunHistory({ runs }: { runs: EsisOverview["recentRuns"] }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        title="Синк ажиллагааны түүх"
        description="Dry-run ажиллуулсны дараа MOCK эсвэл LIVE төлөвтэй түүх энд бүртгэгдэнэ."
        icon={<History aria-hidden />}
      />
    );
  }

  return (
    <section aria-labelledby="esis-history-heading">
      <SectionHeader id="esis-history-heading" title="Сүүлийн ажиллагаа" />
      <TableShell caption="ESIS dry-run ажиллагааны түүх" minWidth="min-w-0" stacked>
        <thead>
          <tr>
            <Th>Эхэлсэн</Th>
            <Th>Мэдээллийн багц</Th>
            <Th>Ажиллуулсан</Th>
            <Th>Эх үүсвэр</Th>
            <Th>Төлөв</Th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <Td data-label="Эхэлсэн">{formatRelative(run.startedAt)}</Td>
              <Td data-label="Мэдээллийн багц">{run.resources.length} багц</Td>
              <Td data-label="Ажиллуулсан">{run.initiatedBy}</Td>
              <Td data-label="Эх үүсвэр">
                <Badge tone={run.mode === "MOCK" ? "sun" : "mint"}>{run.mode}</Badge>
              </Td>
              <Td data-label="Төлөв">
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
