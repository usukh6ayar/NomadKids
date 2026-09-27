import { describe, expect, it } from "vitest";
import { capitalize, fullName, shortName } from "@/lib/format";

/**
 * «Эхний үсэг томоор» — the client, 2026-09-26.
 *
 * ESIS sends names as typed at the ministry — «ахлах бүлэг», «Даваасүрэн
 * анужин» — and they are stored that way, because the import rewrites them
 * from ESIS on every run. So the capital is a display decision, made here and
 * nowhere near the data.
 */
describe("capitalize", () => {
  it("raises the first letter and leaves the rest as typed", () => {
    expect(capitalize("ахлах бүлэг")).toBe("Ахлах бүлэг");
    expect(capitalize("ахлах а")).toBe("Ахлах а");
  });

  it("knows the Mongolian letters", () => {
    expect(capitalize("өлзий")).toBe("Өлзий");
    expect(capitalize("үүрийн туяа")).toBe("Үүрийн туяа");
  });

  it("leaves text that does not start with a letter alone", () => {
    expect(capitalize("3-р бүлэг")).toBe("3-р бүлэг");
    expect(capitalize("«нарны» бүлэг")).toBe("«нарны» бүлэг");
    expect(capitalize("")).toBe("");
  });
});

describe("names", () => {
  it("capitalizes each half of a person's name", () => {
    expect(fullName({ lastName: "даваасүрэн", firstName: "анужин" })).toBe("Даваасүрэн Анужин");
    expect(shortName({ lastName: "даваасүрэн", firstName: "анужин" })).toBe("Д.Анужин");
  });
});
