import { baseCss, esc, formatDate, masthead, paragraphs, reportChrome } from "./template-utils";

/**
 * The annual consolidated report — RFP §6.5.
 *
 * §6.5 asks for six things, and this renders all six: the four terms compared,
 * the progress across them, a chart per development domain, the child's
 * strengths, what to develop next, and the teacher's closing judgement with
 * advice for the family.
 *
 * ★ The per-domain "chart" is a table of levels plus a bar, not an SVG.
 *
 * A term's assessment is an ordinal 1–4 level a kindergarten may rename, so the
 * honest rendering is the level's own word in each term's column with the
 * change stated in words. A line chart over four points would imply a
 * continuous quantity that `AssessmentLevel` is not, and it would print worse
 * on the A4 sheet this is designed for.
 */

export interface AnnualReportData {
  child: {
    lastName: string;
    firstName: string;
    dateOfBirth: Date | string;
    photoDataUri?: string | null;
  };
  kindergarten: { name: string; logoDataUri?: string | null };
  group?: { name: string } | null;
  schoolYear: { name: string; startsOn?: Date | string | null; endsOn?: Date | string | null };
  /** Every term of the year, in order — including ones with no assessment. */
  terms: { id: string; name: string; number: number }[];
  /**
   * One row per development domain, with a cell per term.
   *
   * `levels` is index-aligned with `terms`, and `null` means "not assessed that
   * term" rather than zero — §6.5 is a comparison, and a blank column is a fact
   * about the year rather than a gap to hide.
   */
  domains: {
    name: string;
    levels: ({ value: number; label: string; color: string } | null)[];
    /** Change from the first assessed term to the last, in levels. */
    change: number | null;
  }[];
  /** The teacher's written text, per term, newest last. */
  termReports: {
    termName: string;
    strengths?: string | null;
    needsSupport?: string | null;
    nextGoals?: string | null;
    adviceForParents?: string | null;
    authorName?: string | null;
  }[];
  generatedAt: Date;
  /**
   * True when a guardian's copy is missing terms a teacher would see —
   * unfinalised reports, unpublished assessments. Printed as a note so a family
   * comparing the document with a conversation knows why a column is empty.
   */
  filteredForGuardian: boolean;
}

/** The scale's maximum — `SYSTEM_LEVELS` defines values 1–4. */
const MAX_LEVEL = 4;

