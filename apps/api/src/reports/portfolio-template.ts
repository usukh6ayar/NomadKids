import {
  ageInYears,
  birthFacts,
  YEAR_ANIMALS,
  ZODIAC_SIGNS,
} from "@kinder/contracts";
import { baseCss, esc, formatDate, masthead, paragraphs, reportChrome } from "./template-utils";

export interface PortfolioAgeProfile {
  age: number;
  favoriteColor?: string | null;
  favoriteFood?: string | null;
  favoriteToy?: string | null;
  favoriteBook?: string | null;
  favoriteSong?: string | null;
  favoriteStory?: string | null;
  favoriteActivity?: string | null;
  favoriteClothes?: string | null;
  favoriteMovie?: string | null;
  favoriteTreat?: string | null;
  personality?: string | null;
  emotionalTraits?: string | null;
  familyMembers?: string | null;
  dream?: string | null;
  learningInterest?: string | null;
  newSkills?: string | null;
  kindergartenSkills?: string[];
  kindergartenSkillNotes?: unknown;
  kindergartenOtherSkill?: string | null;
  familyLearningSkills?: string[];
  familyLearningNotes?: unknown;
  familyLearningOther?: string | null;
  characterTraits?: string[];
  characterObservation?: string | null;
  familyMemberTypes?: string[];
  familySize?: number | null;
  familyDescription?: string | null;
  familyMemories?: unknown;
}

export interface PortfolioData {
  child: {
    lastName: string;
    firstName: string;
    dateOfBirth: Date | string;
    sex: string;
    photoDataUri?: string | null;
  };
  kindergarten: { name: string; logoDataUri?: string | null };
  group?: { name: string } | null;
  schoolYear?: { name: string } | null;
  enrollments: {
    kindergartenName: string;
    groupName: string;
    schoolYearName: string;
    startedOn: Date | string;
    endedOn?: Date | string | null;
    status: string;
  }[];
  aboutMe?: {
    introduction?: string | null;
    nameMeaning?: string | null;
    memorableSayings?: string | null;
    dream?: string | null;
    distinguishingTraits?: string | null;
    clanName?: string | null;
    nickname?: string | null;
    birthplace?: string | null;
    bloodType?: string | null;
    eyeColor?: string | null;
    yearAnimalCode?: string | null;
    zodiacCode?: string | null;
    heightCm?: unknown;
    weightKg?: unknown;
    recordedOn?: Date | string | null;
  } | null;
  ageProfiles: PortfolioAgeProfile[];
  birthdayNotes: { age: number; note?: string | null }[];
  artworkComparisons: {
    conclusion: string;
    earlierDataUri?: string | null;
    laterDataUri?: string | null;
    earlierTakenAt?: Date | string | null;
    laterTakenAt?: Date | string | null;
  }[];
  photoAlbums: {
    age: number;
    photos: {
      dataUri: string;
      caption?: string | null;
      takenAt?: Date | string | null;
      categoryLabel?: string | null;
    }[];
  }[];
  generatedAt: Date;
  omittedPhotoCount?: number;
}

const PORTFOLIO_AGES = [2, 3, 4, 5] as const;

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function infoRows(rows: (readonly [string, unknown])[]) {
  return rows
    .filter(([, value]) => isPresent(value))
    .map(
      ([label, value]) => `
        <div class="info-row">
          <dt>${esc(label)}</dt>
          <dd>${esc(value)}</dd>
        </div>`,
    )
    .join("");
}

function joined(values: unknown): string | null {
  if (!Array.isArray(values)) return null;
  const result = values
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim())
    .join(", ");
  return result || null;
}

function joinedNotes(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return joined(Object.values(value));
}

function memoryTitles(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  return joined(
    value.map((memory) =>
      memory && typeof memory === "object" && "title" in memory
        ? (memory as { title?: unknown }).title
        : null,
    ),
  );
}

