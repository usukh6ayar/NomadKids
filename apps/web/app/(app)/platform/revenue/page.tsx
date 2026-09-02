"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import {
  platformRevenueSchema,
  revenueDistributionSchema,
  revenuePartnerSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

const partnersSchema = z.array(revenuePartnerSchema);

/** `2026-08`, today's month — what the screen opens on. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * `"1400000"` → `"1 400 000₮"`.
 *
 * ★ The string is formatted, never parsed into a number first.
 *
 * Every amount on this screen is a decimal string precisely because a JSON
 * number is a double — `funding.dto.ts` explains at length why a figure a bank
 * statement is reconciled against must not round-trip through one. Splitting on
 * the decimal point and grouping the integer part keeps that guarantee all the
 * way to the pixel.
 */
function money(value: string): string {
  const [whole = "0", cents] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  // Whole tögrög only when the fraction is zero: "1 400 000₮" reads as money,
  // "1 400 000.00₮" reads as a spreadsheet.
  return cents && cents !== "00" ? `${grouped}.${cents}₮` : `${grouped}₮`;
}

/**
 * Санхүү — what came in, and how it is divided.
 *
 * ★ The platform operator's screen, and nobody else's.
 *
 * `/kindergartens/:id/funding` is the kindergarten administrator's: their
 * children, their tariffs, their per-child rows. This is the question above
 * it — what arrived across every kindergarten, and what each partner's agreed
 * share of it comes to.
 *
 * ★★ It shows totals and never a child.
 *
 * `platform-access.service.ts` records that a superadmin registers
 * kindergartens and does not read children, and a funding row carries a child's
 * id, their attendance and what they were billed. The endpoint behind this
 * screen aggregates before it answers — see `platform-revenue.repository.ts`,
 * where the boundary is the shape of the query rather than a caller remembering
 * to strip a field.
 */
export default function PlatformRevenuePage() {
  return (
    <RequireSuperAdmin>
      <PlatformRevenue />
    </RequireSuperAdmin>
  );
}

function PlatformRevenue() {
  const [month, setMonth] = useState(thisMonth());

  const revenue = useQuery({
    queryKey: qk.platformRevenue(month),
    queryFn: () => get(`/platform/revenue?month=${month}`, platformRevenueSchema),
  });

  const distribution = useQuery({
    queryKey: qk.platformDistribution(month),
    queryFn: () => get(`/platform/revenue/distribution?month=${month}`, revenueDistributionSchema),
  });

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Санхүү"
        lede="Цэцэрлэгүүдээс орсон орлого, хуваарилалт."
        actions={
          <Field label="Сар">
            {({ id }) => (
              <Input
                id={id}
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="w-[170px]"
              />
            )}
          </Field>
        }
      />

      {revenue.isLoading ? <LoadingState rows={3} /> : null}
      {revenue.isError ? <ErrorState description={errorMessage(revenue.error)} /> : null}

      {revenue.data ? (
        <>
          {/*
            ★★★ The platform's own income, first and alone — corrected
            2026-09-02.

            This screen used to open on three figures from `FundingCalculation`
            with "Орж ирсэн" marked as the real money. Every one of them is
            **state funding paid to the kindergartens**. The platform does not
            receive it and has no share in it, yet the payout list below divided
            exactly that number among the revenue partners.

            The operator's own income — paid portal access fees — was on no
            screen at all. It leads now, because it is the only figure on this
            page a partner's percentage is taken from.
          */}
          <Card pad="roomy" tone="mint" className="flex flex-col gap-1">
            <p className="text-caption font-medium text-mint-ink">
              Платформын орлого — хандалтын төлбөр
            </p>
            <p className="text-display font-semibold tabular-nums text-ink">
              {money(revenue.data.platform.accessFees)}
            </p>
            <p className="text-caption text-muted">
              {revenue.data.platform.accessPayments} төлөлт · хуваарилалт үүнээс бодогдоно
            </p>
          </Card>

          {/*
            Kept, under an honest heading. An operator does want to know which
            kindergartens are running and how much the state moved through
            them — they must simply never read it as their own income again.
          */}
          <section aria-labelledby="state-heading">
            <SectionHeader
              id="state-heading"
              title="Улсаас цэцэрлэгүүдэд"
              lede="Цэцэрлэгүүдийн мөнгө — платформын орлого биш. Ажиллагааны хэмжүүр."
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Total label="Тооцсон" value={revenue.data.state.calculated} />
              <Total label="Баталгаажсан" value={revenue.data.state.approved} />
              <Total label="Орж ирсэн" value={revenue.data.state.received} />
            </div>
          </section>

          <IncomeByKindergarten rows={revenue.data.kindergartens} />
        </>
      ) : null}

      {distribution.data ? <Distribution data={distribution.data} /> : null}

      <Partners month={month} />
    </div>
  );
}

