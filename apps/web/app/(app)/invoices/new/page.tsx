"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { z } from "zod";
import {
  INVOICE_LINE_TYPE_LABEL,
  MAX_PAGE_SIZE,
  childSummarySchema,
  groupListItemSchema,
  paginated,
  type InvoiceLineType,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { fullName } from "@/lib/format";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { YearMonthSelect } from "@/components/ui/year-month-select";
import { FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const rosterSchema = paginated(childSummarySchema);
const groupsSchema = paginated(groupListItemSchema);

const LINE_TYPES: InvoiceLineType[] = ["TUITION", "MEAL", "CLUB", "BUS", "EXTRA", "OTHER"];

/** A row being typed. `quantity` and `unitAmount` are the accountant's arithmetic. */
interface DraftLine {
  key: string;
  type: InvoiceLineType;
  description: string;
  quantity: string;
  unitAmount: string;
}

function emptyLine(type: InvoiceLineType = "TUITION"): DraftLine {
  return { key: crypto.randomUUID(), type, description: "", quantity: "1", unitAmount: "" };
}

/**
 * A cell of the lines table — client, 2026-10-06 ("дахиад л илүү цэвэрхэн"):
 * no box and no grey fill at rest, so the lines read as a printed table; the
 * border comes back under the pointer and while typing, so it is still
 * plainly a field.
 */
const CELL_INPUT =
  "h-9 border-transparent bg-transparent px-1.5 hover:border-border focus:border-primary focus:bg-surface";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** `"126900.00"` → `"126 900₮"` — the same shape `/invoices` prints. */
function money(value: number): string {
  const whole = Math.round(value).toString();
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}₮`;
}

/**
 * Нэхэмжлэх шинээр үүсгэх — the client's 2026-09-17 design.
 *
 * ★ A page, where this was a dialog.
 *
 * The dialog asked for six amounts in a fixed grid and showed nothing back. An
 * invoice is a document somebody is about to send to a family, and the thing
 * that makes it checkable before it is sent is seeing it. Since 2026-10-06 the
 * form *is* that document — e-Tax's shape, lines and totals on one card — and
 * the separate preview column of the 2026-09-17 drawing is gone.
 *
 * ★★ What the drawing has and this deliberately does not, each because the
 * data behind it does not exist yet rather than because it was missed:
 *
 *  - **The number, before saving.** `нэмэлт.md` §7 numbers an invoice on
 *    creation (`nextInvoiceNumber`), from the last one issued — reserving one
 *    for a form somebody may abandon would burn a number out of a sequence the
 *    schema says is never reused. The field says so instead.
 *  - **Ноорог болгон хадгалах.** There is no DRAFT state: `InvoiceStatus` is
 *    UNPAID · PARTIALLY_PAID · PAID · OVERDUE · REFUNDED, and a draft invoice
 *    is a different record with different rules about numbering and totals.
 *  - **Хавсралт.** Invoices have no media relation.
 *  - **И-мэйл / SMS илгээх.** Neither transport exists; SMS is Phase IV
 *    (CLAUDE.md §7). What *does* happen on save is an in-app notice to the
 *    child's guardians, which is not offered as a choice because nothing
 *    would honour turning it off.
 *  - **Банкны данс, НӨАТ.** No kindergarten bank fields, and no VAT anywhere
 *    in the finance module.
 */
export default function NewInvoicePage() {
  return (
    <RequireRole roles={["ACCOUNTANT", "ADMIN"]}>
      <NewInvoice />
    </RequireRole>
  );
}

function NewInvoice() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  /*
    ★ No `useSelectedChild()` here, and that is the bug this line replaces.

    It seeded the picker from the shell's currently-selected child, which
    threw: an accountant's layout returns **before** `SelectedChildProvider`
    ("a cook and an accountant have no selected child to provide"), so the hook
    found no context and raised — taking the whole screen down for the one
    role this page exists for. The picker starts empty instead.
  */
  const [groupId, setGroupId] = useState("");
  const [childId, setChildId] = useState("");
  const [month, setMonth] = useState(thisMonth());
  const [dueDate, setDueDate] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);

  /*
    ★ The group comes first, and the roster is asked for narrowed — 2026-09-17,
    at the client's request that a class be chosen before the child.

    Narrowed by the API (`groupId` on the finance roster), not filtered here: a
    kindergarten of fifty children is one request either way, but the filter
    that matters is the one the server applied — a client-side narrowing of a
    paged roster silently drops whoever is on page two.
  */
  const groups = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    staleTime: 5 * 60_000,
  });

  const roster = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: ["invoices", "roster", kindergartenId, groupId],
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/children/finance-roster?pageSize=${MAX_PAGE_SIZE}` +
          (groupId ? `&groupId=${groupId}` : ""),
        rosterSchema,
      ),
  });

  /*
    ★ The line's own arithmetic happens here and only the product is sent.

    `InvoiceLineItem` stores a type, a description and an amount — quantity and
    unit price were lost when §7 was built twice and the live branch won
    (docs/FINANCE_MODULE.md §1). Typing them is how an accountant works, so the
    form keeps them; what is stored is what the schema has, and the description
    carries the working ("2 × 60 000") so the figure can still be explained.
  */
  const priced = lines.map((line) => {
    const amount = Number(line.quantity || 0) * Number(line.unitAmount || 0);
    return { ...line, amount: Number.isFinite(amount) ? amount : 0 };
  });

  const subtotal = priced.reduce((sum, line) => sum + line.amount, 0);
  const discountValue = Number(discount || 0);
  const total = Math.max(0, subtotal - (Number.isFinite(discountValue) ? discountValue : 0));

  const create = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/invoices`, z.object({ id: z.string() }), {
        method: "POST",
        body: {
          childId,
          month,
          dueDate,
          lineItems: priced
            .filter((line) => line.amount > 0)
            .map((line) => ({
              type: line.type,
              description:
                line.description.trim() ||
                (Number(line.quantity) > 1
                  ? `${line.quantity} × ${money(Number(line.unitAmount))}`
                  : undefined),
              amount: line.amount.toFixed(2),
            })),
          discountAmount: discount || undefined,
          note: note.trim() || undefined,
        },
      }),
    onSuccess: (invoice) => {
      toast.success("Нэхэмжлэл үүслээ.");
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["invoice-summary"] });
      router.push(`/invoices/${invoice.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(create.error);
  const busy = create.isPending;
  const ready = Boolean(childId && dueDate && priced.some((line) => line.amount > 0));

  const monthLabel = useMemo(() => {
    const [year, index] = month.split("-");
    return `${year} оны ${Number(index)}-р сар`;
  }, [month]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (ready && !busy) create.mutate();
  }

  if (!kindergartenId) return <LoadingState rows={4} />;

  /** One line's field, written once for the three inputs a line has. */
  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <div className="flex flex-col gap-3">
      <PageHeader backHref="/invoices" title="Шинэ нэхэмжлэх" />

      {/*
        ★ One document, the way e-Tax / e-barimt writes an invoice — client,
        2026-10-06 ("минимал … олон нуршсан зүйлгүй … etax mta дээр
        нэхэмжлэл үүсгэдэг шиг"). Who pays and when, the lines as a table with
        each line's amount beside it, the totals under the table, and the
        two buttons at the foot.

        What went, and why it is not missed: the lede; the "1. 2. 3." section
        cards; «Нэхэмжлэхийн дугаар» and «Огноо», both fixed fields nobody
        could type in (the number is issued on save, the date is today); the
        0/2000 counter; and «Урьдчилан харах», which restated every field —
        the totals block under the lines is the part of it that was read.
        The note opens on «+ Тайлбар нэмэх».
      */}
      <form onSubmit={onSubmit}>
        <Card pad="roomy" className="flex flex-col gap-4">
          <FormError message={create.isError ? errorMessage(create.error) : null} />

          {/*
            ★ Бүлэг, then Суралцагч — the client's order, 2026-09-17: the class
            narrows fifty names to a dozen. Changing the group clears the
            child, who may not be in the new class.
          */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Бүлэг">
              {({ id }) => (
                <Select
                  id={id}
                  value={groupId}
                  onChange={(event) => {
                    setGroupId(event.target.value);
                    setChildId("");
                  }}
                  disabled={busy || groups.isPending}
                >
                  <option value="">Бүх бүлэг</option>
                  {(groups.data?.items ?? []).map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Суралцагч" error={errors.childId} required>
              {({ id }) => (
                <Select
                  id={id}
                  value={childId}
                  onChange={(event) => setChildId(event.target.value)}
                  disabled={busy || roster.isPending}
                >
                  <option value="">Суралцагч сонгоно уу</option>
                  {(roster.data?.items ?? []).map((row) => (
                    <option key={row.id} value={row.id}>
                      {fullName(row)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Сар">
              {() => <YearMonthSelect value={month} onValueChange={setMonth} />}
            </Field>

            <Field label="Төлбөрийн хугацаа" error={errors.dueDate} required>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  type="date"
                  value={dueDate}
                  invalid={invalid}
                  min={today()}
                  onChange={(event) => setDueDate(event.target.value)}
                  disabled={busy}
                />
              )}
            </Field>
          </div>

          <section aria-label="Төлбөрийн мөрүүд" className="flex flex-col gap-1.5">
            <div
              aria-hidden="true"
              className="hidden grid-cols-[minmax(0,1fr)_72px_120px_110px_36px] gap-2 border-b border-border-soft pb-1.5 text-caption text-muted sm:grid"
            >
              <span>Төрөл</span>
              <span className="text-end">Тоо</span>
              <span className="text-end">Нэгж үнэ</span>
              <span className="text-end">Дүн</span>
              <span />
            </div>

            {priced.map((line) => (
              <div
                key={line.key}
                className="group grid grid-cols-[72px_minmax(0,1fr)_auto_36px] items-center gap-2 border-b border-border-soft py-0.5 sm:grid-cols-[minmax(0,1fr)_72px_120px_110px_36px]"
              >
                <div className="col-span-4 sm:col-span-1">
                  <Select
                    aria-label="Төлбөрийн төрөл"
                    value={line.type}
                    disabled={busy}
                    onChange={(event) =>
                      setLine(line.key, { type: event.target.value as InvoiceLineType })
                    }
                    className={CELL_INPUT}
                  >
                    {LINE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {INVOICE_LINE_TYPE_LABEL[type]}
                      </option>
                    ))}
                  </Select>
                </div>
                <Input
                  aria-label="Тоо хэмжээ"
                  inputMode="numeric"
                  value={line.quantity}
                  disabled={busy}
                  onChange={(event) => setLine(line.key, { quantity: event.target.value })}
                  className={cn(CELL_INPUT, "text-end tabular-nums")}
                />
                <Input
                  aria-label="Нэгж үнэ"
                  inputMode="numeric"
                  placeholder="0"
                  value={line.unitAmount}
                  disabled={busy}
                  onChange={(event) => setLine(line.key, { unitAmount: event.target.value })}
                  className={cn(CELL_INPUT, "text-end tabular-nums")}
                />
                <span className="text-end text-body font-semibold tabular-nums text-ink">
                  {money(line.amount)}
                </span>
                {/*
                  Shown on a phone, where there is no hover; from `sm` it
                  appears with the row under the pointer or the keyboard.
                */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Мөр хасах"
                  disabled={busy || priced.length === 1}
                  onClick={() =>
                    setLines((current) => current.filter((row) => row.key !== line.key))
                  }
                  className="text-faint hover:text-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 disabled:sm:opacity-0"
                >
                  <X size={16} aria-hidden="true" />
                </Button>
              </div>
            ))}

            <button
              type="button"
              disabled={busy}
              onClick={() => setLines((current) => [...current, emptyLine("MEAL")])}
              className="inline-flex min-h-[40px] items-center gap-1.5 self-start text-body font-medium text-primary hover:text-primary-strong disabled:opacity-50"
            >
              <Plus size={16} aria-hidden="true" />
              Мөр нэмэх
            </button>
          </section>

          {/*
            The totals, as the invoice prints them — lines, less the discount,
            the same way `invoice-math.ts` totals it on the server.
          */}
          <dl className="ml-auto flex w-full max-w-[320px] flex-col gap-1.5 text-body">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Дүн</dt>
              <dd className="tabular-nums text-ink">{money(subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt>
                <label htmlFor="invoice-discount" className="text-muted">
                  Хөнгөлөлт
                </label>
              </dt>
              <dd>
                <Input
                  id="invoice-discount"
                  inputMode="numeric"
                  placeholder="0"
                  value={discount}
                  disabled={busy}
                  onChange={(event) => setDiscount(event.target.value)}
                  className={cn(CELL_INPUT, "w-[120px] text-end tabular-nums")}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5">
              <dt className="font-semibold text-ink">Нийт</dt>
              <dd className="text-lead font-bold tabular-nums text-ink">{money(total)}</dd>
            </div>
          </dl>

          {noteOpen ? (
            <Field label="Тайлбар" error={errors.note}>
              {({ id }) => (
                <Textarea
                  id={id}
                  value={note}
                  maxLength={2000}
                  disabled={busy}
                  placeholder={`${monthLabel}ын сургалт, хоолны төлбөр.`}
                  className="min-h-[72px]"
                  onChange={(event) => setNote(event.target.value)}
                  autoFocus
                />
              )}
            </Field>
          ) : (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="inline-flex min-h-[40px] items-center gap-1.5 self-start text-body text-muted hover:text-ink"
            >
              <Plus size={16} aria-hidden="true" />
              Тайлбар нэмэх
            </button>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border-soft pt-3">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => router.push("/invoices")}
            >
              Болих
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {busy ? "Үүсгэж байна…" : "Нэхэмжлэх үүсгэх"}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
