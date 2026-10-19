import { baseCss, esc, formatDate, reportChrome } from "./template-utils";
import type { ServiceInvoiceParams } from "./report-params";

/**
 * A kindergarten's invoice for renewing NomadKids — #211, «Нэхэмжлэх татах»
 * under «Үйлчилгээний эрх».
 *
 * ★ Every figure comes from the job's frozen params (`ServiceInvoiceParams`),
 * never from a live table: the invoice says what was asked for when it was
 * asked. ★★ No child, like the contract and the finance reports.
 */

const PERIOD_LABEL = { TERM: "Нэг улирал", YEAR: "Хичээлийн жил" } as const;

function money(value: string): string {
  const [whole = "0", cents] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${cents && !/^0+$/.test(cents) ? `${grouped}.${cents}` : grouped}₮`;
}

export function renderServiceInvoiceHtml(data: ServiceInvoiceParams): string {
  return `<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8">
<title>Нэхэмжлэх — ${esc(data.kindergartenName)}</title>
<style>
${baseCss()}

.invoice h1 { font-size: 18px; margin: 0 0 4px; }
.invoice .meta { font-size: 10px; color: #6b7280; margin-bottom: 16px; }
.invoice table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 12px 0; }
.invoice th, .invoice td { border-bottom: 0.5px solid #d1d5db; padding: 6px 4px; text-align: left; }
.invoice td.num, .invoice th.num { text-align: right; }
.invoice tfoot td { font-weight: 700; border-top: 1px solid #111827; border-bottom: none; }
.invoice .bank { margin-top: 18px; font-size: 11px; }
.invoice .bank dt { color: #6b7280; }
.invoice .bank dd { margin: 0 0 6px; font-weight: 600; }
</style>
</head>
<body>
<main class="invoice">
  <h1>Нэхэмжлэх</h1>
  <p class="meta">Огноо: ${esc(formatDate(data.issuedOn))} · Гэрээ: ${esc(data.contractNumber)}</p>

  <p><strong>Төлөгч:</strong> ${esc(data.kindergartenName)}</p>
  <p><strong>Хүлээн авагч:</strong> ${esc(data.bank.holder)}</p>

  ${data.perGroupAmount !== undefined ? periodTable(data) : monthlyTable(data)}

  <dl class="bank">
    <dt>Банк</dt><dd>${esc(data.bank.name)}</dd>
    <dt>Дансны дугаар</dt><dd>${esc(data.bank.account)}</dd>
    <dt>Данс эзэмшигч</dt><dd>${esc(data.bank.holder)}</dd>
    <dt>Гүйлгээний утга</dt><dd>${esc(data.contractNumber)} ${esc(data.kindergartenName)}</dd>
  </dl>
</main>
</body>
</html>`;
}

export function serviceInvoiceChrome(kindergartenName: string) {
  return reportChrome("Нэхэмжлэх", kindergartenName);
}

/** Since 2026-10-18: one group's price for the period, as the price sheet states it. */
function periodTable(data: ServiceInvoiceParams): string {
  return `<table>
    <thead>
      <tr>
        <th>Үйлчилгээ</th>
        <th class="num">Бүлэг</th>
        <th class="num">Нэг бүлгийн төлбөр</th>
        <th class="num">Дүн</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>NomadKids үйлчилгээний эрх — ${esc(data.periodLabel ?? PERIOD_LABEL[data.period])}</td>
        <td class="num">${esc(data.groupCount)}</td>
        <td class="num">${data.perGroupAmount ? esc(money(data.perGroupAmount)) : "—"}</td>
        <td class="num">${esc(money(data.amount))}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr><td colspan="3">Нийт төлөх дүн</td><td class="num">${esc(money(data.amount))}</td></tr>
    </tfoot>
  </table>`;
}

/** An invoice queued before 2026-10-18 — the monthly fee × months it was issued with. */
function monthlyTable(data: ServiceInvoiceParams): string {
  return `<table>
    <thead>
      <tr>
        <th>Үйлчилгээ</th>
        <th class="num">Бүлэг</th>
        <th class="num">Сар</th>
        <th class="num">Нэг бүлгийн сарын төлбөр</th>
        <th class="num">Дүн</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>NomadKids үйлчилгээний эрх — ${esc(PERIOD_LABEL[data.period])}</td>
        <td class="num">${esc(data.groupCount)}</td>
        <td class="num">${esc(data.months)}</td>
        <td class="num">${esc(money(data.perGroupMonthlyFee))}</td>
        <td class="num">${esc(money(data.amount))}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr><td colspan="4">Нийт төлөх дүн</td><td class="num">${esc(money(data.amount))}</td></tr>
    </tfoot>
  </table>`;
}
