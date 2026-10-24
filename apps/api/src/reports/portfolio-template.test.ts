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

  it("fills the growth table's four rows under its own header", () => {
    const html = renderPortfolioHtml(portfolio());
    const table = html.slice(
      html.indexOf('<table class="growth-table">'),
      html.indexOf("</table>"),
    );
    const body = table.slice(table.indexOf("<tbody>"));
    expect(body.match(/<tr>/g)).toHaveLength(4);
    expect(table).toContain("<th>Огноо</th>");
    expect(table).toContain("108 см");
  });

  /*
   * ★ 2026-10-24, the user's review of a downloaded portfolio. The page
   * backgrounds are the designer's pages with the sample child taken out
   * (`scripts/portfolio-backgrounds.ts`), as JPEGs: no SVG masks left for
   * Chromium to frame in black, and nothing for a white box to hide.
   */
  it("draws the cleaned backgrounds, not the designer's sample SVGs", () => {
    const html = renderPortfolioHtml(portfolio());
    expect(html).toContain("data:image/jpeg;base64,");
    expect(html).not.toContain("data:image/svg+xml");
  });

  it("prints the child's age from the birth date, never a default of 5", () => {
    const html = renderPortfolioHtml(
      portfolio({
        child: {
          lastName: "Батжаргал",
          firstName: "Ану",
          dateOfBirth: "2022-01-25",
          sex: "FEMALE",
        },
        ageProfiles: [],
        generatedAt: new Date("2026-10-24T00:00:00.000Z"),
      }),
    );
    expect(html).toContain("<b>4 нас · NomadKids цэцэрлэг</b>");
    expect(html).toContain("<small>4 нас</small>");
  });

  it("tells a story card by its kind, in sentences, and leaves an empty note out", () => {
    const html = renderPortfolioHtml(
      portfolio({
        observations: [
          {
            source: "TEACHER",
            typeName: "Ярилцлага",
            observedOn: "2026-02-12",
            activityName: "Өглөөний дугуйлан",
            situation: "Уулзалтын үеэр.",
            childDid: "Өөрийн тухай ярьсан",
            photoDataUris: [],
          },
          { source: "TEACHER", typeName: "Ажиглалт", observedOn: "2026-02-14", photoDataUris: [] },
          {
            source: "PARENT",
            typeName: "Гэр бүлээс ирсэн",
            observedOn: "2026-02-13",
            childDid: "Дүүгээ асарсан.",
            photoDataUris: [],
          },
        ],
      }),
    );
    expect(html).toContain("Уулзалтын үеэр. Өөрийн тухай ярьсан.");
    expect(html).not.toContain("., ");
    expect(html).toContain("<strong>Ярилцлага</strong>");
    expect(html).toContain("<strong>Эцэг эхийн тэмдэглэл</strong>");
    expect(html).not.toContain("ЭЦЭГ ЭХИЙН ЯРИЛЦЛАГА");
    // Two cards, no blank ones for the empty note or an unfilled column.
    expect(html.match(/<article class="history-card/g)).toHaveLength(2);
  });

  it("calls «Миний тухай» complete only when what it asks is filled in", () => {
    expect(renderPortfolioHtml(portfolio())).toContain('<b class="figure about">Дутуу</b>');
    const complete = renderPortfolioHtml(
      portfolio({
        aboutMe: {
          clanName: "Боржигон",
          birthplace: "Улаанбаатар",
          bloodType: "A+",
          eyeColor: "Хар",
        },
      }),
    );
    expect(complete).toContain('<b class="figure about">Бүрэн</b>');
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
    expect(html.match(/<div class="fill fit">✓<\/div>/g)).toHaveLength(2);
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

  /*
   * ★ 2026-10-24: the design's boxes are fixed, what people write is not (a
   * letter up to 5,000 characters). Text is shrunk to fit in the page itself,
   * and marked «…» if it still does not — never cut without a sign.
   */
  it("fits long text to its box rather than cutting it silently", () => {
    const html = renderPortfolioHtml(portfolio({ teacherLetter: "Урт захиа. ".repeat(400) }));
    expect(html).toContain('<div class="letter-body fit">');
    expect(html).toContain("document.fonts.ready.then(");
    expect(html).toContain('.fit.cut::after{content:"…"');
  });

  it("escapes user-controlled text", () => {
    const html = renderPortfolioHtml(portfolio({ teacherLetter: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
