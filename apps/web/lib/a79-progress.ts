import { z } from "zod";
import { A79_LEVELS, type A79Domain, type A79Level } from "@/lib/a79-assessment";

/**
 * А/79 in the progress record — 2026-10-08, the client: a teacher links an
 * observation to one or more А/79 criteria and says how the skill showed, and
 * «Үр дүнгийн үнэлгээ» reads a child's criteria back as a result.
 *
 * The contract the backend is asked for. Kept in the web app until it lands in
 * `@kinder/contracts`, as `lib/feedback.ts` is:
 *
 *   PUT /observations/:observationId/a79-links ← observationA79LinksSchema   (TEACHER, ADMIN)
 *   GET /children/:childId/a79-progress?level=I|II|III|IV → a79ProgressSchema (TEACHER, ADMIN)
 *
 * ★ A separate PUT rather than a field on `POST /children/:id/observations`:
 * that body is `.strict()`, so an unknown key would fail the whole note — and a
 * note is worth keeping whether or not the links saved.
 *
 * ★★ A criterion is named by its level and its number within the level, 1 to
 * 37 / 41 / 46 / 49 in the order of the client's PDF (`lib/a79-assessment.ts`),
 * which is how the document itself numbers them («Ш18»).
 */

export const A79_LEVEL_KEYS = ["I", "II", "III", "IV"] as const;
export type A79LevelKey = (typeof A79_LEVEL_KEYS)[number];

/** How the skill showed — the four the client's design names. */
export const A79_STATUSES = ["INDEPENDENT", "SUPPORTED", "DEVELOPING", "NOT_YET"] as const;
export type A79Status = (typeof A79_STATUSES)[number];

/**
 * ★ The three a teacher chooses from, and the result table's three columns —
 * 2026-10-22, the user: the result's own words, «Хангалттай эзэмшиж байна /
 * Ахиж байна / Хөгжиж байна», not four statuses of their own. The stored
 * values stay (no migration): INDEPENDENT, SUPPORTED, DEVELOPING. NOT_YET is
 * no longer offered; a link saved with it reads as «Хөгжиж байна».
 */
export const A79_CHOICES = ["INDEPENDENT", "SUPPORTED", "DEVELOPING"] as const;
export type A79Choice = (typeof A79_CHOICES)[number];

/** The column a stored status reads under — NOT_YET under «Хөгжиж байна». */
export function a79Choice(status: A79Status): A79Choice {
  return status === "NOT_YET" ? "DEVELOPING" : status;
}

export const A79_STATUS_LABEL: Record<A79Status, string> = {
  INDEPENDENT: "Хангалттай эзэмшиж байна",
  SUPPORTED: "Ахиж байна",
  DEVELOPING: "Хөгжиж байна",
  NOT_YET: "Хөгжиж байна",
};

export const A79_STATUS_HINT: Record<A79Status, string> = {
  INDEPENDENT: "Тусламжгүйгээр, тогтвортой илэрсэн.",
  SUPPORTED: "Сануулга, дэмжлэгтэйгээр илэрсэн.",
  DEVELOPING: "Чадварын эхлэл бий, тогтвортой биш.",
  NOT_YET: "Чадварын эхлэл бий, тогтвортой биш.",
};

export const a79LinkSchema = z.object({
  level: z.enum(A79_LEVEL_KEYS),
  number: z.number().int().min(1),
  status: z.enum(A79_STATUSES),
  note: z.string().max(500).nullish(),
});
export type A79Link = z.infer<typeof a79LinkSchema>;

export const observationA79LinksSchema = z.object({ links: z.array(a79LinkSchema) });

/**
 * One linked note, as evidence for one criterion — the status the teacher gave
 * it on that note, and enough of the note to recognise it.
 */
export const a79EvidenceSchema = z.object({
  observationId: z.string(),
  observedOn: z.string(),
  status: z.enum(A79_STATUSES),
  /** «Ажиглалт», «Ярилцлага», «Бүтээл» — the note's type name. */
  typeName: z.string().nullish(),
  /** The link's own «Тайлбар», else the opening of the note. */
  note: z.string().nullish(),
});
export type A79Evidence = z.infer<typeof a79EvidenceSchema>;

