"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FilePlus, FileText } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { z } from "zod";
import {
  childSummarySchema,
  INVOICE_STATUS_LABEL,
  invoiceSummarySchema,
  paginated,
  type ChildSummary,
  type InvoiceStatus,
  type InvoiceSummary,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { fullName } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import {
  cents,
  FigureCard,
  FigureRow,
  FilterBar,
  GroupField,
  money,
  MonthField,
  useGroups,
} from "@/components/finance/finance-ui";

const invoicesSchema = paginated(invoiceSummarySchema);
const childrenSchema = paginated(childSummarySchema);
const generateResultSchema = z.object({
  created: z.number(),
  invoiceIds: z.array(z.string()),
  skipped: z.array(z.object({ childId: z.string(), reason: z.string() })),
});

/** Every invoice of one month, page by page — the register is paginated. */
async function allInvoicesForMonth(
  kindergartenId: string,
  month: string,
): Promise<InvoiceSummary[]> {
  const path = `/kindergartens/${kindergartenId}/invoices?month=${month}`;
  const first = await get(`${path}&page=1&pageSize=100`, invoicesSchema);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) =>
      get(`${path}&page=${index + 2}&pageSize=100`, invoicesSchema),
    ),
  );
  return [first, ...rest].flatMap((page) => page.items);
}

/** The finance roster — which children a group's «Нэхэмжлэх» bills. */
async function allChildren(kindergartenId: string): Promise<ChildSummary[]> {
  const path = `/kindergartens/${kindergartenId}/children/finance-roster`;
  const first = await get(`${path}?page=1&pageSize=100`, childrenSchema);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) =>
      get(`${path}?page=${index + 2}&pageSize=100`, childrenSchema),
    ),
  );
  return [first, ...rest].flatMap((page) => page.items);
}

function activeGroupId(child: ChildSummary): string | null {
  return (
    child.enrollments.find((item) => item.status === "ACTIVE")?.group?.id ??
    child.enrollments[0]?.group?.id ??
    null
  );
}

function useMonthInvoices(kindergartenId: string, month: string) {
  return useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.invoices(kindergartenId, { month, all: true }),
    queryFn: () => allInvoicesForMonth(kindergartenId, month),
  });
}

type Sums = {
  due: number;
  paid: number;
  discount: number;
  balance: number;
  count: number;
  discounted: number;
};

function sum(invoices: InvoiceSummary[]): Sums {
  return invoices.reduce<Sums>(
    (total, invoice) => ({
      due: total.due + cents(invoice.totalDue),
      paid: total.paid + cents(invoice.paidAmount),
      discount: total.discount + cents(invoice.discountAmount),
      balance: total.balance + cents(invoice.balance),
      count: total.count + 1,
      discounted: total.discounted + (cents(invoice.discountAmount) > 0 ? 1 : 0),
    }),
    { due: 0, paid: 0, discount: 0, balance: 0, count: 0, discounted: 0 },
  );
}

type Tone = "neutral" | "mint" | "sky" | "peach" | "danger";

const STATUS_TONE: Record<InvoiceStatus, Tone> = {
  UNPAID: "neutral",
  PARTIALLY_PAID: "peach",
  PAID: "mint",
  OVERDUE: "danger",
  REFUNDED: "sky",
};

const NO_GROUP = "__none__";

function byGroup(invoices: InvoiceSummary[], groupId: string) {
  return groupId ? invoices.filter((invoice) => invoice.child.group?.id === groupId) : invoices;
}

/**
 * Төлбөрийн нэхэмжлэл — the month's billing at a glance: four totals and a
 * row per group, each with its own «Нэхэмжлэх».
 *
 * ★ 2026-10-01, the client's «Төлбөрийн нэхэмжлэл» tab; a row for **every**
 * group and the per-group «Нэхэмжлэх» since 2026-10-02, as their reference
 * has it. A group with nothing billed yet reads zeros, not absence, because
 * that is the row an accountant is about to bill.
 *
 * «Нэхэмжлэх» is `POST …/invoices/generate-month` with the group's children
 * as `childIds`. The API prices them from the `PARENT` tariffs × the month's
 * attendance and meal days and skips anyone already invoiced, so pressing it
 * twice is harmless — which is why it asks only for a due date.
 */