type CompareRow = {
  label: string;
  value: (profile: PortfolioAgeProfile) => string | null | undefined;
};

function comparisonTable(
  title: string,
  rows: CompareRow[],
  profiles: PortfolioAgeProfile[],
): string {
  const byAge = new Map(profiles.map((profile) => [profile.age, profile]));
  const usefulRows = rows.filter((row) =>
    PORTFOLIO_AGES.some((age) => {
      const profile = byAge.get(age);
      return profile ? isPresent(row.value(profile)) : false;
    }),
  );
  if (usefulRows.length === 0) return "";

  return `
    <section class="age-table-card">
      <h3>${esc(title)}</h3>
      <table class="age-table">
        <thead><tr><th>Харьцуулах мэдээлэл</th>${PORTFOLIO_AGES.map((age) => `<th>${age} нас</th>`).join("")}</tr></thead>
        <tbody>
          ${usefulRows
            .map(
              (row) => `<tr>
                <th>${esc(row.label)}</th>
                ${PORTFOLIO_AGES.map((age) => {
                  const profile = byAge.get(age);
                  const value = profile ? row.value(profile) : null;
                  return `<td>${isPresent(value) ? esc(value) : `<span class="empty-cell">-</span>`}</td>`;
                }).join("")}
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>`;
}

export function renderPortfolioHtml(data: PortfolioData): string {
  const fullName = `${data.child.lastName} ${data.child.firstName}`;
  const age = ageInYears(data.child.dateOfBirth);
  const computedBirthFacts = birthFacts(data.child.dateOfBirth);
  const zodiac =
    ZODIAC_SIGNS.find((item) => item.code === data.aboutMe?.zodiacCode) ??
    computedBirthFacts.zodiac;
  const yearAnimalOverride = YEAR_ANIMALS.find(
    (item) => item.code === data.aboutMe?.yearAnimalCode,
  );
  const yearAnimal = yearAnimalOverride ?? computedBirthFacts.yearAnimal;
  const sexLabel =
    data.child.sex === "FEMALE" ? "Эмэгтэй" : data.child.sex === "MALE" ? "Эрэгтэй" : null;

  const identityRows = infoRows([
    ["Ургийн овог", data.aboutMe?.clanName],
    ["Овог, нэр", fullName],
    ["Дууддаг нэр", data.aboutMe?.nickname],
    ["Төрсөн огноо", formatDate(data.child.dateOfBirth)],
    ["Төрсөн газар", data.aboutMe?.birthplace],
    ["Нас", `${age} нас`],
    ["Хүйс", sexLabel],
    ["Өрнийн орд", zodiac.name],
    ["Монгол жил", `${yearAnimal.name} жил`],
    ["Цусны бүлэг", data.aboutMe?.bloodType],
    ["Нүдний өнгө", data.aboutMe?.eyeColor],
    ["Өндөр", data.aboutMe?.heightCm ? `${String(data.aboutMe.heightCm)} см` : null],
    ["Жин", data.aboutMe?.weightKg ? `${String(data.aboutMe.weightKg)} кг` : null],
    ["Хэмжилтийн огноо", data.aboutMe?.recordedOn ? formatDate(data.aboutMe.recordedOn) : null],
  ]);

  const enrollmentBlocks = data.enrollments
    .map(
      (enrollment, index) => `
        <article class="enrollment-card">
          <span class="timeline-number">${index + 1}</span>
          <div>
            <h3>${esc(enrollment.kindergartenName)}</h3>
            <p><strong>${esc(enrollment.groupName)}</strong> · ${esc(enrollment.schoolYearName)}</p>
            <p class="meta">${formatDate(enrollment.startedOn)} - ${enrollment.endedOn ? formatDate(enrollment.endedOn) : "Одоо"}</p>
          </div>
        </article>`,
    )
    .join("");

  const aboutRows = infoRows([
    ["Нэрний утга", data.aboutMe?.nameMeaning],
    ["Миний мөрөөдөл", data.aboutMe?.dream],
    ["Миний онцлог", data.aboutMe?.distinguishingTraits],
    ["Сонирхолтой хэлсэн үг", data.aboutMe?.memorableSayings],
  ]);

  const birthdayBlocks = data.birthdayNotes
    .filter((note) => isPresent(note.note))
    .map(
      (note) => `
        <article class="birthday-card">
          <span>${note.age}</span>
          <div><h3>${note.age} насны төрсөн өдрийн дурсамж</h3>${paragraphs(note.note)}</div>
        </article>`,
    )
    .join("");

  const ageTables = [
    comparisonTable(
      "Миний дуртай бүх зүйлс",
      [
        ["Тоглоом", "favoriteToy"],
        ["Дуу", "favoriteSong"],
        ["Хувцас", "favoriteClothes"],
        ["Үлгэр", "favoriteStory"],
        ["Хүүхэлдэйн кино / кино", "favoriteMovie"],
        ["Амттан", "favoriteTreat"],
        ["Өнгө", "favoriteColor"],
        ["Ном", "favoriteBook"],
        ["Хийх дуртай зүйл", "favoriteActivity"],
        ["Хоол", "favoriteFood"],
      ].map(([label, key]) => ({
        label: label!,
        value: (profile: PortfolioAgeProfile) =>
          profile[key as keyof PortfolioAgeProfile] as string | null | undefined,
      })),
      data.ageProfiles,
    ),
    comparisonTable(
      "Миний цэцэрлэгтээ сурсан зүйлс",
      [
        { label: "Сонгосон чадварууд", value: (profile) => joined(profile.kindergartenSkills) },
        { label: "Нэмэлт тайлбар", value: (profile) => joinedNotes(profile.kindergartenSkillNotes) },
        {
          label: "Өөр сурсан зүйл",
          value: (profile) => profile.kindergartenOtherSkill ?? profile.newSkills,
        },
        { label: "Сурах сонирхол", value: (profile) => profile.learningInterest },
      ],
      data.ageProfiles,
    ),
    comparisonTable(
      "Миний гэр бүлээсээ суралцсан зүйлс",
      [
        { label: "Сонгосон чадварууд", value: (profile) => joined(profile.familyLearningSkills) },
        { label: "Нэмэлт тайлбар", value: (profile) => joinedNotes(profile.familyLearningNotes) },
        {
          label: "Өөр сурсан зүйл",
          value: (profile) => profile.familyLearningOther ?? profile.familyMembers,
        },
      ],
      data.ageProfiles,
    ),
    comparisonTable(
      "Миний зан араншин",
      [
        { label: "Зан араншингийн ажиглалт", value: (profile) => joined(profile.characterTraits) },
        {
          label: "Тухайн насны зан араншин",
          value: (profile) =>
            profile.characterObservation ??
            joined([profile.personality, profile.emotionalTraits].filter(Boolean)),
        },
        { label: "Тухайн насны мөрөөдөл", value: (profile) => profile.dream },
      ],
      data.ageProfiles,
    ),
    comparisonTable(
      "Миний гэр бүл",
      [
        {
          label: "Ам бүлийн тоо",
          value: (profile) => (profile.familySize ? String(profile.familySize) : null),
        },
        { label: "Гэр бүлийн гишүүд", value: (profile) => joined(profile.familyMemberTypes) },
        { label: "Хамтдаа хийх дуртай зүйлс", value: (profile) => profile.familyDescription },
        { label: "Гэр бүлийн дурсамж", value: (profile) => memoryTitles(profile.familyMemories) },
      ],
      data.ageProfiles,
    ),
  ]
    .filter(Boolean)
    .join("");

  const comparisonBlocks = data.artworkComparisons
    .map(
      (comparison, index) => `
        <article class="artwork-card">
          <div class="card-heading"><span>${index + 1}</span><h3>Бүтээлийн ахицын цуваа</h3></div>
          <div class="art-pair">
            ${
              comparison.earlierDataUri
                ? `<figure><img src="${comparison.earlierDataUri}" alt="Өмнөх бүтээл"><figcaption>${comparison.earlierTakenAt ? formatDate(comparison.earlierTakenAt) : "Огноогүй"}</figcaption></figure>`
                : `<figure class="missing"><span>Өмнөх зураг хавсаргаагүй</span></figure>`
            }
            <div class="progress-arrow">→</div>
            ${
              comparison.laterDataUri
                ? `<figure><img src="${comparison.laterDataUri}" alt="Дараагийн бүтээл"><figcaption>${comparison.laterTakenAt ? formatDate(comparison.laterTakenAt) : "Огноогүй"}</figcaption></figure>`
                : `<figure class="missing"><span>Дараагийн зураг хавсаргаагүй</span></figure>`
            }
          </div>
          <div class="conclusion"><strong>Ахицын дүгнэлт</strong>${paragraphs(comparison.conclusion)}</div>
        </article>`,
    )
    .join("");

  const albumsByAge = new Map(data.photoAlbums.map((album) => [album.age, album.photos]));
  const albumBlocks = PORTFOLIO_AGES.map((albumAge) => {
    const photos = albumsByAge.get(albumAge) ?? [];
    return `
      <article class="album-age-card">
        <div class="album-age-heading"><strong>${albumAge}</strong><span>нас</span></div>
        ${
          photos.length
            ? `<div class="album-photos album-count-${photos.length}">
                ${photos
                  .map(
                    (photo) => `<figure>
                      <img src="${photo.dataUri}" alt="${albumAge} насны цомгийн зураг">
                      <figcaption>
                        ${photo.categoryLabel ? `<strong>${esc(photo.categoryLabel)}</strong>` : ""}
                        ${photo.caption ? `<span>${esc(photo.caption)}</span>` : ""}
                        ${photo.takenAt ? `<time>${formatDate(photo.takenAt)}</time>` : ""}
                      </figcaption>
                    </figure>`,
                  )
                  .join("")}
              </div>`
            : `<div class="album-empty">Нас заасан цомгийн зураг хараахан алга.</div>`
        }
      </article>`;
  }).join("");

  const attendedNames = [...new Set(data.enrollments.map((item) => item.kindergartenName))];

  return `<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8">
<title>${esc(fullName)} - хүүхдийн хувийн хавтас</title>
<style>
${baseCss()}

  :root {
    --yellow: #ffd35a;
    --yellow-soft: #fff8d7;
    --blue: #28a9e2;
    --blue-soft: #e9f8ff;
    --green: #65bd61;
    --green-soft: #eef9e9;
    --orange: #f7943d;
    --orange-soft: #fff1df;
    --pink: #f06487;
    --pink-soft: #fff0f4;
    --ink: #253252;
  }

  body { color: var(--ink); background: white; }
  h2 { border: 0; color: #07559f; font-size: 20pt; margin-bottom: 7mm; }
  h3 { color: var(--ink); }
  p { text-align: left; }
  .page-section { break-before: page; position: relative; }
  .section-heading { display: flex; align-items: center; gap: 4mm; margin-bottom: 7mm; }
  .section-heading h2 { margin: 0; }
  .section-icon {
    display: grid; place-items: center; width: 13mm; height: 13mm; border-radius: 50%;
    color: white; background: var(--blue); font-size: 15pt; font-weight: 700;
  }

  .cover {
    height: 235mm; padding: 10mm 12mm; text-align: center; overflow: hidden; break-inside: avoid;
    border-radius: 9mm; background:
      radial-gradient(circle at 12% 12%, #fff2a7 0 20mm, transparent 20.5mm),
      radial-gradient(circle at 88% 24%, #fff2a7 0 16mm, transparent 16.5mm),
      linear-gradient(155deg, #ffd35a 0%, #ffc839 62%, #ffdc72 100%);
  }
  .cover .masthead { justify-content: center; margin-bottom: 7mm; }
  .cover .masthead img { width: 25mm; height: 25mm; }
  .cover-kicker { color: #0860a8; font-size: 11pt; font-weight: 700; letter-spacing: .8px; }
  .cover-title { margin: 3mm 0 7mm; color: white; font-size: 31pt; line-height: 1.2; text-shadow: 0 2px 0 #e49e00; }
  .portrait-wrap {
    display: grid; place-items: center; width: 68mm; height: 68mm; margin: 0 auto 6mm;
    border: 4mm solid rgba(255,255,255,.72); border-radius: 50%; background: white;
  }
  .portrait-wrap img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
  .portrait-placeholder { color: #8fc6dc; font-size: 42pt; }
  .cover-name-card {
    margin: 0 auto; max-width: 142mm; padding: 5mm 10mm; border-radius: 9mm;
    background: white; border: 1.5mm solid #a8d47f;
  }
  .cover-name { color: var(--pink); font-size: 26pt; font-weight: 700; line-height: 1.25; }
  .cover-meta { margin-top: 3mm; color: #52627f; font-size: 10pt; }
  .age-pill { display: inline-flex; gap: 2mm; margin-top: 4mm; padding: 2mm 6mm; border-radius: 999px; color: white; background: var(--pink); font-weight: 700; }
  .cover-schools { margin-top: 4mm; color: #52627f; font-size: 8.5pt; }
  .cover-wave { margin: 6mm -12mm -10mm; height: 20mm; background: linear-gradient(165deg, transparent 0 32%, #49bced 33% 54%, #b9eaff 55% 69%, #fff 70%); }

  .identity-layout { display: grid; grid-template-columns: 55mm 1fr; gap: 7mm; align-items: start; }
  .profile-card { padding: 6mm; border-radius: 7mm; background: var(--blue-soft); text-align: center; }
  .profile-card img { width: 42mm; height: 51mm; object-fit: cover; border-radius: 5mm; }
  .profile-card .placeholder { display: grid; place-items: center; width: 42mm; height: 51mm; margin: auto; border-radius: 5mm; background: white; color: #8fc6dc; font-size: 30pt; }
  .profile-card strong { display: block; margin-top: 3mm; color: #07559f; }
  .info-panel { padding: 6mm; border-radius: 7mm; background: var(--yellow-soft); }
  .info-list { margin: 0; display: block; }
  .info-row { display: grid; grid-template-columns: 42mm 1fr; gap: 3mm; padding: 2.2mm 3mm; border-bottom: 1px dashed #d2d8df; }
  .info-row:last-child { border-bottom: 0; }
  .info-row dt { color: #53627a; }
  .info-row dd { color: var(--ink); font-weight: 700; }
  .subheading { margin: 8mm 0 4mm; color: #07559f; font-size: 13pt; }
  .enrollment-card { display: grid; grid-template-columns: 14mm 1fr; gap: 4mm; break-inside: avoid; margin-bottom: 4mm; padding: 4mm; border-radius: 5mm; background: var(--green-soft); }
  .timeline-number { display: grid; place-items: center; width: 11mm; height: 11mm; border-radius: 50%; color: white; background: var(--green); font-weight: 700; }
  .enrollment-card h3, .enrollment-card p { margin: 0; }
  .about-card { break-inside: avoid; margin-top: 6mm; padding: 6mm; border-radius: 7mm; background: var(--pink-soft); }
  .about-card h3 { color: var(--pink); }
  .birthday-card { display: grid; grid-template-columns: 16mm 1fr; gap: 4mm; break-inside: avoid; margin-top: 4mm; padding: 5mm; border-radius: 6mm; background: var(--orange-soft); }
  .birthday-card > span { display: grid; place-items: center; width: 13mm; height: 13mm; border-radius: 50%; color: white; background: var(--orange); font-weight: 700; }
  .birthday-card p { margin-bottom: 0; }

  .age-table-card { break-inside: avoid; margin-bottom: 7mm; padding: 5mm; border-radius: 6mm; background: var(--blue-soft); }
  .age-table-card:nth-child(even) { background: var(--green-soft); }
  .age-table-card h3 { color: #07559f; }
  .age-table { table-layout: fixed; margin: 0; background: white; }
  .age-table th, .age-table td { padding: 2.2mm; font-size: 8.2pt; vertical-align: top; overflow-wrap: anywhere; }
  .age-table thead th { color: #07559f; background: #dff4fd; text-align: center; }
  .age-table thead th:first-child { width: 34mm; text-align: left; }
  .age-table tbody th { color: #56647b; background: #fafcff; }
  .empty-cell { color: #aab2bf; }

  .artwork-card { break-inside: avoid; margin-bottom: 8mm; padding: 6mm; border-radius: 7mm; background: var(--orange-soft); }
  .card-heading { display: flex; align-items: center; gap: 3mm; margin-bottom: 4mm; }
  .card-heading > span { display: grid; place-items: center; width: 9mm; height: 9mm; border-radius: 50%; color: white; background: var(--orange); font-weight: 700; }
  .card-heading h3 { margin: 0; }
  .art-pair { display: grid; grid-template-columns: 1fr 10mm 1fr; gap: 3mm; align-items: center; }
  .art-pair figure { margin: 0; padding: 3mm; border-radius: 5mm; background: white; }
  .art-pair img { width: 100%; height: 58mm; object-fit: contain; }
  .art-pair figcaption { margin-top: 2mm; color: #6b7280; font-size: 8.5pt; text-align: center; }
  .art-pair .missing { display: grid; place-items: center; min-height: 66mm; border: 1px dashed #e2b477; color: #8b7355; }
  .progress-arrow { color: var(--orange); font-size: 22pt; font-weight: 700; text-align: center; }
  .conclusion { margin-top: 4mm; padding: 4mm; border-radius: 4mm; background: white; }
  .conclusion strong { display: block; margin-bottom: 1mm; color: #07559f; }
  .conclusion p { margin: 0; }

  .album-age-card { break-inside: avoid; margin-bottom: 7mm; padding: 5mm; border-radius: 7mm; background: var(--green-soft); }
  .album-age-card:nth-child(even) { background: var(--blue-soft); }
  .album-age-heading { display: flex; align-items: baseline; gap: 2mm; margin-bottom: 4mm; color: #07559f; }
  .album-age-heading strong { display: grid; place-items: center; width: 12mm; height: 12mm; border-radius: 50%; color: white; background: var(--blue); font-size: 15pt; }
  .album-age-heading span { font-weight: 700; }
  .album-photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
  .album-count-1 { grid-template-columns: 1fr; }
  .album-count-2 { grid-template-columns: 1fr 1fr; }
  .album-photos figure { margin: 0; padding: 2mm; border-radius: 4mm; background: white; }
  .album-photos img { width: 100%; height: 48mm; object-fit: cover; border-radius: 3mm; }
  .album-count-1 img { height: 70mm; }
  .album-photos figcaption { display: flex; flex-direction: column; margin-top: 2mm; color: #65718a; font-size: 7.8pt; }
  .album-photos figcaption strong { color: #07559f; }
  .album-empty { padding: 8mm; border: 1px dashed #b9d8c0; border-radius: 4mm; color: #758378; background: white; text-align: center; }
  .report-note { margin-top: 6mm; padding: 4mm; border-radius: 4mm; color: #7b6743; background: var(--yellow-soft); }
  .generated { margin-top: 8mm; text-align: right; }
</style>
</head>
<body>

<section class="cover">
  ${masthead(data.kindergarten, { withName: false })}
  <div class="cover-kicker">ХҮҮХДИЙН ЦАХИМ ХУВИЙН ХАВТАС</div>
  <h1 class="cover-title">Миний хөгжлийн ном</h1>
  <div class="portrait-wrap">
    ${data.child.photoDataUri ? `<img src="${data.child.photoDataUri}" alt="Хүүхдийн зураг">` : `<span class="portrait-placeholder">☺</span>`}
  </div>
  <div class="cover-name-card">
    <div class="cover-name">${esc(fullName)}</div>
    <div class="cover-meta">
      ${esc(data.kindergarten.name)}
      ${data.group ? ` · ${esc(data.group.name)}` : ""}
      ${data.schoolYear ? ` · ${esc(data.schoolYear.name)}` : ""}
    </div>
    <span class="age-pill"><strong>${age}</strong> нас</span>
    ${attendedNames.length ? `<div class="cover-schools">Суралцсан цэцэрлэг: ${attendedNames.map(esc).join(" · ")}</div>` : ""}
  </div>
  <div class="cover-wave"></div>
</section>

<section class="page-section">
  <div class="section-heading"><span class="section-icon">1</span><h2>Миний тухай</h2></div>
  <div class="identity-layout">
    <div class="profile-card">
      ${data.child.photoDataUri ? `<img src="${data.child.photoDataUri}" alt="Хүүхдийн зураг">` : `<div class="placeholder">☺</div>`}
      <strong>${esc(data.child.firstName)}</strong>
    </div>
    <div class="info-panel"><dl class="info-list">${identityRows}</dl></div>
  </div>
  ${data.aboutMe?.introduction ? `<div class="about-card"><h3>Энэ бол би</h3>${paragraphs(data.aboutMe.introduction)}</div>` : ""}
  ${aboutRows ? `<div class="about-card"><h3>Миний мэдээлэл</h3><dl class="info-list">${aboutRows}</dl></div>` : ""}
  ${
    computedBirthFacts.yearAnimal.beforeLunarNewYear && !yearAnimalOverride
      ? `<p class="meta">Цагаан сараас өмнө төрсөн тул монгол жилийг гэр бүлийн мэдээлэлтэй тулган баталгаажуулна уу.</p>`
      : ""
  }

  <h3 class="subheading">Суралцсан цэцэрлэгүүд</h3>
  ${enrollmentBlocks || `<p class="empty">Суралцсан цэцэрлэгийн түүх хараахан бүртгэгдээгүй.</p>`}

  <h3 class="subheading">Төрсөн өдрийн мэдээлэл</h3>
  ${birthdayBlocks || `<p class="empty">Төрсөн өдрийн дурсамж хараахан бүртгэгдээгүй.</p>`}
</section>

<section class="page-section">
  <div class="section-heading"><span class="section-icon">2</span><h2>Нас насны хөгжлийн харьцуулалт</h2></div>
  ${ageTables || `<p class="empty">2-5 насны хөгжлийн мэдээлэл хараахан бүртгэгдээгүй.</p>`}
</section>

${
  comparisonBlocks
    ? `<section class="page-section">
        <div class="section-heading"><span class="section-icon">3</span><h2>Бүтээлийн өмнөх ба дараах ахиц</h2></div>
        ${comparisonBlocks}
      </section>`
    : ""
}

<section class="page-section">
  <div class="section-heading"><span class="section-icon">4</span><h2>Зургийн цомгийн харьцуулалт</h2></div>
  ${albumBlocks}
</section>

${
  data.omittedPhotoCount
    ? `<p class="report-note">Файлын хэмжээг хязгаарлахын тулд ${data.omittedPhotoCount} зургийг энэ PDF-д оруулаагүй. Бүх зургийг NomadKids системээс үзнэ үү.</p>`
    : ""
}

<p class="meta generated">Үүсгэсэн: ${formatDate(data.generatedAt)}</p>
</body>
</html>`;
}

export function portfolioChrome(childName: string, kindergartenName: string) {
  return reportChrome(`${kindergartenName} · Хүүхдийн хувийн хавтас`, childName);
}
