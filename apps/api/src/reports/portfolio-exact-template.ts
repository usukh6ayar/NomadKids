import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGE_FAMILY_OPTIONS,
  ARTWORK_TYPES,
  birthFacts,
  LEARNING_DOMAINS,
  YEAR_ANIMALS,
  ZODIAC_SIGNS,
  type LearningDomain,
} from "@kinder/contracts";
import { esc, fontFaceCss, formatDate, paragraphs } from "./template-utils";
import type { PortfolioAgeProfile, PortfolioData } from "./portfolio-template";

const AGES = [2, 3, 4, 5] as const;
let backgrounds: string[] | null = null;

function templateAsset(page: number) {
  const fileName = `${page}.svg`;
  const candidates = [
    join(__dirname, "assets", "portfolio-template", fileName),
    join(process.cwd(), "src", "reports", "assets", "portfolio-template", fileName),
    join(process.cwd(), "apps", "api", "src", "reports", "assets", "portfolio-template", fileName),
  ];
  const asset = candidates.find(existsSync);
  if (!asset) throw new Error(`Portfolio template asset is missing: ${fileName}`);
  return asset;
}

function pageBackgrounds() {
  backgrounds ??= Array.from({ length: 19 }, (_, index) =>
    readFileSync(templateAsset(index + 1)).toString("base64"),
  );
  return backgrounds;
}

/*
  ★ Each background is written once, as a CSS class, however many pages use it
  — 2026-10-19 review. Inlined per page, a portfolio with ten artwork pages
  carried ten copies of a 1.4 MB SVG through DevTools into the 2 GB worker.
*/
function exactPage(template: number, overlay = "") {
  return `<section class="sheet t${template}"><div class="page-bg bg${template}"></div><div class="overlay">${overlay}</div></section>`;
}

function backgroundCss(pages: string[]) {
  const used = [...new Set(pages.join("").match(/ bg\d+"/g) ?? [])].map((match) =>
    Number(match.slice(3, -1)),
  );
  return used
    .map(
      (template) =>
        `.bg${template}{background-image:url("data:image/svg+xml;base64,${pageBackgrounds()[template - 1]}")}`,
    )
    .join("");
}

/** A domain's own note, from `{ "Танин мэдэхүй": "…" }`. */
function domainNote(notes: unknown, domain: LearningDomain) {
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return undefined;
  return (notes as Record<string, unknown>)[domain];
}

/** The family questions this child's family ticked, under the domain each belongs to. */
function familySkills(
  age: (typeof AGES)[number],
  skills: string[] | undefined,
  domain: LearningDomain,
) {
  return (skills ?? []).filter((skill) => AGE_FAMILY_OPTIONS[age][domain].includes(skill));
}

function unplacedFamilySkills(age: (typeof AGES)[number], skills: string[] | undefined) {
  return (skills ?? []).filter(
    (skill) => !LEARNING_DOMAINS.some((domain) => AGE_FAMILY_OPTIONS[age][domain].includes(skill)),
  );
}

function profile(data: PortfolioData, age: number) {
  return data.ageProfiles.find((item) => item.age === age);
}

function list(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").join(", ") : "";
}

function deepText(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(deepText);
  if (value && typeof value === "object") return Object.values(value).flatMap(deepText);
  return [];
}

function declarative(value: string) {
  const clean = value.trim().replace(/\s+(уу|үү)\?$/iu, ".");
  return /[.!?]$/u.test(clean) ? clean : `${clean}.`;
}

function text(...values: unknown[]) {
  return values.flatMap(deepText).filter(Boolean).join(", ");
}

function statements(...values: unknown[]) {
  return values.flatMap(deepText).filter(Boolean).map(declarative).join(" ");
}

function matrix(cells: unknown[], className: string) {
  return `<div class="matrix ${className}">${cells.map((cell) => `<div class="fill">${esc(cell || "")}</div>`).join("")}</div>`;
}

function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size),
  );
}

