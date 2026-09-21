import { User, UserRound, Users } from "lucide-react";
import type { Tone } from "@/components/ui/tone";
import { formatLongDate } from "@/lib/format";

/**
 * The five `AttendanceStatus` values, in one place.
 *
 * ★ Shared by `child-attendance.tsx` (the day list, the request form) and the
 * new overview page's calendar/summary — one map, so a status cannot read as
 * one colour on the tab and another on the calendar. The tones are the
 * product's own status palette (`Badge`'s `mint`/`sky`/`peach`/`danger`),
 * reused rather than a second, chart-specific palette: PRESENT is the one
 * "good" outcome, ABSENT the one "critical" one, and the rest sit between.
 */
/*
 * ★ Re-exported from `@kinder/contracts`, not defined here.
 *
 * The API's spreadsheet writes the same five words into a header row (see
 * `register-workbook.ts`), and a second copy of them is how one surface comes
 * to say "Хагас өдөр" while another says "Хагас хоног". The shared map also
 * carries `OTHER`, the sixth status `attendanceStatusSchema` predates — every
 * consumer here renders by `ATTENDANCE_STATUS_ORDER` below, which is still the
 * five, so nothing on an existing screen changes.
 */
export { ATTENDANCE_STATUS_LABEL } from "@kinder/contracts";

export const ATTENDANCE_STATUS_TONE: Record<string, "mint" | "sky" | "peach" | "danger"> = {
  PRESENT: "mint",
  HALF_DAY: "sky",
  EXCUSED: "sky",
  SICK: "peach",
  ABSENT: "danger",
};

/**
 * The same five statuses as a chart `Tone`.
 *
 * ★ It differs from `ATTENDANCE_STATUS_TONE` in exactly one entry, and that
 * difference is a type boundary rather than a second design decision: `Badge`
 * has a `danger` variant and the chart palette (`ui/tone.ts`) does not — its
 * six tones are accent washes, and `--color-danger` is deliberately outside
 * them. `ABSENT` becomes `peach`, the attention tone, which is the nearest the
 * chart palette has and the one the funding register's own alert already uses
 * for the same meaning.
 */
export const ATTENDANCE_STATUS_CHART_TONE: Record<string, Tone> = {
  PRESENT: "mint",
  HALF_DAY: "sky",
  EXCUSED: "sky",
  SICK: "sun",
  ABSENT: "peach",
};

/** Same tones, as a solid background fill for a calendar day cell or a chart segment. */
export const ATTENDANCE_STATUS_BG: Record<string, string> = {
  PRESENT: "bg-mint",
  HALF_DAY: "bg-sky",
  EXCUSED: "bg-sky",
  SICK: "bg-peach",
  ABSENT: "bg-danger",
};

/**
 * The four a teacher may *choose* — Ирсэн · Өвчтэй · Чөлөөтэй · Тасалсан.
 *
 * ★ A narrower set than the six the data holds, and deliberately so —
 * 2026-09-10, at the client's request ("4 сонголт л байна").
 *
 * `HALF_DAY` and `OTHER` are **not** removed. They are load-bearing in money:
 * the state funding claim counts `PRESENT` + `HALF_DAY`
 * (`funding.repository.ts`), the parent invoice bills the same pair
 * (`invoices.repository.ts`), and both spreadsheets carry a column each. Rows
 * already written with them keep rendering everywhere, this register included
 * — what changes is only what a teacher can newly assign.
 *
 * So this is a picker, not a vocabulary. Every *reader* in the product still
 * maps `ATTENDANCE_STATUS_LABEL`, which names all six, and a cell holding
 * "Хагас өдөр" draws it. `ATTENDANCE_STATUS_ORDER` below is untouched: the
 * legends and the funding register's columns are a settled report format.
 */
export const TEACHER_ATTENDANCE_STATUSES = ["PRESENT", "SICK", "EXCUSED", "ABSENT"] as const;

/**
 * The single Cyrillic letter a register cell shows — И, Ө, Ч, Т and the two
 * older values it must still be able to draw.
 *
 * ★ Not `label[0]`. "Ирсэн" and "Өвчтэй" would give И and Ө correctly, but
 * "Хагас өдөр" gives Х and "Тасалсан" gives Т — and the client's own sheet
 * uses Х for Хагас өдөр and Т for Тасалсан, so deriving them would be right by
 * luck rather than by decision. Written out, one letter per status.
 */
export const ATTENDANCE_STATUS_LETTER: Record<string, string> = {
  PRESENT: "И",
  SICK: "Ө",
  EXCUSED: "Ч",
  ABSENT: "Т",
  HALF_DAY: "Х",
  OTHER: "Б",
};

/** The order every legend and stacked bar renders in — fixed, never sorted by count. */
export const ATTENDANCE_STATUS_ORDER = [
  "PRESENT",
  "HALF_DAY",
  "EXCUSED",
  "SICK",
  "ABSENT",
] as const;

/**
 * Who handed the child over — drop-off, pickup, and (as of 2026-08-26) a
 * guardian's own arrival claim ("Ирц мэдэгдэх") all read this one map.
 * `MOTHER`/`FATHER` replaced a single `GUARDIAN` value, and `ALONE` is gone
 * entirely — dropped by client request: a kindergarten this young never
 * receives a child unaccompanied.
 */
export const ATTENDANCE_COMPANION_LABEL: Record<string, string> = {
  MOTHER: "Ээж",
  FATHER: "Аав",
  OTHER: "Бусад",
};

