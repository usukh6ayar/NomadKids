"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CloudDownload } from "lucide-react";
import { useState } from "react";
import {
  esisOverviewSchema,
  esisResourceReadSchema,
  type EsisField,
  type EsisOverview,
  type EsisResourceKey,
  type EsisResourceRead,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { EsisRowValues, esisSampleColumns } from "@/components/esis/esis-rows";
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

/** The path values a service can ask for, in the operator's language. */
const PARAM_LABEL: Record<string, string> = {
  studentGroupId: "ESIS бүлгийн дугаар",
  productId: "ESIS бүтээгдэхүүний дугаар",
  dayDate: "Огноо",
  beginDate: "Эхлэх огноо",
};

const DEMO_PARAM: Record<string, string> = {
  studentGroupId: "10001",
  productId: "51001",
  dayDate: "2026-09-08",
  beginDate: "2026-09-01",
};

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
 * ★★ A kindergarten without a live token sees the demo sandbox field list,
 * not an error. It stays explicitly labelled `Demo ESIS`, while preserving the
 * exact shape that a live response replaces once credentials are available.
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
  const overview = useQuery({
    queryKey: qk.esis(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/esis`, esisOverviewSchema),
  });

  const endpoint = overview.data?.endpoints.find((item) => item.key === resource);
  const required = endpoint?.params ?? [];
  const demoMode = Boolean(overview.data && !overview.data.deployment.configured);

  /* Live calls use caller-supplied ESIS identifiers. Demo mode supplies the
   * sandbox mapping so the connected-state screen is complete on first open. */
  const [entered, setEntered] = useState<Record<string, string>>({});
  const value = (name: string) =>
    entered[name] ?? params?.[name] ?? (demoMode ? DEMO_PARAM[name] : "") ?? "";
  const missing = required.filter((name) => !value(name));
  const ready = Boolean(overview.data?.canPreview) && missing.length === 0;

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
      {overview.isPending ? <LoadingState rows={3} /> : null}

      {overview.isError ? (
        <p role="alert" className="rounded-control bg-danger-soft px-4 py-3 text-body text-danger">
          {errorMessage(overview.error)}
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
                  <Field key={name} label={PARAM_LABEL[name] ?? name}>
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
              <p className="mt-2 text-caption text-muted">
                {demoMode
                  ? "Demo sandbox mapping-аас автоматаар бөглөгдсөн."
                  : "ESIS-ийн өөрийн дугаарыг ашиглана."}
              </p>
            </Card>
          ) : null}

          {demoMode ? (
            <Card pad="compact" tone="mint">
              <p className="flex items-center gap-2 text-body font-medium text-ink">
                <CheckCircle2 size={18} className="text-mint-ink" aria-hidden />
                Demo ESIS sandbox холболт идэвхтэй · сүүлийн синк 2026.09.08 09:15
              </p>
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
            <ReadResult result={read.data} />
          ) : (
            <SampleResult endpoint={endpoint} demoMode={demoMode} />
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

function EndpointSummary({ endpoint }: { endpoint: EsisOverview["endpoints"][number] }) {
  const outputs = endpoint.fields.filter((field) => field.io === "OUTPUT");
  const inputs = endpoint.fields.filter((field) => field.io === "INPUT");
  const keptOutputs = outputs.filter((field) => field.ingested).length;

  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <div className="min-w-0">
        <dt className="text-caption font-semibold text-muted">Сервис</dt>
        <dd className="mt-1 text-body font-medium text-ink">
          {endpoint.slug} · ID {endpoint.apiId}
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
 * The sandbox records shown until a live response replaces them.
 *
 * ★ Rendered through `EsisRowValues`, the same component a live result uses, so
 * the demonstration has the same shape as a live result, while the `Demo ESIS`
 * badge prevents it from being presented as production evidence.
 *
 * ★★ The whole demo set, not its first row. A roster service that renders one
 * child answers "what fields come back?" and not "what will this screen look
 * like once we are connected?", which is the question somebody opens this
 * dialog without a token to ask.
 */
function SampleResult({
  endpoint,
  demoMode,
}: {
  endpoint: EsisOverview["endpoints"][number];
  demoMode: boolean;
}) {
  const columns = esisSampleColumns(endpoint.fields);

  return (
    <section aria-labelledby="esis-pull-sample">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 id="esis-pull-sample" className="text-body font-semibold text-ink">
          Синк хийсэн мэдээлэл
        </h3>
        <Badge tone={demoMode ? "mint" : "sun"}>
          {demoMode ? "Demo ESIS синк" : "Live хариу хүлээгдэж байна"}
        </Badge>
        <Badge tone="sky">{endpoint.sampleRows.length} бичлэг</Badge>
      </div>
      <p className="mb-3 text-caption text-muted">
        {demoMode
          ? "Developer portal-ийн гэрээгээр боловсруулсан demo sandbox өгөгдөл."
          : "Талбарын нэр нь ESIS developer portal-оос баталгаажсан."}
      </p>
      <EsisRowValues columns={columns} rows={endpoint.sampleRows} />
    </section>
  );
}

function ReadResult({ result }: { result: EsisResourceRead }) {
  if (result.status === "FAILED") {
    return (
      <Card pad="compact" tone="peach">
        <p className="text-body font-semibold text-ink">ESIS хариу өгсөнгүй</p>
        <p className="mt-1 text-caption text-muted">
          {ERROR_LABEL[result.errorCode ?? "UNKNOWN"] ?? result.errorCode}
        </p>
      </Card>
    );
  }

  const columns = esisSampleColumns(result.fields);

  return (
    <section aria-labelledby="esis-pull-rows">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 id="esis-pull-rows" className="text-body font-semibold text-ink">
          Ирсэн мэдээлэл
        </h3>
        <Badge tone="mint">{result.count} бичлэг</Badge>
        {result.durationMs === null ? null : <Badge tone="sky">{result.durationMs} мс</Badge>}
      </div>

      {result.rows.length === 0 ? (
        <Card pad="compact">
          <p className="text-body text-muted">ESIS энэ сервисээр бичлэг буцаасангүй.</p>
        </Card>
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
        minWidth={showSamples ? "min-w-[720px]" : "min-w-[560px]"}
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
              <Td>
                <span className="font-mono text-caption text-ink">{field.name}</span>
              </Td>
              <Td>{field.label}</Td>
              <Td>
                <Badge tone={field.io === "OUTPUT" ? "sky" : "peach"}>
                  {field.io === "OUTPUT" ? "Гаралт" : "Оролт"}
                </Badge>
              </Td>
              {showSamples ? (
                <Td>
                  {/* Refused fields have no sample — see `esis.fields.ts`. */}
                  {field.sample ? (
                    <span className="text-caption text-ink">{field.sample}</span>
                  ) : (
                    <span className="text-caption text-faint">—</span>
                  )}
                </Td>
              ) : null}
              <Td>
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
