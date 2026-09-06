// Test content for the PDF spike.
//
// This is deliberately shaped like the real MVP report: a child portfolio with
// an identity page, an "About me" page, age profiles, observation entries with
// photos, an assessment matrix and a narrative. The Mongolian text is long and
// real rather than lorem ipsum, because the whole point of the spike is whether
// Cyrillic renders, wraps and hyphenates correctly at A4 width.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const DOMAINS = [
  "Бие бялдрын хөгжил",
  "Нийгэмшихүй, сэтгэл хөдлөл",
  "Хэл яриа, харилцаа",
  "Танин мэдэхүй",
  "Урлаг, гоо зүйн хүмүүжил",
];

const LEVELS = ["Дэмжлэгтэй", "Хөгжиж буй", "Хүрсэн", "Давсан"];

// Long-form Mongolian paragraphs. Line-breaking behaviour in Cyrillic is the
// single most likely place for a rendering engine to fail, so these are full
// sentences with the long agglutinative words Mongolian actually produces.
const PARAGRAPHS = [
  "Өнөөдрийн хичээлийн үеэр Батбаяр бүлгийнхээ хүүхдүүдтэй хамтран барилгын " +
    "тоглоомоор цамхаг барих даалгавар гүйцэтгэлээ. Тэрээр эхлээд ганцаараа " +
    "ажиллаж эхэлсэн боловч цамхаг нь хэд хэдэн удаа нурсны дараа хажуугийн " +
    "ширээний найзуудаасаа тусламж хүсэж, хамтран ажиллах шийдвэр гаргасан нь " +
    "нийгэмшихүйн хөгжлийн илэрхий ахиц юм.",
  "Уншлагын буланд үлгэр сонсох үедээ асуулт олон асууж, дүрүүдийн сэтгэл " +
    "хөдлөлийг өөрийн үгээр тайлбарлаж чадаж байна. „Яагаад туулай " +
    "гунигтай байна вэ?“ гэсэн асуултад „Найз нь холдчихсон учраас“ " +
    "гэж хариулсан нь шалтгаан-үр дагаврын холбоог ойлгож буйг харуулж байна.",
  "Гараар ажиллах нарийн хөдөлгөөний даалгаварт харандаа барих байдал сүүлийн " +
    "хоёр сарын хугацаанд мэдэгдэхүйц сайжирсан. Хайчаар шулуун шугамаар " +
    "тайрах ажлыг бие даан гүйцэтгэж, өмнө нь шаардлагатай байсан багшийн " +
    "дэмжлэг одоо хэрэггүй болсон байна.",
  "Гадаа тоглолтын үеэр бөмбөг шидэх, барих дасгалыг тогтмол хийж байгаа " +
    "бөгөөд тэнцвэрийн самбар дээгүүр алхахдаа гараа дэлгэн тэнцвэрээ хадгалж " +
    "сурсан. Бие бялдрын хөгжлийн үзүүлэлтүүд насны ангилалдаа тохирч байна.",
  "Хөгжмийн хичээл дээр аяыг сонсоод хэмнэлийг гараараа алгадаж дагах " +
    "чадвартай болсон. Бүлгийн дуунд идэвхтэй оролцож, үгийг нь тогтоон " +
    "цээжилсэн байна. Урлагийн үйл ажиллагаанд сонирхол өндөр байна.",
];

const OBSERVATION_TITLES = [
  "Барилгын буланд хамтран ажилласан нь",
  "Үлгэр сонсох үеийн асуулт",
  "Хайчаар тайрах даалгавар",
  "Гадаа тоглолт — тэнцвэрийн дасгал",
  "Хөгжмийн хичээл дээрх оролцоо",
  "Өглөөний уулзалт дээр өөрийгөө танилцуулсан нь",
  "Зургийн буланд өнгө сонгосон байдал",
  "Хоолны цагийн бие даасан байдал",
  "Шинэ найзтай танилцсан нь",
  "Тоолох дасгалын үр дүн",
];

