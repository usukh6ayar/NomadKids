import { describe, expect, it } from "vitest";
import { suggestUsername } from "@/lib/username";

/*
 * ★ The director's login name, suggested from the kindergarten's name — the
 * user, 2026-10-14: from the organisation, since two directors can share a name.
 */
describe("suggestUsername", () => {
  it("writes the organisation's own words in Latin, without «цэцэрлэг»", () => {
    expect(suggestUsername("Бамбарууш цэцэрлэг")).toBe("bambaruush");
    expect(suggestUsername("Аз жаргал цэцэрлэг")).toBe("az.jargal");
    expect(suggestUsername("Өнөр хүүхдийн цэцэрлэг")).toBe("onor");
    expect(suggestUsername("Хүслэн цэцэрлэг (жишээ)")).toBe("khuslen");
  });

  it("names a numbered kindergarten by its number", () => {
    expect(suggestUsername("23-р цэцэрлэг")).toBe("tsetserleg23");
    expect(suggestUsername("5 дугаар цэцэрлэг")).toBe("tsetserleg5");
    expect(suggestUsername("Цэцэрлэг №5")).toBe("tsetserleg5");
  });

  it("only ever suggests what the login form accepts", () => {
    for (const name of ["Шинэ-Үе ХХК цэцэрлэг", "Од", "Ёлт, Ялгуун!", "Цэцэрлэг"]) {
      expect(suggestUsername(name)).toMatch(/^[a-z0-9._-]{3,}$/);
    }
  });
});
