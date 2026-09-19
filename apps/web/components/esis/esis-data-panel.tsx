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
import { EsisNoAnswer } from "@/components/esis/esis-no-answer";
import { EsisRowValues, esisSampleColumns } from "@/components/esis/esis-rows";
import { ESIS_PARAM_LABEL, isPersonalParam } from "@/components/esis/esis-params";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

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
 * So the label is recorded here instead of on screen. `/platform/[id]/esis`
 * keeps its badges: that screen exists to say which services are live and which
 * are not, and is where anybody asking "is this real?" is sent.
 *
 * ★★★★★ **The technical half is gone — 2026-09-19**, at the client's
 * instruction: the panels "нэг тиим сонин демо юм шиг харагдуулаад байна …
 * энгийн болгоороой", prod and local alike.
 *
 * What went, and why none of it had an audience here:
 *
 * - `slug · api-128 · GET /v2/cook/levelHood/students` under every heading. A
 *   director does not have an api id; the only person who does is the platform
 *   operator, and that screen prints it itself.
 * - The `ESIS LIVE` badge, which said the same thing the rows already say.
 * - `showResponseDetails` and everything behind it — Method, Response mode,
 *   HTTP status, Sync status, Request URL and a dark `<pre>` of the raw
 *   envelope. It was set on exactly two product screens, `/children`'s
 *   РД-ээр хайх and `/kitchen/recipes`' Бэлэн бүтээгдэхүүн, so a teacher
 *   searching for a child and a cook reading the food catalogue were both
 *   shown a debugger. **`/platform/[id]/esis` does not render this component
 *   at all** — it has its own UI — so the block had no legitimate reader
 *   anywhere.
 * - The footer's field policy, replaced by a plain "Сүүлд шинэчилсэн".
 *
 * What stayed is what a person reading their kindergarten's data needs: the
 * name of the thing, a sentence about it, how many records came back, a button
 * to refresh, and the rows.
 */
