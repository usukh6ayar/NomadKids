import { describe, expect, it } from "vitest";
import { promptIndicatorKey, withIndicatorKeys } from "./indicator-key";

describe("indicator keys the server gives a question", () => {
  it("is the same for the same words, whatever whitespace surrounds them", () => {
    expect(promptIndicatorKey("  Өнгө ялгадаг уу?\n")).toBe(promptIndicatorKey("Өнгө ялгадаг уу?"));
    expect(promptIndicatorKey("Өнгө ялгадаг уу?")).toMatch(/^q_[0-9a-f]{12}$/);
  });

  it("matches what the migration's md5 computed", () => {
    // Read back from the dev database after 20260921120000 ran.
    expect(promptIndicatorKey("Хүүхдийн харшилтай хоол хүнс")).toBe("q_80db56082a8b");
  });

  it("keeps a key a question already has, and numbers a repeated prompt", () => {
    const [kept, first, second] = withIndicatorKeys([
      { prompt: "Хэл яриа", indicatorKey: "speech" },
      { prompt: "Тоолох" },
      { prompt: "Тоолох", indicatorKey: null },
    ]);
    expect(kept!.indicatorKey).toBe("speech");
    expect(first!.indicatorKey).toBe(promptIndicatorKey("Тоолох"));
    expect(second!.indicatorKey).toBe(`${promptIndicatorKey("Тоолох")}_2`);
  });
});
