/**
 * Birth facts derived from a date of birth — RFP §4.2.
 *
 * The RFP's "Төрсөн өдрийн мэдээлэл" section asks for the birth date, the age,
 * the **өрнийн орд** (western zodiac sign) and the **монгол жилийн амьтан**, and
 * says the last two may be computed rather than typed.
 *
 * ★ Why this lives in `contracts` and not in a service.
 *
 * Two consumers need the same answer: the portfolio response the web app reads,
 * and the PDF templates the report worker renders. Computing it in the API
 * response only would leave the printed portfolio — the artefact a family
 * actually keeps — missing the section, and nobody would notice until a report
 * came back. A pure function of one date has no reason to be anywhere else.
 */

export interface ZodiacSign {
  code: string;
  /** Mongolian name, for display. */
  name: string;
}

export interface YearAnimal {
  code: string;
  name: string;
  /**
   * True when the birth date falls in the window where the Mongolian lunar new
   * year (Цагаан сар) may not yet have passed — see `mongolianYearAnimal`.
   */
  beforeLunarNewYear: boolean;
}

/**
 * The twelve signs with the Gregorian date each one starts on.
 *
 * Ordered by start date within the year, beginning at Матар (Capricorn) so that
 * a simple "last boundary at or before this date" scan works without wrapping.
 */
/**
 * Матар is named separately because it is both the first and the last boundary:
 * the sign spans the new year. Having it as a value rather than as
 * `ZODIAC_BOUNDARIES[0]` is also what lets the scan below start from something
 * the compiler knows is defined.
 */
const CAPRICORN = { code: "capricorn", name: "Матар" };

const ZODIAC_BOUNDARIES: { month: number; day: number; code: string; name: string }[] = [
  { month: 1, day: 1, ...CAPRICORN },
  { month: 1, day: 20, code: "aquarius", name: "Хумх" },
  { month: 2, day: 19, code: "pisces", name: "Загас" },
  { month: 3, day: 21, code: "aries", name: "Хонь" },
  { month: 4, day: 20, code: "taurus", name: "Үхэр" },
  { month: 5, day: 21, code: "gemini", name: "Ихэр" },
  { month: 6, day: 22, code: "cancer", name: "Хавч" },
  { month: 7, day: 23, code: "leo", name: "Арслан" },
  { month: 8, day: 23, code: "virgo", name: "Онгон" },
  { month: 9, day: 23, code: "libra", name: "Дэнс" },
  { month: 10, day: 23, code: "scorpio", name: "Хилэнц" },
  { month: 11, day: 22, code: "sagittarius", name: "Нумч" },
  { month: 12, day: 22, ...CAPRICORN },
];

/**
 * The twelve-year animal cycle, indexed so that a year with `year % 12 === 4`
 * is Хулгана — 2020, 2008, 1996 and so on.
 */
const YEAR_ANIMALS: { code: string; name: string }[] = [
  { code: "rat", name: "Хулгана" },
  { code: "ox", name: "Үхэр" },
  { code: "tiger", name: "Бар" },
  { code: "rabbit", name: "Туулай" },
  { code: "dragon", name: "Луу" },
  { code: "snake", name: "Могой" },
  { code: "horse", name: "Морь" },
  { code: "sheep", name: "Хонь" },
  { code: "monkey", name: "Бич" },
  { code: "rooster", name: "Тахиа" },
  { code: "dog", name: "Нохой" },
  { code: "pig", name: "Гахай" },
];

/**
 * Parses the date shapes this system actually carries.
 *
 * Prisma `@db.Date` arrives as a `Date` in the API and as an ISO string over
 * HTTP. A bare `YYYY-MM-DD` is read in **UTC** by `new Date`, so it is split by
 * hand instead: parsed as local time, a birth date recorded in Ulaanbaatar
 * (UTC+8) reads as the previous day everywhere west of it, which moves a child
 * across a zodiac boundary once every twelve births or so.
 */