export function renderAnnualReportHtml(data: AnnualReportData): string {
  const fullName = `${data.child.lastName} ${data.child.firstName}`;

  const headerCells = data.terms.map((t) => `<th>${esc(t.name)}</th>`).join("");

  const domainRows = data.domains
    .map((domain) => {
      const cells = domain.levels
        .map((level) =>
          level
            ? `<td><span class="level" style="background:${esc(level.color)}20;color:${esc(
                level.color,
              )}">${esc(level.label)}</span></td>`
            : // An em dash, never a zero: "not assessed" and "lowest level" are
              // opposite facts and must not look alike.
              `<td class="empty">—</td>`,
        )
        .join("");

      return `
      <tr>
        <td>${esc(domain.name)}</td>
        ${cells}
        <td>${changeLabel(domain.change)}</td>
      </tr>`;
    })
    .join("");

  /*
   * The bar chart §6.5 asks for, one row per domain.
   *
   * Drawn with a div width rather than an SVG: it prints identically, needs no
   * font inside a graphic, and the same numbers are already in the table above
   * — which is what a screen reader and a photocopier both get.
   */
  const domainBars = data.domains
    .map((domain) => {
      const latest = [...domain.levels].reverse().find((l) => l !== null);
      if (!latest) return "";

      const percent = Math.round((latest.value / MAX_LEVEL) * 100);
      return `
      <div class="bar-row">
        <span class="bar-label">${esc(domain.name)}</span>
        <span class="bar-track">
          <span class="bar-fill" style="width:${percent}%;background:${esc(latest.color)}"></span>
        </span>
        <span class="bar-value">${esc(latest.label)}</span>
      </div>`;
    })
    .join("");

  const termBlocks = data.termReports
    .map(
      (report) => `
      <section class="term-block">
        <h3>${esc(report.termName)}</h3>
        ${labelled("Давуу тал", report.strengths)}
        ${labelled("Дэмжлэг шаардлагатай", report.needsSupport)}
        ${labelled("Дараагийн зорилго", report.nextGoals)}
        ${labelled("Эцэг эхэд өгөх зөвлөмж", report.adviceForParents)}
        ${report.authorName ? `<p class="meta">${esc(report.authorName)}</p>` : ""}
      </section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8">
<title>${esc(fullName)} — ${esc(data.schoolYear.name)} жилийн тайлан</title>
<style>
${baseCss()}

  .head { display: flex; align-items: center; gap: 6mm; margin-bottom: 6mm; }
  .head img { width: 28mm; height: 28mm; object-fit: cover; border-radius: 50%; }
  .head .name { font-size: 18pt; font-weight: 700; }

  .term-block { break-inside: avoid; margin-bottom: 6mm; }

  /* The bar chart — RFP §6.5's "Хөгжлийн чиглэл тус бүрийн график". */
  .bar-row { display: grid; grid-template-columns: 45mm 1fr 30mm; align-items: center; gap: 3mm; margin-bottom: 2.5mm; }
  .bar-label { font-size: 9.5pt; }
  .bar-track { height: 4mm; background: #f3f4f6; border-radius: 2mm; overflow: hidden; }
  .bar-fill { display: block; height: 100%; }
  .bar-value { font-size: 9pt; color: #6b7280; }

  .change-up { color: #047857; font-weight: 700; }
  .change-flat { color: #6b7280; }
  .change-down { color: #b45309; }
</style>
</head>
<body>

${masthead(data.kindergarten)}

<div class="head">
  ${data.child.photoDataUri ? `<img src="${data.child.photoDataUri}" alt="Хүүхдийн зураг">` : ""}
  <div>
    <div class="name">${esc(fullName)}</div>
    <p class="meta">
      ${esc(data.kindergarten.name)}${data.group ? ` · ${esc(data.group.name)}` : ""}
    </p>
    <p class="meta">Төрсөн: ${formatDate(data.child.dateOfBirth)}</p>
  </div>
</div>

<h2>${esc(data.schoolYear.name)} — жилийн нэгдсэн тайлан</h2>
${
  data.schoolYear.startsOn && data.schoolYear.endsOn
    ? `<p class="meta">Хамрах хугацаа: ${formatDate(data.schoolYear.startsOn)} – ${formatDate(
        data.schoolYear.endsOn,
      )}</p>`
    : ""
}

${
  data.filteredForGuardian
    ? `<p class="meta">Зөвхөн баталгаажсан үнэлгээ, тайланг оруулсан болно.</p>`
    : ""
}

<h3>Улирлын харьцуулалт</h3>
${
  data.domains.length > 0
    ? `<table>
        <thead><tr><th>Хөгжлийн чиглэл</th>${headerCells}<th>Ахиц</th></tr></thead>
        <tbody>${domainRows}</tbody>
      </table>`
    : `<p class="empty">Энэ жилд нийтэлсэн үнэлгээ алга байна.</p>`
}

${domainBars ? `<h3>Жилийн эцсийн түвшин</h3>${domainBars}` : ""}

${termBlocks ? `<section class="page-break"><h2>Улирлын дүгнэлт</h2>${termBlocks}</section>` : ""}

<p class="meta">Тайлан үүсгэсэн: ${formatDate(data.generatedAt)}</p>

</body>
</html>`;
}

function labelled(label: string, value?: string | null): string {
  if (!value) return "";
  return `<h4>${esc(label)}</h4>${paragraphs(value)}`;
}

/**
 * The year's movement, in words as well as a number.
 *
 * ★ Null when there is nothing to compare — one assessed term, or none. "0" and
 * "we only measured once" are different facts, and §6.5 is a comparison: a
 * report that prints "±0" for a child assessed once is stating a result nobody
 * measured.
 */
function changeLabel(change: number | null): string {
  if (change === null) return `<span class="empty">—</span>`;
  if (change > 0) return `<span class="change-up">+${change} түвшин</span>`;
  if (change < 0) return `<span class="change-down">${change} түвшин</span>`;
  return `<span class="change-flat">Тогтвортой</span>`;
}

export function annualReportChrome(childName: string, kindergartenName: string, yearName: string) {
  return reportChrome(`${kindergartenName} · ${yearName}`, childName);
}
