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
const backgrounds = new Map<number, string>();

/*
  ★ The designer's pages with their sample content taken out —
  `scripts/portfolio-backgrounds.ts` builds `clean-<n>.jpg` from `<n>.svg`
  (2026-10-24, the user: the sample child showed through, white boxes laid
  over it showed as extra squares, and Chromium framed every masked picture
  in a black hairline). Nothing here hides anything any more: each overlay
  writes into a place the background leaves empty.
*/
function templateAsset(page: number) {
  const fileName = `clean-${page}.jpg`;
  const candidates = [
    join(__dirname, "assets", "portfolio-template", fileName),
    join(process.cwd(), "src", "reports", "assets", "portfolio-template", fileName),
    join(process.cwd(), "apps", "api", "src", "reports", "assets", "portfolio-template", fileName),
  ];
  const asset = candidates.find(existsSync);
  if (!asset) throw new Error(`Portfolio template asset is missing: ${fileName}`);
  return asset;
}

function pageBackground(page: number) {
  let encoded = backgrounds.get(page);
  if (!encoded) {
    encoded = readFileSync(templateAsset(page)).toString("base64");
    backgrounds.set(page, encoded);
  }
  return encoded;
}

/*
  ★ Each background is written once, as a CSS class, however many pages use it
  — 2026-10-19 review. Inlined per page, a portfolio with ten artwork pages
  carried ten copies of the image through DevTools into the 2 GB worker.
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
        `.bg${template}{background-image:url("data:image/jpeg;base64,${pageBackground(template)}")}`,
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

/** Whole years from a birth date to a day — null without a valid date. */
function ageOn(dateOfBirth: Date | string, day: Date | string) {
  const born = new Date(dateOfBirth);
  const on = new Date(day);
  if (Number.isNaN(born.getTime()) || Number.isNaN(on.getTime())) return null;
  let years = on.getUTCFullYear() - born.getUTCFullYear();
  const before =
    on.getUTCMonth() < born.getUTCMonth() ||
    (on.getUTCMonth() === born.getUTCMonth() && on.getUTCDate() < born.getUTCDate());
  if (before) years -= 1;
  return years >= 0 ? years : null;
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

/** What a note says, as sentences — never «үеэр., Өөрийн» (2026-10-24). */
function noteText(item: PortfolioData["observations"][number]) {
  return statements(item.situation, item.childDid, item.childSaid, item.teacherComment);
}

/**
 * The card's kind: the note's own type for a teacher's («Ажиглалт»,
 * «Ярилцлага», «Бүтээл», …) and «Эцэг эхийн тэмдэглэл» for a family's — it
 * used to say «ЭЦЭГ ЭХИЙН ЯРИЛЦЛАГА» for every family note and «БАГШИЙН
 * АЖИГЛАЛТ» for every teacher's, a conversation or an artwork included.
 */
function noteKind(item: PortfolioData["observations"][number]) {
  return item.source === "PARENT" ? "Эцэг эхийн тэмдэглэл" : item.typeName || "Ажиглалт";
}

function observationCards(items: PortfolioData["observations"]) {
  return items
    .map((item) => {
      const source = item.source === "PARENT" ? "parent" : "teacher";
      const title =
        item.activityName && item.activityName !== item.typeName ? item.activityName : "";
      return `<article class="history-card ${source}"><div class="history-head"><strong>${esc(noteKind(item))}</strong><time>${formatDate(item.observedOn)}</time></div>${title ? `<h3>${esc(title)}</h3>` : ""}${paragraphs(noteText(item))}</article>`;
    })
    .join("");
}

/**
 * «Хүүхдийн түүх» — the notes in the order they were written, six a page.
 * ★ No empty cards: they used to be filed teacher left, family right, three
 * of each, so a page of teacher notes carried three blank family cards.
 * ★★ A note with nothing written in it is left out — a card with a date and
 * no words is not part of a child's story.
 */
function historyPages(data: PortfolioData) {
  const notes = data.observations.filter((item) => noteText(item));
  if (notes.length === 0) return [];
  return chunks(notes, 6).map((pageItems) =>
    exactPage(9, `<div class="history-grid">${observationCards(pageItems)}</div>`),
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
  return `<svg viewBox="0 0 300 130"><polyline points="${points.map((item) => `${item.x},${item.y}`).join(" ")}" fill="none" stroke="${color}" stroke-width="4"/>${points.map((item) => `<circle cx="${item.x}" cy="${item.y}" r="5" fill="${color}"/><text x="${item.x}" y="${item.y - 9}" text-anchor="middle">${item.value} ${unit}</text><text x="${item.x}" y="124" text-anchor="middle">${esc(item.label)}</text>`).join("")}</svg>`;
}

type VisualItem = {
  dataUri: string;
  caption?: string | null;
  takenAt?: Date | string | null;
  madeOn?: Date | string | null;
  age?: number | null;
};

/** A picture with the category it is filed under — a page may hold several. */
type FiledItem = VisualItem & { label: string };

/**
 * ★ Categories share a page (2026-10-24): one page per category printed
 * thirteen pages for thirteen single photographs. A category still starts in
 * order and keeps its pictures together; a page holding more than one names
 * them all in its title, and each picture says which it is.
 */
function filedPages(groups: [string, VisualItem[]][], perPage: number) {
  const items: FiledItem[] = groups.flatMap(([label, list]) =>
    byAgeRoundRobin(list).map((item) => ({ ...item, label })),
  );
  return chunks(items, perPage).map((pageItems) => ({
    title: [...new Set(pageItems.map((item) => item.label))].join(" · "),
    mixed: new Set(pageItems.map((item) => item.label)).size > 1,
    items: pageItems,
  }));
}

function artGrid(items: FiledItem[], mixed: boolean) {
  // Only the works there are — an empty slot drew a blank card (2026-10-24).
  return `<div class="art-grid">${items
    .map((item) => {
      const caption = [
        mixed ? item.label : "",
        item.age ? `${item.age} нас` : "",
        item.madeOn ? formatDate(item.madeOn) : "",
        item.caption || "",
      ].filter(Boolean);
      return `<figure><div class="frame"><img src="${item.dataUri}" alt="${esc(item.label)}"></div><figcaption>${esc(caption.join(" · "))}</figcaption></figure>`;
    })
    .join("")}</div>`;
}

function albumGrid(items: (VisualItem & { label?: string })[], mixed = false) {
  return `<div class="album-grid">${items
    .map((item) => {
      const caption = item.caption || (item.takenAt ? formatDate(item.takenAt) : "");
      // The category once — a caption often already names it («Цээж зураг (4 нас)»).
      const named = mixed && item.label && !caption.includes(item.label);
      const right = [named ? item.label : "", caption].filter(Boolean).join(" · ");
      return `<figure><img src="${item.dataUri}" alt=""><figcaption><strong>${item.age ? `${item.age} нас` : ""}</strong><span>${esc(right)}</span></figcaption></figure>`;
    })
    .join("")}</div>`;
}

function artworkPages(data: PortfolioData) {
  const actual = [...new Set(data.artworks.map((item) => item.type))];
  const types = [
    ...ARTWORK_TYPES.filter((type) => actual.includes(type)),
    ...actual.filter((type) => !ARTWORK_TYPES.includes(type as (typeof ARTWORK_TYPES)[number])),
  ];
  const groups = types.map(
    (type) => [type, data.artworks.filter((item) => item.type === type)] as [string, VisualItem[]],
  );
  return filedPages(groups, 4).map((page) =>
    exactPage(
      11,
      `<div class="section-title art-title"${page.mixed ? ' style="--title-size:13pt"' : ""}>${esc(page.title)}</div>${artGrid(page.items, page.mixed)}`,
    ),
  );
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
  return filedPages([...grouped], 6).map((page) =>
    exactPage(
      12,
      `<div class="section-title album-title"${page.mixed ? ' style="--title-size:13pt"' : ""}>${esc(page.title)}</div>${albumGrid(page.items, page.mixed)}`,
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
  /*
    ★ The child's age on the day the portfolio is made, from the birth date
    (2026-10-24). It was the last age record's, else 5: a four-year-old with
    no age records printed «5 нас» on the cover.
  */
  const age = ageOn(data.child.dateOfBirth, data.generatedAt);
  const notes = data.observations.filter((item) => noteText(item));
  /*
    «Миний тухай» is «Бүрэн» only when what it asks is filled in — it said
    «Бүрэн» for any record, with the clan name and blood type empty.
  */
  const aboutMeComplete = [
    data.aboutMe?.clanName,
    data.aboutMe?.birthplace,
    data.aboutMe?.bloodType,
    data.aboutMe?.eyeColor,
  ].every((value) => typeof value === "string" && value.trim());
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
      `<div class="cover-card"><strong>${esc(fullName.toUpperCase())}</strong><span>${esc([data.group?.name, data.schoolYear?.name].filter(Boolean).join(" · "))}</span><b>${esc([age === null ? "" : `${age} нас`, data.kindergarten.name].filter(Boolean).join(" · "))}</b></div>`,
    ),
    exactPage(
      2,
      `${data.child.photoDataUri ? `<img class="child-photo" src="${data.child.photoDataUri}" alt="">` : ""}<div class="identity-name"><strong>${esc(data.child.firstName)}</strong>${age === null ? "" : `<small>${age} нас</small>`}${data.group?.name ? `<span class="pill">${esc(data.group.name)}</span>` : ""}</div><dl class="identity-values">${[data.aboutMe?.clanName, fullName, formatDate(data.child.dateOfBirth), data.child.sex === "FEMALE" ? "Эмэгтэй" : "Эрэгтэй", `${yearAnimal.name} жил`, zodiac.name, data.aboutMe?.bloodType, data.group?.name].map((value) => `<dd>${esc(value)}</dd>`).join("")}</dl><b class="figure about">${aboutMeComplete ? "Бүрэн" : "Дутуу"}</b><b class="figure ages">${data.ageProfiles.length}/4 нас</b><b class="figure notes">${notes.length} тэмдэглэл</b><b class="figure photos">${photoCount} зураг</b>`,
    ),
    exactPage(
      3,
      `<div class="enrollment">${data.enrollments.map((item, index) => `<article><i>${index + 1}</i><div><strong>${esc(item.kindergartenName)}</strong><span><b>${esc(item.groupName)}</b> · ${esc(item.schoolYearName)}</span><small>${formatDate(item.startedOn)} - ${item.endedOn ? formatDate(item.endedOn) : "Одоо"}</small></div></article>`).join("")}</div>`,
    ),
    exactPage(
      4,
      `${matrix(traitCells, "traits")}${AGES.map((year, index) => `<article class="trait-note n${index}"><strong>${year} нас</strong><p>${esc(profile(data, year)?.characterObservation || "")}</p></article>`).join("")}`,
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
      AGES.map((year, index) => {
        const item = profile(data, year);
        // No «ам бүл -» when the size is not known (2026-10-24).
        const size = item?.familySize
          ? `<strong>Манай гэр бүл ам бүл ${item.familySize}</strong>`
          : "";
        return `<article class="family-card c${index}">${size}<p>${esc(statements(item?.familyDescription, item?.familyMembers, list(item?.familyMemberTypes), item?.familyMemories))}</p></article>`;
      }).join(""),
    ),
    exactPage(
      7,
      `${AGES.map((year, index) => {
        const item = profile(data, year);
        const notes = item?.kindergartenSkillNotes;
        return `<article class="learning-card c${index}"><h3>Танин мэдэхүй</h3><p>${esc(statements(item?.learningInterest, item?.kindergartenOtherSkill, domainNote(notes, "Танин мэдэхүй")))}</p><h3>Нийгэмшихүй</h3><p>${esc(statements(item?.kindergartenSkills, domainNote(notes, "Нийгэмшихүй")))}</p><h3>Бие бялдар</h3><p>${esc(statements(item?.newSkills, domainNote(notes, "Бие бялдар")))}</p></article>`;
      }).join("")}`,
    ),
    exactPage(
      8,
      `${AGES.map((year, index) => {
        const item = profile(data, year);
        // Each ticked question under its own domain; «Бие бялдар» used to
        // reprint `familyDescription`, which page 6 already shows.
        const skills = item?.familyLearningSkills;
        const notes = item?.familyLearningNotes;
        return `<article class="learning-card c${index}"><h3>Танин мэдэхүй</h3><p>${esc(statements(familySkills(year, skills, "Танин мэдэхүй"), unplacedFamilySkills(year, skills), item?.familyLearningOther, domainNote(notes, "Танин мэдэхүй")))}</p><h3>Нийгэмшихүй</h3><p>${esc(statements(familySkills(year, skills, "Нийгэмшихүй"), domainNote(notes, "Нийгэмшихүй")))}</p><h3>Бие бялдар</h3><p>${esc(statements(familySkills(year, skills, "Бие бялдар"), domainNote(notes, "Бие бялдар")))}</p></article>`;
      }).join("")}`,
    ),
    ...historyPages(data),
    exactPage(
      10,
      `<table class="growth-table"><thead><tr><th>Огноо</th><th>Өндөр</th><th>Жин</th></tr></thead><tbody>${growthRows.map((item) => (item ? `<tr><td>${formatDate(item.measuredOn)}</td><td>${measured(item.heightCm) ? `${esc(item.heightCm)} см` : ""}</td><td>${measured(item.weightKg) ? `${esc(item.weightKg)} кг` : ""}</td></tr>` : "<tr><td></td><td></td><td></td></tr>")).join("")}</tbody></table><div class="height-chart">${chart(height, "#317bd6", "см")}</div><div class="weight-chart">${chart(weight, "#43a66f", "кг")}</div>`,
    ),
    ...artworkPages(data),
    ...albumPages(data),
    ...teacherPhotoPages(data),
    exactPage(
      19,
      `<div class="letter-name">Бяцхан шавь ${esc(data.child.firstName)} минь,</div><div class="letter-body">${data.teacherLetter ? paragraphs(data.teacherLetter) : ""}</div><div class="letter-sign"><strong>Хайртай шүү, бяцхан шавь минь.</strong><span>${esc(teacherSignature(data))}</span></div><div class="letter-date">${formatDate(data.generatedAt)}</div>`,
    ),
  ];

  return `<!doctype html><html lang="mn"><head><meta charset="utf-8"><title>${esc(fullName)} - хүүхдийн хөгжлийн хувийн хавтас</title><style>
  ${fontFaceCss()}
  ${backgroundCss(pages)}
  /*
    ★ Every place below is measured on the designer's page in CSS pixels
    (A4 = 794 × 1123 px), and every background is clean
    (scripts/portfolio-backgrounds.ts): nothing here is a white box hiding
    the sample — the overlays are transparent and write into empty places.
  */
  @page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;font-family:"Noto Sans",sans-serif;color:#14385d}.sheet{position:relative;width:210mm;height:297mm;overflow:hidden;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto}.page-bg{position:absolute;inset:0;background-size:100% 100%;background-repeat:no-repeat}body{counter-reset:sheet}.sheet{counter-increment:sheet}.sheet::after{content:counter(sheet);position:absolute;z-index:3;left:0;right:0;bottom:5mm;text-align:center;font-size:8pt;color:#8aa0b9}.t1::after{content:none}.overlay{position:absolute;inset:0}.overlay>*{position:absolute}
  .cover-card{left:108px;top:166px;width:580px;height:94px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;text-align:center}.cover-card strong{font-size:16pt;color:#163a63}.cover-card span{color:#60738b;font-size:10pt}.cover-card b{color:#2e78d6;font-size:8.5pt}
  .child-photo{left:57px;top:162px;width:235px;height:180px;border-radius:18px;object-fit:cover}.identity-name{left:55px;top:350px;width:247px;height:112px;display:flex;flex-direction:column;align-items:center;gap:3px}.identity-name strong{font-size:16pt}.identity-name small{font-size:9pt;color:#60738b}.identity-name .pill{margin-top:8px;padding:5px 22px;border-radius:999px;background:#dcecfb;color:#2e78d6;font-size:8pt;font-weight:700;text-transform:uppercase}.identity-values{left:468px;top:176px;width:247px;margin:0}.identity-values dd{height:33px;margin:0;display:flex;align-items:center;justify-content:flex-end;font-weight:700;font-size:9pt;white-space:nowrap;overflow:hidden}.figure{width:96px;height:27px;display:flex;align-items:center;justify-content:flex-end;font-size:8.5pt;font-weight:400;color:#60738b}.figure.about{left:280px;top:595px}.figure.notes{left:280px;top:651px}.figure.ages{left:608px;top:595px}.figure.photos{left:608px;top:651px}
  .enrollment{left:72px;top:86px;width:676px;height:960px;display:flex;flex-direction:column;gap:16px;overflow:hidden}.enrollment article{flex:none;height:94px;display:flex;align-items:center;gap:26px;padding:0 24px;border-radius:18px;background:#eff9eb}.enrollment i{flex:none;display:flex;width:42px;height:42px;align-items:center;justify-content:center;border-radius:50%;background:#63bf60;color:#fff;font-style:normal;font-weight:700}.enrollment div{display:flex;flex-direction:column;gap:2px}.enrollment strong{font-size:10.5pt}.enrollment span{font-size:9.5pt}.enrollment small{font-size:8pt;color:#8aa0b9}
  .matrix{display:grid;grid-template-columns:repeat(4,1fr)}.matrix .fill{display:flex;align-items:center;justify-content:center;padding:2px 4px;text-align:center;font-size:8pt;line-height:1.2;overflow:hidden}.traits{left:215px;top:125px;width:520px;height:563px;grid-template-rows:repeat(11,1fr);column-gap:10px;row-gap:12px}.traits .fill{color:#43a66f;font-size:14pt;font-weight:700}.favorites{left:215px;top:173px;width:520px;height:537px;grid-template-rows:repeat(10,1fr);column-gap:10px;row-gap:14px}
  .trait-note{left:77px;width:636px;height:86px;padding:10px 20px;overflow:hidden}.trait-note.n0{top:712px}.trait-note.n1{top:815px}.trait-note.n2{top:918px}.trait-note.n3{top:1022px}.trait-note strong{display:block;margin-bottom:3px;color:#07559f;font-size:8.5pt}.trait-note p{margin:0;color:#07559f;font-size:8pt;line-height:1.35}
  .family-card{width:275px;height:130px;padding:10px 16px;overflow:hidden;text-align:center}.family-card.c0{left:100px;top:258px}.family-card.c1{left:448px;top:258px}.family-card.c2{left:106px;top:571px}.family-card.c3{left:457px;top:571px}.family-card strong{display:block;font-size:9pt;color:#07559f}.family-card p{margin:6px 0 0;font-size:8.5pt;line-height:1.4;color:#07559f}
  .learning-card{width:268px;height:356px;padding:8px 6px;overflow:hidden}.learning-card.c0{left:84px;top:190px}.learning-card.c1{left:431px;top:190px}.learning-card.c2{left:84px;top:676px}.learning-card.c3{left:437px;top:680px}.learning-card h3{margin:0 0 2px;color:#07559f;font-size:9pt}.learning-card p{min-height:92px;margin:0 0 6px;color:#07559f;font-size:8pt;line-height:1.3}
  .history-grid{left:55px;top:165px;width:685px;height:750px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(3,238px);gap:18px 26px}.history-card{padding:18px 20px;border-radius:24px;overflow:hidden}.history-card.teacher{background:#e8f6fc}.history-card.parent{background:#fff0e7}.history-head{display:flex;justify-content:space-between;gap:8px;font-size:7.5pt;color:#2e78d6;text-transform:uppercase}.history-card.parent .history-head{color:#ff7849}.history-head time{color:#8aa0b9}.history-card h3{margin:8px 0 4px;font-size:10pt}.history-card p{margin:6px 0 0;color:#26384c;font-size:8pt;line-height:1.4}
  .growth-table{left:62px;top:190px;width:671px;border-collapse:collapse;table-layout:fixed;font-size:8.5pt}.growth-table th,.growth-table td{height:40px;padding:0 12px;text-align:left;font-weight:400}.growth-table th{color:#07559f;font-weight:700}.growth-table th:nth-child(1){width:270px}.growth-table th:nth-child(2){width:205px}.height-chart,.weight-chart{top:574px;width:308px;height:236px}.height-chart{left:60px}.weight-chart{left:412px}.height-chart svg,.weight-chart svg{width:100%;height:100%}svg text{fill:#60738b;font-size:7px}
  .section-title{color:#14385d;font-size:20pt;font-weight:700}.art-title{left:78px;top:128px;width:640px;height:56px;display:flex;align-items:center;font-size:var(--title-size,20pt);line-height:1.15;overflow:hidden}.album-title{left:42px;top:128px;width:690px;height:56px;display:flex;align-items:center;font-size:var(--title-size,20pt);font-weight:400;line-height:1.15;overflow:hidden}
  .art-grid{left:75px;top:190px;width:660px;height:880px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(2,421px);gap:18px 8px}.art-grid figure{margin:0;display:flex;flex-direction:column}.art-grid .frame{flex:1;display:flex;align-items:center;justify-content:center;padding:14px;border-radius:20px;background:#fff8dc}.art-grid img{max-width:100%;max-height:100%;object-fit:contain}.art-grid figcaption{height:24px;display:flex;align-items:center;justify-content:center;font-size:7.5pt;font-weight:700;color:#ff7849;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .album-grid{left:57px;top:190px;width:680px;height:805px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(3,250px);gap:27px 27px}.album-grid figure{position:relative;margin:0;padding:14px 14px 36px;overflow:hidden;border-radius:20px;background:#eaf8fc}.album-grid figure:nth-child(2){background:#eef9f1}.album-grid figure:nth-child(3){background:#fff0e7}.album-grid figure:nth-child(4){background:#f1edff}.album-grid figure:nth-child(5){background:#fff8dc}.album-grid img{width:100%;height:100%;object-fit:contain}.album-grid figcaption{position:absolute;left:16px;right:16px;bottom:10px;display:flex;justify-content:space-between;gap:8px;font-size:8pt;color:#60738b}.album-grid figcaption strong{flex:none;white-space:nowrap;color:#14385d}.album-grid figcaption span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .letter-name{left:195px;top:200px;width:405px;text-align:center;color:#ff7849;font-size:13pt;font-weight:700}.letter-body{left:115px;top:300px;width:570px;height:470px;color:#26384c;font-size:10pt;line-height:1.6;overflow:hidden}.letter-body p{margin:0 0 14px}.letter-sign{left:117px;top:786px;width:380px;display:flex;flex-direction:column;gap:3px}.letter-sign strong{color:#f06487;font-size:10pt}.letter-sign span{color:#60738b;font-size:9pt}.letter-date{right:118px;top:820px;width:200px;text-align:right;color:#60738b;font-size:9pt}
  </style></head><body>${pages.join("")}</body></html>`;
}
