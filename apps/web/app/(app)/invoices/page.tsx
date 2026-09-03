"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { z } from "zod";
import {
  INVOICE_LINE_TYPE_LABEL,
  INVOICE_STATUS_LABEL,
  invoiceSummarySchema,
  paginated,
  type InvoiceLineType,
  type InvoiceStatus,
} from "@kinder/contracts";
import { childSummarySchema, MAX_PAGE_SIZE } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

const rosterSchema = paginated(childSummarySchema);
const listSchema = paginated(invoiceSummarySchema);

const LINE_TYPES: InvoiceLineType[] = ["TUITION", "MEAL", "CLUB", "BUS", "EXTRA", "OTHER"];

type Tone = "neutral" | "mint" | "sky" | "sun" | "peach" | "primary" | "danger";

const STATUS_TONE: Record<InvoiceStatus, Tone> = {
  UNPAID: "neutral",
  PARTIALLY_PAID: "peach",
  PAID: "mint",
  OVERDUE: "danger",
  REFUNDED: "sky",
};

/** `"126900.00"` → `"126 900₮"` — same formatting `/finance` uses, repeated rather than imported across route boundaries. */
function money(value: string | null): string {
  if (!value) return "0₮";
  const [whole = "0", cents] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return cents && cents !== "00" ? `${grouped}.${cents}₮` : `${grouped}₮`;
}

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Эцэг эхийн нэхэмжлэл — нэмэлт.md §7.
 *
 * ★ The accountant and the administrator, same as `/finance` — §13's role.
 */
export default function InvoicesPage() {
  return (
    <RequireRole roles={["ACCOUNTANT", "ADMIN"]}>
      <Invoices />
    </RequireRole>
  );
}

