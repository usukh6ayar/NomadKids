"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AUDIT_ACTION_LABEL,
  AUDIT_OBJECT_LABEL,
  auditEntrySchema,
  paginated,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Card, RowCard, RowList } from "@/components/ui/card";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

const listSchema = paginated(auditEntrySchema);

/**
 * The accountant's own audit trail — нэмэлт.md §13's "Санхүүгийн audit log".
 *
 * ★ The bug this whole finance-module pass started from.
 *
 * `/admin/audit` already reads every `AuditLog` row, but it is
 * `RequireRole(["ADMIN"])` — an accountant, who §13 names as needing this
 * exact data, had no route to it at all. This is that door: the same table,
 * narrowed server-side to the financial object types
 * (`AuditRepository.FINANCIAL_OBJECT_TYPES`) rather than reusing the admin
 * screen's unrestricted one.
 */
export default function FinancialAuditLogPage() {
  return (
    <RequireRole roles={["ACCOUNTANT", "ADMIN"]}>
      <FinancialAuditLog />
    </RequireRole>
  );
}

function FinancialAuditLog() {
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const [page, setPage] = useState(1);

  const entries = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.financialAuditLog(kindergartenId ?? "", page),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/financial-audit-log?page=${page}&pageSize=25`,
        listSchema,
      ),
    placeholderData: (previous) => previous,
  });

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader backHref="/finance" title="Санхүүгийн үйлдлийн түүх" />

      {entries.isLoading ? <LoadingState rows={6} /> : null}
      {entries.isError ? <ErrorState description={errorMessage(entries.error)} /> : null}

      {entries.data && entries.data.items.length === 0 ? (
        <EmptyState
          title="Бичлэг олдсонгүй"
          description="Санхүүтэй холбоотой өөрчлөлт хараахан бүртгэгдээгүй байна."
        />
      ) : null}

      {entries.data && entries.data.items.length > 0 ? (
        <>
          <ResultCount total={entries.data.total} noun="бичлэг" />

          <RowList className={entries.isPlaceholderData ? "opacity-60" : ""}>
            {entries.data.items.map((entry) => (
              <FinancialAuditRow key={entry.id} entry={entry} />
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

function FinancialAuditRow({ entry }: { entry: ReturnType<typeof auditEntrySchema.parse> }) {
  const metadata = entry.metadata;
  const hasMetadata = metadata !== null && metadata !== undefined && typeof metadata === "object";

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
        <span className="text-body text-muted">
          <span className="text-faint">· </span>
          <span className={entry.actorLabel ? undefined : "text-faint"}>
            {entry.actorLabel ?? "—"}
          </span>
        </span>
        <span className="ml-auto text-caption text-muted">{formatRelative(entry.createdAt)}</span>
      </div>

      {/* Хэн → Хэзээ → Ямар мэдээлэл is above; Өмнөх/Шинэ утга is here — §14. */}
      {hasMetadata && isChange(metadata) ? <ChangeTable metadata={metadata} /> : null}
      {hasMetadata && !isChange(metadata) ? (
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

type Values = Record<string, unknown>;

function isChange(metadata: object): metadata is { before?: Values; after?: Values } {
  const { before, after } = metadata as { before?: unknown; after?: unknown };
  return isValues(before) || isValues(after);
}

function isValues(value: unknown): value is Values {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * «Өмнөх утга → Шинэ утга» as a table — 2026-09-26.
 *
 * ★ It printed the metadata as JSON under the API's English keys, which put
 * §14's whole point — what a figure was before somebody changed it — behind a
 * format an accountant does not read. One row per field, in Mongolian, with
 * the old value beside the new one.
 *
 * ★★ A creation has no `before` and a removal no `after`; the empty side is a
 * dash, not a missing column, so every row reads the same way.
 */
function ChangeTable({ metadata }: { metadata: { before?: Values; after?: Values } }) {
  const before = metadata.before ?? {};
  const after = metadata.after ?? {};
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-caption">
        <caption className="sr-only">Өмнөх → Шинэ утга</caption>
        <thead>
          <tr className="text-left text-muted">
            <th scope="col" className="py-1 pr-3 font-medium">
              Талбар
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Өмнөх
            </th>
            <th scope="col" className="py-1 font-medium">
              Шинэ
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => {
            const was = field in before ? formatValue(before[field]) : "—";
            const now = field in after ? formatValue(after[field]) : "—";
            return (
              <tr key={field} className="border-t border-border">
                <th scope="row" className="py-1 pr-3 text-left font-normal text-muted">
                  {FIELD_LABEL[field] ?? field}
                </th>
                <td className="py-1 pr-3 text-ink">{was}</td>
                <td className={was === now ? "py-1 text-muted" : "py-1 font-medium text-ink"}>
                  {now}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** The API's field names, as the accountant's screens name them. */
const FIELD_LABEL: Record<string, string> = {
  name: "Нэр",
  note: "Тайлбар",
  source: "Эх үүсвэр",
  ageBand: "Насны бүлэг",
  effectiveFrom: "Хүчинтэй эхлэх",
  effectiveTo: "Хүчинтэй дуусах",
  dailyRate: "Өдрийн тариф",
  monthlyRate: "Сарын тариф",
  approvedAmount: "Баталсан дүн",
  receivedAmount: "Хүлээн авсан дүн",
  children: "Хүүхдийн тоо",
  calculatedTotal: "Тооцсон дүн",
  month: "Сар",
  status: "Төлөв",
  dueDate: "Төлөх хугацаа",
  totalDue: "Нийт төлбөр",
  baseAmount: "Үндсэн төлбөр",
  mealAmount: "Хоолны төлбөр",
  extraAmount: "Нэмэлт төлбөр",
  discountAmount: "Хөнгөлөлт",
  amount: "Дүн",
  method: "Төлбөрийн хэлбэр",
  invoiceId: "Нэхэмжлэл",
  voidedAt: "Цуцалсан",
};