export function InvoiceOverview({
  kindergartenId,
  month,
  onMonthChange,
}: {
  kindergartenId: string;
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const invoices = useMonthInvoices(kindergartenId, month);
  const groups = useGroups();
  const [groupId, setGroupId] = useState("");

  const all = useMemo(() => invoices.data ?? [], [invoices.data]);
  const totals = sum(byGroup(all, groupId));

  const rows = useMemo(() => {
    const buckets = new Map<string, InvoiceSummary[]>();
    for (const invoice of all) {
      const key = invoice.child.group?.id ?? NO_GROUP;
      buckets.set(key, [...(buckets.get(key) ?? []), invoice]);
    }
    const listed = (groups.data?.items ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      ...sum(buckets.get(group.id) ?? []),
    }));
    const orphans = buckets.get(NO_GROUP);
    if (orphans) listed.push({ id: NO_GROUP, name: "Бүлэггүй", ...sum(orphans) });
    return groupId ? listed.filter((row) => row.id === groupId) : listed;
  }, [all, groups.data, groupId]);

  return (
    <div className="flex flex-col gap-4">
      {invoices.data ? (
        <FigureRow>
          <FigureCard label="Нэхэмжилсэн" value={money(totals.due)} tone="peach" />
          <FigureCard label="Төлсөн" value={money(totals.paid)} tone="sky" />
          <FigureCard label="Хөнгөлсөн" value={money(totals.discount)} tone="mint" />
          <FigureCard label="Үлдэгдэл" value={money(totals.balance)} tone="sun" />
        </FigureRow>
      ) : null}

      <FilterBar>
        <MonthField value={month} onChange={onMonthChange} />
        <GroupField value={groupId} onChange={setGroupId} allLabel="Бүгд" />
        <Button asChild variant="secondary" size="sm">
          <a
            href={downloadUrl(
              `/kindergartens/${kindergartenId}/invoices/export?` +
                new URLSearchParams({ month, ...(groupId ? { groupId } : {}) }).toString(),
            )}
          >
            <Download size={16} aria-hidden="true" />
            Excel
          </a>
        </Button>
        <Button asChild variant="secondary" size="sm" className="ml-auto">
          <Link href="/invoices">
            <FileText size={16} aria-hidden="true" />
            Нэхэмжлэл засах
          </Link>
        </Button>
      </FilterBar>

      {invoices.isLoading || groups.isLoading ? <LoadingState rows={3} /> : null}
      {invoices.isError ? <ErrorState description={errorMessage(invoices.error)} /> : null}

      {invoices.data && groups.data ? (
        rows.length === 0 ? (
          <EmptyState
            title="Бүлэг алга"
            description="«Анги, бүлэг» хэсэгт бүлэг үүсгэсний дараа нэхэмжлэл үүсгэнэ."
          />
        ) : (
          <TableShell caption="Бүлгээр нэхэмжлэл" minWidth="min-w-[820px]">
            <thead>
              <tr>
                <Th className="w-12">№</Th>
                <Th>Бүлэг</Th>
                <Th numeric>Хүүхэд</Th>
                <Th numeric>Хөнгөлөлт</Th>
                <Th numeric>Нэхэмжилсэн</Th>
                <Th numeric>Төлсөн</Th>
                <Th numeric>Хөнгөлсөн</Th>
                <Th numeric>Үлдэгдэл</Th>
                <Th>Үйлдэл</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <Td className="tabular-nums text-muted">{index + 1}</Td>
                  <Td className="font-medium text-ink">{row.name}</Td>
                  <Td numeric>{row.count}</Td>
                  <Td numeric>{row.discounted}</Td>
                  <Td numeric className="text-peach-ink">
                    {money(row.due)}
                  </Td>
                  <Td numeric className="text-sky-ink">
                    {money(row.paid)}
                  </Td>
                  <Td numeric className="text-mint-ink">
                    {money(row.discount)}
                  </Td>
                  <Td numeric className="font-semibold">
                    {money(row.balance)}
                  </Td>
                  <Td>
                    {row.id === NO_GROUP ? null : (
                      <GenerateForGroup
                        kindergartenId={kindergartenId}
                        month={month}
                        groupId={row.id}
                        groupName={row.name}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )
      ) : null}
    </div>
  );
}

/** «Нэхэмжлэх» for one group — a due date, then `generate-month`. */
function GenerateForGroup({
  kindergartenId,
  month,
  groupId,
  groupName,
}: {
  kindergartenId: string;
  month: string;
  groupId: string;
  groupName: string;
}) {
  const [open, setOpen] = useState(false);
  const [dueDate, setDueDate] = useState(`${month}-25`);
  const formId = useId();
  const toast = useToast();
  const queryClient = useQueryClient();

  const roster = useQuery({
    queryKey: ["finance", "roster", kindergartenId],
    queryFn: () => allChildren(kindergartenId),
    enabled: open,
  });
  const childIds = (roster.data ?? [])
    .filter((child) => activeGroupId(child) === groupId)
    .map((child) => child.id);

  const generate = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/invoices/generate-month`, generateResultSchema, {
        method: "POST",
        body: { month, dueDate, childIds },
      }),
    onSuccess: (result) => {
      toast.success(
        result.created > 0
          ? `${groupName}: ${result.created} нэхэмжлэл үүсгэлээ.`
          : `${groupName}: шинээр нэхэмжлэх хүүхэд алга.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["invoices", kindergartenId] });
      setOpen(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setDueDate(`${month}-25`);
          setOpen(true);
        }}
      >
        <FilePlus size={16} aria-hidden="true" />
        Нэхэмжлэх
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`${groupName} — нэхэмжлэх`}
        description="Тариф, сарын ирц, хоолны өдрөөр бодно. Аль хэдийн нэхэмжилсэн хүүхдийг алгасна."
        busy={generate.isPending}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={generate.isPending}
            >
              Цуцлах
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={generate.isPending || roster.isLoading || childIds.length === 0}
            >
              {generate.isPending ? "Үүсгэж байна…" : "Нэхэмжлэх"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!generate.isPending && childIds.length > 0) generate.mutate();
          }}
        >
          <Field label="Төлөх эцсийн огноо" required>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                required
              />
            )}
          </Field>
          <p className="text-body text-muted">
            {roster.isLoading
              ? "Бүлгийн хүүхдүүдийг уншиж байна…"
              : childIds.length === 0
                ? "Энэ бүлэгт суралцаж буй хүүхэд алга."
                : `${childIds.length} хүүхдэд ${month} сарын нэхэмжлэл үүсгэнэ.`}
          </p>
        </form>
      </FormDialog>
    </>
  );
}

