"use client";

import { useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { Download, FilePlus2, Printer, Send } from "lucide-react";
import { z } from "zod";
import {
  attendanceJournalSchema,
  childSummarySchema,
  esisResourceReadSchema,
  financeDashboardSchema,
  groupListItemSchema,
  paginated,
  reportTableSchema,
  type ReportTable,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { MonthSelect } from "@/components/ui/month-select";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { money, monthLabel } from "@/components/finance/money";
import { cn } from "@/lib/utils";

/*
 * Төлбөрийн нэгтгэл — the administrator's finance screen as five tabs, client,
 * 2026-09-27.
 *
 * ★ Built from this product's own components and endpoints; the drawing the
 * client supplied was a reference for *what* to show, and nothing of another
 * product's code, artwork or wording was copied.
 *
 * ★★ Nothing is invented. Every figure below is read from an endpoint that
 * already exists. Where the drawing asks for a figure no endpoint serves — a
 * group's billed total, a discount, a transaction ledger, a child's year of
 * invoices — the cell reads "—" and the backend requirement is recorded, not
 * guessed at from something nearby.
 */

const groupsSchema = paginated(groupListItemSchema);
const childrenSchema = paginated(childSummarySchema);
const generatedSchema = z.object({
  created: z.number(),
  invoiceIds: z.array(z.string()),
  skipped: z.array(z.object({ childId: z.string(), reason: z.string() })),
});

export function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function today(): string {
  const now = new Date();
  return `${thisMonth()}-${String(now.getDate()).padStart(2, "0")}`;
}

function useGroups() {
  return useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    staleTime: 60_000,
  });
}

function useAllChildren() {
  const pageSize = 100;
  const first = useQuery({
    queryKey: qk.children({ page: 1, pageSize, financeRoster: true }),
    queryFn: () => get(`/children?page=1&pageSize=${pageSize}`, childrenSchema),
    staleTime: 60_000,
  });
  const rest = useQueries({
    queries: Array.from({ length: Math.max(0, (first.data?.totalPages ?? 1) - 1) }, (_, index) => {
      const page = index + 2;
      return {
        queryKey: qk.children({ page, pageSize, financeRoster: true }),
        queryFn: () => get(`/children?page=${page}&pageSize=${pageSize}`, childrenSchema),
        staleTime: 60_000,
      };
    }),
  });
  const items = [first.data?.items ?? [], ...rest.map((query) => query.data?.items ?? [])]
    .flat()
    .sort((a, b) =>
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, "mn-MN"),
    );
  return {
    items,
    pending: first.isPending || rest.some((query) => query.isPending),
    error: first.error ?? rest.find((query) => query.isError)?.error,
  };
}

// ── Shared pieces ────────────────────────────────────────────────────────────

const TONE = {
  danger: "bg-danger-soft text-danger",
  sky: "bg-sky text-sky-ink",
  mint: "bg-mint text-mint-ink",
  peach: "bg-peach text-peach-ink",
  cornflower: "bg-cornflower text-cornflower-ink",
} as const;

function Figure({ label, value, tone }: { label: string; value: string; tone: keyof typeof TONE }) {
  return (
    <div className={cn("rounded-card px-4 py-3", TONE[tone])}>
      <dt className="text-caption font-semibold uppercase tracking-wide opacity-80">{label}</dt>
      <dd className="mt-1 text-title font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-3">
      {children}
    </div>
  );
}

