import { Role } from "../../domain/enums";

/**
 * The role a member of staff gets from the ministry's own occupation code.
 *
 * ★ **Keyed on `jobCode`, never on `positionName`** — measured live against
 * institution 42778 on 2026-09-16. `positionName` is free text and the thirteen
 * real rows already disagree with themselves on capitalisation ("ахлах Тогооч",
 * "туслах Тогооч"); `jobCode` is ISCO-08 and its four-digit group is stable.
 *
 * ★★ **Unmapped returns `null`, and `null` means no account.** Two codes are
 * refused deliberately rather than missing by accident:
 *
 * - `5153` (building caretakers) — the жижүүр. `TEACHER` is the tempting
 *   default because it is the commonest staff role here; it would also hand
 *   every child's development record to the caretaker.
 * - `1341` (child-care services managers) — the эрхлэгч. `ADMIN` fits, and is
 *   refused because this flow has no approval step: a job title in somebody
 *   else's database must not decide who administers a kindergarten.
 *
 * `ACCOUNTANT` is absent for the same reason as `ADMIN`. Both stay
 * invitation-only.
 */
const ROLE_BY_OCCUPATION_GROUP: Record<string, Role> = {
  /** Early-childhood educators — багш, багшийн туслах. */
  "2342": Role.TEACHER,
  /** Education-methods specialists — арга зүйч. */
  "2351": Role.TEACHER,
  /** Cooks — тогооч. */
  "5120": Role.COOK,
};

/**
 * The roster rows nobody here has claimed yet — «ESIS-д бүртгэлтэй, системд
 * бүртгүүлээгүй».
 *
 * ★ One definition for the list the director reads and for «Бүх багшийг
 * урих», which issues an invitation per row of it. Two copies would drift,
 * and the drift would be an invitation for somebody the list says is
 * registered — a second account for one person.
 *
 * A row is claimed when an account here carries its `esisPersonId` or its
 * register number — or, for display and for not inviting twice, the same
 * name: an invited account carries neither key (12 of 13 on live data), and
 * listing every teacher the director already added as "not registered" was
 * the bug this rule fixed. Nothing is *granted* on a name.
 */
export function unclaimedRosterRows<
  R extends { esisPersonId: string; registerNumber: string; lastName: string; firstName: string },
>(
  roster: readonly R[],
  identities: readonly {
    esisPersonId: string | null;
    registerNumber: string | null;
    lastName: string;
    firstName: string;
  }[],
): R[] {
  const ids = new Set(identities.map((user) => user.esisPersonId).filter(Boolean));
  const registers = new Set(
    identities.map((user) => normalizeRegisterNumber(user.registerNumber)).filter(Boolean),
  );
  const names = new Set(
    identities.map((user) => normalizeIdentity(`${user.lastName} ${user.firstName}`)),
  );
  return roster.filter(
    (row) =>
      !ids.has(row.esisPersonId) &&
      !registers.has(row.registerNumber) &&
      !names.has(normalizeIdentity(`${row.lastName} ${row.firstName}`)),
  );
}

export function normalizeIdentity(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("mn-MN");
}

export function roleForJobCode(jobCode: string | null | undefined): Role | null {
  const group = /^(\d{4})-/.exec((jobCode ?? "").trim())?.[1];
  return group ? (ROLE_BY_OCCUPATION_GROUP[group] ?? null) : null;
}

/*
 * Cyrillic letters that have an identical-looking Latin twin. A teacher on a
 * Latin layout types the twin, the equality match fails, and the screen can
 * only say "not found" — which is indistinguishable from not being on the
 * roster at all. Mapping them costs nothing and removes a whole class of
 * unanswerable support question.
 */
const LOOKALIKE: Record<string, string> = {
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
  Y: "У",
};

/**
 * A register number in the one form the roster stores and the match compares.
 *
 * Returns `null` when the input is not two Cyrillic letters followed by eight
 * digits — the shape of a Mongolian регистрийн дугаар. A caller treats `null`
 * exactly as it treats "no such row": the same refusal, the same message.
 *
 * ★ **The upper-casing is load-bearing, not tidiness** — measured against
 * institution 42778 on 2026-09-16. `school/staff` returns register numbers in
 * **lower case**: 0 of its 13 matched this pattern as sent, 13 of 13 after
 * upper-casing. `teacher/list` returns the same thirteen people's numbers in
 * upper case, 10 of 10 as sent. The roster is built from `school/staff`, so
 * without this line no member of staff could ever be matched and the screen
 * would tell them they are not on the list.
 *
 * ★★ The pattern was checked against **117 real values** the same day — 13
 * staff, 10 teachers, 94 students. Every one is ten characters, and every
 * leading letter observed falls inside `А-Я` (U+0410–U+042F). `Ё`, `Ө` and `Ү`
 * are listed because they are Mongolian Cyrillic outside that range and a
 * register number may legitimately begin with one; none appeared in this
 * institution's data, so they are defensive rather than verified.
 */
export function normalizeRegisterNumber(value: string | null | undefined): string | null {
  const collapsed = (value ?? "").replace(/\s+/g, "").toUpperCase();
  const mapped = [...collapsed].map((ch) => LOOKALIKE[ch] ?? ch).join("");
  return /^[А-ЯЁӨҮ]{2}\d{8}$/.test(mapped) ? mapped : null;
}
