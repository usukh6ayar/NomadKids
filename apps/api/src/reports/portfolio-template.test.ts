import { describe, expect, it } from "vitest";
import { renderPortfolioHtml, type PortfolioData } from "./portfolio-template";

function portfolio(overrides: Partial<PortfolioData> = {}): PortfolioData {
  return {
    child: { lastName: "Бат", firstName: "Тэмүүлэн", dateOfBirth: "2021-05-12", sex: "MALE" },
    kindergarten: { name: "NomadKids цэцэрлэг" },
    group: { name: "Нархан бүлэг" },
    teachers: [{ lastName: "Болормаа", firstName: "Болормаа" }],
    schoolYear: { name: "2026-2027" },
    enrollments: [
      {
        kindergartenName: "NomadKids цэцэрлэг",
        groupName: "Нархан бүлэг",
        schoolYearName: "2026-2027",
        startedOn: "2026-09-01",
        status: "ACTIVE",
      },
    ],
    aboutMe: { clanName: "Боржигон", bloodType: "A+" },
    ageProfiles: [
      {
        age: 5,
        favoriteColor: "Ногоон",
        characterTraits: ["Зоригтой"],
        familySize: 4,
        kindergartenSkills: ["Хамтран ажиллах"],
        familyLearningSkills: ["Ахмадаа хүндлэх"],
      },
    ],
    birthdayNotes: [],
    observations: [
      {
        source: "TEACHER",
        typeName: "Ажиглалт",
        observedOn: "2026-02-12",
        activityName: "Хамтын хот",
        childDid: "Зам хийв.",
        photoDataUris: [],
      },
      {
        source: "PARENT",
        typeName: "Ярилцлага",
        observedOn: "2026-02-13",
        activityName: "Гэр бүлийн ярилцлага",
        teacherComment: "Ном унших дуртай.",
        photoDataUris: [],
      },
    ],
    growthMeasurements: [{ measuredOn: "2026-02-12", heightCm: 108, weightKg: 18 }],
    milestones: [],
    artworkComparisons: [],
    artworks: [
      { type: "Зураг", age: 5, dataUri: "data:image/png;base64,AA==", caption: "Миний гэр бүл" },
    ],
    photoAlbums: [
      {
        key: "5:PORTRAIT",
        label: "Цээж зураг",
        age: 5,
        photos: [{ dataUri: "data:image/png;base64,AA==", caption: "Төгсөлт" }],
      },
    ],
    albumSummary: [],
    teacherLetter: "Хайрт шавьдаа",
    generatedAt: new Date("2026-09-21T00:00:00.000Z"),
    ...overrides,
  };
}

