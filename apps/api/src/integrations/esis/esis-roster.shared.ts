import type { AgeBand } from "../../domain/enums";

/*
 * What the roster import and the group sync both need to agree on. One copy,
 * because two copies of the level table is how one of them refiles every group
 * the day the other is corrected.
 */

/**
 * ESIS's own level code → the age band this product files a group under.
 *
 * ★ **By the numeric code, not the name.** `academicLevelName` is Mongolian
 * free-ish text the ministry may reword; the code is the key. Verified live
 * against institution 42778 on 2026-09-20 — it returns exactly these four and
 * nothing else:
 *
 *     17=Ахлах  15=Бага  16=Дунд  18=Бэлтгэл
 *
 * ★★ The band names and the level names are **off by one**, and that is not a
 * mistake to "fix": ESIS's Бага is this product's NURSERY, its Дунд is JUNIOR,
 * and so on up. `seed-esis.ts` carries the same table with the same comment;
 * changing one without the other would silently refile every group.
 */
export const AGE_BAND_BY_LEVEL: Record<string, AgeBand> = {
  "15": "NURSERY",
  "16": "JUNIOR",
  "17": "MIDDLE",
  "18": "SENIOR",
};

/**
 * A name reduced to what two people typing the same class, or the same
 * child, agree on.
 *
 * Case and surrounding space are the two differences seen in practice; the
 * inner spacing is left alone, because «бага бүлэг» and «багабүлэг» are not
 * obviously the same name and guessing that they are would merge two real
 * classes — or two real children.
 */
export function normaliseName(name: string): string {
  return name.trim().toLocaleLowerCase("mn-MN");
}

/**
 * ESIS's date strings → a `Date`, or null.
 *
 * ★ Null rather than `new Date("")`, which is `Invalid Date` and reaches
 * Postgres as an error a hundred rows later, naming neither the row nor the
 * field. A child with no readable birth date is skipped where they are read.
 */
export function esisDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value.slice(0, 10));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
