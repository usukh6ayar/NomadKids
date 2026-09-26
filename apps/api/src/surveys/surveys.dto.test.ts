import { describe, expect, it } from "vitest";
import { createSurveySchema } from "./surveys.dto";

const validSurvey = {
  title: "Хүүхдийн хөгжлийн судалгаа",
  category: "OTHER",
  scope: "CHILD",
  kind: "FORM",
  respondent: "TEACHER",
  period: "MIDLINE",
};

describe("create survey validation messages", () => {
  it.each([
    ["category", "Ангиллаа зөв сонгоно уу"],
    ["scope", "Хамрах хүрээг зөв сонгоно уу"],
    ["kind", "Судалгаа, асуулгын төрлийг зөв сонгоно уу"],
    ["respondent", "Хариулагчийг зөв сонгоно уу"],
    ["period", "Үнэлгээний төрлийг зөв сонгоно уу"],
  ] as const)("shows a Mongolian message for an invalid %s", (field, message) => {
    const result = createSurveySchema.safeParse({ ...validSurvey, [field]: "" });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ path: [field], message }),
    );
  });
});
