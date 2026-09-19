/**
 * Who the state subsidises the meals of — `нэмэлт.md` §3.
 *
 * §3 asks for a per-child meal cost split by source, and a split needs to know
 * which children the state pays for. The kindergarten does not decide that;
 * the ministry does, and `cook/levelHood/students` (api 128) is where it says
 * so. This file is the join between that answer and the local roster.
 *
 * ★ **Pure functions, taking data and returning data** — the same argument
 * `funding-rules.ts` makes for the arithmetic beside it. No Prisma, no HTTP,
 * no authorization: what makes this hard is the matching, and matching is
 * exactly the kind of logic that has to be readable and testable on its own.
 *
 * ★★ **Nothing here is stored.** `children` carries no ESIS person id —
 * `нэмэлт.md` §15, the external-id history, is not built — so a match is made
 * when a screen asks and forgotten afterwards. That is a deliberate choice and
 * not only a consequence of §15: eligibility is the ministry's fact and it
 * changes without telling us, so a stored copy would be a number that is right
 * on the day it was written and silently wrong after. Reading it live means
 * the screen is either current or visibly unavailable.
 */

/** One row of `students/list`, reduced to what the match needs. */
export interface RosterEntry {
  personId: string;
  lastName: string | null;
  firstName: string | null;
  /** ISO, as ESIS sends it — `2024-07-04T00:00:00.000Z` or `2024-07-04`. */
  dateOfBirth: string | null;
  familyName?: string | null;
  lastNameMgl?: string | null;
  firstNameMgl?: string | null;
}

/**
 * One row of `cook/levelHood/students`, after the refused fields are gone.
 *
 * ★ `undefined` as well as `null`, because the schema's fields are optional
 * and ESIS may omit a key entirely rather than send it empty. Both mean the
 * same thing to `discountStatus` — the ministry has not said — and admitting
 * the wider type here is what keeps that decision in one place instead of at
 * every call site.
 */
export interface DiscountEntry {
  personId: string;
  isFoodDiscount?: string | null;
  orderNum?: string | null;
}

/** A local child, as the register holds them. */
export interface LocalChild {
  id: string;
  lastName: string;
  firstName: string;
  /** Midnight UTC, from a `@db.Date` column. */
  dateOfBirth: Date;
}

/**
 * What the ministry says about one child's meal subsidy.
 *
 * ★ Three states, not two. `UNASSESSED` is the one that matters and the one a
 * boolean would have destroyed: the discount service returned 65 rows against
 * a roster of 83 on this deployment, so eighteen children are not in it at
 * all. They are not children without a subsidy — they are children the
 * ministry has not ruled on, and pricing them as "no discount" would bill a
 * family for something the state may be about to pay.
 */
export type FoodDiscountStatus = "ELIGIBLE" | "NOT_ELIGIBLE" | "UNASSESSED";

export interface ChildFoodDiscount {
  childId: string;
  status: FoodDiscountStatus;
  /** The ministry's order, when it named one. Absent on most rows. */
  orderNum: string | null;
}

/**
 * ESIS's Mongolian yes/no, as a status.
 *
 * ★ Compared case-insensitively and trimmed, because it is prose rather than a
 * code: the service sends "Тийм" today and nothing in the contract promises it
 * will not send "тийм" tomorrow.
 *
 * ★★ Anything that is neither yes nor no reads as `UNASSESSED`, never as a
 * refusal. An empty string, a null, or a word this function has not seen are
 * all "the ministry has not said", which is the answer that leaves the child's
 * price alone rather than silently charging their family.
 */
export function discountStatus(value: string | null | undefined): FoodDiscountStatus {
  const normalized = (value ?? "").trim().toLocaleLowerCase("mn-MN");
  if (normalized === "тийм") return "ELIGIBLE";
  if (normalized === "үгүй") return "NOT_ELIGIBLE";
  return "UNASSESSED";
}

/**
 * `"Батбаяр Ганболд"` and `" батбаяр  ганболд "` are the same name.
 *
 * Identical to `attendance.service.ts`'s normaliser on purpose: the two do the
 * same job against the same upstream, and a second spelling of "the same name"
 * is how one screen starts finding children the other cannot.
 */
function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("mn-MN");
}

/** `2024-07-04T00:00:00.000Z` and `2024-07-04` both yield `2024-07-04`. */
function isoDay(value: string | Date | null): string {
  if (value === null) return "";
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/**
 * Local child → ESIS `personId`, by name and date of birth.
 *
 * ★ Both, never the name alone. Two children called Б.Сараа in one
 * kindergarten is ordinary; two born on the same day as well is not, and the
 * pair is what makes the match safe enough to price money against.
 *
 * ★★ **An ambiguous match resolves to nothing.** Where two roster entries fit
 * one child, neither is chosen — the child comes back `UNASSESSED`, which
 * reads on screen as "ESIS has not said" and leaves their price untouched.
 * Picking the first would be a coin toss that decides a family's bill.
 *
 * ★★★ The four name spellings mirror the attendance matcher: ESIS carries a
 * Cyrillic pair, a traditional-script pair and a clan name, and which of them
 * a kindergarten typed into the ministry's form is not something this code can
 * know. Trying all of them is what makes the match work on real data.
 */
export function personIdByChild(
  children: readonly LocalChild[],
  roster: readonly RosterEntry[],
): Map<string, string> {
  const found = new Map<string, string>();

  for (const child of children) {
    const wanted = normalizedName(`${child.lastName} ${child.firstName}`);
    const birthday = isoDay(child.dateOfBirth);

    const matches = roster.filter((entry) => {
      if (isoDay(entry.dateOfBirth) !== birthday) return false;
      return [
        `${entry.lastName ?? ""} ${entry.firstName ?? ""}`,
        `${entry.lastNameMgl ?? ""} ${entry.firstNameMgl ?? ""}`,
        `${entry.familyName ?? ""} ${entry.firstName ?? ""}`,
      ]
        .map(normalizedName)
        .includes(wanted);
    });

    if (matches.length === 1) found.set(child.id, matches[0]!.personId);
  }

  return found;
}

/**
 * Each local child's subsidy status, from the two ESIS reads.
 *
 * ★ Every child comes back, including the ones with no match and the ones the
 * ministry has not assessed. A caller that received only the eligible ones
 * would have to decide what the absence of a child meant, and the whole point
 * of `UNASSESSED` is that "absent" has two meanings this function has already
 * told apart.
 */
export function foodDiscountByChild(
  children: readonly LocalChild[],
  roster: readonly RosterEntry[],
  discounts: readonly DiscountEntry[],
): ChildFoodDiscount[] {
  const personIds = personIdByChild(children, roster);
  const byPerson = new Map(discounts.map((row) => [String(row.personId), row]));

  return children.map((child) => {
    const personId = personIds.get(child.id);
    const row = personId === undefined ? undefined : byPerson.get(personId);

    return {
      childId: child.id,
      status: row ? discountStatus(row.isFoodDiscount) : "UNASSESSED",
      orderNum: row?.orderNum?.trim() ? row.orderNum : null,
    };
  });
}

/** How many children fall in each state — the figure a register shows. */
export function countByStatus(rows: readonly ChildFoodDiscount[]): {
  eligible: number;
  notEligible: number;
  unassessed: number;
} {
  return {
    eligible: rows.filter((row) => row.status === "ELIGIBLE").length,
    notEligible: rows.filter((row) => row.status === "NOT_ELIGIBLE").length,
    unassessed: rows.filter((row) => row.status === "UNASSESSED").length,
  };
}
