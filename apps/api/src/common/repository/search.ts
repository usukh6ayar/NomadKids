/**
 * One definition of what "хайх" means, for every list in the product.
 *
 * Order А/261, kindergarten criterion 21 asks that search works across the
 * fields a reader would expect. It was marked ◐ not because search was missing
 * but because it was **not uniform**: seven modules had a `q` and each had
 * written it out by hand, so four trimmed the term and three did not, and a
 * module with no `q` at all simply had no search. A person who learns that
 * typing a name works on one screen and finds it does nothing on the next has
 * learned the system is unreliable, which is the same lesson a wrong result
 * teaches.
 *
 * ★ This file is the counterpart to `tenant-scope.ts` and exists for the same
 * reason: a rule reconstructed by hand at every call site is a rule that will
 * eventually be forgotten at one of them. `ATTENDANCE_STATUS`'s six values
 * written out in four places is the worked example of that going wrong
 * (CLAUDE.md §7) — a status list by hand is how "Бусад" shipped broken.
 *
 * ★★ It deliberately does **not** touch the tenant filter. `searchWhere`
 * returns a fragment for a caller to place inside `scopedWhere`'s conditions,
 * where it can narrow the guards and can never widen them.
 */

import { z } from "zod";
import type { WhereFragment } from "./tenant-scope";

/**
 * The `q` every list query parses.
 *
 * ★ Trimmed, and an all-whitespace term becomes `undefined` rather than `""`.
 *
 * Without the trim, a term pasted with a trailing space matches nothing and the
 * screen reports "олдсонгүй" about a child who is right there — the failure is
 * invisible because the space is. Four of the seven modules trimmed and three
 * did not, which is exactly the inconsistency criterion 21 names.
 *
 * `undefined` rather than `""` matters downstream: `searchWhere` returns `null`
 * for it, so a repository's `...(fragment ?? {})` adds no condition at all. An
 * empty `contains` would match every row, which happens to be the same answer —
 * but only by luck, and not on a `startsWith` or an exact match.
 */
export const searchTermSchema = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => (value ? value : undefined));

/**
 * A case-insensitive `contains` across the given fields, as an `OR`.
 *
 * Returns `null` — not an empty object — when there is nothing to search for,
 * so a call site that forgets to spread it conditionally fails to compile
 * rather than quietly matching everything.
 *
 * ★ `contains`, not full-text search. Postgres's `to_tsvector` has no Mongolian
 * configuration, so its stemming would treat "Оюунаа" and "Оюунаагийн" as
 * unrelated while lower-casing them identically — worse than a substring match,
 * and slower. `mode: "insensitive"` compiles to `ILIKE`, which handles Cyrillic
 * correctly under the database's own collation. If a list ever grows past what
 * `ILIKE '%…%'` can scan, the fix is a trigram index on the same columns, not a
 * different matching rule.
 *
 * ★★ Nested paths are written as objects by the caller, because Prisma has no
 * string path syntax:
 *
 * ```ts
 * searchWhere(q, ["title"], [{ child: { lastName: … } }])  // ← not this
 * ```
 *
 * — use `searchRelation` below instead, which keeps the field list flat.
 */
export function searchWhere(
  term: string | undefined,
  fields: readonly string[],
): WhereFragment | null {
  if (!term || fields.length === 0) return null;

  return {
    OR: fields.map((field) => ({ [field]: { contains: term, mode: "insensitive" as const } })),
  };
}

/**
 * The same, for fields reached through a relation — a child's name on a list of
 * that child's records, say.
 *
 * ```ts
 * searchRelation(q, "child", ["lastName", "firstName"])
 * // → { child: { OR: [{ lastName: { contains: … } }, …] } }
 * ```
 *
 * ★ The `OR` is nested *inside* the relation rather than sitting beside it.
 * `{ OR: [{ child: { lastName } }, { child: { firstName } }] }` is the same
 * result and a different query plan — Postgres cannot use the relation's index
 * once the alternatives are lifted above the join.
 */
export function searchRelation(
  term: string | undefined,
  relation: string,
  fields: readonly string[],
): WhereFragment | null {
  const inner = searchWhere(term, fields);
  if (!inner) return null;
  return { [relation]: inner };
}

/**
 * Combines several fragments into one condition, dropping the nulls.
 *
 * ★ The fragments are joined with `OR`, not `AND`: they are alternative places
 * the *same* term might match. "Дорж" typed into a list of invoices should find
 * the invoice numbered Дорж-01 **and** the one belonging to a child called
 * Дорж — a reader who has to know which field a system searches has been given
 * a puzzle rather than a search box.
 */
export function anyOf(...fragments: (WhereFragment | null)[]): WhereFragment | null {
  const present = fragments.filter((f): f is WhereFragment => f !== null);
  if (present.length === 0) return null;
  if (present.length === 1) return present[0]!;
  return { OR: present };
}
