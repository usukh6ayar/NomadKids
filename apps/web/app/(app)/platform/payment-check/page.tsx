"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  QPAY_FILTERS,
  QPAY_KIND_LABEL,
  platformQpayInvoiceSchema,
  platformQpayInvoicesSchema,
  qpayStatusMeta,
  type PlatformQpayInvoice,
  type QpayFilter,
} from "@/lib/platform-qpay";
import { useDebounced } from "@/lib/use-debounced";
import { cn } from "@/lib/utils";

const KEY = ["platform", "qpay-invoices"] as const;

/**
 * Төлбөр шалгах — 2026-10-20, the user: "би төлбөрөө төлсөн шалгаад өг гэвэл
 * би яаж шалгах уу". Ask for the payment number (or the phone), search, and
 * read the status; a row QPay has not settled can be asked about again.
 * Contract and privacy rules: `lib/platform-qpay.ts`.
 */
export default function PaymentCheckPage() {
  return (
    <RequireSuperAdmin>
      <PaymentCheck />
    </RequireSuperAdmin>
  );
}

function PaymentCheck() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<QpayFilter>("");
  const q = useDebounced(query.trim());

  const list = useQuery({
    queryKey: [...KEY, { q, filter }],
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "50" });
      if (q) params.set("q", q);
      if (filter) params.set("status", filter);
      return get(`/platform/qpay/invoices?${params}`, platformQpayInvoicesSchema);
    },
    retry: false,
  });
  const notReady = list.isError && isNotFound(list.error);
  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PlatformPageHeading
        title="Төлбөр шалгах"
        lede="Эцэг эхийн баримт дээрх «Дугаар» эсвэл утсаар хайж, QPay төлбөрийн төлвийг харна."
      />

      <SearchField
        label="Төлбөрийн дугаар эсвэл утас"
        placeholder="Дугаар (3F2A9C1B) эсвэл утас"
        value={query}
        onChange={setQuery}
      />

      <div role="group" aria-label="Төлөв" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {QPAY_FILTERS.map(({ key, label }) => (
          <button
            key={key || "all"}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "min-h-9 shrink-0 rounded-pill border px-3 text-caption font-semibold transition-colors",
              filter === key
                ? "border-primary bg-primary text-white"
                : "border-border-soft bg-surface text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {list.isLoading ? <LoadingState rows={4} /> : null}
      {notReady ? (
        <EmptyState
          title="Удахгүй нэмэгдэнэ"
          description="Төлбөр хайх боломж сервер талд бэлэн болмогц энд ажиллана."
        />
      ) : null}
      {list.isError && !notReady ? <ErrorState description={errorMessage(list.error)} /> : null}
      {list.data && items.length === 0 ? (
        <EmptyState
          title={q ? "Төлбөр олдсонгүй" : "Төлбөр алга"}
          description={
            q
              ? "Дугаар эсвэл утсаа шалгаад дахин хайна уу. Олдохгүй бол банкны баримтын зургийг авна уу."
              : "Энэ төлөвтэй төлбөр одоогоор алга."
          }
        />
      ) : null}

      {items.length > 0 ? (
        <ul className="flex flex-col overflow-hidden rounded-card border border-border-soft bg-surface">
          {items.map((invoice) => (
            <InvoiceRow key={invoice.id} invoice={invoice} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function InvoiceRow({ invoice }: { invoice: PlatformQpayInvoice }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const meta = qpayStatusMeta(invoice);

  const recheck = useMutation({
    mutationFn: () =>
      mutate(`/platform/qpay/invoices/${invoice.id}/recheck`, platformQpayInvoiceSchema, {
        method: "POST",
        body: {},
      }),
    onSuccess: (latest) => {
      toast.success(
        latest.status === "PAID" && !latest.needsReview
          ? "Төлбөр баталгаажлаа — хандалт нээгдлээ."
          : "QPay-ээс шалгалаа — төлбөр хараахан ороогүй байна.",
      );
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (error) =>
      toast.error(
        isNotFound(error) ? "Дахин шалгах боломж удахгүй нэмэгдэнэ." : errorMessage(error),
      ),
  });

  return (
    <li className="flex flex-col gap-1.5 border-b border-border-soft px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold tabular-nums text-ink">{invoice.number}</span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <span className="ml-auto font-bold tabular-nums text-ink">
          {invoice.amount.toLocaleString("en-US")}₮
        </span>
      </div>
      <p className="text-caption text-muted">
        {[
          QPAY_KIND_LABEL[invoice.kind],
          invoice.periodLabel,
          invoice.kindergarten?.name,
          invoice.payerPhone ? `Төлөгч: ${invoice.payerPhone}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="text-caption text-muted">
        Үүссэн {formatDateTime(invoice.createdAt)}
        {invoice.paidAt ? ` · Төлсөн ${formatDateTime(invoice.paidAt)}` : null}
        {invoice.validUntil ? ` · Хүчинтэй ${formatDate(invoice.validUntil)} хүртэл` : null}
      </p>
      {meta.hint || meta.recheck ? (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {meta.hint ? <p className="min-w-0 flex-1 text-caption text-ink">{meta.hint}</p> : null}
          {meta.recheck ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={recheck.isPending}
              onClick={() => recheck.mutate()}
            >
              <RefreshCw
                size={15}
                aria-hidden
                className={cn(recheck.isPending && "animate-spin")}
              />
              {recheck.isPending ? "Шалгаж байна…" : "QPay-ээс дахин шалгах"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
