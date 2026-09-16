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
 */
export function normalizeRegisterNumber(value: string | null | undefined): string | null {
  const collapsed = (value ?? "").replace(/\s+/g, "").toUpperCase();
  const mapped = [...collapsed].map((ch) => LOOKALIKE[ch] ?? ch).join("");
  return /^[А-ЯЁӨҮ]{2}\d{8}$/.test(mapped) ? mapped : null;
}
