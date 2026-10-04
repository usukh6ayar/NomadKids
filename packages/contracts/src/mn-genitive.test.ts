import { describe, expect, it } from "vitest";
import { genitive, guardianChatName } from "./mn-genitive";

describe("genitive", () => {
  it.each([
    // back-vowel consonant endings
    ["Болд", "Болдын"],
    ["Батбаяр", "Батбаярын"],
    ["Мөнхзул", "Мөнхзулын"],
    ["Оргил", "Оргилын"],
    // front-vowel consonant endings
    ["Энх", "Энхийн"],
    ["Төгс", "Төгсийн"],
    ["Мишээл", "Мишээлийн"],
    // г, ж, ч, ш always take -ийн
    ["Ганзориг", "Ганзоригийн"],
    ["Дорж", "Доржийн"],
    // н takes -гийн
    ["Хулан", "Хулангийн"],
    ["Тэмүүлэн", "Тэмүүлэнгийн"],
    ["Номин", "Номингийн"],
    // long vowels take -гийн
    ["Сараа", "Сараагийн"],
    ["Батхүү", "Батхүүгийн"],
    ["Энхтуяа", "Энхтуяагийн"],
    // a diphthong in й takes -н
    ["Сарнай", "Сарнайн"],
    // a short э drops
    ["Эрдэнэ", "Эрдэнийн"],
    ["Бат-Эрдэнэ", "Бат-Эрдэнийн"],
    // a short vowel that is not э or и
    ["Ану", "Анугийн"],
  ])("%s → %s", (name, expected) => {
    expect(genitive(name)).toBe(expected);
  });

  it("never misspells a name it cannot read", () => {
    expect(genitive("Anna")).toBe("Anna-ийн");
    expect(genitive("")).toBe("");
  });
});

describe("guardianChatName", () => {
  it("names a guardian by their child and what they are to them", () => {
    expect(guardianChatName({ lastName: "Ганбаатар", firstName: "Батбаяр" }, "MOTHER")).toBe(
      "Г.Батбаярын ээж",
    );
    expect(guardianChatName({ lastName: "Дорж", firstName: "Номин" }, "FATHER")).toBe(
      "Д.Номингийн аав",
    );
  });

  it("falls back to асран хамгаалагч when the relation is not one of the named ones", () => {
    expect(guardianChatName({ lastName: null, firstName: "Болд" }, "OTHER")).toBe(
      "Болдын асран хамгаалагч",
    );
  });
});
