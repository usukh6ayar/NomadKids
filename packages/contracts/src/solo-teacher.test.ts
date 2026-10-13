import { describe, expect, it } from "vitest";
import { locationStem, normalizeKindergartenName } from "./solo-teacher";

describe("normalizeKindergartenName", () => {
  it("reads «Нарлаг», «нарлаг цэцэрлэг» and «Нарлаг-цэцэрлэг» as one name", () => {
    const names = ["Нарлаг", "нарлаг цэцэрлэг", "Нарлаг-цэцэрлэг"].map(normalizeKindergartenName);
    expect(new Set(names)).toEqual(new Set(["нарлаг"]));
  });

  it("keeps the digits of a numbered kindergarten", () => {
    expect(normalizeKindergartenName("115-р цэцэрлэг")).toBe("115р");
  });
});

describe("locationStem", () => {
  it("drops the kind from a district or a province", () => {
    expect(locationStem("Баянзүрх дүүрэг")).toBe("Баянзүрх");
    expect(locationStem(" Төв аймаг ")).toBe("Төв");
    expect(locationStem("Хан-Уул")).toBe("Хан-Уул");
  });
});