function byAgeRoundRobin<T extends { age?: number | null }>(items: T[]) {
  const buckets = new Map<number | null, T[]>();
  for (const item of items) {
    const age = AGES.includes(item.age as (typeof AGES)[number]) ? Number(item.age) : null;
    buckets.set(age, [...(buckets.get(age) ?? []), item]);
  }
  const result: T[] = [];
  const order: (number | null)[] = [...AGES, null];
  for (let row = 0; ; row += 1) {
    let added = false;
    for (const age of order) {
      const item = buckets.get(age)?.[row];
      if (item) {
        result.push(item);
        added = true;
      }
    }
    if (!added) return result;
  }
}

function observationCards(items: PortfolioData["observations"]) {
  const teacher = items.filter((item) => item.source === "TEACHER");
  const parent = items.filter((item) => item.source === "PARENT");
  return [0, 1, 2]
    .flatMap((index) => [teacher[index], parent[index]])
    .map((item, index) => {
      const source = index % 2 === 0 ? "teacher" : "parent";
      if (!item) return `<article class="history-card ${source}"></article>`;
      return `<article class="history-card ${source}"><div class="history-head"><strong>${source === "teacher" ? "БАГШИЙН АЖИГЛАЛТ" : "ЭЦЭГ ЭХИЙН ЯРИЛЦЛАГА"}</strong><time>${formatDate(item.observedOn)}</time></div><h3>${esc(item.activityName || item.typeName)}</h3>${paragraphs(text(item.situation, item.childDid, item.childSaid, item.teacherComment))}</article>`;
    })
    .join("");
}

function historyPages(data: PortfolioData) {
  const teacher = data.observations.filter((item) => item.source === "TEACHER");
  const parent = data.observations.filter((item) => item.source === "PARENT");
  const count = Math.max(1, Math.ceil(teacher.length / 3), Math.ceil(parent.length / 3));
  return Array.from({ length: count }, (_, index) =>
    exactPage(
      9,
      `<div class="history-grid">${observationCards([
        ...teacher.slice(index * 3, index * 3 + 3),
        ...parent.slice(index * 3, index * 3 + 3),
      ])}</div>`,
    ),
  );
}

function chart(values: { value: number; label: string }[], color: string, unit: string) {
  if (!values.length) return "";
  const min = Math.min(...values.map((item) => item.value));
  const max = Math.max(...values.map((item) => item.value));
  const span = Math.max(max - min, 1);
  const points = values.map((item, index) => ({
    ...item,
    x: values.length === 1 ? 150 : 24 + (index * 252) / (values.length - 1),
    y: 105 - ((item.value - min) / span) * 75,
  }));
  return `<svg viewBox="0 0 300 130"><polyline points="${points.map((item) => `${item.x},${item.y}`).join(" ")}" fill="none" stroke="${color}" stroke-width="4"/>${points.map((item) => `<circle cx="${item.x}" cy="${item.y}" r="5" fill="${color}"/><text x="${item.x}" y="${item.y - 9}" text-anchor="middle">${item.value}${unit}</text><text x="${item.x}" y="124" text-anchor="middle">${esc(item.label)}</text>`).join("")}</svg>`;
}

type VisualItem = {
  dataUri: string;
  caption?: string | null;
  takenAt?: Date | string | null;
  madeOn?: Date | string | null;
  age?: number | null;
};

function artGrid(items: VisualItem[], type: string) {
  return `<div class="art-grid">${Array.from({ length: 4 }, (_, index) => {
    const item = items[index];
    return `<figure>${item ? `<img src="${item.dataUri}" alt="${esc(type)}"><figcaption><strong>${item.age ? `${item.age} нас` : ""}</strong><span>${esc(item.caption || type)}${item.madeOn ? ` · ${formatDate(item.madeOn)}` : ""}</span></figcaption>` : ""}</figure>`;
  }).join("")}</div>`;
}

function albumGrid(items: VisualItem[]) {
  return `<div class="album-grid">${Array.from({ length: 6 }, (_, index) => {
    const item = items[index];
    return `<figure>${item ? `<img src="${item.dataUri}" alt=""><figcaption><strong>${item.age ? `${item.age} нас` : ""}</strong><span>${esc(item.caption || (item.takenAt ? formatDate(item.takenAt) : ""))}</span></figcaption>` : ""}</figure>`;
  }).join("")}</div>`;
}