function GroupSelect({
  value,
  onChange,
  allLabel = "Бүх бүлэг",
  includeAll = true,
}: {
  value: string;
  onChange: (value: string) => void;
  allLabel?: string;
  includeAll?: boolean;
}) {
  const groups = useGroups();
  return (
    <Field label="Бүлэг">
      {({ id }) => (
        <Select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-[200px]"
        >
          {includeAll ? <option value="">{allLabel}</option> : null}
          {(groups.data?.items ?? []).map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

const HEAD =
  "border-b border-border bg-sunken px-3 py-2.5 text-left text-body font-semibold text-ink";
const CELL = "border-b border-border-soft px-3 py-2 text-body";

function BalanceTable({ table }: { table: ReportTable }) {
  const moneyKeys = new Set(
    table.columns.filter((column) => column.money).map((column) => column.key),
  );

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-border bg-canvas">
              {table.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={
                    moneyKeys.has(column.key)
                      ? "px-4 py-3 text-right font-medium text-ink"
                      : "px-4 py-3 text-left font-medium text-ink"
                  }
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index} className="border-b border-border last:border-0">
                {table.columns.map((column) => (
                  <BalanceCell
                    key={column.key}
                    value={row[column.key]}
                    isMoney={moneyKeys.has(column.key)}
                  />
                ))}
              </tr>
            ))}
          </tbody>
          {table.totals ? (
            <tfoot>
              <tr className="border-t-2 border-border bg-canvas font-semibold">
                {table.columns.map((column) => (
                  <BalanceCell
                    key={column.key}
                    value={table.totals?.[column.key]}
                    isMoney={moneyKeys.has(column.key)}
                  />
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function BalanceCell({ value, isMoney }: { value: unknown; isMoney: boolean }) {
  if (value === null || value === undefined || value === "") {
    return <td className="px-4 py-3 text-muted">—</td>;
  }

  return (
    <td
      className={
        isMoney
          ? "px-4 py-3 text-right tabular-nums text-ink"
          : "px-4 py-3 text-left text-ink"
      }
    >
      {isMoney ? money(String(value)) : String(value)}
    </td>
  );
}

// ── 1. Төлбөрийн үлдэгдэл ────────────────────────────────────────────────────

/**
 * Every invoice still owed, whatever month it was raised in — the existing
 * `unpaid` report. Arrears are not a property of a month, so there is no
 * month picker here.
 */
export function BalancesTab({ kindergartenId }: { kindergartenId: string }) {
  const period = thisMonth();
  const children = useAllChildren();
  const report = useQuery({
    queryKey: qk.financeReport(kindergartenId, "unpaid", period),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/invoices/reports?report=unpaid&period=${period}`,
        reportTableSchema,
      ),
  });

  const balanceTable: ReportTable | null = report.data
    ? (() => {
        const invoiceRows = report.data.rows
          .map((row) => ({
            child: row.child ?? "—",
            number: row.number ?? "—",
            month: row.month ?? "—",
            dueDate: row.dueDate ?? "—",
            daysLate: row.daysLate ?? "—",
            outstanding: row.outstanding ?? null,
          }))
          .sort((a, b) => {
            const left = typeof a.daysLate === "number" ? a.daysLate : Number(a.daysLate) || 0;
            const right = typeof b.daysLate === "number" ? b.daysLate : Number(b.daysLate) || 0;
            return right - left;
          });
        const invoicedNames = new Set(invoiceRows.map((row) => String(row.child).trim()));
        const childrenWithoutInvoice = children.items
          .map((child) => `${child.lastName} ${child.firstName}`.trim())
          .filter((name) => !invoicedNames.has(name))
          .map((child) => ({
            child,
            number: "—",
            month: "—",
            dueDate: "—",
            daysLate: "—",
            outstanding: null,
          }));
        return {
          title: "Төлбөрийн нэгтгэл",
          columns: [
            { key: "child", header: "Хүүхэд" },
            { key: "number", header: "Нэхэмжлэл" },
            { key: "month", header: "Сар" },
            { key: "dueDate", header: "Төлөх хугацаа" },
            { key: "daysLate", header: "Хоцорсон хоног" },
            { key: "outstanding", header: "Үлдэгдэл", money: true },
          ],
          rows: [...invoiceRows, ...childrenWithoutInvoice],
          totals: {
            child: `Нийт ${children.items.length} хүүхэд`,
            outstanding: report.data.totals?.outstanding ?? null,
          },
        };
      })()
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <Button asChild variant="secondary" size="sm" className="ml-auto">
          <a
            href={downloadUrl(
              `/kindergartens/${kindergartenId}/invoices/reports/export?report=unpaid&period=${period}`,
            )}
          >
            <Download size={16} aria-hidden /> Excel
          </a>
        </Button>
      </Toolbar>
      {children.error ? <ErrorState description={errorMessage(children.error)} /> : null}
      {report.isError ? <ErrorState description={errorMessage(report.error)} /> : null}
      {children.pending || report.isPending ? <LoadingState rows={6} /> : null}
      {!children.pending && !report.isPending && balanceTable ? (
        balanceTable.rows.length > 0 ? (
          <BalanceTable table={balanceTable} />
        ) : (
          <EmptyState
            title="Суралцагч бүртгэгдээгүй байна"
            description="Хүүхдийн мэдээлэл хэсэгт суралцагч бүртгэсний дараа энд харагдана."
          />
        )
      ) : null}
    </div>
  );
}

// ── 2. Төлбөрийн нэхэмжлэл ───────────────────────────────────────────────────

/**
 * The month's billing, a group per row, with the one action a month needs —
 * `POST …/invoices/generate-month` for that group's children.
 *
 * ★ The four figures are the whole kindergarten's (`…/invoices/dashboard`),
 * so they are labelled as such. A group's own billed/paid totals have no
 * endpoint yet and read "—"; summing a page of invoices in the browser would
 * be a total that changed with the page size.
 */
export function InvoicingTab({ kindergartenId }: { kindergartenId: string }) {
  const [month, setMonth] = useState(thisMonth());
  const [groupId, setGroupId] = useState("");
  const [billing, setBilling] = useState<{ id: string; name: string } | null>(null);
  const groups = useGroups();

  const dashboard = useQuery({
    queryKey: qk.financeDashboard(kindergartenId, month),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/invoices/dashboard?month=${month}`,
        financeDashboardSchema,
      ),
  });
  const parents = dashboard.data?.parents;
  const rows = (groups.data?.items ?? []).filter((group) => !groupId || group.id === groupId);

  const exportQuery = new URLSearchParams({ month });
  if (groupId) exportQuery.set("groupId", groupId);

  return (
    <div className="flex flex-col gap-4">
      <dl
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        aria-label={`${monthLabel(month)}, бүх цэцэрлэг`}
      >
        <Figure label="Нэхэмжилсэн" value={parents ? money(parents.billed) : "—"} tone="danger" />
        <Figure label="Төлсөн" value={parents ? money(parents.paid) : "—"} tone="sky" />
        {/* No discount total on the dashboard yet. */}
        <Figure label="Хөнгөлсөн" value="—" tone="mint" />
        <Figure label="Үлдэгдэл" value={parents ? money(parents.unpaid) : "—"} tone="peach" />
      </dl>

      <Toolbar>
        <Field label="Сар">
          {({ id }) => (
            <MonthSelect id={id} value={month} onValueChange={setMonth} className="w-[170px]" />
          )}
        </Field>
        <GroupSelect value={groupId} onChange={setGroupId} allLabel="Бүгд" />
        <Button asChild variant="secondary" size="sm">
          <a href={downloadUrl(`/kindergartens/${kindergartenId}/invoices/export?${exportQuery}`)}>
            <Download size={16} aria-hidden /> Excel
          </a>
        </Button>
      </Toolbar>

      {groups.isError ? <ErrorState description={errorMessage(groups.error)} /> : null}
      {groups.isPending ? <LoadingState rows={4} /> : null}
      {groups.data && rows.length === 0 ? (
        <EmptyState title="Бүлэг алга" description="Эхлээд Анги, бүлэг хэсэгт бүлэг нэмнэ үү." />
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-[720px] border-collapse">
            <caption className="sr-only">Бүлгээрх нэхэмжлэл</caption>
            <thead>
              <tr>
                <th scope="col" className={cn(HEAD, "w-12")}>
                  №
                </th>
                <th scope="col" className={HEAD}>
                  Бүлэг
                </th>
                <th scope="col" className={cn(HEAD, "text-center")}>
                  Хөнгөлөлт
                </th>
                <th scope="col" className={cn(HEAD, "text-right")}>
                  Нэхэмжилсэн
                </th>
                <th scope="col" className={cn(HEAD, "text-right")}>
                  Төлсөн
                </th>
                <th scope="col" className={cn(HEAD, "text-right")}>
                  Хөнгөлсөн
                </th>
                <th scope="col" className={HEAD}>
                  Үйлдэл
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((group, index) => (
                <tr key={group.id}>
                  <td className={cn(CELL, "tabular-nums text-muted")}>{index + 1}</td>
                  <td className={cn(CELL, "text-ink")}>{group.name}</td>
                  {/* A group's own totals have no endpoint yet — see the note above. */}
                  <td className={cn(CELL, "text-center text-faint")}>—</td>
                  <td className={cn(CELL, "text-right text-faint")}>—</td>
                  <td className={cn(CELL, "text-right text-faint")}>—</td>
                  <td className={cn(CELL, "text-right text-faint")}>—</td>
                  <td className={CELL}>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setBilling({ id: group.id, name: group.name })}
                    >
                      <FilePlus2 size={16} aria-hidden /> Нэхэмжлэх
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {billing ? (
        <BillGroupDialog
          kindergartenId={kindergartenId}
          month={month}
          group={billing}
          onClose={() => setBilling(null)}
        />
      ) : null}
    </div>
  );
}

function BillGroupDialog({
  kindergartenId,
  month,
  group,
  onClose,
}: {
  kindergartenId: string;
  month: string;
  group: { id: string; name: string };
  onClose: () => void;
}) {
  const toast = useToast();
  const [dueDate, setDueDate] = useState(`${month}-25`);

  const bill = useMutation({
    mutationFn: async () => {
      const children = await get(
        `/children?groupId=${group.id}&page=1&pageSize=100`,
        childrenSchema,
      );
      const childIds = children.items.map((child) => child.id);
      if (childIds.length === 0) throw new Error("Энэ бүлэгт хүүхэд алга байна.");
      return mutate(`/kindergartens/${kindergartenId}/invoices/generate-month`, generatedSchema, {
        method: "POST",
        body: { month, dueDate, childIds },
      });
    },
    onSuccess: (result) => {
      toast.success(
        result.skipped.length > 0
          ? `${result.created} нэхэмжлэл үүслээ, ${result.skipped.length} хүүхдийг алгаслаа.`
          : `${result.created} нэхэмжлэл үүслээ.`,
      );
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? null : onClose())}
      title={`${group.name} — нэхэмжлэх`}
      description={`${monthLabel(month)}-ын нэхэмжлэлийг тухайн сарын тариф, ирц, хооллосон өдрөөр үүсгэнэ. Үүссэн нэхэмжлэлийг дахин үүсгэхгүй.`}
      busy={bill.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={bill.isPending}>
            Болих
          </Button>
          <Button onClick={() => bill.mutate()} disabled={bill.isPending || !dueDate}>
            {bill.isPending ? "Үүсгэж байна…" : "Нэхэмжлэх"}
          </Button>
        </>
      }
    >
      <Field label="Төлөх хугацаа">
        {({ id }) => (
          <Input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        )}
      </Field>
    </FormDialog>
  );
}

// ── 3. Гүйлгээ ───────────────────────────────────────────────────────────────

/**
 * The transaction ledger — drawn, and honest that it is not connected.
 *
 * ★ No endpoint lists payments across invoices: they are read one invoice at a
 * time. So the filters are shown disabled and the figures read "—". An empty
 * table under live filters would say "there were no transactions", which is a
 * claim this screen cannot make.
 */
export function TransactionsTab() {
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Нийт орлого" value="—" tone="sky" />
        <Figure label="Нийт зарлага" value="—" tone="danger" />
        <Figure label="Цэвэр үлдэгдэл" value="—" tone="mint" />
        <Figure label="Гүйлгээний тоо" value="—" tone="cornflower" />
      </dl>

      <Toolbar>
        <Field label="Эхлэх огноо">
          {({ id }) => <Input id={id} type="date" disabled className="w-[170px]" />}
        </Field>
        <Field label="Дуусах огноо">
          {({ id }) => <Input id={id} type="date" disabled className="w-[170px]" />}
        </Field>
        <Field label="Төрөл">
          {({ id }) => (
            <Select id={id} value="" disabled className="w-[160px]">
              <option value="">Бүгд</option>
            </Select>
          )}
        </Field>
        <div className="ml-auto flex items-end gap-2">
          <Input aria-label="Гүйлгээ хайх" placeholder="Хайх..." disabled className="w-[220px]" />
          <Button
            variant="secondary"
            size="sm"
            disabled
            title="Гүйлгээний жагсаалт хараахан холбогдоогүй байна"
          >
            <Download size={16} aria-hidden /> Excel
          </Button>
        </div>
      </Toolbar>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full min-w-[760px] border-collapse">
          <caption className="sr-only">Гүйлгээ</caption>
          <thead>
            <tr>
              {["№", "Огноо", "Бүлэг", "Суралцагч", "Дүн", "Төрөл", "Гүйлгээний төрөл", "Утга"].map(
                (label) => (
                  <th key={label} scope="col" className={HEAD}>
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
        </table>
        <EmptyState
          title="Гүйлгээний жагсаалт удахгүй нэмэгдэнэ"
          description="Төлбөрийг одоогоор нэхэмжлэл бүрийн дэлгэрэнгүйгээс бүртгэж, харна."
        />
      </div>
    </div>
  );
}

// ── 4. Жилийн тайлан ─────────────────────────────────────────────────────────

/** 1 September of the school year `date` falls in, to `date` itself. */
function schoolYearSoFar(date: string): { from: string; to: string } {
  const year = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 9 ? year : year - 1;
  return { from: `${start}-09-01`, to: date };
}

/** The register reads at most 92 days at a time; a year is asked for in pieces. */
function windows(from: string, to: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const last = new Date(cursor);
    last.setUTCDate(last.getUTCDate() + 91);
    const stop = last < end ? last : end;
    out.push({ from: cursor.toISOString().slice(0, 10), to: stop.toISOString().slice(0, 10) });
    cursor = new Date(stop);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * A group's school year so far, a child per row.
 *
 * ★ "Нийт ирц" is real: the days each child came (Ирсэн, a legacy half day
 * included), counted from the attendance register since 1 September. The five
 * money columns have no per-child yearly endpoint yet and read "—".
 */
export function AnnualTab({ kindergartenId }: { kindergartenId: string }) {
  const groups = useGroups();
  const [chosen, setChosen] = useState("");
  const groupId = chosen || groups.data?.items[0]?.id || "";
  const span = schoolYearSoFar(today());
  const parts = windows(span.from, span.to);

  const registers = useQueries({
    queries: parts.map((part) => ({
      queryKey: qk.attendanceJournal(kindergartenId, {
        from: part.from,
        to: part.to,
        groupId,
        page: 1,
        pageSize: 200,
      }),
      queryFn: () =>
        get(
          `/kindergartens/${kindergartenId}/attendance/register?from=${part.from}&to=${part.to}&groupId=${groupId}&page=1&pageSize=200`,
          attendanceJournalSchema,
        ),
      enabled: Boolean(groupId),
    })),
  });

  const failed = registers.find((query) => query.isError);
  const pending = registers.some((query) => query.isPending);
  const children = new Map<string, { lastName: string | null; firstName: string; days: number }>();
  if (!pending && !failed) {
    for (const query of registers) {
      for (const row of query.data?.items ?? []) {
        const entry = children.get(row.childId) ?? {
          lastName: row.child.lastName,
          firstName: row.child.firstName,
          days: 0,
        };
        entry.days += (row.counts.PRESENT ?? 0) + (row.counts.HALF_DAY ?? 0);
        children.set(row.childId, entry);
      }
    }
  }
  const rows = [...children.entries()];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <GroupSelect value={groupId} onChange={setChosen} includeAll={false} />
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => window.print()}>
            <Printer size={16} aria-hidden /> Хэвлэх
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled
            title="Жилийн тайлангийн экспорт хараахан холбогдоогүй байна"
          >
            <Download size={16} aria-hidden /> Export
          </Button>
        </div>
      </Toolbar>

      <ul className="flex flex-wrap gap-2 text-body font-semibold" aria-label="Нийт дүн">
        <li className={cn("rounded-pill px-3 py-1", TONE.sky)}>
          Нийт суралцагч: {pending || failed ? "—" : rows.length}
        </li>
        <li className={cn("rounded-pill px-3 py-1", TONE.danger)}>Нийт нэхэмжилсэн: —</li>
        <li className={cn("rounded-pill px-3 py-1", TONE.mint)}>Нийт төлсөн: —</li>
      </ul>

      {!groupId && groups.data ? (
        <EmptyState title="Бүлэг алга" description="Эхлээд Анги, бүлэг хэсэгт бүлэг нэмнэ үү." />
      ) : failed ? (
        <ErrorState description={errorMessage(failed.error)} />
      ) : pending ? (
        <LoadingState rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Суралцагч алга"
          description="Энэ бүлэгт энэ хичээлийн жилд бүртгэл алга."
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-[860px] border-collapse">
            <caption className="sr-only">Жилийн тайлан</caption>
            <thead>
              <tr>
                <th scope="col" className={cn(HEAD, "w-12")}>
                  №
                </th>
                <th scope="col" className={HEAD}>
                  Суралцагчийн нэр
                </th>
                <th scope="col" className={cn(HEAD, "text-center")}>
                  Хөнгөлөлттэй
                </th>
                <th scope="col" className={cn(HEAD, "text-center")}>
                  Нийт ирц
                </th>
                <th scope="col" className={cn(HEAD, "text-right")}>
                  Нэхэмжилсэн дүн
                </th>
                <th scope="col" className={cn(HEAD, "text-right")}>
                  Төлсөн дүн
                </th>
                <th scope="col" className={cn(HEAD, "text-right")}>
                  Илүү төлөлт
                </th>
                <th scope="col" className={cn(HEAD, "text-right")}>
                  Төлбөл зохих
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([childId, child], index) => (
                <tr key={childId}>
                  <td className={cn(CELL, "tabular-nums text-muted")}>{index + 1}</td>
                  <td className={CELL}>
                    {child.lastName ? (
                      <span className="block text-caption text-muted">{child.lastName}</span>
                    ) : null}
                    <span className="font-semibold text-ink">{child.firstName}</span>
                  </td>
                  <td className={cn(CELL, "text-center text-faint")}>—</td>
                  <td className={cn(CELL, "text-center tabular-nums text-ink")}>{child.days}</td>
                  <td className={cn(CELL, "text-right text-faint")}>—</td>
                  <td className={cn(CELL, "text-right text-faint")}>—</td>
                  <td className={cn(CELL, "text-right text-faint")}>—</td>
                  <td className={cn(CELL, "text-right text-faint")}>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 5. Маягт ─────────────────────────────────────────────────────────────────

/**
 * The ministry's food-income forms, Маягт-1 and Маягт-2, moved here from the
 * foot of Санхүүжилт (client, 2026-09-27: the ESIS fields "шингээнэ").
 *
 * ★ Read from ESIS (`livelihoodForm1`, `livelihoodForm2`) and drawn as the
 * document it is, not as a field table. Only a LIVE read fills it in: a MOCK
 * read is the adapter's sample, and a form that looks ready to sign must not
 * carry invented figures. ESIS has no write service for these forms in this
 * product, so ESIS илгээх is shown disabled.
 */
export function FormsTab({ kindergartenId }: { kindergartenId: string }) {
  const [month, setMonth] = useState(thisMonth());
  const [form, setForm] = useState<"1" | "2">("1");
  const [esisGroup, setEsisGroup] = useState("");
  const params = { academicYear: month.slice(0, 4), academicMonth: String(Number(month.slice(5))) };

  const esisGroups = useQuery({
    queryKey: ["esis", kindergartenId, "groups"],
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/esis/resource?resource=groups`, esisResourceReadSchema),
    enabled: form === "2",
    retry: false,
    staleTime: 5 * 60_000,
  });
  const liveGroups = esisGroups.data?.source === "LIVE" ? esisGroups.data.rows : [];

  const read = useQuery({
    queryKey: ["esis", kindergartenId, `livelihoodForm${form}`, params, esisGroup],
    queryFn: () => {
      const query = new URLSearchParams({ resource: `livelihoodForm${form}`, ...params });
      if (form === "2") query.set("studentGroupId", esisGroup);
      return get(`/kindergartens/${kindergartenId}/esis/resource?${query}`, esisResourceReadSchema);
    },
    enabled: form === "1" || Boolean(esisGroup),
    retry: false,
  });
  const live = read.data?.source === "LIVE";
  const rows = live ? read.data!.rows : [];
  const monthNumber = Number(month.slice(5));

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <Field label="Сар">
          {({ id }) => (
            <MonthSelect id={id} value={month} onValueChange={setMonth} className="w-[170px]" />
          )}
        </Field>
        <Field label="Маягт">
          {({ id }) => (
            <Select
              id={id}
              value={form}
              onChange={(e) => setForm(e.target.value as "1" | "2")}
              className="w-[160px]"
            >
              <option value="1">Маягт-1</option>
              <option value="2">Маягт-2</option>
            </Select>
          )}
        </Field>
        {form === "2" ? (
          <Field label="Бүлэг">
            {({ id }) => (
              <Select
                id={id}
                value={esisGroup}
                onChange={(e) => setEsisGroup(e.target.value)}
                className="w-[200px]"
              >
                <option value="">Бүлэг сонгох</option>
                {liveGroups.map((group) => (
                  <option key={group.studentGroupId ?? ""} value={group.studentGroupId ?? ""}>
                    {group.studentGroupName ?? group.studentGroupId}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            disabled
            title="ESIS руу маягт илгээх үйлдэл хараахан холбогдоогүй байна"
          >
            <Send size={16} aria-hidden /> ESIS илгээх
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled
            title="Маягтын Excel хараахан холбогдоогүй байна"
          >
            <Download size={16} aria-hidden /> Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer size={16} aria-hidden /> Хэвлэх
          </Button>
        </div>
      </Toolbar>

      <article className="rounded-card border border-border bg-surface px-4 py-6 sm:px-8">
        <h2 className="mx-auto max-w-3xl text-center text-lead font-bold uppercase text-ink">
          {live && rows[0]?.orgName ? `${rows[0].orgName} ` : ""}
          {monthNumber}-р сарын хоолны түүхий эдийн зардлын эцэг эх, асран хамгаалагчийн төвлөрүүлэх
          орлого
        </h2>
        <p className="mt-3 text-center text-body font-semibold text-ink">(Маягт - {form})</p>

        {read.isError ? (
          <div className="mt-4">
            <ErrorState description={errorMessage(read.error)} />
          </div>
        ) : null}
        {read.data && !live ? (
          <p className="mt-4 rounded-card bg-sunken px-4 py-3 text-center text-body text-muted">
            ESIS-тэй бодитоор холбогдоогүй тул маягтын дүнг харуулахгүй.
          </p>
        ) : null}
        {form === "2" && !esisGroup ? (
          <p className="mt-4 rounded-card bg-sunken px-4 py-3 text-center text-body text-muted">
            {esisGroups.data && liveGroups.length === 0
              ? "ESIS-ээс бүлгийн жагсаалт ирээгүй байна."
              : "Маягт-2-ыг харахын тулд бүлэг сонгоно уу."}
          </p>
        ) : null}

        <div className="mt-5 overflow-x-auto">
          {form === "1" ? (
            <table className="w-full min-w-[760px] border-collapse">
              <caption className="sr-only">Маягт-1</caption>
              <thead>
                <tr>
                  {[
                    "Д/д",
                    "Байгууллагын нэр",
                    "Нийт хүүхдийн тоо",
                    "Зорилтот бүлгийн хүүхдийн тоо",
                    "Нийт төвлөрүүлэх орлогын дүн (₮)",
                    "Нийт төвлөрүүлсэн орлогын дүн (₮)",
                  ].map((label) => (
                    <th key={label} scope="col" className={cn(HEAD, "text-center")}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className={cn(CELL, "text-center")}>1</td>
                    {Array.from({ length: 5 }, (_, i) => (
                      <td key={i} className={cn(CELL, "text-center text-faint")}>
                        —
                      </td>
                    ))}
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr key={index}>
                      <td className={cn(CELL, "text-center")}>{index + 1}</td>
                      <td className={cn(CELL, "text-center")}>{row.orgName ?? "—"}</td>
                      <td className={cn(CELL, "text-center tabular-nums")}>
                        {row.studentCnt ?? "—"}
                      </td>
                      <td className={cn(CELL, "text-center tabular-nums")}>
                        {row.livelihoodCnt ?? "—"}
                      </td>
                      <td className={cn(CELL, "text-center tabular-nums")}>
                        {money(row.livelihoodBudget)}
                      </td>
                      <td className={cn(CELL, "text-center tabular-nums")}>
                        {money(row.livelihoodAmount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[860px] border-collapse">
              <caption className="sr-only">Маягт-2</caption>
              <thead>
                <tr>
                  {[
                    "Д/д",
                    "Бүлэг",
                    "Суралцагч",
                    "Ирэх өдөр",
                    "Ирсэн өдөр",
                    "Төлөх дүн",
                    "Төлсөн дүн",
                    "Амьжиргааны хөнгөлөлт",
                  ].map((label) => (
                    <th key={label} scope="col" className={cn(HEAD, "text-center")}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    <td className={cn(CELL, "text-center")}>{index + 1}</td>
                    <td className={cn(CELL, "text-center")}>{row.studentGroupName ?? "—"}</td>
                    <td className={cn(CELL, "text-center tabular-nums")}>{row.personId ?? "—"}</td>
                    <td className={cn(CELL, "text-center tabular-nums")}>
                      {row.comingDays ?? "—"}
                    </td>
                    <td className={cn(CELL, "text-center tabular-nums")}>
                      {row.arrivalDays ?? "—"}
                    </td>
                    <td className={cn(CELL, "text-center tabular-nums")}>{money(row.amountDue)}</td>
                    <td className={cn(CELL, "text-center tabular-nums")}>
                      {money(row.amountPaid)}
                    </td>
                    <td className={cn(CELL, "text-center tabular-nums")}>
                      {money(row.livelihoodDiscount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mx-auto mt-8 flex max-w-md flex-col gap-3 text-body text-ink">
          <p>Эрхлэгч ______________________ /.............../</p>
          <p>Нягтлан бодогч ______________________ /.............../</p>
        </div>
        <p className="mt-6 text-center text-body text-muted">
          {today().slice(0, 4)} оны {today().slice(5, 7)} сарын {today().slice(8, 10)} өдөр
        </p>
      </article>
    </div>
  );
}
