import { ageInYears, birthFacts } from "@kinder/contracts";
import { baseCss, esc, formatDate, paragraphs, reportChrome } from "./template-utils";

/**
 * The child portfolio PDF — RFP §10.3.
 *
 * HTML and CSS rather than a drawing API, which is why Puppeteer was chosen:
 * `break-inside: avoid`, CSS grid and `object-fit` all work, and the layout is
 * editable by anyone who can read CSS.
 *
 * Escaping, fonts and the shared typography live in `template-utils.ts` so that
 * this template and the term report cannot drift apart on any of them.
 */

export interface PortfolioData {
  child: {
    lastName: string;
    firstName: string;
    dateOfBirth: Date | string;
    sex: string;
    photoDataUri?: string | null;
  };
  kindergarten: { name: string };
  group?: { name: string } | null;
  schoolYear?: { name: string } | null;
  aboutMe?: {
    introduction?: string | null;
    nameMeaning?: string | null;
    memorableSayings?: string | null;
    dream?: string | null;
    distinguishingTraits?: string | null;
    heightCm?: unknown;
    weightKg?: unknown;
  } | null;
  ageProfiles: {
    age: number;
    favoriteColor?: string | null;
    favoriteFood?: string | null;
    favoriteToy?: string | null;
    favoriteBook?: string | null;
    favoriteSong?: string | null;
    favoriteActivity?: string | null;
    personality?: string | null;
    newSkills?: string | null;
    parentNote?: string | null;
    teacherNote?: string | null;
  }[];
  birthdayNotes: { age: number; note?: string | null }[];
  observations: {
    observedOn: Date | string;
    typeName: string;
    situation?: string | null;
    childDid?: string | null;
    childSaid?: string | null;
    teacherComment?: string | null;
    nextSteps?: string | null;
    photoDataUris: string[];
  }[];
  assessments: {
    termName: string;
    domainName: string;
    levelLabel: string;
    levelColor: string;
    comment?: string | null;
  }[];
  generatedAt: Date;
  /**
   * Photographs left out because the report hit its image budget
   * (`report-images.ts`). Printed as a note rather than silently dropped: a
   * family comparing the PDF with the app must be able to tell that pictures
   * are missing by design, not lost.
   */
  omittedPhotoCount?: number;
}