function artworkPages(data: PortfolioData) {
  const actual = [...new Set(data.artworks.map((item) => item.type))];
  const types = [
    ...ARTWORK_TYPES.filter((type) => actual.includes(type)),
    ...actual.filter((type) => !ARTWORK_TYPES.includes(type as (typeof ARTWORK_TYPES)[number])),
  ];
  return types.flatMap((type) => {
    const items = byAgeRoundRobin(data.artworks.filter((item) => item.type === type));
    return chunks(items, 4).map((pageItems) =>
      exactPage(
        11,
        `<div class="section-title art-title">${esc(type)}</div>${artGrid(pageItems, type)}`,
      ),
    );
  });
}

function flattenedAlbums(data: PortfolioData) {
  return data.photoAlbums.map((album) => ({
    label: album.label,
    attribution: album.attribution,
    items: album.photos.map((photo) => ({ ...photo, age: album.age })),
  }));
}

function albumPages(data: PortfolioData) {
  const grouped = new Map<string, VisualItem[]>();
  for (const album of flattenedAlbums(data)) {
    if (album.label === "Багшийн илгээсэн зураг") continue;
    grouped.set(album.label, [...(grouped.get(album.label) ?? []), ...album.items]);
  }
  return [...grouped].flatMap(([label, items]) =>
    chunks(byAgeRoundRobin(items), 6).map((pageItems) =>
      exactPage(
        12,
        `<div class="section-title album-title">${esc(label)}</div>${albumGrid(pageItems)}`,
      ),
    ),
  );
}

function teacherPhotoPages(data: PortfolioData) {
  const items = flattenedAlbums(data)
    // Only the uncategorised ones — a teacher's photo with a category is
    // already on that category's album page.
    .filter((album) => album.label === "Багшийн илгээсэн зураг")
    .flatMap((album) => album.items);
  return AGES.flatMap((age) => {
    const ageItems = items.filter((item) => item.age === age);
    return chunks(ageItems, 6).map((pageItems) => exactPage(13 + age, albumGrid(pageItems)));
  });
}

function teacherSignature(data: PortfolioData) {
  const people = (data.teachers ?? []).map((teacher) => {
    const initial = teacher.lastName.trim().charAt(0);
    return `${initial ? `${initial}. ` : ""}${teacher.firstName}`;
  });
  const group = data.group?.name || data.enrollments.at(-1)?.groupName || "";
  const groupLabel = group.endsWith("бүлэг")
    ? group.replace(/бүлэг$/u, "бүлгийн")
    : `${group} бүлгийн`;
  return `${groupLabel} багш${people.length > 1 ? " нар" : ""}${people.length ? `: ${people.join(", ")}` : ""}`;
}

