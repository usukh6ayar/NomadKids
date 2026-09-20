"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import {
  CheckCircle2,
  CircleAlert,
  Database,
  Eye,
  FlaskConical,
  History,
  KeyRound,
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
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { esisApiIdLabel } from "@/components/esis/esis-params";
import { EsisRowValues, esisSampleColumns } from "@/components/esis/esis-rows";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader, SunkenPanel } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";

type Tab = "overview" | "apis" | "requests" | "preview" | "history";

const TABS: { value: Tab; label: string; icon: typeof Database }[] = [
  { value: "overview", label: "Ерөнхий", icon: Network },
  { value: "apis", label: "Сервис ба талбар", icon: ShieldCheck },
  { value: "requests", label: "Эрхийн хүсэлт", icon: KeyRound },
  { value: "preview", label: "Синк шалгалт", icon: FlaskConical },
  { value: "history", label: "Түүх", icon: History },
];

/** How a grant reads on screen, and in which colour. */
const GRANT_LABEL: Record<
  EsisOverview["endpoints"][number]["grant"],
  { text: string; tone: "mint" | "sun" | "danger" | "neutral" }
> = {
  APPROVED: { text: "Зөвшөөрөгдсөн", tone: "mint" },
  PENDING: { text: "Хүлээгдэж байна", tone: "sun" },
  CANCELLED: { text: "Цуцлагдсан", tone: "danger" },
  NOT_REQUESTED: { text: "Хүсэлт гараагүй", tone: "neutral" },
};

/**
 * Where a service's field names came from, as the operator sees it.
 *
 * ★ Three values, not two — 2026-09-14. This was a ternary on `=== "PORTAL"`,
 * so everything that was not read off the catalogue page shared one badge, and
 * a field list verified against a real ESIS response looked exactly like one
 * nobody had ever checked. Nine services were in the second group and all nine
 * were wrong.
 *
 * "Амьд хариунаас" is the strongest of the three: the catalogue documents a
 * name, a payload proves it.
 */
const FIELD_SOURCE_LABEL: Record<
  EsisOverview["endpoints"][number]["fieldSource"],
  { text: string; tone: "mint" | "sky" | "peach" }
> = {
  LIVE: { text: "Амьд хариунаас", tone: "mint" },
  PORTAL: { text: "Каталогоос", tone: "sky" },
  ADAPTER: { text: "Адаптерын схемээр", tone: "peach" },
};

const DOMAIN_LABEL: Record<EsisOverview["endpoints"][number]["domain"], string> = {
  ORGANIZATION: "Байгууллага",
  ROSTER: "Хүүхэд ба хүний нөөц",
  ATTENDANCE: "Ирц",
  FOOD: "Хоолны лавлах",
  // Added 2026-09-15 with the twenty health, vaccine, measurement and
  // screening services — kept apart from ROSTER because one is a medical
  // record and the other is a child's name and group.
  HEALTH: "Эрүүл мэнд",
};

/**
 * The platform operator's ESIS hub, for one kindergarten.
 *
 * ★ **This screen was `/admin/integrations/esis` until 2026-09-14**, where a
 * kindergarten's own director reached it. It moved at the client's request
 * ("захирал дээр ESIS системийн зүйл байх нь зөв уу? superadmin дээр байх нь
 * зөв"), and the request is right on the facts: `ESIS_TOKEN` and
 * `ESIS_BASE_URL` are deployment environment settings, one ESIS developer
 * account serves every kindergarten, and the institution mapping on
 * `/platform/[id]` was already superadmin-only. A director could read every
 * blocker here and clear none of them.
 *
 * ★★ What a director kept is the working surface, and it never lived here: the
 * "ESIS-ээс татах" buttons on the roster, the child record and the day sheet
 * (`EsisDataPanel`, `GET …/esis/catalog` + `…/esis/resource`). This screen is
 * the operator's — token state, granted scope, the dry run, the run history.
 *
 * ★★★ **2026-09-17 — the manual "Татах" buttons briefly lived on this screen
 * and moved to `/admin/esis-sync`.** They called `POST …/kindergartens/:id/
 * esis/sync`, which sits behind `KindergartenEsisController`'s tenant `ADMIN`
 * membership check, not the platform flag this page is gated on — the same
 * "системийн зүйл" (systemic) vs. "ажлын гадаргуу" (working surface) line the
 * 2026-09-14 move itself drew. A sync spends *that* kindergarten's token
 * against *its* roster and feeds *its* screens, which is a working-surface
 * action a director presses, not a platform one. The read-only dry run stays
 * here, on the operator's own route (`POST …/platform/kindergartens/:id/
 * esis/preview`), because it changes nothing tenant-scoped to gate.
 */