export function renderPortfolioHtml(data: PortfolioData): string {
  const fullName = `${data.child.lastName} ${data.child.firstName}`;

  const aboutRows = data.aboutMe
    ? [
        ["Нэрний утга", data.aboutMe.nameMeaning],
        ["Миний мөрөөдөл", data.aboutMe.dream],
        ["Миний онцлог", data.aboutMe.distinguishingTraits],
        ["Сонирхолтой үг", data.aboutMe.memorableSayings],
        ["Өндөр", data.aboutMe.heightCm ? `${String(data.aboutMe.heightCm)} см` : null],
        ["Жин", data.aboutMe.weightKg ? `${String(data.aboutMe.weightKg)} кг` : null],
      ].filter(([, value]) => Boolean(value))
    : [];

  const ageSections = data.ageProfiles
    .map((profile) => {
      const rows = [
        ["Дуртай өнгө", profile.favoriteColor],
        ["Дуртай хоол", profile.favoriteFood],
        ["Дуртай тоглоом", profile.favoriteToy],
        ["Дуртай ном", profile.favoriteBook],
        ["Дуртай дуу", profile.favoriteSong],
        ["Дуртай үйл ажиллагаа", profile.favoriteActivity],
        ["Зан чанар", profile.personality],
        ["Шинээр эзэмшсэн чадвар", profile.newSkills],
        ["Эцэг эхийн тэмдэглэл", profile.parentNote],
        ["Багшийн тэмдэглэл", profile.teacherNote],
      ].filter(([, value]) => Boolean(value));

      if (rows.length === 0) return "";

      return `
        <section class="age">
          <h3>${profile.age} нас</h3>
          <dl>
            ${rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join("")}
          </dl>
        </section>`;
    })
    .join("");

  const observationBlocks = data.observations
    .map(
      (obs) => `
      <article class="obs">
        <h3>${esc(obs.typeName)}</h3>
        <p class="meta">${formatDate(obs.observedOn)}</p>
        ${paragraphs(obs.situation)}
        ${obs.childDid ? `<p><strong>Хүүхдийн хийсэн:</strong> ${esc(obs.childDid)}</p>` : ""}
        ${obs.childSaid ? `<p><strong>Хүүхдийн хэлсэн:</strong> ${esc(obs.childSaid)}</p>` : ""}
        ${paragraphs(obs.teacherComment)}
        ${obs.nextSteps ? `<p><strong>Дараагийн алхам:</strong> ${esc(obs.nextSteps)}</p>` : ""}
        ${obs.photoDataUris
          .map((uri) => `<img class="obs-photo" src="${uri}" alt="Ажиглалтын зураг">`)
          .join("")}
      </article>`,
    )
    .join("");

  const assessmentRows = data.assessments
    .map(
      (a) => `
      <tr>
        <td>${esc(a.termName)}</td>
        <td>${esc(a.domainName)}</td>
        <td><span class="level" style="background:${esc(a.levelColor)}20;color:${esc(
          a.levelColor,
        )}">${esc(a.levelLabel)}</span></td>
        <td>${esc(a.comment)}</td>
      </tr>`,
    )
    .join("");

  const birthdayBlocks = data.birthdayNotes
    .filter((n) => n.note)
    .map((n) => `<div class="birthday"><h4>${n.age} нас</h4>${paragraphs(n.note)}</div>`)
    .join("");

  /*
   * RFP §4.2 — өрнийн орд and монгол жилийн амьтан, from the same functions the
   * portfolio screen uses. Rendered unconditionally: unlike the notes, these are
   * derived from the birth date, so there is no "not filled in yet" state that
   * would justify hiding the section.
   */
  const { zodiac, yearAnimal } = birthFacts(data.child.dateOfBirth);
  const birthdayHeader = `
    <dl class="birth-facts">
      <dt>Төрсөн огноо</dt><dd>${formatDate(data.child.dateOfBirth)}</dd>
      <dt>Нас</dt><dd>${ageInYears(data.child.dateOfBirth)} нас</dd>
      <dt>Өрнийн орд</dt><dd>${esc(zodiac.name)}</dd>
      <dt>Монгол жил</dt><dd>${esc(yearAnimal.name)} жил</dd>
    </dl>
    ${
      yearAnimal.beforeLunarNewYear
        ? `<p class="meta">Цагаан сараас өмнө төрсөн тул монгол жил нь өмнөх жилийнх байж болно.</p>`
        : ""
    }`;

  return `<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8">
<title>${esc(fullName)} — хөгжлийн хавтас</title>
<style>
${baseCss()}

  .cover { text-align: center; padding-top: 30mm; }
  .cover img { width: 55mm; height: 55mm; object-fit: cover; border-radius: 50%; }
  .cover .name { font-size: 26pt; font-weight: 700; margin-top: 8mm; }

  /* An observation must not split across a page boundary mid-entry. */
  .obs { break-inside: avoid; margin-bottom: 6mm; padding-bottom: 4mm; border-bottom: 1px solid #f3f4f6; }
  .obs-photo { width: 100%; max-height: 70mm; object-fit: cover; border-radius: 3mm; margin-top: 2mm; }

  .age { break-inside: avoid; margin-bottom: 6mm; }
  .birthday { break-inside: avoid; margin-bottom: 4mm; }
</style>
</head>
<body>

<section class="cover">
  ${data.child.photoDataUri ? `<img src="${data.child.photoDataUri}" alt="Хүүхдийн зураг">` : ""}
  <div class="name">${esc(fullName)}</div>
  <p class="meta">
    ${esc(data.kindergarten.name)}
    ${data.group ? ` · ${esc(data.group.name)}` : ""}
    ${data.schoolYear ? ` · ${esc(data.schoolYear.name)} хичээлийн жил` : ""}
  </p>
  <p class="meta">Төрсөн: ${formatDate(data.child.dateOfBirth)}</p>
</section>

${
  data.aboutMe && aboutRows.length > 0
    ? `<section class="page-break">
        <h2>Миний тухай</h2>
        <dl>${aboutRows.map(([l, v]) => `<dt>${esc(l)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        ${paragraphs(data.aboutMe.introduction)}
      </section>`
    : ""
}

${
  ageSections
    ? `<section class="page-break"><h2>Насны хөгжлийн тойм</h2>${ageSections}</section>`
    : ""
}

${
  /*
   * ★ The section no longer depends on a note existing.
   *
   * It used to render only when somebody had written one, so a portfolio for a
   * two-year-old printed no birthday section at all — and RFP §4.2's four facts
   * were absent from every PDF regardless, because they were never computed
   * here. The header is always worth printing; the notes are what may be empty.
   */
  ""
}
<section class="page-break">
  <h2>Төрсөн өдрийн мэдээлэл</h2>
  ${birthdayHeader}
  ${birthdayBlocks}
</section>

${
  observationBlocks
    ? `<section class="page-break"><h2>Багшийн ажиглалт</h2>${observationBlocks}</section>`
    : ""
}

${
  assessmentRows
    ? `<section class="page-break">
        <h2>Хөгжлийн үнэлгээ</h2>
        <table>
          <thead><tr><th>Улирал</th><th>Хөгжлийн чиглэл</th><th>Түвшин</th><th>Тайлбар</th></tr></thead>
          <tbody>${assessmentRows}</tbody>
        </table>
      </section>`
    : ""
}

${
  data.omittedPhotoCount
    ? `<p class="empty">Файлын хэмжээг хязгаарлахын тулд ${data.omittedPhotoCount} зургийг
        энэ тайланд оруулаагүй болно. Бүх зургийг системээс үзнэ үү.</p>`
    : ""
}

<p class="meta">Үүсгэсэн: ${formatDate(data.generatedAt)}</p>

</body>
</html>`;
}

/** Running header and footer — see `reportChrome` for why they re-declare the font. */
export function portfolioChrome(childName: string, kindergartenName: string) {
  return reportChrome(`${kindergartenName} · Хүүхдийн хөгжлийн хавтас`, childName);
}