function Invoices() {
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const [month, setMonth] = useState(thisMonth());
  const [status, setStatus] = useState<InvoiceStatus | "">("");
  const [page, setPage] = useState(1);
  const [generateOpen, setGenerateOpen] = useState(false);

  const filters = { month, status: status || undefined, page };

  const invoices = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.invoices(kindergartenId ?? "", filters),
    queryFn: () => {
      const params = new URLSearchParams({ month, page: String(page), pageSize: "25" });
      if (status) params.set("status", status);
      return get(`/kindergartens/${kindergartenId}/invoices?${params}`, listSchema);
    },
    placeholderData: (previous) => previous,
  });

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Эцэг эхийн нэхэмжлэл"
        lede="Сар бүрийн төлбөр, төлөгдсөн эсэх. Ирц, хоолны бүртгэлтэй хамт улсын санхүүжилтээс тусдаа."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Сар">
              {({ id }) => (
                <Input
                  id={id}
                  type="month"
                  value={month}
                  onChange={(e) => {
                    setMonth(e.target.value);
                    setPage(1);
                  }}
                  className="w-[170px]"
                />
              )}
            </Field>
            <Field label="Төлөв">
              {({ id }) => (
                <Select
                  id={id}
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as InvoiceStatus | "");
                    setPage(1);
                  }}
                  className="w-[170px]"
                >
                  <option value="">Бүгд</option>
                  {Object.entries(INVOICE_STATUS_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button size="sm" onClick={() => setGenerateOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              Нэхэмжлэл үүсгэх
            </Button>
          </div>
        }
      />

      {invoices.isLoading ? <LoadingState rows={5} /> : null}
      {invoices.isError ? <ErrorState description={errorMessage(invoices.error)} /> : null}

      {invoices.data && invoices.data.items.length === 0 ? (
        <EmptyState
          title="Нэхэмжлэл алга"
          description="Энэ сар, төлөвт тохирох нэхэмжлэл байхгүй байна. Дээрх товчоор шинээр үүсгэнэ үү."
        />
      ) : null}

      {invoices.data && invoices.data.items.length > 0 ? (
        <>
          <ResultCount total={invoices.data.total} noun="нэхэмжлэл" />
          <Card className="divide-y divide-border-soft">
            {invoices.data.items.map((invoice) => (
              <Link
                key={invoice.id}
                href={`/invoices/${invoice.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-canvas"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-body font-medium text-ink">
                      {invoice.child.lastName ? `${invoice.child.lastName} ` : ""}
                      {invoice.child.firstName}
                    </span>
                    <Badge tone={STATUS_TONE[invoice.status]}>
                      {INVOICE_STATUS_LABEL[invoice.status]}
                    </Badge>
                  </p>
                  <p className="text-caption text-muted">
                    Төлөх хугацаа: {formatDate(invoice.dueDate)}
                  </p>
                </div>
                <div className="flex shrink-0 items-baseline gap-4 tabular-nums">
                  <span className="text-caption text-muted">Нийт {money(invoice.totalDue)}</span>
                  <span className="text-body font-semibold text-ink">
                    Үлдэгдэл {money(invoice.balance)}
                  </span>
                </div>
              </Link>
            ))}
          </Card>
          <Pagination
            page={invoices.data.page}
            totalPages={invoices.data.totalPages}
            onPage={setPage}
          />
        </>
      ) : null}

      {kindergartenId ? (
        <GenerateInvoiceDialog
          kindergartenId={kindergartenId}
          open={generateOpen}
          onOpenChange={setGenerateOpen}
        />
      ) : null}
    </div>
  );
}

/**
 * A row per line type rather than a dynamic add/remove list.
 *
 * ★ нэмэлт.md §7 names exactly six charge types, and a fixed row per type is
 * both simpler to build and closer to how the work is actually done — an
 * accountant fills in whichever apply this month and leaves the rest blank,
 * rather than assembling a list from scratch every time.
 */
function GenerateInvoiceDialog({
  kindergartenId,
  open,
  onOpenChange,
}: {
  kindergartenId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [childId, setChildId] = useState("");
  const [month, setMonth] = useState(thisMonth());
  const [dueDate, setDueDate] = useState("");
  const [amounts, setAmounts] = useState<Record<InvoiceLineType, string>>({
    TUITION: "",
    MEAL: "",
    CLUB: "",
    BUS: "",
    EXTRA: "",
    OTHER: "",
  });
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");

  const roster = useQuery({
    enabled: open,
    queryKey: ["invoices", "roster", kindergartenId],
    queryFn: () => get(`/children?pageSize=${MAX_PAGE_SIZE}`, rosterSchema),
  });

  const generate = useMutation({
    mutationFn: () => {
      const lineItems = LINE_TYPES.filter((type) => Number(amounts[type]) > 0).map((type) => ({
        type,
        amount: amounts[type],
      }));

      return mutate(`/kindergartens/${kindergartenId}/invoices`, z.unknown(), {
        method: "POST",
        body: {
          childId,
          month,
          dueDate,
          lineItems,
          discountAmount: discount || undefined,
          note: note || undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success("Нэхэмжлэл үүслээ.");
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["invoices", kindergartenId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Нэхэмжлэл үүсгэх"
      description="Тухайн сард ногдуулах дүнг төрөл тус бүрээр оруулна. Хоосон орхисон төрөл нэхэмжлэлд орохгүй."
      busy={generate.isPending}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={generate.isPending}
          >
            Цуцлах
          </Button>
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || !childId || !dueDate}
          >
            {generate.isPending ? "Үүсгэж байна…" : "Үүсгэх"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!generate.isPending) generate.mutate();
        }}
        className="flex flex-col gap-3"
      >
        <FormError message={generate.isError ? errorMessage(generate.error) : null} />

        <Field label="Хүүхэд">
          {({ id }) => (
            <Select id={id} value={childId} onChange={(e) => setChildId(e.target.value)} required>
              <option value="">Сонгоно уу</option>
              {(roster.data?.items ?? []).map((child) => (
                <option key={child.id} value={child.id}>
                  {child.lastName ? `${child.lastName} ` : ""}
                  {child.firstName}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Сар">
            {({ id }) => (
              <Input
                id={id}
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            )}
          </Field>
          <Field label="Төлөх хугацаа">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {LINE_TYPES.map((type) => (
            <Field key={type} label={INVOICE_LINE_TYPE_LABEL[type]}>
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder="0"
                  value={amounts[type]}
                  onChange={(e) => setAmounts((prev) => ({ ...prev, [type]: e.target.value }))}
                />
              )}
            </Field>
          ))}
        </div>

        <Field label="Хөнгөлөлт">
          {({ id }) => (
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              min={0}
              placeholder="0"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          )}
        </Field>

        <Field label="Тэмдэглэл">
          {({ id }) => (
            <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          )}
        </Field>
      </form>
    </FormDialog>
  );
}
