"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import {
  auditEntrySchema,
  AUDIT_ACTION_LABEL,
  AUDIT_OBJECT_LABEL,
  paginated,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, RowCard, RowList } from "@/components/ui/card";
import { X } from "lucide-react";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

const listSchema = paginated(auditEntrySchema);

/**
 * The audit browser — RFP §2.1's "Системийн үйлдлийн түүх буюу audit log харах".
 *
 * ★ The API for this has existed since Phase 9b, filterable by action, actor,
 * child and date range, and the admin dashboard showed only the last few rows.
 * "Дэлгэрэнгүй audit log" is also RFP §20 Phase III in its own right.
 *
 * ★★ Read-only, and there is deliberately no write path anywhere.
 *
 * `AuditLog`'s repository exposes only `append()`, and entries are written by
 * the services that perform the actions. An endpoint that could edit history
 * would let a caller forge it — which is the one thing an audit log exists to
 * prevent.
 */
export default function AuditPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AuditBrowser />
    </RequireRole>
  );
}

function AuditBrowser() {
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  /*
    ★ Filtering by person is driven from the rows, not from a picker.

    `actorUserId` has been an accepted filter since the endpoint was written and
    nothing in the UI ever sent it. The obvious way to expose it is a select of
    everyone in the kindergarten — and that list is unbounded in the way that
    matters: `MAX_PAGE_SIZE` is 100, and a kindergarten of 200 children has more
    guardians than that before its staff are counted, so the picker would
    quietly omit the people at the end of the alphabet.

    Clicking the name on a row has no such ceiling. It also matches the question
    being asked: an administrator reads "Батсайхан Оюунчимэг" in the log and
    wants the rest of that person's actions — they are not browsing a roster.
    The label is kept beside the id because the chip has to name who is being
    filtered, and the row it came from may not be on the current page.
  */
  const [actor, setActor] = useState<{ id: string; label: string } | null>(null);

  const filters = {
    action: action || undefined,
    from: from || undefined,
    to: to || undefined,
    actorUserId: actor?.id,
  };

  const entries = useQuery({
    queryKey: qk.audit({ ...filters, page }),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (action) params.set("action", action);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (actor) params.set("actorUserId", actor.id);
      return get(`/audit?${params}`, listSchema);
    },
    // Keeps the previous page on screen while the next loads, so the list does
    // not collapse to a skeleton on every filter change.
    placeholderData: (previous) => previous,
  });

  function narrow(change: () => void) {
    change();
    // A new filter starts at page one — otherwise filtering from page four
    // shows an empty result that reads as "no such entries".
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Үйлдлийн түүх"
      />

      <div className="flex flex-wrap items-end gap-3">
        {/*
          ★ `max-w`, because `flex-1` on the widest field is not a width.

          This select held one word — "Бүгд", "Нэвтэрсэн" — and `flex-1` gave
          it every pixel the two date inputs did not want: 1,050px of control
          for a twelve-character value, with its own chevron a screen away from
          its text. A filter bar reads as a row of controls; one control
          stretched across it reads as an input somebody forgot to size.
        */}
        <Field label="Үйлдэл" className="min-w-[180px] max-w-[240px] flex-1">
          {({ id }) => (
            <Select
              id={id}
              value={action}
              onChange={(e) => narrow(() => setAction(e.target.value))}
            >
              <option value="">Бүгд</option>
              {Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Эхлэх огноо" className="min-w-[150px]">
          {({ id }) => (
            <Input
              id={id}
              type="date"
              value={from}
              onChange={(e) => narrow(() => setFrom(e.target.value))}
            />
          )}
        </Field>

        <Field label="Дуусах огноо" className="min-w-[150px]">
          {({ id }) => (
            <Input
              id={id}
              type="date"
              value={to}
              onChange={(e) => narrow(() => setTo(e.target.value))}
            />
          )}
        </Field>

        {action || from || to || actor ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              narrow(() => {
                setAction("");
                setFrom("");
                setTo("");
                setActor(null);
              })
            }
          >
            Шүүлт цэвэрлэх
          </Button>
        ) : null}
      </div>

      {entries.isPending ? <LoadingState rows={6} /> : null}
      {entries.isError ? <ErrorState description={errorMessage(entries.error)} /> : null}

      {entries.data && entries.data.items.length === 0 ? (
        <EmptyState
          title="Бичлэг олдсонгүй"
          description="Сонгосон хугацаа, үйлдэлд тохирох түүх алга."
        />
      ) : null}

      {entries.data && entries.data.items.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <ResultCount total={entries.data.total} noun="бичлэг" />

            {/*
              ★ The chip names who is being filtered, because nothing else on
              the screen does.

              An `actorUserId` in the query string with no visible sign of it is
              a list that looks short for no reason — the same failure as a
              search box that has quietly kept its text. It carries its own
              clear button rather than relying on "Шүүлт цэвэрлэх", which resets
              every filter at once.
            */}
            {actor ? (
              <span className="inline-flex items-center gap-1 rounded-pill bg-primary-soft py-1 pl-3 pr-1 text-caption font-medium text-primary">
                Хэн: {actor.label}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${actor.label} — шүүлтийг арилгах`}
                  className="size-[28px] min-h-0 text-primary hover:bg-primary/10"
                  onClick={() => narrow(() => setActor(null))}
                >
                  <X size={14} aria-hidden />
                </Button>
              </span>
            ) : null}
          </div>

          <RowList className={entries.isPlaceholderData ? "opacity-60" : ""}>
            {entries.data.items.map((entry) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                onFilterActor={(next) => narrow(() => setActor(next))}
              />
            ))}
          </RowList>

          <Pagination
            page={entries.data.page}
            totalPages={entries.data.totalPages}
            onPage={setPage}
          />
        </>
      ) : null}
    </div>
  );
}

function AuditRow({
  entry,
  onFilterActor,
}: {
  entry: z.infer<typeof auditEntrySchema>;
  /** Absent on a screen with no filtering, which keeps the name plain text. */
  onFilterActor?: (actor: { id: string; label: string }) => void;
}) {
  const metadata = entry.metadata;
  const hasMetadata = metadata !== null && metadata !== undefined && typeof metadata === "object";

  /*
    ★ `RowCard`, not a bare `<div>`.

    Like `/admin/terms` before it, this list put unwrapped `<div>`s inside
    `RowList` — the column, without the row — so every entry rendered as loose
    text on the canvas while the neighbouring admin screens rendered cards. The
    metadata disclosure below already used a `Card`, which made the mismatch
    visible on the same row: a bordered surface nested inside nothing.
  */
  return (
    <RowCard className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={entry.action === "DELETE" ? "danger" : "sky"}>
          {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}
        </Badge>
        {entry.objectType ? (
          <span className="text-body text-ink">
            {AUDIT_OBJECT_LABEL[entry.objectType] ?? entry.objectType}
          </span>
        ) : null}

        {/*
          ★ Who did it — the column this screen was missing entirely.

          "Устгасан · Хүүхэд · 3 хоногийн өмнө" is three quarters of an answer,
          and the missing quarter is the one an audit log exists to give. The
          name is resolved server-side from `actorUserId`; see
          `apps/api/src/dashboard/audit-actor.ts` for why it is not read off
          `AuditLog.actorLabel`, which almost nothing writes.

          An em dash rather than a hidden row when there is no actor: an
          unauthenticated action is a real entry, and blanking the column would
          make it look like a rendering fault.
        */}
        <span className="text-body text-muted">
          <span className="text-faint">· </span>
          {entry.actorLabel && entry.actorUserId && onFilterActor ? (
            /*
              ★ The name is a button when the log can be narrowed to it.

              Plain text when it cannot: an entry whose actor was hard-deleted
              keeps its label and loses its id, and a control that filters to
              nobody is worse than no control. Same rule the sidebar is held to
              — nothing offers what it cannot deliver.
            */
            <button
              type="button"
              onClick={() => onFilterActor({ id: entry.actorUserId!, label: entry.actorLabel! })}
              className="rounded-control underline decoration-transparent underline-offset-2 transition-colors hover:text-primary hover:decoration-current"
              title={`${entry.actorLabel}-ийн үйлдлүүдийг харах`}
            >
              {entry.actorLabel}
            </button>
          ) : (
            <span className={entry.actorLabel ? undefined : "text-faint"}>
              {entry.actorLabel ?? "—"}
            </span>
          )}
        </span>

        <span className="ml-auto text-caption text-muted">{formatRelative(entry.createdAt)}</span>
      </div>

      {/*
        The metadata is what an administrator opens this screen for — "what
        exactly changed" — but it is machine-shaped, so it is behind a
        disclosure rather than filling the row. Rendered as formatted JSON
        because its shape differs by action, and inventing a per-action
        presentation would be a promise this screen cannot keep as new actions
        are added.
      */}
      {hasMetadata ? (
        <details className="group">
          <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center text-caption font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
            Дэлгэрэнгүй
          </summary>
          <Card pad="compact" className="mt-1.5 overflow-x-auto">
            <pre className="text-caption text-muted">{JSON.stringify(metadata, null, 2)}</pre>
          </Card>
        </details>
      ) : null}
    </RowCard>
  );
}
