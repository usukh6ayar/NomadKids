import { describe, expect, it } from "vitest";
import { esisInstitutionLookupSchema } from "./domain";

describe("esisInstitutionLookupSchema", () => {
  const valid = {
    institutionId: "42778",
    name: "Дэгдээхий үрс цэцэрлэг",
    longName: "Улаанбаатар.Баянзүрх.Дэгдээхий үрс цэцэрлэг",
    address: "Улаанбаатар, Баянзүрх, 16-р хороо",
    classification: "Цэцэрлэг",
    propertyType: "Хувийн",
    isKindergarten: true,
    alreadyUsed: false,
    staff: [
      {
        personId: "1000048746697",
        registerNumber: "УБ12345678",
        lastName: "Батсайхан",
        firstName: "Оюунаа",
        positionName: "эрхлэгч",
        jobCode: "1341-11",
        suggestedRole: null,
      },
    ],
  };

  it("accepts a live-shaped payload", () => {
    expect(esisInstitutionLookupSchema.safeParse(valid).success).toBe(true);
  });

  it("keeps a staff row whose job code maps to no role", () => {
    // 1341 (эрхлэгч) and 5153 (жижүүр) both map to null, and the эрхлэгч is
    // the person the create screen exists to pick. `suggestedRole` is advice,
    // not a filter.
    const parsed = esisInstitutionLookupSchema.parse(valid);
    expect(parsed.staff[0]!.suggestedRole).toBeNull();
  });

  it("refuses a numeric personId, because the roster stores text", () => {
    const wrong = { ...valid, staff: [{ ...valid.staff[0], personId: 1000048746697 }] };
    expect(esisInstitutionLookupSchema.safeParse(wrong).success).toBe(false);
  });

  it("accepts a suggested role for a mapped job code", () => {
    const teacher = {
      ...valid,
      staff: [{ ...valid.staff[0], jobCode: "2342-01", suggestedRole: "TEACHER" }],
    };
    expect(esisInstitutionLookupSchema.safeParse(teacher).success).toBe(true);
  });
});
