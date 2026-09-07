"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
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
import { Button } from "@/components/ui/button";
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
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/finance">
          <ArrowLeft size={18} />
          Санхүүжилт
        </Link>
      </Button>

      <PageHeader
        title="Санхүүгийн үйлдлийн түүх"
      />

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
      {hasMetadata ? (
        <details className="group">
          <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center text-caption font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
            Өмнөх → Шинэ утга
          </summary>
          <Card pad="compact" className="mt-1.5 overflow-x-auto">
            <pre className="text-caption text-muted">{JSON.stringify(metadata, null, 2)}</pre>
          </Card>
        </details>
      ) : null}
    </RowCard>
  );
}
