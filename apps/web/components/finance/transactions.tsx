"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import {
  PAYMENT_METHOD_LABEL,
  paginated,
  paymentMethodSchema,
  type PaymentMethod,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { formatDate, fullName } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Pagination } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";
import {
  FigureCard,
  FigureRow,
  FilterBar,
  GroupField,
  moneyText,
} from "@/components/finance/finance-ui";

/*
  ★ The ledger's shape — agreed with the backend on 2026-10-02 and not yet
  served (`docs/FINANCE_BACKEND_REQUEST.md` §1). Declared here rather than in
  `@kinder/contracts` because the API has not committed to it; once the route
  ships, the shape moves there and this file imports it.
*/
const transactionKindSchema = z.enum(["PAYMENT", "REVERSAL"]);
type TransactionKind = z.infer<typeof transactionKindSchema>;

const transactionSchema = z.object({
  id: z.string(),
  kind: transactionKindSchema,
  /** Negative on a reversal row, as on `Payment`. */
  amount: z.string(),
  method: paymentMethodSchema,
  note: z.string().nullable(),
  voidedAt: z.string().nullable(),
  createdAt: z.string(),
  invoice: z.object({ id: z.string(), number: z.string().nullable(), month: z.string() }),
  child: z.object({
    id: z.string(),
    lastName: z.string().nullable(),
    firstName: z.string(),
    registrationNumber: z.string().nullable(),
    group: z.object({ id: z.string(), name: z.string() }).nullable(),
  }),
});

const transactionsSchema = paginated(transactionSchema).extend({
  /** Over every matching row, not the page. */
  summary: z.object({
    income: z.string(),
    /** "0.00" until the expense module exists. */
    expense: z.string(),
    net: z.string(),
    count: z.number(),
  }),
});

const KIND_LABEL: Record<TransactionKind, string> = {
  PAYMENT: "Орлого",
  REVERSAL: "Буцаалт",
};

const PAGE_SIZE = 25;

function firstOfMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Гүйлгээ — every payment recorded over a range of dates, newest first.
 *
 * ★ 2026-10-02, the client's «Гүйлгээ» tab: four totals, a date range, a
 * group, the method and the kind, and a search. Read-only: a payment is
 * recorded and voided on its invoice (`/invoices`), and a voided one stays in
 * the list with its reversing row beside it — §14's rule that a confirmed
 * transaction is never deleted is what the reader is looking at.
 *
 * ★★ «Нийт зарлага» is in the reference and reads 0 here until an expense
 * module exists — a card that always says 0 is honest; a missing one would
 * hide that the question has no answer yet.
 *
 * ★★★ Until the route exists the API answers 404, shown as "not yet
 * available" rather than as an error — a known state, not a fault.
 */
