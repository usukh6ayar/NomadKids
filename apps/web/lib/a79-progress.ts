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

export const A79_STATUS_LABEL: Record<A79Status, string> = {
  INDEPENDENT: "Бие даан",
  SUPPORTED: "Дэмжлэгтэй",
  DEVELOPING: "Хөгжиж байна",
  NOT_YET: "Хараахан ажиглагдаагүй",
};

export const A79_STATUS_HINT: Record<A79Status, string> = {
  INDEPENDENT: "Тусламжгүйгээр илэрсэн.",
  SUPPORTED: "Асуулт, сануулга, үлгэрлэл, багахан тусламжтайгаар илэрсэн.",
  DEVELOPING: "Чадварын эхлэл байгаа ч тогтвортой биш.",
  NOT_YET: "Одоогоор дүгнэх нотолгоо байхгүй.",
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

export const A79_BAND_LABEL: Record<A79Band, string> = {
  MASTERED: "Хангалттай",
  PROGRESSING: "Ахиж байна",
  DEVELOPING: "Хөгжиж байна",
};

/** 80% and above, 50–79%, below 50% — the bands on the client's design. */
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
  const pct = (a: number, t: number) => (t > 0 ? Math.round((a / t) * 100) : 0);
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
    ["Бие даан илрүүлсэн", `${score.achieved} / ${score.total} (${score.percent}%)`],
    ...score.byDomain.map((row) => [
      row.domain,
      `${row.achieved} / ${row.total} (${row.percent}%)`,
    ]),
    [],
    ["Хэсэг", "№", "Шалгуур", "Одоогийн төлөв", ...A79_STATUSES.map((s) => A79_STATUS_LABEL[s])],
  ];
  a79Level(progress.level).criteria.forEach((criterion, index) => {
    const row = byNumber.get(index + 1);
    lines.push([
      criterion.domain,
      index + 1,
      criterion.text,
      A79_STATUS_LABEL[row?.status ?? "NOT_YET"],
      ...A79_STATUSES.map((status) =>
        (row?.evidence ?? [])
          .filter((e) => e.status === status)
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