export default function EsisIntegrationPage() {
  return (
    <RequireSuperAdmin>
      <EsisIntegration />
    </RequireSuperAdmin>
  );
}

function EsisIntegration() {
  const params = useParams<{ id: string }>();
  const kindergartenId = params.id;
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
    queryKey: qk.esis(kindergartenId),
    queryFn: () => get(`/platform/kindergartens/${kindergartenId}/esis`, esisOverviewSchema),
  });

  const runPreview = useMutation({
    mutationFn: () =>
      mutate(`/platform/kindergartens/${kindergartenId}/esis/preview`, esisPreviewResultSchema, {
        method: "POST",
        body: { resources: selected },
      }),
    onSuccess: (result) => {
      setPreview(result);
      void queryClient.invalidateQueries({ queryKey: qk.esis(kindergartenId) });
    },
  });

  const header = (
    <PlatformPageHeading
      /*
       * ★ Explicit, because the derived answer is one level too far.
       *
       * `useAutoBackHref` walks up to the nearest destination the menu names,
       * and the operator's menu names `/platform` — not `/platform/:id`, which
       * has no row of its own. Back from a kindergarten's ESIS panel means its
       * own page, so this screen genuinely knows better than the walk.
       *
       * ★★ It also replaced three `<BackButton className="ml-0" />` renders —
       * one per branch — that sat on their own row **above** this header. That
       * was the only place left in the product where Буцах was not on the
       * title's line, and once the header began deriving one it was two arrows
       * stacked on top of each other.
       */
      backHref={`/platform/${kindergartenId}`}
      title="ESIS мэдээллийн төв"
      lede="Платформын ESIS хандалт — token, зөвшөөрөгдсөн сервис, шалгалт"
      mark={<Database />}
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
          title={isNotFound(overview.error) ? "Олдсонгүй" : "Алдаа гарлаа"}
          description={
            isNotFound(overview.error) ? "Энэ цэцэрлэг олдсонгүй." : errorMessage(overview.error)
          }
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

      <section aria-label="ESIS бэлэн байдлын үе шат">
        <h2 className="mb-3 text-title font-bold text-ink">Бэлэн байдлын үе шат</h2>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          {data.stages.map((stage) => {
            const ready = stage.status === "READY";
            return (
              <Card
                key={stage.code}
                pad="compact"
                tone={ready ? "mint" : "sun"}
                className="bg-[linear-gradient(135deg,#ffffff_0%,#f4f9fc_100%)] shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-caption font-bold text-primary">{stage.code}</p>
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
        </div>
      </section>

      <div
        role="tablist"
        aria-label="ESIS удирдлагын харагдац"
        className="mt-1 flex max-w-full gap-1 overflow-x-auto rounded-card border border-border bg-surface p-1.5 shadow-sm"
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
        {tab === "requests" ? <RequestRegister requests={data.requests} /> : null}
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
            <Badge tone="mint">
              <CheckCircle2 size={13} aria-hidden />
              Live холбогдсон
            </Badge>
          }
        />
        <Card pad="roomy">
          <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {/*
              ★ Was `connection.environment ?? "LIVE"` until 2026-09-19. The
              fallback was doing all the work: the ministry runs no ESIS test
              environment, so the field only ever held 'PRODUCTION' or null and
              the column is gone. "LIVE" is now simply the truth, stated once.
            */}
            <Definition label="Орчин" value="LIVE" />
            {/*
              ★ "Холбогдоогүй", not a fallback id — 2026-09-14. This read
              `?? "40305"`, the demo institution, so an unmapped kindergarten
              displayed somebody else's code as though it were its own.
            */}
            <Definition
              label="Байгууллагын код"
              value={data.connection.institutionId ?? "Холбогдоогүй"}
            />
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
        lede={`${data.endpoints.length} endpoint · ${totalOutputs} гаралтын талбар · ${totalInputs} илгээх талбар · live access идэвхтэй.`}
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
      <EndpointFields endpoint={selected} />

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
function EndpointFields({ endpoint }: { endpoint: EsisOverview["endpoints"][number] }) {
  const [view, setView] = useState<"request" | "response" | "mapping" | "log">("response");
  const outputs = endpoint.fields.filter((field) => field.io === "OUTPUT");
  const inputs = endpoint.fields.filter((field) => field.io === "INPUT");
  const omitted = outputs.filter((field) => !field.ingested).length;
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
            {/*
              The portal's own name for the id, when it differs from ours. It is
              how an operator checks a row against the developer portal without
              our help — and how a wrong id shows itself, as `studentInfo`'s did.
            */}
            {endpoint.portalName && endpoint.portalName !== endpoint.name ? (
              <p className="mt-1 text-caption text-muted">Порталын нэр: {endpoint.portalName}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={GRANT_LABEL[endpoint.grant].tone}>
              {GRANT_LABEL[endpoint.grant].text}
            </Badge>
            {outputs.length > 0 ? <Badge tone="sky">{outputs.length} гаралт</Badge> : null}
            {inputs.length > 0 ? <Badge tone="peach">{inputs.length} оролт</Badge> : null}
            {omitted > 0 ? <Badge tone="sun">{omitted} авахгүй</Badge> : null}
            <Badge tone={FIELD_SOURCE_LABEL[endpoint.fieldSource].tone}>
              {FIELD_SOURCE_LABEL[endpoint.fieldSource].text}
            </Badge>
          </div>
        </div>

        {endpoint.fieldSource === "ADAPTER" ? (
          <p className="mt-3 text-caption text-muted">
            Эдгээр нь манай адаптер уншиж авдаг талбарууд. ESIS-ээс бодит хариу ирээгүй тул
            баталгаажаагүй байна.
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
              endpoint.httpStatus === null ? "Хариу хүлээгдэж байна" : String(endpoint.httpStatus)
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
          <Badge tone="mint">
            <CheckCircle2 size={13} aria-hidden />
            LIVE
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
              {/*
                ★ "Гэрээ", not "Response output" — 2026-09-14. This block shows
                the shape a response takes, never a response: the samples that
                used to fill it were invented, and an operator checking whether
                the integration works must not be shown something that looks
                like it already did.
              */}
              <p className="text-body font-semibold text-ink">Хариуны бүтэц · бүх safe field</p>
              <Badge tone={endpoint.httpStatus === null ? "peach" : "mint"}>
                {endpoint.httpStatus === null ? "NOT ENABLED" : "LIVE"}
              </Badge>
            </div>
            <JsonBlock value={responseExample(endpoint)} />
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
              value={endpoint.httpStatus === null ? "—" : String(endpoint.httpStatus)}
            />
            <Definition label="Mode" value={endpoint.responseMode} />
            <Definition label="Error code" value={endpoint.syncErrorCode ?? "—"} />
          </dl>
        ) : null}

        {/*
          ★ The per-service "ESIS-ээс татах" button is **not** here, and was
          removed when this screen became the operator's on 2026-09-14.
          `EsisPullButton` calls `GET /kindergartens/:id/esis/resource`, which a
          platform operator cannot reach: a superadmin holds no `Membership`
          (CLAUDE.md §1.1), so the route answers 404 for them by design. A
          button that always fails is worse than no button.

          The operator's live check is the "Синк шалгалт" tab, which spends the
          same token against the same services through a route that is theirs.
          The staff-facing pull buttons are unchanged on the screens that draw
          them — the roster, a child's record, the day sheet.
        */}
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

/**
 * The envelope shape this service answers in — **field names, not values.**
 *
 * ★ Rewritten 2026-09-14. It used to return a `DEMO_SUCCESS` envelope wrapped
 * around the catalog's invented rows, so the operator screen rendered a
 * complete-looking ESIS response for a service nobody had called. With the
 * samples gone the honest version of the same answer is the *contract*: the
 * envelope's own keys, and the field names a `RESULT` row carries, each mapped
 * to its type rather than to a made-up value.
 *
 * A reader comparing this against the ministry's portal can still check every
 * name. What they can no longer do is mistake it for a response.
 */
function responseExample(endpoint: Endpoint): unknown {
  const direction = endpoint.method === "POST" && !endpoint.readable ? "INPUT" : "OUTPUT";
  const names = endpoint.fields
    .filter((field) => field.io === direction && field.ingested)
    .map((field) => field.name);

  return {
    SUCCESS_CODE: "number",
    RESPONSE_MESSAGE: "string",
    RESULT: [Object.fromEntries(names.map((name) => [name, "string | null"]))],
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

/**
 * Who sees which ESIS services, as `esisServicesForActor` decides it.
 *
 * ★ Rewritten 2026-09-14 with the move of this screen to the platform
 * operator. Two of these rows had gone stale and the lede had become false:
 * it said raw endpoint detail is for "удирдлага", and after the move the
 * director does not see this screen at all. The cook's seven `cook/*` reads
 * and the accountant's two income statements landed on 2026-09-09 and were
 * still listed here as NOT ENABLED.
 */
function RoleCoverage() {
  const rows = [
    [
      "Платформын оператор",
      "Token, base URL, эрхийн бүртгэл, blocker, dry-run, ажиллагааны түүх — энэ дэлгэц",
      "ENABLED",
    ],
    [
      "Удирдлага (эрхлэгч)",
      "Каталогийн бүх сервис ажлын дэлгэцээс: байгууллага, бүлэг, багш, хүүхэд, хөтөлбөр. Token болон deployment-ийн төлөв харахгүй",
      "ENABLED",
    ],
    ["Багш", "Өөрийн профайл, бүлэг, хүүхэд, өрхийн маягт, ирцийн request/response", "ENABLED"],
    ["Эцэг эх", "Өөрийн хүүхдэд sync болсон safe талбар; raw API болон token харахгүй", "LIMITED"],
    ["Тогооч", "Хоолны лавлахын 7 унших сервис; бичих сервис байхгүй", "ENABLED"],
    [
      "Нягтлан",
      "Хоолны төвлөрүүлэх орлогын маягт 1, 2 — зөвхөн унших. ESIS-д тусдаа finance endpoint байхгүй тул зохиогоогүй",
      "ENABLED",
    ],
  ] as const;

  return (
    <section className="mt-8" aria-labelledby="esis-role-coverage">
      <SectionHeader
        id="esis-role-coverage"
        title="Role тус бүрийн ESIS харагдац"
        lede="Raw endpoint, token болон deployment-ийн төлөвийг зөвхөн платформын оператор харна; цэцэрлэгийн role бүр ажлын хүрээндээ багасгасан мэдээлэл авна."
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
                      {item.status === "SUCCEEDED" ? "Амжилттай" : item.errorCode}
                    </Badge>
                  </div>
                  {item.preview.length > 0 && endpoint ? (
                    <SunkenPanel className="mt-4 min-w-0">
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

/**
 * The deployment's ESIS request register — what the ministry granted, and how
 * much of it this product calls.
 *
 * ★ The operator's own question, and the reason this screen is theirs: the
 * grants belong to one ESIS developer account that serves every kindergarten,
 * so "хэдэн хүсэлт зөвшөөрөгдсөн, хэдийг нь ашиглаж байна" is a platform
 * figure. A director cannot file a request and cannot answer for one.
 *
 * ★★ The counts are computed from the register joined against the catalog by
 * `apiId` — no hand-kept total to drift. `reviewedAt` is on screen because no
 * ESIS service reports a token's own scope: this is a list read off the portal
 * by hand, and the date is what keeps it a snapshot rather than a claim.
 */
function RequestRegister({ requests }: { requests: EsisOverview["requests"] }) {
  const { counts } = requests;
  const summary: { label: string; value: number; tone: "mint" | "sun" | "sky" | "peach" }[] = [
    { label: "Зөвшөөрөгдсөн", value: counts.approved, tone: "mint" },
    { label: "Ашиглаж байгаа", value: counts.wired, tone: "sky" },
    { label: "Хүлээгдэж байна", value: counts.pending, tone: "sun" },
    { label: "Цуцлагдсан", value: counts.cancelled, tone: "peach" },
  ];

  return (
    <section aria-labelledby="esis-requests-heading">
      <SectionHeader
        id="esis-requests-heading"
        title="ЭСИС-д илгээсэн эрхийн хүсэлт"
        lede={`Нийт ${counts.total} хүсэлт · порталаас ${requests.reviewedAt}-нд тулгав`}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {summary.map((item) => (
          <Card key={item.label} pad="compact" tone={item.tone}>
            <p className="text-caption font-semibold text-muted">{item.label}</p>
            <p className="mt-1 text-display font-semibold text-ink">{item.value}</p>
          </Card>
        ))}
      </div>

      <p className="mt-4 text-caption text-muted">
        Зөвшөөрөгдсөн {counts.approved} сервисийн {counts.wired}-г нь систем дуудаж байна. Үлдсэн{" "}
        {counts.approvedUnwired} нь эрх нь нээлттэй боловч энэ бүтээгдэхүүнд хараахан холбогдоогүй —
        дуудах дэлгэц, талбарын жагсаалт нь бэлэн болсон үед нэмэгдэнэ.
      </p>

      <TableShell
        className="mt-4"
        caption="ЭСИС-д илгээсэн хүсэлт бүрийн төлөв"
        minWidth="min-w-0"
        stacked
      >
        <thead>
          <tr>
            <Th>API</Th>
            <Th>Нэр</Th>
            <Th>Бүлэг</Th>
            <Th>Огноо</Th>
            <Th>Төлөв</Th>
            <Th>Ашиглалт</Th>
          </tr>
        </thead>
        <tbody>
          {requests.items.map((item) => (
            <tr key={item.apiId}>
              <Td data-label="API">
                <span className="break-all font-mono text-caption">{item.apiId}</span>
              </Td>
              <Td data-label="Нэр">{item.name}</Td>
              <Td data-label="Бүлэг">{item.group}</Td>
              <Td data-label="Огноо">{item.requestedAt}</Td>
              <Td data-label="Төлөв">
                <Badge tone={GRANT_LABEL[item.status].tone}>{GRANT_LABEL[item.status].text}</Badge>
              </Td>
              <Td data-label="Ашиглалт">
                {item.serviceKey ? (
                  <Badge tone="sky">{item.serviceKey}</Badge>
                ) : (
                  <span className="text-caption text-muted">Холбоогүй</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </section>
  );
}

/**
 * The "Түүх" tab: `overview.recentRuns`, the platform's own fixed-ten list.
 *
 * ★ **Not `sync-runs`.** That paginated route lives on
 * `KindergartenEsisController`, gated `@Roles("ADMIN")` with no
 * `@AllowSuperAdmin` marker, then `TenantAccessService.assertAdmin` inside
 * `EsisSyncService.listRuns` — it asks whether *this* actor holds an `ADMIN`
 * membership at *this* kindergarten, which a pure platform operator's
 * `isSuperAdmin` flag does not answer (verified directly against
 * `roles.guard.ts` and `tenant-access.service.ts` — no bypass exists for
 * either). This screen's own `overview` route
 * (`GET /platform/kindergartens/:id/esis`) is the one thing an operator can
 * always reach, so the history here reads its `recentRuns` rather than a list
 * that would 404 for exactly the account this screen is built for.
 *
 * The manual "Татах" buttons and the paginated history behind them moved to
 * `/admin/esis-sync` — the kindergarten's own `ADMIN`-gated screen — for the
 * same reason: a sync spends *that* kindergarten's token on *its* roster, and
 * `sync-runs` only ever answers for someone who holds that membership.
 */
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
              <Td data-label="Ажиллуулсан">{run.initiatedBy ?? "хуваарь"}</Td>
              <Td data-label="Эх үүсвэр">
                <Badge tone="mint">{run.mode}</Badge>
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