/** Same convention as `SURVEY_CATEGORY_META` (`lib/survey-meta.ts`) — the icon
 * component itself, not a name string, keyed the same as every other
 * companion map here. */
export const ATTENDANCE_COMPANION_ICON: Record<string, typeof UserRound> = {
  MOTHER: UserRound,
  FATHER: User,
  OTHER: Users,
};

export const ATTENDANCE_COMPANION_ORDER = ["MOTHER", "FATHER", "OTHER"] as const;

/** "Ээж**тэйгээ**", "Аав**тайгаа**", or the OTHER name itself suffixed the
 * same way ("Ахын найз**тай**") — the companion word inflected onto a
 * child's name the way a confirmation sentence needs it ("Оюун árrived
 * ...тэйгээ"). Falls back to the generic phrase when OTHER carries no name.
 * Mongolian's comitative suffix varies by the word's final sound in the
 * general case; this covers the three fixed categories (plus a free-text
 * name treated the same way `-тай` always is informally), not the general
 * rule. */
export function attendanceCompanionSuffix(companion: string, name?: string | null): string {
  if (companion === "MOTHER") return "ээжтэйгээ";
  if (companion === "FATHER") return "аавтайгаа";
  return name ? comitative(name) : "хамт ирсэн хүнтэйгээ";
}

/**
 * "эмээ" → "эмээтэй", "Жолооч" → "Жолоочтой", "Ахын найз" → "Ахын найзтай".
 *
 * ★ 2026-09-12, from a client screenshot: the sentence read "Г.Батбаяр
 * эмээ-тай … цэцэрлэгээс явлаа."
 *
 * A hyphen is how this was avoided rather than solved — free text was glued to
 * a fixed "-тай" so no name could be spelled outright wrongly, and every one of
 * them was then spelled visibly oddly instead. The comitative is the one
 * suffix in this file's way where vowel harmony is decidable from the word
 * alone: the last vowel chooses between -тай, -той and -тэй, with no
 * dependence on meaning or on the rest of the sentence. Genitive is not like
 * that, which is why `attendanceEventSentence` still keeps the child's name
 * uninflected.
 *
 * `и` is neutral in Mongolian — it takes the harmony of the vowel before it —
 * so it is skipped, and a name with nothing but `и` in it falls to -тэй, which
 * is the form those words take ("Чимэг", "Ишид").
 */
function comitative(word: string): string {
  const trimmed = word.trim();
  const BACK = "аоуяё";
  const ROUND = "оё";

  for (const letter of [...trimmed.toLowerCase()].reverse()) {
    if (letter === "и" || letter === "ь" || letter === "ъ") continue;
    if (ROUND.includes(letter)) return `${trimmed}той`;
    if (BACK.includes(letter)) return `${trimmed}тай`;
    if ("эөүеюий".includes(letter)) return `${trimmed}тэй`;
  }

  return `${trimmed}тэй`;
}

/**
 * "Б.Бат аавтайгаа 2026 оны 9-р сарын 11-нд 10:23 минутад цэцэрлэгтээ ирлээ."
 *
 * ★ One sentence builder for both events — 2026-09-12, at the client's wording:
 * "ирлээ гэдэг дээр дарахаар … 2026. 9. 11-нд 10:23 минутад цэцэрлэгтээ ирлээ
 * гэж өгүүлбэрээр харагд."
 *
 * The screens said the same thing in four different half-sentences — "10:23-д
 * аавтайгаа цэцэрлэгтээ ирлээ" on the parent's card, "Бат аавтайгаа
 * цэцэрлэгтээ 10:23 цагт ирлээ" in the teacher's panel — none of them naming
 * the day. A family reading yesterday's row needs the date in the sentence,
 * and one builder is what keeps the two screens from drifting apart again.
 *
 * ★★ The child's name is never inflected, only the companion word is. The
 * client's pickup example put the child in the genitive ("Б.Батийн аав"), and
 * Mongolian's genitive suffix depends on the final sound of the word — a rule
 * that cannot be applied to an arbitrary name without getting some of them
 * visibly wrong. Keeping the name in the subject and the suffix on "аав"/"ээж",
 * where the three categories are fixed and known, says the same thing and
 * cannot misspell somebody's child.
 */
export function attendanceEventSentence({
  mode,
  childName,
  companion,
  companionName,
  date,
  time,
}: {
  mode: "arrival" | "pickup";
  /** Written as given — `shortName()`'s "Б.Бат". Falls back to "Хүүхэд". */
  childName?: string | null;
  companion: string;
  companionName?: string | null;
  date: string | Date;
  /** `HH:MM`, already in the reader's own timezone. */
  time?: string | null;
}): string {
  const who = childName?.trim() || "Хүүхэд";
  const withWhom =
    companion === "OTHER" && !companionName?.trim()
      ? mode === "arrival"
        ? "хамт ирсэн хүнтэйгээ"
        : "авсан хүнтэйгээ"
      : attendanceCompanionSuffix(companion, companionName);
  const when = `${formatLongDate(date)}-нд`;
  const at = time ? ` ${time} минутад` : "";
  const what = mode === "arrival" ? "цэцэрлэгтээ ирлээ" : "цэцэрлэгээс явлаа";

  return `${who} ${withWhom} ${when}${at} ${what}.`;
}

/** "Бусад (Жолооч)" for a list row — the label, with the OTHER name
 * parenthesised when there is one. */
export function attendanceCompanionDisplay(companion: string, name?: string | null): string {
  const label = ATTENDANCE_COMPANION_LABEL[companion] ?? companion;
  return name ? `${label} (${name})` : label;
}
