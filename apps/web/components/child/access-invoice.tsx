"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { z } from "zod";
import { childSummarySchema, type AccessPeriod } from "@kinder/contracts";
import { money } from "@/components/finance/money";
import { Button } from "@/components/ui/button";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * The family's own children — the same key and schema the shell's menu reads,
 * so on any screen this resolves from cache. `GET /children/:id` answers 402
 * while the fee is unpaid, so the child's name cannot come from there.
 */
const ownChildrenSchema = z.array(childSummarySchema);

export type AccessInvoiceData = {
  /** «Нэхэмжлэх» before the payment, «Төлбөрийн баримт» after it. */
  state: "due" | "paid";
  childName: string | null;
  period: AccessPeriod;
  /** A TERM row's term, 1–3 — known once a term is paid. */
  termNumber?: number | null;
  schoolYearName?: string | null;
  /** The decimal string the API sends; never a number. */
  amount: string | null;
  /** The subscription's id — its first eight characters are the number. */
  number?: string | null;
  paidAt?: string | null;
  expiresAt?: string | null;
};

/** `"2026-2027"` + 2 → «2026-2027 хичээлийн жилийн II улирал». */
export function periodLabel(
  period: AccessPeriod,
  schoolYearName?: string | null,
  termNumber?: number | null,
): string {
  const year = schoolYearName ? `${schoolYearName} хичээлийн жил` : "Хичээлийн жил";
  if (period === "YEAR") return year;
  const term = termNumber ? `${["I", "II", "III"][termNumber - 1] ?? termNumber} улирал` : "улирал";
  return schoolYearName ? `${schoolYearName} хичээлийн жилийн ${term}` : `Нэг ${term}`;
}

/** Each line of the receipt, in the order it reads — one list for the screen and the PDF. */
function receiptLines(data: AccessInvoiceData) {
  const head: [string, string][] = [];
  if (data.childName) head.push(["Хүүхэд", data.childName]);
  if (data.number) head.push(["Дугаар", data.number.slice(0, 8).toUpperCase()]);
  if (data.state === "paid" && data.paidAt) head.push(["Төлсөн", formatDateTime(data.paidAt)]);

  const service: [string, string][] = [
    ["Үйлчилгээ", "NomadKids үйлчилгээний эрх"],
    ["Хугацаа", periodLabel(data.period, data.schoolYearName, data.termNumber)],
  ];
  if (data.state === "paid" && data.expiresAt) {
    service.push(["Хүчинтэй", `${formatDate(data.expiresAt)} хүртэл`]);
  }

  const total: [string, string][] =
    data.state === "paid"
      ? [
          ["Нийт дүн", money(data.amount)],
          ["Төлбөрийн хэлбэр", "QPay"],
        ]
      : [
          ["Нийт дүн", money(data.amount)],
          ["Төлөх арга", "QPay"],
        ];
  return { head, service, total };
}

/**
 * The portal access fee as a receipt — 2026-10-15, the user: "нэхэмжлэх маш
 * ойлгомжтой цэгцтэй, и-баримт шиг минимал", with a PDF.
 *
 * The same quiet look as a month's bill on the finance tab (`InvoiceCard` in
 * `child-invoices.tsx`): who and what at the top, the period, the total under a
 * dashed rule. One type size, so nothing shouts.
 *
 * ★ It is NomadKids' receipt for the fee, not a VAT «И-баримт»: nothing here
 * is sent to the tax system, and it never says otherwise.
 *
 * ★★ «PDF» goes through the browser's print (save as PDF) — the agreement's
 * way (`printAgreement`), so no PDF job is queued for one small page.
 */
export function AccessInvoice({
  data,
  className,
}: {
  data: AccessInvoiceData;
  className?: string;
}) {
  const { head, service, total } = receiptLines(data);
  const title = data.state === "paid" ? "Төлбөрийн баримт" : "Нэхэмжлэх";

  return (
    <article
      aria-label={title}
      className={cn(
        "rounded-card border border-border-soft bg-white px-4 py-4 text-caption leading-5 shadow-sm sm:px-5",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold uppercase tracking-[0.14em] text-slate-400">
            {title}
          </p>
          <h3 className="text-compact font-bold text-ink">NomadKids</h3>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-border-soft px-2 py-0.5 text-caption font-semibold text-slate-600">
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-pill",
              data.state === "paid" ? "bg-emerald-500" : "bg-slate-400",
            )}
          />
          {data.state === "paid" ? "Төлөгдсөн" : "Төлөгдөөгүй"}
        </span>
      </header>

      {head.length > 0 ? <Rows lines={head} className="mt-2" /> : null}
      <Dashed />
      <Rows lines={service} />
      <Dashed />
      <Rows lines={total} strongFirst />

      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => printReceipt(title, data)}
          aria-label={`${title} хэвлэх, PDF болгох`}
        >
          <Printer size={16} aria-hidden /> PDF
        </Button>
      </div>
    </article>
  );
}

