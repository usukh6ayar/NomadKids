import { describe, expect, it } from "vitest";
import { normalizeRegisterNumber, roleForJobCode } from "./esis.roster";

/*
 * ★ Every code here was returned live by institution 42778 on 2026-09-16.
 * None is invented, which is the whole point: the eleven reader field-lists
 * this project had to correct were all written from documentation.
 */
describe("roleForJobCode", () => {
  it.each([
    ["2342-13", "TEACHER"], // Багш, цэцэрлэгийн /мэргэжлийн/ /СӨБ/
    ["2342-05", "TEACHER"], // Багшийн туслах
    ["2351-01", "TEACHER"], // Арга зүйч
    ["5120-11", "COOK"], // Тогооч
  ])("maps %s to %s", (jobCode, role) => {
    expect(roleForJobCode(jobCode)).toBe(role);
  });

  /*
   * ★★ The two that must NOT resolve, and they fail in opposite directions.
   *
   * `5153-12` is the жижүүр. Nothing in the product fits, and TEACHER is the
   * tempting default because it is the commonest staff role — it would also
   * hand every child's development record to the building's caretaker.
   *
   * `1341-02` is the эрхлэгч. ADMIN fits perfectly and is refused anyway:
   * with no approval step, a job title would decide who administers the
   * kindergarten, and a job title is a string in somebody else's database.
   */
  it.each([
    ["5153-12"], // Жижүүр /байрны/
    ["1341-02"], // Цэцэрлэгийн менежер, эрхлэгч
  ])("refuses to derive a role for %s", (jobCode) => {
    expect(roleForJobCode(jobCode)).toBeNull();
  });

  it("refuses an unknown, malformed or absent code", () => {
    for (const value of ["9999-99", "2342", "", "  ", null, undefined]) {
      expect({ value, role: roleForJobCode(value) }).toEqual({ value, role: null });
    }
  });

  /* The mapping keys on the four-digit ISCO group, so an unseen suffix works. */
  it("reads the occupation group rather than the whole code", () => {
    expect(roleForJobCode("2342-99")).toBe("TEACHER");
  });
});

describe("normalizeRegisterNumber", () => {
  it("upper-cases and strips whitespace so typing is forgiving", () => {
    expect(normalizeRegisterNumber(" ул24270406 ")).toBe("УЛ24270406");
    expect(normalizeRegisterNumber("УЛ 2427 0406")).toBe("УЛ24270406");
  });

  /*
   * ★ Cyrillic У (U+0423) and Latin Y (U+0059) are different characters that
   * look identical in most fonts. A teacher with a Latin keyboard layout types
   * the wrong one and gets "register number not found" forever, with no way to
   * tell why. Mapped rather than rejected.
   */
  it("maps look-alike Latin letters to their Cyrillic twins", () => {
    expect(normalizeRegisterNumber("YЛ24270406")).toBe("УЛ24270406");
    expect(normalizeRegisterNumber("AA12345678")).toBe("АА12345678");
  });

  it("returns null for anything that is not two letters and eight digits", () => {
    for (const value of ["", "УЛ2427040", "УЛ242704066", "УЛ2427040A", "1234567890"]) {
      expect({ value, out: normalizeRegisterNumber(value) }).toEqual({ value, out: null });
    }
  });
});