/**
 * A child's criteria at one level: the latest status the evidence gives each,
 * and every note linked to it, newest first. A criterion nobody has linked yet
 * is absent, not `NOT_YET` — the screen fills those in from the full list.
 *
 * ★ The evidence list was added 2026-10-08 — the client: each criterion a row,
 * the four statuses its columns, each note under the status it was given.
 */
export const a79ProgressSchema = z.object({
  level: z.enum(A79_LEVEL_KEYS),
  criteria: z.array(
    z.object({
      number: z.number().int(),
      status: z.enum(A79_STATUSES),
      evidence: z.array(a79EvidenceSchema),
    }),
  ),
});
export type A79Progress = z.infer<typeof a79ProgressSchema>;

/**
 * A group's А/79 result, one row per child — the «Үр дүнгийн үнэлгээ» tab of
 * Тайлан (client, 2026-10-08).
 *
 *   GET /groups/:groupId/a79-summary?from=&to= → a79GroupSummarySchema  (TEACHER, ADMIN)
 *
 * ★ Counts, not each child's criteria: the server scores with the same rule as
 * `a79Score` (met = latest evidence «Бие даан»), so the tab is one request and
 * not one per child (CLAUDE.md §3.4).
 */
export const a79GroupSummarySchema = z.object({
  children: z.array(
    z.object({
      childId: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      level: z.enum(A79_LEVEL_KEYS),
      /** Unpaid portal fee in a solo workspace — named, figures withheld. */
      feeDue: z.boolean().default(false),
      achieved: z.number().int(),
      total: z.number().int(),
      byDomain: z.array(
        z.object({
          domain: z.enum(["Мэдлэг", "Чадвар", "Төлөвшил"]),
          achieved: z.number().int(),
          total: z.number().int(),
        }),
      ),
    }),
  ),
});
export type A79GroupSummary = z.infer<typeof a79GroupSummarySchema>;

/** Мэдлэг yellow, Чадвар red, Төлөвшил green — the client, 2026-10-08. */
export const A79_DOMAIN_FILL: Record<A79Domain, string> = {
  Мэдлэг: "var(--color-yellow-chart)",
  Чадвар: "var(--color-red-chart)",
  Төлөвшил: "var(--color-mint-chart)",
};

export const A79_NOT_READY = "А/79 холбоосын сервер холболт хараахан бэлэн болоогүй байна.";

export function a79Level(key: A79LevelKey): A79Level {
  return A79_LEVELS.find((level) => level.key === key)!;
}

/** The level a child's age puts them at — 2→I, 3→II, 4→III, 5→IV, clamped. */
export function a79LevelForAge(years: number | null): A79LevelKey {
  if (years === null) return "I";
  return A79_LEVEL_KEYS[Math.min(3, Math.max(0, years - 2))]!;
}

/** «Ш18» — the document's own way of naming a criterion. */
export function a79Code(link: Pick<A79Link, "level" | "number">): string {
  return `А/79 · ${link.level} · Ш${link.number}`;
}

export function a79CriterionText(level: A79LevelKey, number: number): string {
  return a79Level(level).criteria[number - 1]?.text ?? "";
}

export type A79Band = "MASTERED" | "PROGRESSING" | "DEVELOPING";

/** The regulation's own words — А/79 §2.10 (the user, 2026-10-22). */
export const A79_BAND_LABEL: Record<A79Band, string> = {
  MASTERED: "Хангалттай эзэмшиж байна",
  PROGRESSING: "Ахиж байна",
  DEVELOPING: "Хөгжиж байна",
};

/**
 * А/79 §2.10: 80.0% and above «Хангалттай эзэмшиж байна», 50.0–79.0%
 * «Ахиж байна», 49.0% and below «Хөгжиж байна». The regulation leaves the
 * gaps between (79.0–80.0, 49.0–50.0) unnamed; they fall to the band below
 * the next threshold — under 80 is not «Хангалттай», under 50 is «Хөгжиж».
 */
export const A79_BAND_RULE =
  "80.0% ба түүнээс дээш — Хангалттай эзэмшиж байна · 50.0–79.9% — Ахиж байна · 49.9% ба түүнээс доош — Хөгжиж байна";

/**
 * A percentage to one decimal, as the regulation writes them — cut, never
 * rounded up (2026-10-22, the user): 39 of 49 is 79.5…%, and rounded to 80
 * it read «Хангалттай» where the regulation says «Ахиж байна». Cut, the
 * figure shown and the band beside it always agree.
 */