/** One headline figure. `accent` marks the one that is real money. */
function Total({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <Card pad="roomy">
      <p className="text-caption text-muted">{label}</p>
      <p
        className={`mt-1 text-display font-semibold tabular-nums ${accent ? "text-primary" : "text-ink"}`}
      >
        {money(value)}
      </p>
    </Card>
  );
}

function IncomeByKindergarten({
  rows,
}: {
  rows: z.infer<typeof platformRevenueSchema>["kindergartens"];
}) {
  return (
    <section aria-labelledby="income-heading">
      <SectionHeader id="income-heading" title="Цэцэрлэг тус бүрээр" />

      {rows.length === 0 ? (
        <Card pad="roomy">
          <p className="text-body text-muted">
            Энэ сард хандалтын төлбөр төлөгдөөгүй, сарын тооцоо ч хийгдээгүй байна.
          </p>
        </Card>
      ) : (
        <Card className="divide-y divide-border-soft">
          {rows.map((row) => (
            <div
              key={row.kindergartenId}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-ink">{row.name}</p>
                {/*
                  A count of rows, never who they are about — see the note on
                  the page component. "12 бүртгэл" says how much work the figure
                  rests on without naming a single child.
                */}
                <p className="text-caption text-muted">
                  {row.accessPayments} төлөлт · {row.entries} санхүүжилтийн бүртгэл
                </p>
              </div>
              {/*
                ★ Two columns, and the emphasised one is the platform's.
                `received` is the kindergarten's state transfer and stays as
                context in muted type; `accessFees` is what this kindergarten
                actually paid us, which is the column a partner checks.
              */}
              <div className="flex shrink-0 items-baseline gap-4 tabular-nums">
                <span className="text-caption text-muted" title="Улсаас цэцэрлэгт">
                  {money(row.received)}
                </span>
                <span
                  className="text-body font-semibold text-primary"
                  title="Хандалтын төлбөр — платформын орлого"
                >
                  {money(row.accessFees)}
                </span>
              </div>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

/**
 * The split.
 *
 * ★ Computed from **received**, and the screen says so out loud.
 *
 * A share of money that has not arrived is a promise. The label under the
 * heading is not decoration: an operator reading a payout list needs to know
 * which of the three figures above it was divided.
 */
function Distribution({ data }: { data: z.infer<typeof revenueDistributionSchema> }) {
  const short = Number(data.allocatedPercent) < 100;

  return (
    <section aria-labelledby="distribution-heading">
      <SectionHeader
        id="distribution-heading"
        title="Хуваарилалт"
        lede="Хандалтын төлбөрийн орлогоос, тохирсон хувиар."
      />

      <Card pad="roomy" className="flex flex-col gap-3">
        {data.shares.length === 0 ? (
          <p className="text-body text-muted">
            Хувь тохирсон хүн бүртгэгдээгүй байна. Доороос нэмнэ үү.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.shares.map((share) => (
              <li
                key={share.partnerId}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border-soft pb-2 last:border-0 last:pb-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-body font-medium text-ink">{share.name}</span>
                  <Badge tone="sky">{share.sharePercent}%</Badge>
                </span>
                <span className="shrink-0 text-lead font-semibold tabular-nums text-ink">
                  {money(share.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/*
          ★ The remainder is shown, never absorbed.

          A split that quietly loses 30% of a month is the failure this section
          exists to prevent — the operator should see what is unallocated and
          decide, rather than find it missing from a bank reconciliation later.
          `peach` is the palette's "attention" tone, not "danger": money that is
          not yet promised to anyone is a decision, not a fault.
        */}
        {short ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-row bg-peach/40 px-3 py-2.5">
            <span className="text-body text-peach-ink">
              Хуваарилаагүй үлдэгдэл — нийт {data.allocatedPercent}% тохирсон
            </span>
            <span className="text-lead font-semibold tabular-nums text-peach-ink">
              {money(data.unallocated)}
            </span>
          </div>
        ) : null}
      </Card>
    </section>
  );
}

/** The agreed shares, and the form that adds one. */
function Partners({ month }: { month: string }) {
  const [adding, setAdding] = useState(false);

  const partners = useQuery({
    queryKey: qk.platformPartners(),
    queryFn: () => get("/platform/partners", partnersSchema),
  });

  const active = (partners.data ?? []).filter((p) => !p.effectiveTo);
  const allocated = active.reduce((sum, p) => sum + Number(p.sharePercent), 0);

  return (
    <section aria-labelledby="partners-heading">
      <SectionHeader
        id="partners-heading"
        title="Хувь тохирсон хүмүүс"
        lede={`Одоогийн хуваарилалт ${allocated}%`}
        action={
          <Button size="sm" onClick={() => setAdding(true)} disabled={allocated >= 100}>
            <Plus size={16} aria-hidden="true" />
            Хүн нэмэх
          </Button>
        }
      />

      {partners.isLoading ? <LoadingState rows={2} /> : null}

      {partners.data && partners.data.length === 0 ? (
        <EmptyState
          title="Хувь тохирсон хүн алга"
          description="Орлогыг хэн, ямар хувиар авахыг энд бүртгэнэ."
          action={<Button onClick={() => setAdding(true)}>Хүн нэмэх</Button>}
        />
      ) : null}

      {partners.data && partners.data.length > 0 ? (
        <Card className="divide-y divide-border-soft">
          {partners.data.map((partner) => (
            <PartnerRow key={partner.id} partner={partner} month={month} />
          ))}
        </Card>
      ) : null}

      {adding ? (
        <AddPartnerDialog month={month} allocated={allocated} onClose={() => setAdding(false)} />
      ) : null}
    </section>
  );
}

function PartnerRow({
  partner,
  month,
}: {
  partner: z.infer<typeof revenuePartnerSchema>;
  month: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const closed = Boolean(partner.effectiveTo);

  const remove = useMutation({
    mutationFn: () => mutate(`/platform/partners/${partner.id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Бүртгэлээс хаслаа.");
      void queryClient.invalidateQueries({ queryKey: qk.platformPartners() });
      void queryClient.invalidateQueries({ queryKey: qk.platformDistribution(month) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="truncate text-body font-medium text-ink">{partner.name}</span>
          <Badge tone={closed ? "neutral" : "sky"}>{partner.sharePercent}%</Badge>
          {closed ? <Badge tone="neutral">Дууссан</Badge> : null}
        </p>
        <p className="text-caption text-muted">
          {formatDate(partner.effectiveFrom)}
          {partner.effectiveTo ? ` — ${formatDate(partner.effectiveTo)}` : " — одоог хүртэл"}
          {partner.note ? ` · ${partner.note}` : ""}
        </p>
      </div>

      {/*
        `ConfirmDialog` owns its own open state and takes the control that opens
        it — so the button that used to do the work becomes the trigger, and
        this row keeps no `confirming` flag of its own. CLAUDE.md §5: confirm
        before delete.
      */}
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="sm">
            <Trash2 size={16} aria-hidden="true" />
            Хасах
          </Button>
        }
        title={`${partner.name}-г хасах уу?`}
        description="Бүртгэлээс хасагдана. Өмнөх сарын хуваарилалт хэвээр үлдэнэ."
        confirmLabel="Хасах"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

/**
 * Adding a share.
 *
 * ★ The percentage is asked for once and never edited afterwards — the model
 * and `PlatformRevenueService.updatePartner` both record why: a month's
 * distribution is evidence of the split it was paid under, so changing a
 * percentage would rewrite what already went out. Changing a share means
 * closing this row and opening a new one.
 */
function AddPartnerDialog({
  month,
  allocated,
  onClose,
}: {
  month: string;
  allocated: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [sharePercent, setSharePercent] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(`${month}-01`);
  const [note, setNote] = useState("");

  const create = useMutation({
    mutationFn: () =>
      mutate("/platform/partners", revenuePartnerSchema, {
        method: "POST",
        body: {
          name: name.trim(),
          sharePercent: sharePercent.trim(),
          effectiveFrom,
          note: note.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Хувь бүртгэгдлээ.");
      void queryClient.invalidateQueries({ queryKey: qk.platformPartners() });
      void queryClient.invalidateQueries({ queryKey: qk.platformDistribution(month) });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(create.error);
  const remaining = Math.max(0, 100 - allocated);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!create.isPending) create.mutate();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Хувь тохирсон хүн нэмэх"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[460px] rounded-card border border-border bg-surface p-5">
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-title font-semibold text-ink">Хувь тохирсон хүн нэмэх</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Хаах"
              className="grid size-9 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <FormError message={create.isError ? errorMessage(create.error) : null} />

          <Field label="Нэр" error={errors.name} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            )}
          </Field>

          <Field
            label="Хувь"
            error={errors.sharePercent}
            hint={`Үлдсэн ${remaining}% хуваарилагдаагүй байна.`}
            required
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                inputMode="decimal"
                value={sharePercent}
                onChange={(event) => setSharePercent(event.target.value)}
                placeholder="25"
              />
            )}
          </Field>

          <Field label="Эхлэх огноо" error={errors.effectiveFrom} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            )}
          </Field>

          <Field label="Тэмдэглэл" error={errors.note}>
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Гэрээний дугаар, тохиролцооны товч."
              />
            )}
          </Field>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Хадгалж байна…" : "Нэмэх"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
              Болих
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