export function Transactions({ kindergartenId }: { kindergartenId: string }) {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [groupId, setGroupId] = useState("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [kind, setKind] = useState<TransactionKind | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim());

  const filters = new URLSearchParams({
    from,
    to,
    ...(groupId ? { groupId } : {}),
    ...(method ? { method } : {}),
    ...(kind ? { kind } : {}),
    ...(q ? { q } : {}),
  }).toString();

  const transactions = useQuery({
    queryKey: ["payments", kindergartenId, filters, page],
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/payments?${filters}&page=${page}&pageSize=${PAGE_SIZE}`,
        transactionsSchema,
      ),
    retry: false,
  });

  const resetting =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  const missing = transactions.isError && isNotFound(transactions.error);
  const summary = transactions.data?.summary;

  return (
    <div className="flex flex-col gap-4">
      <FigureRow>
        <FigureCard
          label="Нийт орлого"
          value={summary ? moneyText(summary.income) : "—"}
          tone="sky"
        />
        <FigureCard
          label="Нийт зарлага"
          value={summary ? moneyText(summary.expense) : "—"}
          tone="peach"
        />
        <FigureCard
          label="Цэвэр үлдэгдэл"
          value={summary ? moneyText(summary.net) : "—"}
          tone="mint"
        />
        <FigureCard
          label="Гүйлгээний тоо"
          value={summary ? String(summary.count) : "—"}
          tone="cornflower"
        />
      </FigureRow>

      <FilterBar>
        <Field label="Эхлэх огноо">
          {({ id }) => (
            <Input
              id={id}
              type="date"
              value={from}
              max={to}
              onChange={(event) => resetting(setFrom)(event.target.value)}
              className="w-[170px]"
            />
          )}
        </Field>
        <Field label="Дуусах огноо">
          {({ id }) => (
            <Input
              id={id}
              type="date"
              value={to}
              min={from}
              onChange={(event) => resetting(setTo)(event.target.value)}
              className="w-[170px]"
            />
          )}
        </Field>
        <GroupField value={groupId} onChange={resetting(setGroupId)} allLabel="Бүх бүлэг" />
        <Field label="Төлбөрийн хэлбэр" labelHidden>
          {({ id }) => (
            <Select
              id={id}
              value={method}
              onChange={(event) => resetting(setMethod)(event.target.value as PaymentMethod | "")}
              className="w-[180px]"
            >
              <option value="">Бүх хэлбэр</option>
              {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Гүйлгээний төрөл" labelHidden>
          {({ id }) => (
            <Select
              id={id}
              value={kind}
              onChange={(event) => resetting(setKind)(event.target.value as TransactionKind | "")}
              className="w-[160px]"
            >
              <option value="">Бүх төрөл</option>
              {Object.entries(KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <SearchField
          label="Суралцагч, регистр, нэхэмжлэлийн дугаараар хайх"
          placeholder="Хайх…"
          value={search}
          onChange={resetting(setSearch)}
        />
        <Button asChild variant="secondary" size="sm">
          <a href={downloadUrl(`/kindergartens/${kindergartenId}/payments/export?${filters}`)}>
            <Download size={16} aria-hidden="true" />
            Excel
          </a>
        </Button>
      </FilterBar>

      {missing ? (
        <EmptyState
          title="Гүйлгээний жагсаалт удахгүй нэмэгдэнэ"
          description="Сервер талд хийгдэж байна. Төлбөрийг одоохондоо «Нэхэмжлэл засах» хэсгээс нэхэмжлэл бүрээр нь харна уу."
        />
      ) : null}
      {transactions.isLoading ? <LoadingState rows={5} /> : null}
      {transactions.isError && !missing ? (
        <ErrorState description={errorMessage(transactions.error)} />
      ) : null}

      {transactions.data ? (
        transactions.data.items.length === 0 ? (
          <EmptyState
            title="Энэ хугацаанд гүйлгээ алга"
            description="Огнооны хүрээ эсвэл шүүлтүүрээ өөрчилнө үү. Төлбөрийг нэхэмжлэл дээр нь бүртгэнэ."
          />
        ) : (
          <>
            <TableShell caption="Төлбөрийн гүйлгээ" minWidth="min-w-[960px]">
              <thead>
                <tr>
                  <Th className="w-12">№</Th>
                  <Th>Огноо</Th>
                  <Th>Бүлэг</Th>
                  <Th>Суралцагч</Th>
                  <Th>Регистрийн дугаар</Th>
                  <Th numeric>Дүн</Th>
                  <Th>Төрөл</Th>
                  <Th>Гүйлгээний төрөл</Th>
                  <Th>Утга</Th>
                </tr>
              </thead>
              <tbody>
                {transactions.data.items.map((item, index) => (
                  <tr key={item.id} className={item.voidedAt ? "text-muted" : undefined}>
                    <Td className="tabular-nums text-muted">
                      {(page - 1) * PAGE_SIZE + index + 1}
                    </Td>
                    <Td className="tabular-nums">{formatDate(item.createdAt)}</Td>
                    <Td>{item.child.group?.name ?? "—"}</Td>
                    <Td className="font-medium text-ink">
                      <Link href={`/children/${item.child.id}/finance`} className="hover:underline">
                        {fullName(item.child)}
                      </Link>
                    </Td>
                    <Td className="tabular-nums">{item.child.registrationNumber ?? "—"}</Td>
                    <Td numeric className="font-semibold">
                      {moneyText(item.amount)}
                    </Td>
                    <Td>{PAYMENT_METHOD_LABEL[item.method]}</Td>
                    <Td>
                      <Badge tone={item.kind === "REVERSAL" ? "peach" : "mint"}>
                        {KIND_LABEL[item.kind]}
                      </Badge>
                      {item.voidedAt ? (
                        <Badge tone="neutral" className="ml-1">
                          Цуцлагдсан
                        </Badge>
                      ) : null}
                    </Td>
                    <Td>
                      {[item.invoice.number ?? `${item.invoice.month} нэхэмжлэл`, item.note]
                        .filter(Boolean)
                        .join(" · ")}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
            {summary ? (
              <p className="flex flex-wrap gap-x-6 gap-y-1 text-body text-muted">
                <span>
                  Нийт орлого:{" "}
                  <span className="font-semibold text-sky-ink">{moneyText(summary.income)}</span>
                </span>
                <span>
                  Нийт зарлага:{" "}
                  <span className="font-semibold text-peach-ink">{moneyText(summary.expense)}</span>
                </span>
                <span>
                  Цэвэр:{" "}
                  <span className="font-semibold text-mint-ink">{moneyText(summary.net)}</span>
                </span>
              </p>
            ) : null}
            <Pagination page={page} totalPages={transactions.data.totalPages} onPage={setPage} />
          </>
        )
      ) : null}
    </div>
  );
}