export function a79Percent(achieved: number, total: number): number {
  return total > 0 ? Math.floor((achieved * 1000) / total + 1e-9) / 10 : 0;
}

/**
 * The mean of several children's shares, cut to one decimal once, at the end.
 * Averaged from each child's exact share, never from their cut percentages:
 * 80.43%, 50% and 19.57% average to 50.0%, where their cut 80.4, 50 and 19.5
 * would read 49.9% — «Хөгжиж байна» for a group that is not.
 */
export function a79MeanShare(rows: { achieved: number; total: number }[]): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce(
    (total, row) => total + (row.total > 0 ? row.achieved / row.total : 0),
    0,
  );
  return Math.floor((sum * 1000) / rows.length + 1e-9) / 10;
}

export function a79Band(percent: number): A79Band {
  if (percent >= 80) return "MASTERED";
  if (percent >= 50) return "PROGRESSING";
  return "DEVELOPING";
}

export interface A79Score {
  percent: number;
  achieved: number;
  total: number;
  byDomain: { domain: A79Domain; percent: number; achieved: number; total: number }[];
}

/**
 * ★ A criterion counts as met only when its latest evidence is «Бие даан».
 * А/79 marks each criterion 0 or 1; «Дэмжлэгтэй» is a skill on its way, not
 * yet one the child has, and counting it as half would put a number on the
 * report the document does not.
 */
export function a79Score(progress: A79Progress): A79Score {
  const level = a79Level(progress.level);
  const met = new Set(
    progress.criteria.filter((row) => row.status === "INDEPENDENT").map((row) => row.number),
  );
  const pct = a79Percent;
  const domains = [...new Set(level.criteria.map((c) => c.domain))];
  const byDomain = domains.map((domain) => {
    const numbers = level.criteria.flatMap((c, i) => (c.domain === domain ? [i + 1] : []));
    const achieved = numbers.filter((n) => met.has(n)).length;
    return { domain, achieved, total: numbers.length, percent: pct(achieved, numbers.length) };
  });
  const total = level.criteria.length;
  return { percent: pct(met.size, total), achieved: met.size, total, byDomain };
}

/**
 * One child's А/79 result as a spreadsheet — «Excel» beside the level picker,
 * 2026-10-08, the client. CSV with a byte-order mark, as every other «Excel»
 * button in the product writes (`yearly-attendance.tsx`): Excel opens it with
 * the Cyrillic intact.
 *
 * Rows follow the screen: a row per criterion, the four statuses as columns,
 * each note under the status it was given — date, type and note on a line.
 */
export function a79Csv(
  child: { name: string; age: number | null },
  progress: A79Progress,
  formatDay: (iso: string) => string,
): string {
  const score = a79Score(progress);
  const byNumber = new Map(progress.criteria.map((row) => [row.number, row]));
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const lines: (string | number)[][] = [
    ["Хүүхэд", child.name],
    ["Нас", child.age ?? ""],
    ["Түвшин", `${progress.level} түвшин`],
    ["Хангалттай эзэмшсэн", `${score.achieved} / ${score.total} (${score.percent}%)`],
    ...score.byDomain.map((row) => [
      row.domain,
      `${row.achieved} / ${row.total} (${row.percent}%)`,
    ]),
    [],
    ["Хэсэг", "№", "Шалгуур", "Одоогийн төлөв", ...A79_CHOICES.map((s) => A79_STATUS_LABEL[s])],
  ];
  a79Level(progress.level).criteria.forEach((criterion, index) => {
    const row = byNumber.get(index + 1);
    lines.push([
      criterion.domain,
      index + 1,
      criterion.text,
      row ? A79_STATUS_LABEL[row.status] : "Тэмдэглэл холбоогүй",
      ...A79_CHOICES.map((status) =>
        (row?.evidence ?? [])
          .filter((e) => a79Choice(e.status) === status)
          .map((e) =>
            [formatDay(e.observedOn), e.typeName, e.note ? `— ${e.note}` : ""]
              .filter(Boolean)
              .join(" "),
          )
          .join("\n"),
      ),
    ]);
  });
  return lines.map((line) => line.map(quote).join(",")).join("\r\n");
}
