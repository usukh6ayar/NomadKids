import { describe, expect, it } from "vitest";
import {
  renderPortfolioHtml,
  type PortfolioAgeProfile,
  type PortfolioData,
} from "./portfolio-template";

function portfolio(overrides: Partial<PortfolioData> = {}): PortfolioData {
  return {
    child: {
      lastName: "Бат",
      firstName: "Тэмүүлэн",
      dateOfBirth: "2021-05-12",
      sex: "MALE",
    },
    kindergarten: { name: "NomadKids цэцэрлэг" },
    group: { name: "Нархан бүлэг" },
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
    ageProfiles: [],
    birthdayNotes: [],
    observations: [],
    growthMeasurements: [],
    milestones: [],
    artworkComparisons: [],
    photoAlbums: [],
    albumSummary: [],
    generatedAt: new Date("2026-09-21T00:00:00.000Z"),
    ...overrides,
  };
}

describe("renderPortfolioHtml", () => {
  it("prints complete identity and enrollment history without removed sections", () => {
    const html = renderPortfolioHtml(
      portfolio({
        aboutMe: {
          introduction: "Би зураг зурах дуртай.",
          clanName: "Боржигон",
          nickname: "Тэмүү",
          birthplace: "Улаанбаатар",
          bloodType: "A+",
          eyeColor: "Бор",
          heightCm: 108,
          weightKg: 18,
          recordedOn: "2026-09-01",
        },
      }),
    );

    expect(html).toContain("Боржигон");
    expect(html).toContain("Тэмүү");
    expect(html).toContain("Улаанбаатар");
    expect(html).toContain("Суралцсан цэцэрлэгүүд");
    expect(html).toContain("NomadKids цэцэрлэг");
    // Restored 2026-10-16 — the redesign keeps the birthday section.
    expect(html).toContain("Төрсөн өдрийн мэдээлэл");
    expect(html).not.toContain("Эцэг эхийн тэмдэглэл");
    expect(html).not.toContain("Багшийн ажиглалт");
    expect(html).not.toContain("Өсөлт ба онцгой үйл явдал");
    expect(html).not.toContain("Ажиглалт, ярилцлага, бүтээл");
    expect(html).not.toContain("Хөгжлийн үнэлгээ");
  });

  it("escapes profile, enrollment, and album text", () => {
    const html = renderPortfolioHtml(
      portfolio({
        child: {
          lastName: "<script>alert(1)</script>",
          firstName: "Тэмүүлэн",
          dateOfBirth: "2021-05-12",
          sex: "MALE",
        },
        enrollments: [
          {
            kindergartenName: "<img src=x onerror=alert(1)>",
            groupName: "А & Б",
            schoolYearName: "2026-2027",
            startedOn: "2026-09-01",
            status: "ACTIVE",
          },
        ],
        photoAlbums: [
          {
            age: 4,
            photos: [
              {
                dataUri: "data:image/png;base64,AA==",
                caption: "Аюулгүй & ойлгомжтой",
                categoryLabel: "<төрөл>",
              },
            ],
          },
        ],
      }),
    );

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("Аюулгүй &amp; ойлгомжтой");
    expect(html).toContain("&lt;төрөл&gt;");
  });

  it("compares the same development fields across ages and ignores voice notes", () => {
    const withRemovedNotes = {
      age: 2,
      favoriteColor: "Шар",
      kindergartenSkills: ["Өөрөө хувцаслах"],
      parentNote: "PDF-д орох ёсгүй",
      teacherNote: "PDF-д мөн орох ёсгүй",
    } as PortfolioAgeProfile & { parentNote: string; teacherNote: string };
    const html = renderPortfolioHtml(
      portfolio({
        ageProfiles: [
          withRemovedNotes,
          {
            age: 3,
            favoriteColor: "Ногоон",
            kindergartenSkills: ["Гутлаа үдэх"],
          },
        ],
      }),
    );

    expect(html).toContain("Нас насны миний түүх");
    expect(html).toContain("<strong>2</strong><span>нас</span>");
    expect(html).toContain("<strong>3</strong><span>нас</span>");
    expect(html).toContain("Шар");
    expect(html).toContain("Ногоон");
    // What each age learned at kindergarten stays in the PDF (2026-10-16).
    expect(html).toContain("Өөрөө хувцаслах");
    expect(html).toContain("Гутлаа үдэх");
    expect(html).not.toContain("PDF-д орох ёсгүй");
    expect(html).not.toContain("PDF-д мөн орох ёсгүй");
  });

  it("renders artwork progress and age-album comparison separately", () => {
    const html = renderPortfolioHtml(
      portfolio({
        artworkComparisons: [
          {
            conclusion: "Өнгө сонголт болон дүрслэл ахисан.",
            earlierTakenAt: "2025-09-16",
          },
        ],
        photoAlbums: [
          {
            age: 3,
            photos: [
              {
                dataUri: "data:image/png;base64,AA==",
                categoryLabel: "Миний төрсөн өдөр",
                caption: "3 насны зураг",
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain("Бүтээлийн ахицын цуваа");
    expect(html).toContain("Өнгө сонголт болон дүрслэл ахисан.");
    expect(html).toContain("Нас насны зургийн цомог");
    expect(html).toContain("Миний төрсөн өдөр");
    expect(html).toContain("3 насны зураг");
  });

  it("renders only recorded observations, growth, milestones, album counts, and teacher letter", () => {
    const html = renderPortfolioHtml(
      portfolio({
        observations: [
          {
            typeName: "Чөлөөт ажиглалт",
            observedOn: "2026-02-12",
            activityName: "Хамтран бүтээсэн хот",
            childDid: "Зам болон гүүр хийв.",
            photoDataUris: ["data:image/png;base64,AA=="],
          },
        ],
        growthMeasurements: [{ measuredOn: "2026-02-12", heightCm: 108, weightKg: 18 }],
        milestones: [
          {
            title: "Цэцэрлэгийн анхны өдөр",
            occurredOn: "2023-09-01",
            photoDataUris: ["data:image/png;base64,AA=="],
          },
        ],
        albumSummary: [{ label: "Цээж зураг", count: 4 }],
        teacherLetter: "Хайрт шавьдаа",
      }),
    );

    expect(html).toContain("Багшийн ажиглалт");
    expect(html).toContain("Хамтран бүтээсэн хот");
    expect(html).toContain("Өндөр, жингийн түүх");
    expect(html).toContain("108 см");
    expect(html).toContain("Цэцэрлэгийн анхны өдөр");
    expect(html).toContain("Цээж зураг · 4 зураг");
    expect(html).toContain("Багшийн захиа");
    expect(html).toContain("Хайрт шавьдаа");
  });
});