export function EsisDataPanel({
  resource,
  params,
  rows: given,
  hrefs,
  liveHref,
  linkField,
  title,
  description,
  headingId,
  askForParams = true,
  autoRead = false,
  actionLabel,
  detail,
  compact = false,
  className,
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
  /**
   * Where one **live** ESIS row leads, worked out from the row itself.
   *
   * ★ Added 2026-09-14. `hrefs` is index-aligned with the caller's own `rows`
   * and is therefore meaningless once ESIS answers — the ministry's roster is
   * not in the caller's order and need not even be the same set. That is why
   * `hrefs` is dropped for a live read, and why this is a function: the only
   * honest way to link a returned row is to look at what is in it.
   *
   * `/children` uses it to match the ministry's roster against this
   * kindergarten's own children by name and date of birth — the same pairing
   * `attendance.service.ts` and `funding/food-discount.ts` use, because a name
   * alone is not enough to open somebody's record. A row that matches nothing,
   * or matches twice, leads nowhere rather than to a guess.
   */
  liveHref?: (row: Record<string, string | null>) => string | null;
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
  /**
   * Extra classes for the panel's own `<section>`.
   *
   * ★ Added 2026-09-10 so a page whose body sits in a narrow reading column
   * can still give the panel the full width. `/settings` and
   * `/admin/kindergarten` cap their content at 760px — the right width for a
   * form, and far too narrow for a table of ESIS records, which is what the
   * client was looking at when they asked for "дэлгэц дүүрэн".
   *
   * It is a class rather than a `wide` flag because the two callers want the
   * same thing by different means, and a boolean would have to guess which.
   */
  className?: string;
}) {
  const { primaryKindergartenId } = useSession();
  const [entered, setEntered] = useState<Record<string, string>>({});
  const [pulled, setPulled] = useState(false);
  /** When the reader last pressed "татах" for a **live** service — see `pull()`. */
  const [pulledAt, setPulledAt] = useState<string | null>(null);

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
  const required = endpoint?.params ?? [];

  /*
   * A demo deployment pre-fills the ESIS ids it invented, so the panel is
   * complete on first paint. It never pre-fills a personal identifier — see
   * `esis-params.ts`.
   */
  const value = (name: string) => entered[name] ?? params?.[name] ?? "";
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
  /*
   * ★ Live rows, or the caller's own — never invented ones.
   *
   * This ended `?? endpoint.sampleRows` until 2026-09-14, so a panel that had
   * not read yet, or had read and failed, drew a fabricated record under the
   * ministry's service name. With that gone the empty case falls through to
   * `EsisNoAnswer` below, which names the endpoint instead of filling the
   * space.
   *
   * `given` stays: those are rows the caller already holds from a real read,
   * passed in to save a second call.
   */
  const rows = live ? live.rows : (given ?? []);
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
          /*
           * ★ Told apart, but not through `EsisNoAnswer` — 2026-09-14.
           *
           * This branch said "бичлэг буцаасангүй" whether the service had
           * answered with an empty list or not answered at all, which are
           * different facts and lead to different actions. It says which now,
           * and names the service when the read failed.
           *
           * The full card is deliberately not used here: this panel renders
           * inside a table cell, and a bordered, toned, icon-bearing card in a
           * cell is the thing `compact` exists to avoid. Two lines of text
           * carry the same two facts at the weight this slot allows.
           */
          read.data?.status === "FAILED" ? (
            <div className="flex flex-col gap-0.5">
              <p className="text-body text-muted">ESIS-ээс хариу ирсэнгүй.</p>
              {read.data.endpoint ? (
                <p className="break-all font-mono text-caption text-faint">
                  {read.data.endpoint.method} {read.data.endpoint.path}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-body text-muted">ESIS энэ сервисээр бичлэг буцаасангүй.</p>
          )
        ) : (
          <EsisRowValues columns={columns} rows={rows} />
        )}
      </div>
    );
  }
  const heading = headingId ?? `esis-panel-${resource}`;
  async function pull() {
    setPulled(true);
    if (catalog.data?.canRead) {
      await read.refetch();
    } else {
      // No token: re-read our own catalog, which is what is actually shown.
      await catalog.refetch();
    }
    setPulledAt(new Date().toLocaleString("mn-MN"));
  }

  /*
   * ★ **The stored copy's own date, not the moment somebody pressed "татах"**
   * — 2026-09-17, plan Task 7. `pulledAt` says when this browser last asked;
   * for a reference resource that is not the fact worth showing, because the
   * answer came from `EsisReference` and can be weeks old regardless of when
   * it was read just now. `read.data.syncedAt` is when the sweep itself ran,
   * which is the date an operator comparing this table against the ministry's
   * own catalogue actually needs.
   */
  const storeSyncedAt =
    read.data?.source === "STORE" && read.data.syncedAt
      ? new Date(read.data.syncedAt).toLocaleString("mn-MN")
      : null;

  return (
    <section aria-label={title ?? endpoint.name} className={cn("w-full", className)}>
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
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
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

        {read.isError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-soft px-4 py-3 text-body text-danger"
          >
            {errorMessage(read.error)}
          </p>
        ) : null}
        {read.data?.status === "FAILED" ? (
          <EsisNoAnswer endpoint={endpoint} errorCode={read.data.errorCode} variant="FAILED" />
        ) : null}

        {rows.length === 0 ? (
          /*
           * ★ Only once. A failed read has no rows either, so without this the
           * screen stacked "хариу өгсөнгүй" on top of "бичлэг буцаасангүй" and
           * invited the reader to work out whether those were two problems.
           */
          read.data?.status === "FAILED" ? null : (
            <EsisNoAnswer endpoint={endpoint} errorCode={null} variant="EMPTY" />
          )
        ) : (
          <EsisRowValues
            columns={columns}
            rows={rows}
            hrefs={live ? (liveHref ? rows.map(liveHref) : undefined) : hrefs}
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

        {storeSyncedAt || pulledAt ? (
          <p className="border-t border-border-soft pt-4 text-caption text-muted">
            Сүүлд шинэчилсэн: {storeSyncedAt ?? pulledAt}
          </p>
        ) : null}
      </Card>
    </section>
  );
}