function fontFaces() {
  // Fonts are embedded as base64 rather than referenced from the filesystem or
  // the OS. The production container is minimal and has no Cyrillic fonts —
  // the Django project's own assets/fonts/README.md warns that relying on
  // system fonts renders Mongolian as boxes. Embedding makes the spike
  // reproduce the container's constraints on a developer laptop.
  const reg = readFileSync(join(here, "fonts/NotoSans-Regular.ttf")).toString("base64");
  const bold = readFileSync(join(here, "fonts/NotoSans-Bold.ttf")).toString("base64");
  return `
    @font-face {
      font-family: "Noto Sans";
      font-style: normal;
      font-weight: 400;
      src: url(data:font/ttf;base64,${reg}) format("truetype");
    }
    @font-face {
      font-family: "Noto Sans";
      font-style: normal;
      font-weight: 700;
      src: url(data:font/ttf;base64,${bold}) format("truetype");
    }
  `;
}

function photo(n) {
  const buf = readFileSync(join(here, `assets/photo-${n}.jpg`));
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

/**
 * @param {object} opts
 * @param {number} opts.observations how many observation entries to emit
 * @param {number} opts.photos       how many photos to embed
 * @param {boolean} opts.headerFooter emit @page margin boxes (Gotenberg/WeasyPrint
 *                                    style) instead of Puppeteer's header/footer
 *                                    templates
 */
export function buildHtml({ observations = 14, photos = 12, headerFooter = false } = {}) {
  const obs = [];
  for (let i = 0; i < observations; i++) {
    const img = i < photos ? `<img class="obs-photo" src="${photo((i % 12) + 1)}" alt="Ажиглалтын зураг">` : "";
    obs.push(`
      <article class="obs">
        <h3>${OBSERVATION_TITLES[i % OBSERVATION_TITLES.length]}</h3>
        <p class="meta">${DOMAINS[i % DOMAINS.length]} · 2026-${String((i % 12) + 1).padStart(2, "0")}-1${i % 9} · Багш: Оюунчимэг</p>
        <p>${PARAGRAPHS[i % PARAGRAPHS.length]}</p>
        <p>${PARAGRAPHS[(i + 2) % PARAGRAPHS.length]}</p>
        ${img}
      </article>
    `);
  }

  const matrixRows = DOMAINS.map(
    (d, i) => `
      <tr>
        <th scope="row">${d}</th>
        <td>${LEVELS[i % 4]}</td>
        <td>${LEVELS[(i + 1) % 4]}</td>
        <td>${LEVELS[(i + 2) % 4]}</td>
      </tr>`
  ).join("");

  const ages = [2, 3, 4, 5]
    .map(
      (a) => `
      <section class="age">
        <h3>${a} нас</h3>
        <dl>
          <dt>Өндөр</dt><dd>${85 + a * 6} см</dd>
          <dt>Жин</dt><dd>${11 + a * 2.4} кг</dd>
          <dt>Дуртай тоглоом</dt><dd>Барилгын шоо, зурах</dd>
          <dt>Багшийн тэмдэглэл</dt><dd>${PARAGRAPHS[a % PARAGRAPHS.length].slice(0, 180)}…</dd>
        </dl>
      </section>`
    )
    .join("");

  const pageBoxes = headerFooter
    ? `
      @page {
        @top-center {
          content: "NomadKids · Хүүхдийн хөгжлийн хавтас";
          font-size: 9pt; color: #6b7280;
        }
        @bottom-center {
          content: counter(page) " / " counter(pages);
          font-size: 9pt; color: #6b7280;
        }
      }`
    : "";

  return `<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8">
<title>Батбаярын хөгжлийн хавтас</title>
<style>
${fontFaces()}

@page { size: A4; margin: 18mm 16mm 20mm 16mm; ${pageBoxes ? "" : ""} }
${pageBoxes}

* { box-sizing: border-box; }
body {
  font-family: "Noto Sans", sans-serif;
  font-size: 10.5pt;
  line-height: 1.55;
  color: #1f2937;
  margin: 0;
}
h1 { font-size: 20pt; margin: 0 0 4mm; }
h2 { font-size: 14pt; margin: 0 0 3mm; border-bottom: 2px solid #e5e7eb; padding-bottom: 2mm; }
h3 { font-size: 11.5pt; margin: 0 0 2mm; }
p  { margin: 0 0 3mm; text-align: justify; }
.meta { color: #6b7280; font-size: 9pt; }

/* Every major section starts on a fresh page — the behaviour the real report
   needs and a common place for engines to disagree. */
.page-break { break-before: page; }

.cover { text-align: center; padding-top: 30mm; }
.cover img { width: 55mm; height: 55mm; object-fit: cover; border-radius: 50%; }
.cover .name { font-size: 26pt; font-weight: 700; margin-top: 8mm; }

/* Observations must not be split across a page boundary mid-entry. */
.obs { break-inside: avoid; margin-bottom: 6mm; padding-bottom: 4mm; border-bottom: 1px solid #f3f4f6; }
.obs-photo { width: 100%; max-height: 70mm; object-fit: cover; border-radius: 3mm; margin-top: 2mm; }

table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
th, td { border: 1px solid #d1d5db; padding: 2.5mm 3mm; text-align: left; font-size: 9.5pt; }
thead th { background: #f9fafb; }
tbody th { font-weight: 400; }

dl { display: grid; grid-template-columns: 40mm 1fr; gap: 1.5mm 4mm; margin: 0 0 4mm; }
dt { font-weight: 700; }
dd { margin: 0; }

.gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
.gallery img { width: 100%; height: 55mm; object-fit: cover; border-radius: 2mm; }
</style>
</head>
<body>

<section class="cover">
  <img src="${photo(3)}" alt="Хүүхдийн зураг">
  <div class="name">Батбаяр Ганболд</div>
  <p class="meta">Бяцхан Нүүдэлчид цэцэрлэг · Дунд бүлэг · 2025–2026 хичээлийн жил</p>
</section>

<section class="page-break">
  <h2>Миний тухай</h2>
  <dl>
    <dt>Нэр</dt><dd>Батбаяр Ганболд</dd>
    <dt>Төрсөн огноо</dt><dd>2021 оны 4 дүгээр сарын 12</dd>
    <dt>Дуртай хоол</dt><dd>Бууз, ногоотой шөл</dd>
    <dt>Дуртай өнгө</dt><dd>Хөх</dd>
    <dt>Найзууд</dt><dd>Тэмүүлэн, Сарантуяа, Энхжин</dd>
    <dt>Мөрөөдөл</dt><dd>Онгоцны нисгэгч болох</dd>
  </dl>
  <p>${PARAGRAPHS[0]}</p>
  <p>${PARAGRAPHS[1]}</p>
</section>

<section class="page-break">
  <h2>Насны хөгжлийн тойм (2–5 нас)</h2>
  ${ages}
</section>

<section class="page-break">
  <h2>Багшийн ажиглалт</h2>
  ${obs.join("\n")}
</section>

<section class="page-break">
  <h2>Хөгжлийн үнэлгээ — улирлаар</h2>
  <table>
    <thead>
      <tr><th>Хөгжлийн чиглэл</th><th>I улирал</th><th>II улирал</th><th>III улирал</th></tr>
    </thead>
    <tbody>${matrixRows}</tbody>
  </table>
  <h3>Багшийн нэгтгэсэн дүгнэлт</h3>
  <p>${PARAGRAPHS[2]}</p>
  <p>${PARAGRAPHS[3]}</p>
  <p>${PARAGRAPHS[4]}</p>
</section>

<section class="page-break">
  <h2>Зургийн цомог</h2>
  <div class="gallery">
    ${Array.from({ length: Math.min(photos, 12) }, (_, i) => `<img src="${photo(i + 1)}" alt="Цомгийн зураг ${i + 1}">`).join("\n    ")}
  </div>
</section>

</body>
</html>`;
}