/**
 * Төлбөрийн үлдэгдэл — who owes what this month, a child per row.
 *
 * ★ 2026-10-01, the client's «Төлбөрийн үлдэгдэл» tab. The same invoices as
 * «Нэхэмжлэл», not summed: an accountant chasing a balance needs the name.
 * "Зөвхөн өртэй" is on by default, because a paid child is not the question.
 */
export function BalanceOverview({
  kindergartenId,
  month,
  onMonthChange,
}: {
  kindergartenId: string;
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const invoices = useMonthInvoices(kindergartenId, month);
  const [groupId, setGroupId] = useState("");
  const [search, setSearch] = useState("");
  const [owingOnly, setOwingOnly] = useState(true);

  const all = invoices.data ?? [];
  const needle = search.trim().toLocaleLowerCase("mn-MN");
  const inGroup = byGroup(all, groupId);
  const rows = inGroup
    .filter((invoice) => !owingOnly || cents(invoice.balance) > 0)
    .filter(
      (invoice) => !needle || fullName(invoice.child).toLocaleLowerCase("mn-MN").includes(needle),
    )
    .sort((a, b) => fullName(a.child).localeCompare(fullName(b.child), "mn"));
  const totals = sum(inGroup);
  const owing = inGroup.filter((invoice) => cents(invoice.balance) > 0).length;

  return (
    <div className="flex flex-col gap-4">
      {invoices.data ? (
        <FigureRow>
          <FigureCard label="Нийт үлдэгдэл" value={money(totals.balance)} tone="sun" />
          <FigureCard label="Өртэй хүүхэд" value={String(owing)} tone="peach" />
          <FigureCard label="Нэхэмжилсэн" value={money(totals.due)} tone="cornflower" />
          <FigureCard label="Төлсөн" value={money(totals.paid)} tone="mint" />
        </FigureRow>
      ) : null}

      <FilterBar>
        <MonthField value={month} onChange={onMonthChange} />
        <GroupField value={groupId} onChange={setGroupId} allLabel="Бүгд" />
        <SearchField
          label="Суралцагч хайх"
          placeholder="Суралцагч хайх…"
          value={search}
          onChange={setSearch}
        />
        <label className="flex min-h-[44px] items-center gap-2 text-body text-ink">
          <input
            type="checkbox"
            checked={owingOnly}
            onChange={(event) => setOwingOnly(event.target.checked)}
            className="size-4 accent-primary"
          />
          Зөвхөн өртэй
        </label>
      </FilterBar>

      {invoices.isLoading ? <LoadingState rows={4} /> : null}
      {invoices.isError ? <ErrorState description={errorMessage(invoices.error)} /> : null}

      {invoices.data ? (
        rows.length === 0 ? (
          <EmptyState
            title={all.length === 0 ? "Энэ сард нэхэмжлэл алга" : "Үлдэгдэлтэй хүүхэд алга"}
            description={
              all.length === 0
                ? "«Төлбөрийн нэхэмжлэл» tab-аас бүлгээр нь нэхэмжилнэ үү."
                : "Шүүлтүүрээ өөрчилж бусад хүүхдийг харна уу."
            }
          />
        ) : (
          <TableShell caption="Хүүхдийн төлбөрийн үлдэгдэл" minWidth="min-w-[760px]">
            <thead>
              <tr>
                <Th className="w-12">№</Th>
                <Th>Суралцагчийн нэр</Th>
                <Th>Бүлэг</Th>
                <Th numeric>Өмнөх үлдэгдэл</Th>
                <Th numeric>Нэхэмжилсэн</Th>
                <Th numeric>Төлсөн</Th>
                <Th numeric>Үлдэгдэл</Th>
                <Th>Төлөв</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((invoice, index) => (
                <tr key={invoice.id}>
                  <Td className="tabular-nums text-muted">{index + 1}</Td>
                  <Td className="font-medium text-ink">
                    <Link
                      href={`/children/${invoice.child.id}/finance`}
                      className="hover:underline"
                    >
                      {fullName(invoice.child)}
                    </Link>
                  </Td>
                  <Td>{invoice.child.group?.name ?? "—"}</Td>
                  <Td numeric>{money(cents(invoice.previousBalance))}</Td>
                  <Td numeric>{money(cents(invoice.totalDue))}</Td>
                  <Td numeric>{money(cents(invoice.paidAmount))}</Td>
                  <Td numeric className="font-semibold">
                    {money(cents(invoice.balance))}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[invoice.status]}>
                      {INVOICE_STATUS_LABEL[invoice.status]}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )
      ) : null}
    </div>
  );
}