export function renderExactPortfolioHtml(data: PortfolioData): string {
  const fullName = `${data.child.lastName} ${data.child.firstName}`.trim();
  const current = data.ageProfiles.at(-1);
  const favorites = (field: keyof PortfolioAgeProfile) =>
    AGES.map((age) => profile(data, age)?.[field]);
  const traits = [
    "Хөгжилтэй",
    "Эелдэг",
    "Баяр хөөртэй",
    "Тайван",
    "Гунигтай",
    "Зөрүүд",
    "Ууртай",
    "Сандруу",
    "Унтамхай",
    "Ичимхий",
    "Зоригтой",
  ];
  const traitCells = traits.flatMap((trait) =>
    AGES.map((age) => (profile(data, age)?.characterTraits?.includes(trait) ? "✓" : "")),
  );
  const growth = data.growthMeasurements.slice(-4);
  // `Number(null)` is 0: a weight-only measurement would plot at 0 см.
  const measured = (value: unknown) =>
    value !== null && value !== undefined && Number.isFinite(Number(value));
  const height = growth
    .filter((item) => measured(item.heightCm))
    .map((item) => ({ value: Number(item.heightCm), label: formatDate(item.measuredOn) }));
  const weight = growth
    .filter((item) => measured(item.weightKg))
    .map((item) => ({ value: Number(item.weightKg), label: formatDate(item.measuredOn) }));
  /*
    ★ Always four rows — 2026-10-19 review. The page's background is the
    designer's sample, with four made-up measurements («91 см 13.1 кг» …) drawn
    into it; a table only as tall as this child's rows left the rest showing
    as if they were the child's (CLAUDE.md §5: never sample figures).
  */
  const growthRows = Array.from({ length: 4 }, (_, index) => growth[index]);
  const photoCount = data.photoAlbums.reduce((sum, album) => sum + album.photos.length, 0);
  // A guardian's pick overrides the computed answer, as on the web (RFP §4.2).
  const computedBirthFacts = birthFacts(data.child.dateOfBirth);
  const zodiac =
    ZODIAC_SIGNS.find((item) => item.code === data.aboutMe?.zodiacCode) ??
    computedBirthFacts.zodiac;
  const yearAnimal =
    YEAR_ANIMALS.find((item) => item.code === data.aboutMe?.yearAnimalCode) ??
    computedBirthFacts.yearAnimal;

  const pages = [
    exactPage(
      1,
      `<div class="cover-card"><strong>${esc(fullName.toUpperCase())}</strong><span>${esc(data.group?.name || "")} · ${esc(data.schoolYear?.name || "")}</span><b>${current?.age || 5} нас · ${esc(data.kindergarten.name)}</b></div>`,
    ),
    exactPage(
      2,
      `${data.child.photoDataUri ? `<img class="child-photo" src="${data.child.photoDataUri}" alt="">` : ""}<div class="profile-age"></div><div class="identity-name">${esc(data.child.firstName)}<small>${current?.age || 5} нас</small></div><dl class="identity-values">${[data.aboutMe?.clanName, fullName, formatDate(data.child.dateOfBirth), data.child.sex === "FEMALE" ? "Эмэгтэй" : "Эрэгтэй", `${yearAnimal.name} жил`, zodiac.name, data.aboutMe?.bloodType, data.group?.name].map((value) => `<dd>${esc(value)}</dd>`).join("")}</dl><div class="completion"><div><strong>Явцын үнэлгээ</strong><b>${data.observations.length} тэмдэглэл</b></div><div><strong>Миний тухай</strong><b>${data.aboutMe ? "Бүрэн" : "Дутуу"}</b></div><div><strong>Зургийн цомог</strong><b>${photoCount} зураг</b></div><div><strong>2-5 насны мэдээлэл</strong><b>${data.ageProfiles.length}/4 нас</b></div></div>`,
    ),
    exactPage(
      3,
      `<div class="enrollment">${data.enrollments.map((item, index) => `<article><i>${index + 1}</i><div><strong>${esc(item.groupName)} · ${esc(item.schoolYearName)}</strong><span>${formatDate(item.startedOn)} - ${item.endedOn ? formatDate(item.endedOn) : "Одоо"}</span></div><b>${esc(item.kindergartenName)}</b></article>`).join("")}</div>`,
    ),
    exactPage(
      4,
      `${matrix(traitCells, "traits")}<div class="trait-notes">${AGES.map((age) => `<article><strong>${age} нас</strong><p>${esc(profile(data, age)?.characterObservation || "")}</p></article>`).join("")}</div>`,
    ),
    exactPage(
      5,
      matrix(
        [
          ...favorites("favoriteToy"),
          ...favorites("favoriteSong"),
          ...favorites("favoriteClothes"),
          ...favorites("favoriteStory"),
          ...favorites("favoriteMovie"),
          ...favorites("favoriteTreat"),
          ...favorites("favoriteColor"),
          ...favorites("favoriteBook"),
          ...favorites("favoriteActivity"),
          ...favorites("favoriteFood"),
        ],
        "favorites",
      ),
    ),
    exactPage(
      6,
      `<div class="family-grid">${AGES.map((age) => {
        const item = profile(data, age);
        return `<article><strong>Манай гэр бүл ам бүл ${item?.familySize || "-"}</strong><p>${esc(text(item?.familyDescription, item?.familyMembers, list(item?.familyMemberTypes), item?.familyMemories))}</p></article>`;
      }).join("")}</div>`,
    ),
    exactPage(
      7,
      `<div class="learning-grid">${AGES.map((age) => {
        const item = profile(data, age);
        const notes = item?.kindergartenSkillNotes;
        return `<article><h3>Танин мэдэхүй</h3><p>${esc(statements(item?.learningInterest, item?.kindergartenOtherSkill, domainNote(notes, "Танин мэдэхүй")))}</p><h3>Нийгэмшихүй</h3><p>${esc(statements(item?.kindergartenSkills, domainNote(notes, "Нийгэмшихүй")))}</p><h3>Бие бялдар</h3><p>${esc(statements(item?.newSkills, domainNote(notes, "Бие бялдар")))}</p></article>`;
      }).join("")}</div>`,
    ),
    exactPage(
      8,
      `<div class="learning-grid">${AGES.map((age) => {
        const item = profile(data, age);
        // Each ticked question under its own domain; «Бие бялдар» used to
        // reprint `familyDescription`, which page 6 already shows.
        const skills = item?.familyLearningSkills;
        const notes = item?.familyLearningNotes;
        return `<article><h3>Танин мэдэхүй</h3><p>${esc(statements(familySkills(age, skills, "Танин мэдэхүй"), unplacedFamilySkills(age, skills), item?.familyLearningOther, domainNote(notes, "Танин мэдэхүй")))}</p><h3>Нийгэмшихүй</h3><p>${esc(statements(familySkills(age, skills, "Нийгэмшихүй"), domainNote(notes, "Нийгэмшихүй")))}</p><h3>Бие бялдар</h3><p>${esc(statements(familySkills(age, skills, "Бие бялдар"), domainNote(notes, "Бие бялдар")))}</p></article>`;
      }).join("")}</div>`,
    ),
    ...historyPages(data),
    exactPage(
      10,
      `<table class="growth-table"><tbody>${growthRows.map((item) => (item ? `<tr><td>${formatDate(item.measuredOn)}</td><td>${measured(item.heightCm) ? `${esc(item.heightCm)} см` : ""}</td><td>${measured(item.weightKg) ? `${esc(item.weightKg)} кг` : ""}</td></tr>` : "<tr><td></td><td></td><td></td></tr>")).join("")}</tbody></table><div class="height-chart">${chart(height, "#317bd6", "см")}</div><div class="weight-chart">${chart(weight, "#43a66f", "кг")}</div>`,
    ),
    ...artworkPages(data),
    ...albumPages(data),
    ...teacherPhotoPages(data),
    exactPage(
      19,
      `<div class="letter-name">Хайртай шүү, бяцхан шавь ${esc(data.child.firstName)} минь.</div><div class="letter-body">${data.teacherLetter ? paragraphs(data.teacherLetter) : ""}</div><div class="letter-sign">${esc(teacherSignature(data))}</div><div class="letter-date">${formatDate(data.generatedAt)}</div>`,
    ),
  ];

  return `<!doctype html><html lang="mn"><head><meta charset="utf-8"><title>${esc(fullName)} - хүүхдийн хөгжлийн хувийн хавтас</title><style>
  ${fontFaceCss()}
  ${backgroundCss(pages)}
  @page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;font-family:"Noto Sans",sans-serif;color:#14385d}.sheet{position:relative;width:210mm;height:297mm;overflow:hidden;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto}.page-bg{position:absolute;inset:0;background-size:100% 100%;background-repeat:no-repeat}body{counter-reset:sheet}.sheet{counter-increment:sheet}.sheet::after{content:counter(sheet);position:absolute;z-index:3;left:0;right:0;bottom:5mm;text-align:center;font-size:8pt;color:#8aa0b9}.t1::after{content:none}.overlay{position:absolute;inset:0}
  .cover-card{position:absolute;left:12.7%;top:13.9%;width:74.3%;height:9.9%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5mm;border:1px solid #bdd4dd;border-radius:7mm;background:#fff}.cover-card strong{font-size:18pt}.cover-card span{color:#60738b;font-size:9.5pt}.cover-card b{color:#2e78d6;font-size:8.5pt}
  .child-photo{position:absolute;left:9.6%;top:15.4%;width:23.2%;height:23.2%;border-radius:50%;object-fit:cover}.profile-age{position:absolute;left:5%;top:34%;width:18%;height:5%;background:#fff}.identity-name{position:absolute;left:9.7%;top:39%;width:23%;height:7%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff;font-size:17pt;font-weight:700}.identity-name small{margin-top:1mm;font-size:9.5pt;font-weight:400;color:#60738b}.identity-values{position:absolute;left:60.4%;top:15.5%;width:30.2%;margin:0;background:#fff}.identity-values dd{height:8.8mm;margin:0;padding:2.1mm 2mm 0;text-align:right;font-weight:700;font-size:9pt;border-bottom:1px solid #dbe5eb}.completion{position:absolute;left:7.5%;top:52.3%;width:85%;height:27.7%;padding:2mm;display:grid;grid-template-columns:1fr 1fr;gap:4mm 7mm;background:#fff}.completion div{display:flex;flex-direction:column;justify-content:center;padding:3mm 6mm;border-radius:5mm;background:#f5fbf8}.completion strong{font-size:8pt;color:#60738b}.completion b{margin-top:2mm;text-align:right;font-size:10pt}
  .enrollment{position:absolute;left:8%;top:18%;width:84%;height:68%;display:flex;flex-direction:column;gap:5mm;background:#fff;overflow:hidden}.enrollment article{min-height:29mm;display:grid;grid-template-columns:12mm 1fr 42%;align-items:center;gap:4mm;padding:4mm 6mm;border-radius:6mm;background:#eff9eb}.enrollment i{display:flex;width:9mm;height:9mm;align-items:center;justify-content:center;border-radius:50%;background:#fff;font-style:normal;font-weight:700}.enrollment div{display:flex;flex-direction:column;gap:2mm}.enrollment span,.enrollment b{font-size:8pt}.enrollment strong{font-size:9pt}.enrollment b{text-align:right}
  .matrix{position:absolute;display:grid;grid-template-columns:repeat(4,1fr)}.matrix .fill{display:flex;align-items:center;justify-content:center;padding:1mm;background:#fff;text-align:center;font-size:8pt;line-height:1.2;overflow:hidden}.traits{left:27%;top:13.7%;width:65.2%;height:50.2%;grid-template-rows:repeat(11,1fr);gap:3mm 2.6mm}.traits .fill{color:#43a66f;font-size:14pt;font-weight:700}.trait-notes{position:absolute;left:9.6%;top:64.2%;width:80.8%;height:34.8%;display:grid;grid-template-rows:repeat(4,1fr);gap:2mm}.trait-notes article{padding:2.8mm 5mm;background:#eff8f5;border-radius:7mm;overflow:hidden}.trait-notes strong{display:block;margin-bottom:1.2mm;color:#07559f;font-size:8pt}.trait-notes p{margin:0;color:#07559f;font-size:7.5pt;line-height:1.3}.favorites{left:27%;top:15.5%;width:65.2%;height:47.8%;grid-template-rows:repeat(10,1fr);gap:4mm 2.7mm}
  .family-grid{position:absolute;left:10.7%;top:23.6%;width:82%;height:43.5%;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:17mm 8mm}.family-grid article{padding:4mm 5mm;background:#fff;border-radius:3mm;overflow:hidden}.family-grid strong{display:block;text-align:center;font-size:9pt}.family-grid p{font-size:8.5pt;line-height:1.4;color:#07559f}.learning-grid{position:absolute;left:9.3%;top:16.6%;width:82.5%;height:74.8%;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:12mm 9.7mm}.learning-grid article{padding:3mm 2mm;background:#fff;overflow:hidden}.learning-grid h3{margin:0 0 1mm;color:#07559f;font-size:9pt}.learning-grid p{min-height:27mm;margin:0;color:#07559f;font-size:8pt;line-height:1.3}
  .history-grid{position:absolute;left:7%;top:14.9%;width:86%;height:66.3%;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(3,1fr);gap:4mm 7mm}.history-card{padding:6mm;border-radius:7mm;overflow:hidden}.history-card.teacher{background:#e8f6fc}.history-card.parent{background:#fff0e7}.history-head{display:flex;justify-content:space-between;font-size:7.5pt;color:#2e78d6}.history-card.parent .history-head{color:#ff7849}.history-head time{color:#8aa0b9}.history-card h3{margin:3mm 0 2mm 20mm;font-size:10pt}.history-card p{margin:0;color:#26384c;font-size:8pt;line-height:1.35}
  .growth-table{position:absolute;left:7.6%;top:20.5%;width:84.8%;border-collapse:collapse;background:#fff;font-size:8.5pt}.growth-table td{height:10.7mm;padding:2.5mm 3mm;border:1px solid #dbe3e8}.height-chart,.weight-chart{position:absolute;top:46.9%;width:41%;height:26.5%;padding:11mm 5mm 5mm;background:#fff}.height-chart::before,.weight-chart::before{position:absolute;left:6mm;top:5mm;font-size:10pt;font-weight:700}.height-chart::before{content:"Өндрийн өсөлт"}.weight-chart::before{content:"Жингийн өсөлт"}.height-chart{left:6%}.weight-chart{left:50.7%}.height-chart svg,.weight-chart svg{width:100%;height:100%}svg text{fill:#60738b;font-size:7px}
  .section-title{position:absolute;z-index:2;background:#fff;color:#14385d;font-size:20pt;font-weight:700}.art-title{left:9.8%;top:12.1%;width:67%;height:5.5%}.album-title{left:6%;top:10.8%;width:82%;height:7%;padding:2mm 0 0 3%}.art-grid{position:absolute;left:13.5%;top:16.8%;width:72.5%;height:69.8%;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:12mm 14mm}.art-grid figure{margin:0;overflow:hidden;background:#fff;border-radius:5mm}.art-grid img{width:100%;height:87%;object-fit:contain}.art-grid figcaption{display:flex;justify-content:space-between;padding:2mm;text-align:center;font-size:8pt;color:#ff7849}.art-grid figcaption strong{color:#14385d}
  .album-grid{position:absolute;left:7%;top:16.8%;width:86%;height:71.8%;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(3,1fr);gap:7mm 6mm}.album-grid figure{position:relative;margin:0;overflow:hidden;border-radius:6mm;background:#fff}.album-grid figure:nth-child(1),.album-grid figure:nth-child(6){background:#eaf8fc}.album-grid figure:nth-child(2){background:#eef9f1}.album-grid figure:nth-child(3){background:#fff0e7}.album-grid figure:nth-child(4){background:#f1edff}.album-grid figure:nth-child(5){background:#fff8dc}.album-grid img{width:100%;height:82%;object-fit:contain}.album-grid figcaption{position:absolute;left:4mm;right:4mm;bottom:3mm;display:flex;justify-content:space-between;font-size:8pt;color:#60738b}.album-grid figcaption strong{color:#14385d}
  .letter-name{position:absolute;left:18%;top:17.4%;width:64%;height:4.5%;background:#fffdf4;text-align:center;color:#ff7849;font-size:13pt;font-weight:700}.letter-body{position:absolute;left:14%;top:26.5%;width:72%;height:47%;padding:4mm;background:#fff;color:#26384c;font-size:9.5pt;line-height:1.55;overflow:hidden}.letter-body p{margin:0 0 5mm}.letter-sign{position:absolute;left:14.8%;top:68.5%;width:70%;height:7%;background:#fff;color:#f06487;font-size:9pt;font-weight:700}.letter-date{position:absolute;right:14.8%;top:72.4%;width:27%;height:3.5%;background:#fff;color:#60738b;text-align:right;font-size:8.5pt}
  </style></head><body>${pages.join("")}</body></html>`;
}