function parts(dateOfBirth: Date | string): { year: number; month: number; day: number } {
  if (typeof dateOfBirth === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth);
    if (!match) throw new RangeError(`Not a date: ${dateOfBirth}`);
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }
  if (Number.isNaN(dateOfBirth.getTime())) throw new RangeError("Not a date: Invalid Date");
  return {
    year: dateOfBirth.getUTCFullYear(),
    month: dateOfBirth.getUTCMonth() + 1,
    day: dateOfBirth.getUTCDate(),
  };
}

/** Өрнийн орд — the western zodiac sign, in Mongolian. */
export function westernZodiac(dateOfBirth: Date | string): ZodiacSign {
  const { month, day } = parts(dateOfBirth);

  let found: ZodiacSign = CAPRICORN;
  for (const boundary of ZODIAC_BOUNDARIES) {
    if (month > boundary.month || (month === boundary.month && day >= boundary.day)) {
      found = { code: boundary.code, name: boundary.name };
    }
  }
  return found;
}

/**
 * Монгол жилийн амьтан — the animal of the birth year.
 *
 * ★ The lunar boundary is reported, not guessed.
 *
 * The animal year turns at Цагаан сар, which falls somewhere between late
 * January and early March and moves every year — the Mongolian lunar calendar
 * also diverges from the Chinese one by a whole month in some years, so the
 * widely available Chinese New Year tables are not a safe substitute. Shipping
 * a table of dates that cannot be checked here would put a wrong animal in a
 * child's permanent record and give no sign that it was wrong.
 *
 * So this computes from the Gregorian year and sets `beforeLunarNewYear` for
 * any date up to 15 March, which is the whole window Цагаан сар can occupy. The
 * UI qualifies those with a note rather than asserting a value it cannot
 * verify; every other date — five births in six — is unambiguous.
 */
export function mongolianYearAnimal(dateOfBirth: Date | string): YearAnimal {
  const { year, month, day } = parts(dateOfBirth);

  // ((year - 2020) % 12 + 12) % 12 keeps years before 2020 in range: JavaScript's
  // % returns a negative remainder for a negative left operand.
  const index = (((year - 2020) % 12) + 12) % 12;

  // The expression above cannot leave 0..11. The check is here so that fact is
  // proved to the compiler rather than asserted away with `!` — this package is
  // built with `noUncheckedIndexedAccess`, and turning that off for one line is
  // a worse trade than three lines that can never run.
  const animal = YEAR_ANIMALS[index];
  if (!animal) throw new RangeError(`No year animal at index ${index}`);

  return {
    ...animal,
    beforeLunarNewYear: month < 3 || (month === 3 && day <= 15),
  };
}

/**
 * Нас — completed years, the way an age is said out loud.
 *
 * ★ Compared on (month, day) rather than by dividing a millisecond difference.
 * The arithmetic version is out by a day for a child born on 29 February, and
 * out by a whole year for anyone whose birthday is today: 365.25 days per year
 * accumulates enough drift by age five to round the wrong way.
 *
 * `on` is a parameter so a test can pin the day, and so a report generated for
 * a past term can ask "how old were they then".
 */
export function ageInYears(dateOfBirth: Date | string, on: Date | string = new Date()): number {
  const born = parts(dateOfBirth);
  const today = parts(typeof on === "string" ? on : new Date(on.toISOString()));

  let age = today.year - born.year;
  if (today.month < born.month || (today.month === born.month && today.day < born.day)) {
    age -= 1;
  }
  return Math.max(age, 0);
}

/** Both facts together — what the portfolio and the PDF each ask for. */
export function birthFacts(dateOfBirth: Date | string): {
  zodiac: ZodiacSign;
  yearAnimal: YearAnimal;
} {
  return { zodiac: westernZodiac(dateOfBirth), yearAnimal: mongolianYearAnimal(dateOfBirth) };
}
