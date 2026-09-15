"use client";

import { useQuery } from "@tanstack/react-query";
import { CloudDownload } from "lucide-react";
import { useState } from "react";
import {
  esisScopedCatalogSchema,
  esisResourceReadSchema,
  type EsisField,
  type EsisResourceKey,
  type EsisResourceRead,
  type EsisScopedCatalog,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { EsisNoAnswer } from "@/components/esis/esis-no-answer";
import { EsisRowValues, esisSampleColumns } from "@/components/esis/esis-rows";
import { ESIS_PARAM_LABEL, esisApiIdLabel } from "@/components/esis/esis-params";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";

/**
 * "ESIS-ээс татах" — one button, on every screen ESIS data lands on.
 *
 * ★ It opens rather than imports, and that is the point. Approved import needs
 * external-id matching, a conflict decision per field and a retryable queue
 * (`ESIS_API_READINESS.md` C5, not built). What this answers instead is the
 * question the operator actually has today: *when the token arrives, what
 * exactly appears here?* So it shows the field contract first and the live
 * values second, and it shows the contract whether or not the call can run.
 *
 * ★★ Every read is live — the mock transport was removed on 2026-09-14. A
 * service that cannot answer says so through `EsisNoAnswer`, naming the
 * endpoint, rather than showing a fixture.
 */
export function EsisPullButton({
  resource,
  params,
  label = "ESIS-ээс татах",
  size = "sm",
  variant = "secondary",
}: {
  resource: EsisResourceKey;
  /** Path values the service needs — a group, a date, a product. */
  params?: Record<string, string | undefined>;
  label?: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "ghost";
}) {
  const { primaryKindergartenId, hasRole } = useSession();
  const [open, setOpen] = useState(false);

  /*
   * ★ Hidden from anyone who is not an admin of this kindergarten, because the
   * route behind it answers 404 to a teacher or a guardian. The hiding is
   * courtesy, not the control — `esis-admin.test.ts` proves the API refuses
   * them whether or not the button was ever rendered.
   */
  if (!primaryKindergartenId || !hasRole("ADMIN")) return null;

  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <CloudDownload aria-hidden />
        {label}
      </Button>
      {open ? (
        <EsisPullDialog
          kindergartenId={primaryKindergartenId}
          resource={resource}
          params={params}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function EsisPullDialog({
  kindergartenId,
  resource,
  params,
  onClose,
}: {
  kindergartenId: string;
  resource: EsisResourceKey;
  params?: Record<string, string | undefined>;
  onClose: () => void;
}) {
  /*
   * ★ The **role-scoped catalog**, not the operator's overview — changed
   * 2026-09-14 with the move of `GET /kindergartens/:id/esis` to the platform
   * operator (`PlatformEsisController`). This dialog opens for a director on
   * the roster and the day sheet, and reading the operator payload to draw it
   * would have made every one of those buttons 404 the moment the overview
   * became superadmin-only.
   *
   * It is also the honest source: this dialog needs the service's name, its
   * parameters and its field contract, and `…/esis/catalog` is exactly that
   * list scoped to what the caller's own role may reach. `EsisDataPanel` has
   * read it this way all along.
   */
  const catalog = useQuery({
    queryKey: qk.esisCatalog(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/esis/catalog`, esisScopedCatalogSchema),
  });

  const endpoint = catalog.data?.endpoints.find((item) => item.key === resource);
  const required = endpoint?.params ?? [];
  /*
   * ★ Nothing is pre-filled — 2026-09-14. Demo mode used to supply a fixture
   * id per parameter, so the dialog opened with a group number already in the
   * box and the reader could press through without choosing anything. With one
   * transport there is no fixture to key against, and a guessed id would send
   * a real request about somebody else's group.
   */
  const [entered, setEntered] = useState<Record<string, string>>({});
  const value = (name: string) => entered[name] ?? params?.[name] ?? "";
  const missing = required.filter((name) => !value(name));
  /*
   * ★ `canRead`, not the overview's `canPreview` — and the two are not quite
   * the same test. `canPreview` also required the kindergarten's institution
   * mapping to be confirmed; `canRead` asks only whether the deployment is
   * configured or in demo mode. So on a deployment that has a token but an
   * unmapped tenant the button is now pressable and the read comes back 409
   * into the alert below, where it used to stay inert.
   *
   * That is deliberate, and it is what `EsisDataPanel` has always done: the
   * mapping is fixed by the platform operator, and "press it and read why"
   * tells a director more than a disabled control with no explanation. The
   * mapping check still happens server-side — `assertOperable` — so nothing
   * reaches ESIS without it.
   */
  const ready = Boolean(catalog.data?.canRead) && missing.length === 0;

  const query = new URLSearchParams({ resource });
  for (const name of required) {
    if (value(name)) query.set(name, value(name));
  }

  const read = useQuery({
    queryKey: qk.esisResource(kindergartenId, resource, query.toString()),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/esis/resource?${query}`, esisResourceReadSchema),
    // Parameterless services fetch on open; the rest wait for their values.
    enabled: ready,
    /*
     * ★ Opts out of the app-wide refetch policy, deliberately. `providers.tsx`
     * sets `refetchOnWindowFocus` and a 30-second `staleTime` because a teacher
     * returning to a tab wants fresh notifications. This query calls the
     * *ministry*: every refetch is another outbound request against a rate
     * limit the public catalog does not document, and another `AuditLog` VIEW
     * row saying somebody read the roster. Alt-tabbing is not somebody reading
     * the roster. One press, one call.
     *
     * `retry: false` for the same reason — the dialog reports `SCOPE_DENIED`
     * as a result, so a retry would repeat a call whose answer is already known.
     */
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    retry: false,
  });

  return (
    <FormDialog
      open
      size="wide"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={endpoint ? `${endpoint.name} — ESIS-ээс татах` : "ESIS-ээс татах"}
      description={endpoint?.usage}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Хаах
        </Button>
      }
    >
      {catalog.isPending ? <LoadingState rows={3} /> : null}

      {catalog.isError ? (
        <p role="alert" className="rounded-control bg-danger-soft px-4 py-3 text-body text-danger">
          {errorMessage(catalog.error)}
        </p>
      ) : null}

      {endpoint ? (
        <div className="flex flex-col gap-5">
          <EndpointSummary endpoint={endpoint} />

          {required.length > 0 ? (
            <Card pad="compact" tone="sky">
              <p className="text-body font-medium text-ink">ESIS хүсэлтийн параметр</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {required.map((name) => (
                  <Field key={name} label={ESIS_PARAM_LABEL[name] ?? name}>
                    {({ id }) => (
                      <Input
                        id={id}
                        type={name.endsWith("Date") ? "date" : "text"}
                        value={value(name)}
                        onChange={(event) =>
                          setEntered((current) => ({ ...current, [name]: event.target.value }))
                        }
                      />
                    )}
                  </Field>
                ))}
              </div>
              <p className="mt-2 text-caption text-muted">ESIS-ийн өөрийн дугаарыг ашиглана.</p>
            </Card>
          ) : null}

          {read.isPending && ready ? <LoadingState rows={3} /> : null}
          {read.isError ? (
            <p
              role="alert"
              className="rounded-control bg-danger-soft px-4 py-3 text-body text-danger"
            >
              {errorMessage(read.error)}
            </p>
          ) : null}
          {/*
            ★ Live rows or the sample, never both. The sample exists so the
            screen can be *shown* before a token is issued; the moment ESIS
            answers it is gone, so nothing invented can sit beside something
            real and be read as the same kind of thing.
          */}
          {read.data ? (
            <ReadResult result={read.data} endpoint={endpoint} />
          ) : (
            <PendingResult endpoint={endpoint} />
          )}

          {/*
            ★ `showSamples` goes false the moment a live read succeeds. The
            column is headed "Жишээ", so leaving it would not strictly mislead
            — but it would put an invented tenant name on the same screen as
            the real one, and the rule in `esis.fields.ts` is that samples
            vanish when there is something real to show. A rule with an
            exception on the one screen that matters is not a rule.
          */}
          <FieldCatalog
            fields={endpoint.fields}
            note={endpoint.note}
            showSamples={read.data?.status !== "SUCCEEDED"}
          />
        </div>
      ) : null}
    </FormDialog>
  );
}

function EndpointSummary({ endpoint }: { endpoint: EsisScopedCatalog["endpoints"][number] }) {
  const outputs = endpoint.fields.filter((field) => field.io === "OUTPUT");
  const inputs = endpoint.fields.filter((field) => field.io === "INPUT");
  const keptOutputs = outputs.filter((field) => field.ingested).length;

  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <div className="min-w-0">
        <dt className="text-caption font-semibold text-muted">Сервис</dt>
        <dd className="mt-1 text-body font-medium text-ink">
          {endpoint.slug} · {esisApiIdLabel(endpoint.apiId)}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-caption font-semibold text-muted">Зам</dt>
        <dd className="mt-1 break-all text-caption font-medium text-ink">
          {endpoint.method} {endpoint.path}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-caption font-semibold text-muted">Талбар</dt>
        <dd className="mt-1 text-body font-medium text-ink">
          {outputs.length > 0
            ? `${keptOutputs} авна · ${outputs.length - keptOutputs} авахгүй`
            : `${inputs.length} талбар илгээнэ`}
        </dd>
      </div>
    </dl>
  );
}

/**
 * What the service will return, before anything has been asked of it.
 *
 * ★ **The invented records are gone — 2026-09-14.** This used to render a demo
 * roster through `EsisRowValues`, the same table a live result uses, behind a
 * `Mock data` badge. The badge was doing all the work of telling the reader
 * that a table of children was fictional, and the client ended the arrangement:
 * "ene esis ni real zuil shuu".
 *
 * What is left is the honest half of the same answer — the field contract, and
 * a sentence saying nothing has been read yet. The reader presses the button to
 * find out what ESIS actually holds.
 */
function PendingResult({ endpoint }: { endpoint: EsisScopedCatalog["endpoints"][number] }) {
  const outputs = endpoint.fields.filter((field) => field.io === "OUTPUT" && field.ingested);

  return (
    <section aria-labelledby="esis-pull-sample">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 id="esis-pull-sample" className="text-body font-semibold text-ink">
          Хараахан татаагүй байна
        </h3>
        <Badge tone="sun">Live хариу хүлээгдэж байна</Badge>
      </div>
      <p className="text-caption text-muted">
        Дээрх товчийг дарж ESIS-ээс татна. Энэ сервис амжилттай хариулбал{" "}
        {outputs.length} талбар ирнэ; талбарын нэр нь ESIS developer portal-оос баталгаажсан.
      </p>
    </section>
  );
}

function ReadResult({
  result,
  endpoint,
}: {
  result: EsisResourceRead;
  endpoint: EsisScopedCatalog["endpoints"][number];
}) {
  if (result.status === "FAILED") {
    return <EsisNoAnswer endpoint={endpoint} errorCode={result.errorCode} variant="FAILED" />;
  }

  const columns = esisSampleColumns(result.fields);

  return (
    <section aria-labelledby="esis-pull-rows">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 id="esis-pull-rows" className="text-body font-semibold text-ink">
          Ирсэн мэдээлэл
        </h3>
        <Badge tone="mint">LIVE</Badge>
        <Badge tone="sky">{result.count} бичлэг</Badge>
        {result.durationMs === null ? null : <Badge tone="sky">{result.durationMs} мс</Badge>}
      </div>

      {/*
        ★ The envelope, and it says so — 2026-09-14.
        `RESULT` carries the first few records rather than every one: this
        block answers "what shape does ESIS reply in?", and the table below
        answers "what did it send?". Naming the counts is what keeps a short
        `RESULT` from reading as a short response.
      */}
      <p className="mb-2 text-body font-semibold text-ink">
        Response JSON{" "}
        <span className="font-normal text-caption text-muted">
          — бүтцийн жишээ: {result.response.RESULT.length} / {result.count} бичлэг
        </span>
      </p>
      <pre className="mb-4 max-h-[420px] overflow-auto rounded-control border border-border bg-ink p-4 font-mono text-caption leading-6 text-white">
        <code>{JSON.stringify(result.response, null, 2)}</code>
      </pre>

      {result.rows.length === 0 ? (
        <EsisNoAnswer endpoint={endpoint} errorCode={null} variant="EMPTY" />
      ) : (
        <EsisRowValues columns={columns} rows={result.rows} />
      )}
      {result.count > result.rows.length ? (
        <p className="mt-2 text-caption text-muted">
          Эхний {result.rows.length} мөрийг харуулав. Бүрэн импорт нь тусдаа алхам.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Every field the service returns, and what we do with it.
 *
 * ★ The refused rows stay visible. An operator comparing this against the
 * ministry's own catalog has to be able to see that `personRegNumber` was read
 * and declined — a shorter list would read as an oversight rather than a
 * decision, and the reason column is where `ESIS_REQUEST.md` gets cited.
 */
function FieldCatalog({
  fields,
  note,
  showSamples,
}: {
  fields: EsisField[];
  note?: string;
  /** False once a live read has succeeded — see the call site. */
  showSamples: boolean;
}) {
  const outputCount = fields.filter((field) => field.io === "OUTPUT").length;
  const inputCount = fields.filter((field) => field.io === "INPUT").length;

  return (
    <section aria-labelledby="esis-pull-fields">
      <h3 id="esis-pull-fields" className="mb-3 text-body font-semibold text-ink">
        {outputCount > 0
          ? `Гаралтын бүх талбар (${outputCount})`
          : `Илгээх бүх талбар (${inputCount})`}
      </h3>
      {note ? <p className="mb-3 text-caption text-muted">{note}</p> : null}
      <TableShell
        caption={
          outputCount > 0 ? "ESIS сервисийн гаралтын талбарууд" : "ESIS рүү илгээх талбарууд"
        }
        /*
          ★ No pixel floor — 2026-09-10. It was 720/560, which put a horizontal
          scrollbar inside a dialog on every phone: the dialog is already
          narrower than the page, so the floor was guaranteed to bite. `stacked`
          lays the five columns out as one labelled block per field below `md`,
          which is what a field list actually is.
        */
        minWidth="min-w-0"
        stacked
      >
        <thead>
          <tr>
            <Th>Талбар</Th>
            <Th>Утга</Th>
            <Th>Чиглэл</Th>
            {showSamples ? <Th>Жишээ</Th> : null}
            <Th>Төлөв</Th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.name}>
              <Td data-label="Талбар">
                <span className="font-mono text-caption text-ink">{field.name}</span>
              </Td>
              <Td data-label="Утга">{field.label}</Td>
              <Td data-label="Чиглэл">
                <Badge tone={field.io === "OUTPUT" ? "sky" : "peach"}>
                  {field.io === "OUTPUT" ? "Гаралт" : "Оролт"}
                </Badge>
              </Td>
              {showSamples ? (
                <Td data-label="Жишээ">
                  {/* Refused fields have no sample — see `esis.fields.ts`. */}
                  {field.sample ? (
                    <span className="text-caption text-ink">{field.sample}</span>
                  ) : (
                    <span className="text-caption text-faint">—</span>
                  )}
                </Td>
              ) : null}
              <Td data-label="Төлөв">
                {field.io === "INPUT" ? (
                  <Badge tone="peach">Илгээнэ</Badge>
                ) : field.ingested ? (
                  <Badge tone="mint">Авна</Badge>
                ) : (
                  <span className="flex flex-col gap-1">
                    <Badge tone="sun">Авахгүй</Badge>
                    <span className="text-caption text-muted">{field.omitReason}</span>
                  </span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </section>
  );
}
