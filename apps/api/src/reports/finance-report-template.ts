import { baseCss, esc, formatDate, reportChrome } from "./template-utils";

/**
 * A financial report as PDF — `нэмэлт.md` §16's "Excel болон PDF экспорттой".
 *
 * ★ **The only report template with no child in it.** The portfolio, the term
 * report and the annual report are all one child's document; this is a
 * kindergarten's ledger. That shows up in three places: no cover photograph, no
 * `masthead` with a child's name, and a landscape page — a report eight columns
 * wide printed in portrait wraps every row into three lines and becomes
 * unreadable, which is the failure `docs/PDF_SPIKE.md` §4 warns generalises.
 *
 * ★★ Driven by the same `ReportTable` the screen and the spreadsheet render, so
 * a column added to a report appears in all three without being written three
 * times. The alternative — a bespoke template per report — is eight templates
 * that drift, and §16 has eight reports.
 */

/** The row shape, matching `invoices/finance-reports.ts`'s `ReportTable`. */
export interface FinanceReportData {
  title: string;
  kindergartenName: string;
  /** `2026-02`, or a school year like `2025-2026`. */
  period: string;
  note?: string;
  columns: { key: string; header: string; money?: boolean }[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
  generatedAt: Date;
}

/**
 * Money, formatted from the decimal **string**.
 *
 * ★ Never `Number(value)`. This is the last stop before a document somebody
 * reconciles a bank statement against, and it is the place a float error would
 * be least visible and most expensive — the same argument the web app's
 * `money()` makes, restated because this file cannot import it.
 */
function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";

  const text = String(value);
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole = "0", cents] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const body = cents && cents !== "00" ? `${grouped}.${cents}` : grouped;

  return `${negative ? "−" : ""}${body}₮`;
}

function cell(value: string | number | null | undefined, isMoney: boolean): string {
  if (value === null || value === undefined || value === "") return "—";
  return isMoney ? money(value) : esc(value);
}

export function renderFinanceReportHtml(data: FinanceReportData): string {
  const moneyKeys = new Set(data.columns.filter((column) => column.money).map((c) => c.key));

  const head = data.columns
    .map(
      (column) =>
        `<th class="${moneyKeys.has(column.key) ? "num" : ""}">${esc(column.header)}</th>`,
    )
    .join("");

  const body = data.rows
    .map(
      (row) =>
        `<tr>${data.columns
          .map(
            (column) =>
              `<td class="${moneyKeys.has(column.key) ? "num" : ""}">${cell(
                row[column.key],
                moneyKeys.has(column.key),
              )}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");

  const foot = data.totals
    ? `<tfoot><tr>${data.columns
        .map(
          (column) =>
            `<td class="${moneyKeys.has(column.key) ? "num" : ""}">${cell(
              data.totals![column.key],
              moneyKeys.has(column.key),
            )}</td>`,
        )
        .join("")}</tr></tfoot>`
    : "";

  /*
   * ★ An empty report says so in a sentence. A blank table and a broken export
   * look identical on paper, and the person who most needs to tell them apart
   * is the one filing the report with it.
   */
  const empty =
    data.rows.length === 0 ? `<p class="empty">Энэ хугацаанд бичлэг алга байна.</p>` : "";

  return `<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8">
<title>${esc(data.title)}</title>
<style>
${baseCss()}

.report-head { margin-bottom: 14px; }
.report-head h1 { font-size: 17px; margin: 0 0 4px; }
.report-head .meta { font-size: 10px; color: #6b7280; }
.report-head .note { font-size: 10px; color: #6b7280; font-style: italic; margin-top: 6px; }

table.report { width: 100%; border-collapse: collapse; font-size: 10px; }
table.report th,
table.report td {
  border-bottom: 0.5px solid #d1d5db;
  padding: 5px 7px;
  text-align: left;
  vertical-align: top;
}
table.report thead th {
  background: #f3f4f6;
  font-weight: 700;
  border-bottom: 1px solid #9ca3af;
}
/*
  ★ Repeats the header on every printed page. A twelve-page unpaid report whose
  columns are named only on page one is a report nobody can read past page two,
  and this is the one line that fixes it.
*/
table.report thead { display: table-header-group; }
table.report tbody tr { break-inside: avoid; }

.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

table.report tfoot td {
  font-weight: 700;
  border-top: 1px solid #374151;
  border-bottom: none;
  background: #f9fafb;
}

.empty { font-size: 11px; color: #6b7280; margin-top: 16px; }
</style>
</head>
<body>
  <div class="report-head">
    <h1>${esc(data.title)}</h1>
    <div class="meta">${esc(data.kindergartenName)} · ${esc(data.period)} · ${formatDate(
      data.generatedAt,
    )}-нд үүсгэв</div>
    ${data.note ? `<div class="note">${esc(data.note)}</div>` : ""}
  </div>

  <table class="report">
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
    ${foot}
  </table>

  ${empty}
</body>
</html>`;
}

/**
 * Page furniture for a financial report.
 *
 * ★ **Landscape.** Eight columns of names and money do not fit A4 portrait, and
 * `PdfRendererService` takes the orientation from here rather than guessing per
 * report.
 */
export function financeReportChrome(title: string, kindergartenName: string, period: string) {
  return {
    ...reportChrome(`${kindergartenName} · ${period}`, title),
    landscape: true,
  };
}
