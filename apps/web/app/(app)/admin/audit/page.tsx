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

  const filters = { action: action || undefined, from: from || undefined, to: to || undefined };

  const entries = useQuery({
    queryKey: qk.audit({ ...filters, page }),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (action) params.set("action", action);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
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
        lede="Хэн, хэзээ, юу хийсэн. Зөвхөн уншина — түүхийг засах боломжгүй."
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

        {action || from || to ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              narrow(() => {
                setAction("");
                setFrom("");
                setTo("");
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
          <p className="text-body text-muted" aria-live="polite">
            Нийт {entries.data.total} бичлэг
          </p>

          <RowList className={entries.isPlaceholderData ? "opacity-60" : ""}>
            {entries.data.items.map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
          </RowList>

          {entries.data.totalPages > 1 ? (
            <nav aria-label="Хуудаслалт" className="flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Өмнөх
              </Button>
              <span className="text-body text-muted" aria-live="polite">
                {entries.data.page} / {entries.data.totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= entries.data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Дараах
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function AuditRow({ entry }: { entry: z.infer<typeof auditEntrySchema> }) {
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
