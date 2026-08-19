import { baseCss, esc, formatDate, paragraphs, reportChrome } from "./template-utils";

/**
 * The term report PDF — RFP §6.4.
 *
 * ★ Phase 1, not Phase 2. §20-II makes it mandatory MVP and §21.7 an acceptance
 * criterion; ROADMAP D1 records the decision to pull it forward. The text
 * itself is written and finalised through the assessment module — this file
 * only renders what a teacher has already marked `FINAL`.
 *
 * Deliberately short: one to two pages that a parent reads at a meeting. The
 * portfolio is the long document; a term report that runs to eight pages does
 * not get read at all.
 */

export interface TermReportData {
  child: {
    lastName: string;
    firstName: string;
    dateOfBirth: Date | string;
    photoDataUri?: string | null;
  };
  kindergarten: { name: string };
  group?: { name: string } | null;
  schoolYear?: { name: string } | null;
  term: { name: string; number: number; startsOn: Date | string; endsOn: Date | string };
  report: {
    strengths?: string | null;
    needsSupport?: string | null;
    nextGoals?: string | null;
    adviceForParents?: string | null;
    finalizedAt?: Date | string | null;
    authorName?: string | null;
    /**
     * ★ True when a teacher is previewing text they have not finalised.
     *
     * A guardian can never reach this — their query filters to `FINAL`. But a
     * teacher legitimately can, and the rendered page otherwise carries a
     * signature block and a "Баталгаажсан:" line with an empty date. That is a
     * document which looks official, prints as official, and can be handed to a
     * parent at a meeting with nothing to say it is provisional.
     */
    isDraft?: boolean;
  };
  assessments: {
    domainName: string;
    levelLabel: string;
    levelColor: string;
    comment?: string | null;
  }[];
  generatedAt: Date;
}

export function renderTermReportHtml(data: TermReportData): string {
  const fullName = `${data.child.lastName} ${data.child.firstName}`;

  const sections = [
    ["Давуу тал", data.report.strengths],
    ["Дэмжлэг шаардлагатай", data.report.needsSupport],
    ["Дараагийн зорилго", data.report.nextGoals],
    ["Эцэг эхэд өгөх зөвлөмж", data.report.adviceForParents],
  ]
    .filter(([, value]) => Boolean(value))
    .map(
      ([label, value]) => `
      <section class="block">
        <h3>${esc(label)}</h3>
        ${paragraphs(value as string)}
      </section>`,
    )
    .join("");

  const assessmentRows = data.assessments
    .map(
      (a) => `
      <tr>
        <td>${esc(a.domainName)}</td>
        <td><span class="level" style="background:${esc(a.levelColor)}20;color:${esc(
          a.levelColor,
        )}">${esc(a.levelLabel)}</span></td>
        <td>${esc(a.comment)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8">
<title>${esc(fullName)} — ${esc(data.term.name)}</title>
<style>
${baseCss()}

  .head { display: flex; align-items: center; gap: 6mm; margin-bottom: 6mm; }
  .head img { width: 28mm; height: 28mm; object-fit: cover; border-radius: 50%; }
  .head .name { font-size: 18pt; font-weight: 700; }

  /* A section must not split mid-paragraph across a page boundary. */
  .block { break-inside: avoid; margin-bottom: 5mm; }

  .sign { margin-top: 12mm; display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
  .sign div { border-top: 1px solid #9ca3af; padding-top: 2mm; font-size: 9pt; color: #6b7280; }

  /* Impossible to mistake for a finalised report, including on a photocopy. */
  .draft {
    border: 2px solid #b91c1c;
    background: #fef2f2;
    color: #b91c1c;
    font-weight: 700;
    text-align: center;
    padding: 3mm;
    margin-bottom: 5mm;
    letter-spacing: 0.5mm;
  }
</style>
</head>
<body>

${
  data.report.isDraft
    ? `<div class="draft">ТӨСӨЛ — баталгаажаагүй. Эцэг эхэд өгөх баримт биш.</div>`
    : ""
}

<div class="head">
  ${data.child.photoDataUri ? `<img src="${data.child.photoDataUri}" alt="Хүүхдийн зураг">` : ""}
  <div>
    <div class="name">${esc(fullName)}</div>
    <p class="meta">
      ${esc(data.kindergarten.name)}
      ${data.group ? ` · ${esc(data.group.name)}` : ""}
      ${data.schoolYear ? ` · ${esc(data.schoolYear.name)}` : ""}
    </p>
    <p class="meta">Төрсөн: ${formatDate(data.child.dateOfBirth)}</p>
  </div>
</div>

<h2>${esc(data.term.name)} — хөгжлийн тайлан</h2>
<p class="meta">
  Хамрах хугацаа: ${formatDate(data.term.startsOn)} – ${formatDate(data.term.endsOn)}
</p>

${
  assessmentRows
    ? `<table>
        <thead><tr><th>Хөгжлийн чиглэл</th><th>Түвшин</th><th>Тайлбар</th></tr></thead>
        <tbody>${assessmentRows}</tbody>
      </table>`
    : `<p class="empty">Энэ улиралд нийтэлсэн үнэлгээ алга байна.</p>`
}

${sections || `<p class="empty">Тайлангийн бичвэр хоосон байна.</p>`}

${
  data.report.isDraft
    ? ""
    : `<div class="sign">
        <div>Багш: ${esc(data.report.authorName ?? "")}</div>
        <div>Эцэг эх / асран хамгаалагч</div>
      </div>`
}

<p class="meta">
  ${
    data.report.isDraft
      ? "Баталгаажаагүй төсөл"
      : `Баталгаажсан: ${formatDate(data.report.finalizedAt)}`
  } ·
  Үүсгэсэн: ${formatDate(data.generatedAt)}
</p>

</body>
</html>`;
}

export function termReportChrome(childName: string, kindergartenName: string, termName: string) {
  return reportChrome(`${kindergartenName} · ${termName}`, childName);
}