describe("renderPortfolioHtml exact dynamic template", () => {
  it("uses the fixed design pages and only creates populated dynamic sections", () => {
    const html = renderPortfolioHtml(portfolio());
    for (const page of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 19]) {
      expect(html).toContain(`class="sheet t${page}"`);
    }
    expect(html).not.toContain('class="sheet t15"');
  });

  it("binds teacher and parent observations, growth, artwork, albums, and the dedicated letter", () => {
    const html = renderPortfolioHtml(portfolio());
    expect(html).toContain("Хамтын хот");
    expect(html).toContain("Гэр бүлийн ярилцлага");
    expect(html).toContain("108 см");
    expect(html).toContain("Миний гэр бүл");
    expect(html).toContain("Төгсөлт");
    expect(html).toContain("Хайрт шавьдаа");
    expect(html).toContain("Нархан бүлгийн багш: Б. Болормаа");
  });

  it("paginates every populated artwork, album, and teacher-photo category", () => {
    const photo = (caption: string) => ({ dataUri: "data:image/png;base64,AA==", caption });
    const html = renderPortfolioHtml(
      portfolio({
        artworks: Array.from({ length: 5 }, (_, index) => ({
          type: "Наамал",
          age: 2 + (index % 4),
          dataUri: "data:image/png;base64,AA==",
          caption: `Наамал ${index + 1}`,
        })),
        photoAlbums: [
          { key: "2:Хөдөө", label: "Хөдөө", age: 2, photos: [photo("Хөдөө 1")] },
          {
            key: "2:teacher",
            label: "Багшийн илгээсэн зураг",
            age: 2,
            attribution: "TEACHER",
            photos: Array.from({ length: 7 }, (_, index) => photo(`Багш ${index + 1}`)),
          },
        ],
      }),
    );
    expect((html.match(/class="sheet t11"/g) ?? []).length).toBe(2);
    expect((html.match(/class="sheet t15"/g) ?? []).length).toBe(2);
    expect(html).toContain("Хөдөө");
    expect(html).not.toContain("Алтан намар");
  });

  it("turns saved question wording into declarative portfolio statements", () => {
    const html = renderPortfolioHtml(
      portfolio({
        ageProfiles: [{ age: 5, kindergartenSkills: ["Өөрийн нэр, насаа хэлж чаддаг уу?"] }],
      }),
    );
    expect(html).toContain("Өөрийн нэр, насаа хэлж чаддаг.");
    expect(html).not.toContain("чаддаг уу?");
  });

  // ★ The rows below are 2026-10-19's review of #260.

  it("covers all four sample growth rows drawn into the background", () => {
    const html = renderPortfolioHtml(portfolio());
    const table = html.slice(
      html.indexOf('<table class="growth-table">'),
      html.indexOf("</table>"),
    );
    expect(table.match(/<tr>/g)).toHaveLength(4);
    expect(table).toContain("108 см");
  });

  it("does not plot a missing height at 0 см", () => {
    const html = renderPortfolioHtml(
      portfolio({
        growthMeasurements: [
          { measuredOn: "2026-02-12", heightCm: 108, weightKg: 18 },
          { measuredOn: "2026-05-12", heightCm: null, weightKg: 19 },
        ],
      }),
    );
    expect(html).not.toContain(">0см<");
    expect(html).not.toContain("null см");
  });

  it("ticks the traits under the web picker's own spelling", () => {
    const html = renderPortfolioHtml(
      portfolio({ ageProfiles: [{ age: 5, characterTraits: ["Эелдэг", "Сандруу"] }] }),
    );
    expect(html.match(/<div class="fill">✓<\/div>/g)).toHaveLength(2);
  });

  it("prints a family's ticked questions under their own domain, and its description once", () => {
    const DESCRIPTION = "Бид таван хүнтэй гэр бүл";
    const html = renderPortfolioHtml(
      portfolio({
        ageProfiles: [
          {
            age: 5,
            familyDescription: DESCRIPTION,
            familyLearningSkills: ["Хувцсаа ихэнхдээ бие даан өмсөж, тайлж чаддаг уу?"],
          },
        ],
      }),
    );
    expect(html.split(DESCRIPTION)).toHaveLength(2);
    const page8 = html.slice(html.indexOf('class="sheet t8"'), html.indexOf('class="sheet t9"'));
    expect(page8).toMatch(
      /<h3>Бие бялдар<\/h3><p>Хувцсаа ихэнхдээ бие даан өмсөж, тайлж чаддаг\.<\/p>/,
    );
  });

  it("writes each page background once and numbers every page but the cover", () => {
    const html = renderPortfolioHtml(
      portfolio({
        artworks: Array.from({ length: 9 }, () => ({
          type: "Зураг",
          age: 5,
          dataUri: "data:image/png;base64,AA==",
        })),
      }),
    );
    expect(html.split(".bg11{")).toHaveLength(2);
    expect(html.match(/class="page-bg bg11"/g)?.length).toBeGreaterThan(1);
    expect(html).toContain("counter(sheet)");
  });

  it("escapes user-controlled text", () => {
    const html = renderPortfolioHtml(portfolio({ teacherLetter: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
