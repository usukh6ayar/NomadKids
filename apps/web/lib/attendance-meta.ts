import { User, UserRound, Users } from "lucide-react";

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
export const ATTENDANCE_STATUS_LABEL: Record<string, string> = {
  PRESENT: "Ирсэн",
  HALF_DAY: "Хагас өдөр",
  EXCUSED: "Чөлөөтэй",
  SICK: "Өвчтэй",
  ABSENT: "Тасалсан",
};

export const ATTENDANCE_STATUS_TONE: Record<string, "mint" | "sky" | "peach" | "danger"> = {
  PRESENT: "mint",
  HALF_DAY: "sky",
  EXCUSED: "sky",
  SICK: "peach",
  ABSENT: "danger",
};

/** Same tones, as a solid background fill for a calendar day cell or a chart segment. */
export const ATTENDANCE_STATUS_BG: Record<string, string> = {
  PRESENT: "bg-mint",
  HALF_DAY: "bg-sky",
  EXCUSED: "bg-sky",
  SICK: "bg-peach",
  ABSENT: "bg-danger",
};

/** The order every legend and stacked bar renders in — fixed, never sorted by count. */
export const ATTENDANCE_STATUS_ORDER = ["PRESENT", "HALF_DAY", "EXCUSED", "SICK", "ABSENT"] as const;

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

/** Same convention as `SURVEY_TYPE_META` (`lib/survey-meta.ts`) — the icon
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
  return name ? `${name}-тай` : "хамт ирсэн хүнтэйгээ";
}

/** "Бусад (Жолооч)" for a list row — the label, with the OTHER name
 * parenthesised when there is one. */
export function attendanceCompanionDisplay(companion: string, name?: string | null): string {
  const label = ATTENDANCE_COMPANION_LABEL[companion] ?? companion;
  return name ? `${label} (${name})` : label;
}
