/**
 * What a Mongolian register number says about its holder — 2026-10-18, the
 * user: a roster often has «Регистр» and leaves «Төрсөн он сар» and «Хүйс»
 * empty, because the register already carries both.
 *
 * `УП21241512`: two letters, then YY MM DD of birth — the month raised by 20
 * for a birth from 2000 on — then two digits, the first of which is odd for a
 * boy and even for a girl.
 */
export function factsFromRegister(
  register: string,
): { dateOfBirth: string; sex: "MALE" | "FEMALE" } | null {
  const match = /^[А-ЯӨҮЁ]{2}(\d{2})(\d{2})(\d{2})(\d)(\d)$/u.exec(register.trim().toUpperCase());
  if (!match) return null;
  const [, yy, mm, dd, sexDigit] = match;
  const rawMonth = Number(mm);
  const year = (rawMonth > 20 ? 2000 : 1900) + Number(yy);
  const month = rawMonth > 20 ? rawMonth - 20 : rawMonth;
  const day = Number(dd);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return {
    dateOfBirth: date.toISOString().slice(0, 10),
    sex: Number(sexDigit) % 2 === 1 ? "MALE" : "FEMALE",
  };
}