/** The child's «Овог Нэр» from the family's own list, or null while it loads. */
export function useOwnChildName(childId: string, enabled = true): string | null {
  const mine = useQuery({
    queryKey: qk.myChildren(),
    queryFn: () => get("/children/mine", ownChildrenSchema),
    enabled,
    staleTime: 60_000,
  });
  const child = mine.data?.find((item) => item.id === childId);
  return child ? `${child.lastName} ${child.firstName}` : null;
}

function Rows({
  lines,
  className,
  strongFirst = false,
}: {
  lines: [string, string][];
  className?: string;
  strongFirst?: boolean;
}) {
  return (
    <dl className={className}>
      {lines.map(([label, value], index) => {
        const strong = strongFirst && index === 0;
        return (
          <div key={label} className="flex items-baseline justify-between gap-3 py-0.5">
            <dt className={strong ? "font-semibold text-ink" : "text-muted"}>{label}</dt>
            <dd className={cn("text-right tabular-nums text-ink", strong && "font-bold")}>
              {value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Dashed() {
  return <hr className="my-2.5 border-0 border-t border-dashed border-slate-300" />;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The receipt as a page — narrow, centred, the screen's lines exactly. */
export function receiptHtml(title: string, data: AccessInvoiceData): string {
  const { head, service, total } = receiptLines(data);
  const rows = (lines: [string, string][], strongFirst = false) =>
    lines
      .map(
        ([label, value], index) =>
          `<div class="row${strongFirst && index === 0 ? " strong" : ""}"><span>${escapeHtml(
            label,
          )}</span><span>${escapeHtml(value)}</span></div>`,
      )
      .join("");
  const paid = data.state === "paid";
  return `<!doctype html><html lang="mn"><head><meta charset="utf-8"><title>${escapeHtml(
    title,
  )}</title><style>
@page { size: A4; margin: 20mm; }
body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; font-size: 10pt; line-height: 1.55; }
.card { max-width: 92mm; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 3mm; padding: 6mm 6mm 5mm; }
.top { display: flex; justify-content: space-between; align-items: flex-start; }
.eyebrow { font-size: 8pt; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: #94a3b8; }
.brand { font-size: 12pt; font-weight: 700; }
.badge { font-size: 8pt; font-weight: 600; color: #475569; border: 1px solid #e2e8f0; border-radius: 99px; padding: .4mm 2.4mm; white-space: nowrap; }
.badge i { display: inline-block; width: 1.6mm; height: 1.6mm; border-radius: 50%; margin-right: 1.2mm; background: ${paid ? "#10b981" : "#94a3b8"}; }
.row { display: flex; justify-content: space-between; gap: 4mm; padding: .5mm 0; }
.row span:first-child { color: #64748b; }
.row span:last-child { text-align: right; font-variant-numeric: tabular-nums; }
.row.strong span { color: #0f172a; font-weight: 700; }
hr { border: 0; border-top: 1px dashed #cbd5e1; margin: 3mm 0; }
.foot { margin-top: 4mm; text-align: center; font-size: 8pt; color: #94a3b8; }
</style></head><body><div class="card">
<div class="top"><div><div class="eyebrow">${escapeHtml(title)}</div><div class="brand">NomadKids</div></div>
<span class="badge"><i></i>${paid ? "Төлөгдсөн" : "Төлөгдөөгүй"}</span></div>
${head.length > 0 ? `<div style="margin-top:2mm">${rows(head)}</div>` : ""}
<hr>${rows(service)}<hr>${rows(total, true)}
<div class="foot">nomadkids.mn</div>
</div></body></html>`;
}

function printReceipt(title: string, data: AccessInvoiceData) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.srcdoc = receiptHtml(title, data);
  frame.onload = () => {
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
  document.body.appendChild(frame);
}
