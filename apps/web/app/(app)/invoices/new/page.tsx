"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import {
  INVOICE_LINE_TYPE_LABEL,
  MAX_PAGE_SIZE,
  childSummarySchema,
  groupListItemSchema,
  paginated,
  type InvoiceLineType,
  localDate,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { formatDate, fullName } from "@/lib/format";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { MonthSelect } from "@/components/ui/month-select";
import { ChildAvatar } from "@/components/media/media-image";
import { FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

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

function today(): string {
  return localDate();
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
 * that makes it checkable before it is sent is seeing it: the form on the left
 * and the invoice it is building on the right, which is the client's own
 * drawing.
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
 *    child's guardians, which the panel below states plainly rather than
 *    offering as a choice nothing would honour.
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

  const child = (roster.data?.items ?? []).find((row) => row.id === childId);

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

  return (
    <div className="page-band">
      <PageHeader
        backHref="/invoices"
        title="Нэхэмжлэх шинээр үүсгэх"
        lede="Эцэг эхэд илгээх төлбөрийн нэхэмжлэхийг энд үүсгэнэ."
      />

      <form onSubmit={onSubmit} className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card pad="roomy" className="flex flex-col gap-3">
            <SectionHeader title="1. Ерөнхий мэдээлэл" as="h2" />

            <FormError message={create.isError ? errorMessage(create.error) : null} />

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Нэхэмжлэхийн дугаар">
                {({ id }) => (
                  <Input
                    id={id}
                    value="Хадгалахад автоматаар"
                    readOnly
                    disabled
                    className="text-muted"
                  />
                )}
              </Field>

              <Field label="Огноо">
                {({ id }) => <Input id={id} value={formatDate(today())} readOnly disabled />}
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

            {/*
              ★ Бүлэг, then Суралцагч — the client's order, 2026-09-17. On a
              roster of fifty the class is what a person knows first, and
              choosing it turns a fifty-name list into a dozen.

              Changing the group clears the child: the one selected may not be
              in the new class, and an invoice raised against a name nobody
              checked is the mistake this ordering exists to prevent.
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
            </div>

            {child ? (
              <div className="flex items-center gap-3 rounded-card border border-border-soft bg-canvas px-3.5 py-3">
                <ChildAvatar child={child} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold text-ink">
                    {fullName(child)}
                  </span>
                  <span className="block truncate text-caption text-muted">
                    {child.enrollments?.find((row) => row.group)?.group?.name ?? "Бүлэггүй"}
                  </span>
                </span>
              </div>
            ) : null}
          </Card>

          <Card pad="roomy" className="flex flex-col gap-3">
            <SectionHeader title="2. Төлбөрийн мэдээлэл" as="h2" />

            <Field label="Сар" className="sm:max-w-[220px]">
              {({ id }) => (
                <MonthSelect id={id} value={month} onValueChange={setMonth} disabled={busy} />
              )}
            </Field>

            <div className="flex flex-col gap-2">
              {priced.map((line, index) => (
                <div
                  key={line.key}
                  className="grid items-end gap-2 rounded-card border border-border-soft p-2.5 sm:grid-cols-[minmax(0,1.4fr)_70px_minmax(0,1fr)_auto]"
                >
                  <Field label={index === 0 ? "Төрөл" : ""}>
                    {({ id }) => (
                      <Select
                        id={id}
                        aria-label="Төлбөрийн төрөл"
                        value={line.type}
                        disabled={busy}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((row) =>
                              row.key === line.key
                                ? { ...row, type: event.target.value as InvoiceLineType }
                                : row,
                            ),
                          )
                        }
                      >
                        {LINE_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {INVOICE_LINE_TYPE_LABEL[type]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field label={index === 0 ? "Тоо" : ""}>
                    {({ id }) => (
                      <Input
                        id={id}
                        aria-label="Тоо хэмжээ"
                        inputMode="numeric"
                        value={line.quantity}
                        disabled={busy}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((row) =>
                              row.key === line.key ? { ...row, quantity: event.target.value } : row,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>

                  <Field label={index === 0 ? "Нэгж үнэ (₮)" : ""}>
                    {({ id }) => (
                      <Input
                        id={id}
                        aria-label="Нэгж үнэ"
                        inputMode="numeric"
                        value={line.unitAmount}
                        disabled={busy}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((row) =>
                              row.key === line.key
                                ? { ...row, unitAmount: event.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>

                  <div className="flex items-center gap-2 pb-0.5">
                    <span className="min-w-[90px] text-end text-body font-semibold tabular-nums text-ink">
                      {money(line.amount)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Мөр хасах"
                      disabled={busy || priced.length === 1}
                      onClick={() =>
                        setLines((current) => current.filter((row) => row.key !== line.key))
                      }
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}

              <Button
                type="button"
                variant="secondary"
                className="self-start"
                disabled={busy}
                onClick={() => setLines((current) => [...current, emptyLine("MEAL")])}
              >
                <Plus size={16} aria-hidden="true" />
                Мөр нэмэх
              </Button>
            </div>

            <Field label="Хөнгөлөлт (₮)" className="sm:max-w-[220px]">
              {({ id }) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={discount}
                  disabled={busy}
                  onChange={(event) => setDiscount(event.target.value)}
                />
              )}
            </Field>
          </Card>

          <Card pad="roomy" className="flex flex-col gap-3">
            <SectionHeader title="3. Нэмэлт мэдээлэл" as="h2" />

            <Field label="Тайлбар" error={errors.note}>
              {({ id }) => (
                <Textarea
                  id={id}
                  value={note}
                  maxLength={2000}
                  disabled={busy}
                  placeholder="2026 оны 9-р сарын сургалт, хоолны төлбөр."
                  className="min-h-[80px]"
                  onChange={(event) => setNote(event.target.value)}
                />
              )}
            </Field>
            <p className="text-end text-caption tabular-nums text-muted">{note.length}/2000</p>
          </Card>
        </div>

        {/*
          ★ The invoice as it will be — the drawing's right-hand column.

          Built from the same state the form holds, so it cannot disagree with
          what is about to be sent, and totalled the same way `invoice-math.ts`
          totals it on the server: lines, less the discount.
        */}
        <div className="flex flex-col gap-4">
          <Card pad="roomy" className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <SectionHeader title="Урьдчилан харах" as="h2" />
              <span className="shrink-0 text-caption font-semibold text-muted">НЭХЭМЖЛЭХ</span>
            </div>

            <dl className="flex flex-col gap-1 text-caption">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Огноо</dt>
                <dd className="tabular-nums text-ink">{formatDate(today())}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Төлөх хугацаа</dt>
                <dd className="tabular-nums text-ink">{dueDate ? formatDate(dueDate) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Суралцагч</dt>
                <dd className="truncate text-ink">{child ? fullName(child) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Сар</dt>
                <dd className="text-ink">{monthLabel}</dd>
              </div>
            </dl>

            <ul className="flex flex-col gap-1 border-t border-border-soft pt-2.5">
              {priced.map((line) => (
                <li
                  key={line.key}
                  className="flex items-baseline justify-between gap-3 text-caption"
                >
                  <span className="min-w-0 truncate text-ink">
                    {INVOICE_LINE_TYPE_LABEL[line.type]}
                    {Number(line.quantity) > 1 ? (
                      <span className="text-muted"> · {line.quantity} ш</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink">{money(line.amount)}</span>
                </li>
              ))}
            </ul>

            <dl className="flex flex-col gap-1 border-t border-border-soft pt-2.5 text-caption">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Дүн</dt>
                <dd className="tabular-nums text-ink">{money(subtotal)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Хөнгөлөлт</dt>
                <dd className="tabular-nums text-ink">
                  {money(Number.isFinite(discountValue) ? discountValue : 0)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-border-soft pt-1.5">
                <dt className="font-semibold text-ink">Нийт дүн</dt>
                <dd className="text-lead font-bold tabular-nums text-primary">{money(total)}</dd>
              </div>
            </dl>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!ready || busy}>
              {busy ? "Үүсгэж байна…" : "Нэхэмжлэх үүсгэх"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => router.push("/invoices")}
            >
              Цуцлах
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
