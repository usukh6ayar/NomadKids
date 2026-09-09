"use client";

import { useQuery } from "@tanstack/react-query";
import { CloudDownload, Database } from "lucide-react";
import { useState } from "react";
import {
  esisScopedCatalogSchema,
  esisResourceReadSchema,
  type EsisResourceKey,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { EsisRowValues, esisSampleColumns } from "@/components/esis/esis-rows";
import {
  ESIS_DEMO_PARAM,
  ESIS_PARAM_LABEL,
  esisApiIdLabel,
  isPersonalParam,
} from "@/components/esis/esis-params";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { LoadingState } from "@/components/ui/states";

/** The Mongolian sentence behind each upstream failure code. */
const ERROR_LABEL: Record<string, string> = {
  UNAUTHORIZED: "Token хүчингүй эсвэл хугацаа нь дууссан байна.",
  SCOPE_DENIED: "Энэ API-д манай token-д эрх олгоогүй байна.",
  TIMEOUT: "ESIS хугацаанд хариу өгсөнгүй.",
  NETWORK: "ESIS сервертэй холбогдож чадсангүй.",
  INVALID_RESPONSE: "ESIS-ийн хариу гэрээнд тохирохгүй байна.",
  NOT_CONFIGURED: "Server дээр ESIS тохиргоо алга байна.",
  HTTP: "ESIS алдаатай хариу буцаалаа.",
  UNKNOWN: "Тодорхойгүй алдаа гарлаа.",
};

/**
 * One ESIS service, **on the screen that uses it** — not behind a dialog.
 *
 * ★ The dialog was the wrong shape for the director's question. `EsisPullButton`
 * answers "what would ESIS say if I asked?", which is the integration
 * engineer's question; the director's is "what does ESIS hold about my
 * kindergarten?", and the answer to that belongs beside the local copy it is
 * meant to be compared against. `/settings` has shown a teacher their own ESIS
 * record inline since it shipped, and it reads as connected because nothing has
 * to be pressed for the data to be there. This is that panel, for a service.
 *
 * ★★ So the values are present on first paint — demo rows when no token is
 * configured, live rows once one is — and the button **replaces** them rather
 * than revealing them. That ordering is what keeps the badge honest: a screen
 * whose data appears only after a press invites the reader to assume the press
 * called the ministry, whether or not it did.
 *
 * ★★★ Never mixed. Live rows replace the demo set entirely, so an invented
 * tenant name is never on screen beside a real one.
 *
 * ★★★★ **The `Demo ESIS синк` badge is gone from this panel — 2026-09-08, at
 * the client's explicit instruction**, asked for twice: the screen is to read
 * as a connected system, "яг л ESIS-тэй холбогдчихсон датагаа тэндээс нь авч
 * байгаа мэт". The concern was put to them in writing first — that the demo
 * tenant is invented, so an unlabelled panel puts "Бяцхан нүүдэлчид (жишээ)"
 * on a director's screen as if it were their own record — and they chose it
 * anyway, with the demo values kept as they are.
 *
 * So the label is recorded here instead of on screen. `/admin/integrations/esis`
 * keeps its badges: that screen exists to say which services are live and which
 * are not, and is where anybody asking "is this real?" is sent.
 */
export function EsisDataPanel({
  resource,
  params,
  rows: given,
  hrefs,
  linkField,
  title,
  description,
  headingId,
  askForParams = true,
  autoRead = false,
  showResponseDetails = false,
  actionLabel,
  detail,
  compact = false,
}: {
  resource: EsisResourceKey;
  /** Path values the caller already knows — a group id, a date. */
  params?: Record<string, string | undefined>;
  /**
   * Records to show in place of the catalog's own, while no live read has
   * replaced them.
   *
   * ★ For the one screen whose rows have to be *reachable*: `/children` builds
   * them from the kindergarten's own children so that every row is a child
   * this product holds a record for, and `hrefs` can lead there. The catalog's
   * demo roster is ten invented people who match nobody, so a link on it would
   * lead nowhere — which is how the roster lost its way into a child's record
   * in the first place.
   */
  rows?: Record<string, string | null>[];
  /** Where each of `rows` leads, index-aligned. */
  hrefs?: (string | null)[];
  /** Which column carries the link — the name, on a roster. */
  linkField?: string;
  /**
   * Whether the panel may ask the reader for a path value it lacks.
   *
   * ★ False on a screen that is already about one record — 2026-09-09, at the
   * client's instruction. A child's own page identifies the child; a register
   * box there is a second search on a screen about one person, and the client
   * did not want the "add a регистр first" sentence either. So the panel shows
   * what ESIS holds and simply cannot run a live pull until the number is on
   * the record.
   *
   * True everywhere else, which is where searching among many belongs.
   */
  askForParams?: boolean;
  /** Overrides the service's catalog name in the section header. */
  title?: string;
  description?: string;
  headingId?: string;
  /** Calls the role-authorised ESIS reader as soon as its catalog is ready. */
  autoRead?: boolean;
  /** Shows request metadata and the complete ESIS response envelope inline. */
  showResponseDetails?: boolean;
  /** Overrides the generic pull command for a task-specific action. */
  actionLabel?: string;
  /**
   * Services to read for an opened row — the second half of "дээр нь дарахад
   * дэлгэрэнгүй", where the detail is another service rather than more columns.
   *
   * ★ This is the only way `foodKit` and `foodKitProducts` are reachable. Both
   * take `:productId`, and a panel of their own would ask the cook to type a
   * ministry product code into a box. Opening a `foodProducts` row supplies
   * the id from the record the reader just pressed.
   *
   * ★★ Read per opened row, never for the list. A list of forty products would
   * otherwise be forty outbound calls to the ministry and forty `AuditLog`
   * VIEW rows on first paint — §3.4's N+1, pointed at somebody else's server.
   */
  detail?: {
    resources: EsisResourceKey[];
    /** `name` is the path parameter; `from` is the row field that fills it. */
    param: { name: string; from: string };
  };
  /**
   * A panel nested inside an opened row: the service's name and its records,
   * and none of the page furniture.
   *
   * ★ Without this the drill-down renders a *second complete panel* inside a
   * table cell — database icon, `<h2>`, the slug/ID/path line, the record-count
   * badge, a "татах" button and the footer disclaimer — twice over, for the two
   * detail services. A page inside a page, on the screen whose instruction was
   * "зүгээр энгийн харагдуул".
   *
   * So a compact panel is a heading and the rows. There is no pull button
   * because there is nothing to press: `autoRead` has already run for the id
   * the row supplied, and a second button would offer to re-ask the ministry
   * the same question.
   */
  compact?: boolean;
}) {
  const { primaryKindergartenId } = useSession();
  const [entered, setEntered] = useState<Record<string, string>>({});
  const [pulled, setPulled] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  /*
   * ★ The role-scoped catalog, not the operator's overview — 2026-09-09.
   *
   * This read `/esis`, which is `@Roles("ADMIN")`, so the panel rendered for
   * nobody else — and the client began placing services on the teacher's
   * screens. `/esis/catalog` answers with the services the caller's own role
   * uses and nothing about the deployment, so a teacher's day sheet can draw
   * one without being handed the token's state and the run history.
   *
   * A service outside the caller's list simply is not in the response, and the
   * panel renders nothing rather than an error: the screens are shared, and a
   * cook opening one that carries a teacher's panel should see the screen, not
   * a hole where a permission failed.
   */
  const catalog = useQuery({
    queryKey: qk.esisCatalog(primaryKindergartenId ?? "none"),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis/catalog`, esisScopedCatalogSchema),
    enabled: Boolean(primaryKindergartenId),
    retry: false,
  });

  const endpoint = catalog.data?.endpoints.find((item) => item.key === resource);
  const demoMode = catalog.data?.mode === "DEMO";
  const required = endpoint?.params ?? [];

  /*
   * A demo deployment pre-fills the ESIS ids it invented, so the panel is
   * complete on first paint. It never pre-fills a personal identifier — see
   * `esis-params.ts`.
   */
  const value = (name: string) =>
    entered[name] ?? params?.[name] ?? (demoMode ? (ESIS_DEMO_PARAM[name] ?? "") : "") ?? "";
  const missing = required.filter((name) => !value(name));

  /*
   * ★ Ask only for what the caller has not already supplied — 2026-09-09, at
   * the client's instruction: "регистрийн дугаараар хайх зөвхөн олон хүүхэд
   * дундаас хайх үед л хэрэгтэй учир, зөвхөн нэг хүүхдэд хэрэггүй шүүдээ".
   *
   * A parameter this screen knows is not a question. On a child's own record
   * the register number is on the record; asking for it again turns a panel
   * that should simply show what ESIS holds into a form to fill in, and puts
   * a second register search on a screen about one child. The roster's
   * `studentByRegister` is where searching among many belongs, and there the
   * caller supplies nothing — so every field it needs is still asked for.
   */
  const asks = askForParams ? required.filter((name) => !params?.[name]) : [];

  const query = new URLSearchParams({ resource });
  for (const name of required) {
    if (value(name)) query.set(name, value(name));
  }

  const read = useQuery({
    queryKey: qk.esisResource(primaryKindergartenId ?? "none", resource, query.toString()),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis/resource?${query}`, esisResourceReadSchema),
    enabled: (autoRead || pulled) && Boolean(catalog.data?.canRead) && missing.length === 0,
    /*
     * ★ Opts out of the app-wide refetch policy, deliberately — the same
     * reasoning as `EsisPullButton`. This query calls the *ministry*: every
     * refetch is another outbound request and another `AuditLog` VIEW row
     * saying somebody read the roster. Alt-tabbing is not somebody reading the
     * roster. One press, one call.
     */
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    retry: false,
  });

  if (!primaryKindergartenId) return null;
  if (catalog.isPending) return <LoadingState rows={compact ? 1 : 3} />;
  // 404 for a role with no ESIS services, and absent for one this role does not
  // hold — either way there is nothing honest to draw.
  if (!endpoint) return null;

  const live = read.data?.status === "SUCCEEDED" ? read.data : null;
  // A live response replaces everything, `rows` included — the caller's records
  // are a stand-in for the catalog's, not something to merge with a real one.
  const rows = live ? live.rows : (given ?? endpoint.sampleRows);
  const columns = esisSampleColumns(live ? live.fields : endpoint.fields);

  /*
   * ★ The nested form: a heading, the records, and nothing else. Everything
   * the full panel adds — the icon, the slug/ID/path line, the badges, the
   * pull button, the response envelope, the footer — is page furniture, and a
   * table cell is not a page. See the `compact` prop for the whole argument.
   *
   * It sits below `rows`/`columns` rather than beside the earlier guards so it
   * reads the *same* two values the full panel draws — a compact panel that
   * recomputed them could disagree with its own expanded form.
   */
  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-caption font-semibold uppercase text-muted">
          {title ?? endpoint.name}
        </h3>
        {read.isFetching && !read.data ? (
          <LoadingState rows={1} />
        ) : rows.length === 0 ? (
          <p className="text-body text-muted">ESIS энэ сервисээр бичлэг буцаасангүй.</p>
        ) : (
          <EsisRowValues columns={columns} rows={rows} />
        )}
      </div>
    );
  }
  const heading = headingId ?? `esis-panel-${resource}`;
  const receivedAt = read.dataUpdatedAt
    ? new Date(read.dataUpdatedAt).toLocaleString("mn-MN")
    : null;

  async function pull() {
    setPulled(true);
    if (catalog.data?.canRead) {
      await read.refetch();
    } else {
      // No token: re-read our own catalog, which is what is actually shown.
      await catalog.refetch();
    }
    setSyncedAt(new Date().toLocaleString("mn-MN"));
  }

  return (
    <section aria-label={title ?? endpoint.name}>
      <Card pad="roomy" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start gap-3 border-b border-border-soft pb-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-sky text-sky-ink">
            <Database size={21} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={heading} className="font-semibold text-ink">
              {title ?? endpoint.name}
            </h2>
            <p className="mt-0.5 text-body text-muted">{description ?? endpoint.usage}</p>
            <p className="mt-1 break-all font-mono text-caption text-faint">
              {endpoint.slug} · {esisApiIdLabel(endpoint.apiId)} · {endpoint.method} {endpoint.path}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {showResponseDetails ? (
              <Badge tone={demoMode ? "sun" : "mint"}>
                {demoMode ? "ESIS DEMO DATA" : "ESIS LIVE"}
              </Badge>
            ) : null}
            <Badge tone="sky">{rows.length} бичлэг</Badge>
            <Button
              size="sm"
              variant="secondary"
              disabled={read.isFetching || missing.length > 0}
              onClick={() => void pull()}
            >
              <CloudDownload aria-hidden />
              {read.isFetching
                ? resource === "studentByRegister"
                  ? "Хайж байна…"
                  : "Татаж байна…"
                : autoRead && read.data
                  ? "Дахин татах"
                  : (actionLabel ?? "ESIS-ээс мэдээллээ татах")}
            </Button>
          </div>
        </div>

        {asks.length > 0 ? (
          <div>
            <div className="grid gap-3 sm:grid-cols-2">
              {asks.map((name) => (
                <Field key={name} label={ESIS_PARAM_LABEL[name] ?? name}>
                  {({ id }) => (
                    <Input
                      id={id}
                      type={name.endsWith("Date") ? "date" : "text"}
                      autoComplete={isPersonalParam(name) ? "off" : undefined}
                      autoCapitalize={isPersonalParam(name) ? "characters" : undefined}
                      maxLength={isPersonalParam(name) ? 32 : undefined}
                      value={value(name)}
                      onChange={(event) => {
                        const nextValue = isPersonalParam(name)
                          ? event.target.value.toUpperCase()
                          : event.target.value;
                        setEntered((current) => ({ ...current, [name]: nextValue }));
                      }}
                    />
                  )}
                </Field>
              ))}
            </div>
            <p className="mt-2 text-caption text-muted">
              {asks.some(isPersonalParam)
                ? "Регистрийн дугаарыг ESIS рүү илгээх ба хадгалахгүй."
                : "ESIS-ийн өөрийн дугаарыг ашиглана."}
            </p>
          </div>
        ) : null}

        {showResponseDetails ? (
          <div className="flex flex-col gap-4" aria-label="ESIS хүсэлт ба хариу">
            {demoMode ? (
              <p className="rounded-control border border-sun-ink/20 bg-sun px-4 py-3 text-body font-semibold text-sun-ink">
                ESIS DEMO DATA — LIVE CONNECTION NOT ACTIVE
              </p>
            ) : null}

            <dl className="grid overflow-hidden rounded-control border border-border-soft sm:grid-cols-2 xl:grid-cols-4">
              <ResponseFact label="Method" value={endpoint.method} />
              <ResponseFact
                label="Response mode"
                value={read.data?.source ?? (demoMode ? "MOCK" : "LIVE")}
              />
              <ResponseFact
                label="HTTP status"
                value={
                  read.data
                    ? `${read.data.response.SUCCESS_CODE}${read.data.source === "MOCK" ? " MOCK" : ""}`
                    : "Хүлээж байна"
                }
              />
              <ResponseFact label="Sync status" value={read.data?.status ?? "PENDING"} />
              <ResponseFact
                label="Request parameter"
                value={
                  required.length > 0
                    ? required
                        .map((name) => {
                          const currentValue = value(name);
                          return `${name}=${
                            isPersonalParam(name) && currentValue ? "••••••••" : currentValue || "—"
                          }`;
                        })
                        .join(", ")
                    : "Параметргүй"
                }
              />
              <ResponseFact
                label="Response message"
                value={read.data?.response.RESPONSE_MESSAGE ?? "Хүлээж байна"}
              />
              <ResponseFact
                label="Response count"
                value={read.data ? String(read.data.count) : "—"}
              />
              <ResponseFact
                label="Duration"
                value={
                  read.data?.durationMs === null || read.data?.durationMs === undefined
                    ? "—"
                    : `${read.data.durationMs} ms`
                }
              />
            </dl>

            <div>
              <p className="text-caption font-semibold uppercase text-muted">Request URL</p>
              <p className="mt-1 break-all rounded-control bg-canvas px-3 py-2 font-mono text-caption text-ink">
                {endpoint.method} {endpoint.path}
              </p>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-ink">Response output · Бүтэн JSON</h3>
                <span className="text-caption text-muted">
                  {receivedAt ? `Хүлээн авсан: ${receivedAt}` : "ESIS response хүлээж байна"}
                </span>
              </div>
              {read.isFetching && !read.data ? (
                <LoadingState rows={2} />
              ) : read.data ? (
                <pre className="mt-3 max-h-[520px] overflow-auto rounded-control bg-[#142033] p-4 font-mono text-caption leading-5 text-[#e8f2ff]">
                  {JSON.stringify(read.data.response, null, 2)}
                </pre>
              ) : (
                <p className="mt-3 text-body text-muted">Response хараахан ирээгүй байна.</p>
              )}
            </div>
          </div>
        ) : null}

        {read.isError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-soft px-4 py-3 text-body text-danger"
          >
            {errorMessage(read.error)}
          </p>
        ) : null}
        {read.data?.status === "FAILED" ? (
          <Card pad="compact" tone="peach">
            <p className="text-body font-semibold text-ink">ESIS хариу өгсөнгүй</p>
            <p className="mt-1 text-caption text-muted">
              {ERROR_LABEL[read.data.errorCode ?? "UNKNOWN"] ?? read.data.errorCode}
            </p>
          </Card>
        ) : null}

        {rows.length === 0 ? (
          <Card pad="compact">
            <p className="text-body text-muted">ESIS энэ сервисээр бичлэг буцаасангүй.</p>
          </Card>
        ) : (
          <EsisRowValues
            columns={columns}
            rows={rows}
            hrefs={live ? undefined : hrefs}
            linkField={linkField}
            renderDetail={
              detail
                ? (row) => {
                    const id = row[detail.param.from];
                    // A record the ministry returned without the id its detail
                    // services key on. Nothing honest to read, so nothing drawn
                    // — rather than a call with an empty path segment.
                    if (!id) return null;
                    return detail.resources.map((key) => (
                      <EsisDataPanel
                        key={key}
                        resource={key}
                        params={{ [detail.param.name]: id }}
                        askForParams={false}
                        autoRead
                        compact
                      />
                    ));
                  }
                : undefined
            }
          />
        )}

        <p className="border-t border-border-soft pt-4 text-caption text-muted">
          {syncedAt ? `Шинэчилсэн: ${syncedAt} · ` : null}
          Татахгүй талбар: регистр, иргэний бүртгэлийн дугаар, нэвтрэх мэдээлэл.
        </p>
      </Card>
    </section>
  );
}

function ResponseFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-b border-border-soft px-4 py-3 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="mt-1 break-words font-mono text-caption font-semibold text-ink">{value}</dd>
    </div>
  );
}
