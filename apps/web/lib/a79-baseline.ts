import {
  A79_DOMAINS,
  A79_LEVELS,
  type A79Domain,
  type A79GroupSummary,
  type A79Level,
} from "@kinder/contracts";

/**
 * «Гарааны үнэлгээ» — the А/79 baseline a teacher records as a survey, read
 * as the result screen reads a result (2026-10-21, the user: "үр дүнгийн
 * үнэлгээний загвар шиг").
 *
 * ★ No API of its own. The baseline is a teacher survey made from the А/79
 * template (`create-survey-wizard.tsx`): one 0/1 question per criterion,
 * prompted «Мэдлэг: <criterion>» (`a79Questions`). `GET /surveys/:id/
 * teacher-sheet` hands back the whole group's answers, and this turns them
 * into `A79GroupSummary`'s shape so the result screen's own chart and table
 * draw it.
 *
 * ★★ Matched by the prompt's text, never by position: a teacher may reorder
 * or reword a draft. A question that matches no criterion of the survey's
 * level is not counted, and `unmatched` says how many — a silently shorter
 * total would read as a weaker group. Only a submitted row counts; a
 * half-saved draft is not an assessment.
 */

export interface BaselineQuestion {
  id: string;
  prompt: string;
}

export interface BaselineRow {
  child: { id: string; firstName: string; lastName?: string | null };
  response: { submittedAt: string; answers: { questionId: string; value: unknown }[] } | null;
}

export interface BaselineChild {
  childId: string;
  firstName: string;
  lastName: string;
  level: A79Level["key"];
  /**
   * A solo workspace's child whose family has not paid the portal fee — named,
   * every figure withheld, as the result screen does (CLAUDE.md §1.7). The
   * teacher sheet does not say it; the caller marks it (`withFeeDue`).
   */
  feeDue: boolean;
  achieved: number;
  total: number;
  byDomain: { domain: A79Domain; achieved: number; total: number }[];
  /** No submitted response — not assessed (absent), never a 0. */
  notFilled: boolean;
  /** When the row was sent; null when it was not. */
  submittedAt: string | null;
}

export interface BaselineSummary {
  level: A79Level["key"];
  children: BaselineChild[];
  /** Questions that are not one of the level's criteria. */
  unmatched: number;
  /** The latest submission, for «… огноо». */
  lastSubmittedAt: string | null;
}

const promptOf = (domain: A79Domain, text: string) => `${domain}: ${text}`;
const normalise = (value: string) => value.replace(/\s+/g, " ").trim();

/** The level whose criteria the survey's prompts match most. */
export function baselineLevel(questions: BaselineQuestion[]): A79Level | null {
  const prompts = new Set(questions.map((q) => normalise(q.prompt)));
  let best: { level: A79Level; hits: number } | null = null;
  for (const level of A79_LEVELS) {
    const hits = level.criteria.filter((c) =>
      prompts.has(normalise(promptOf(c.domain, c.text))),
    ).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { level, hits };
  }
  return best?.level ?? null;
}

/** A «1» — the template's options are "0" and "1"; a number is accepted too. */
function met(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

export function baselineSummary(
  questions: BaselineQuestion[],
  rows: BaselineRow[],
): BaselineSummary | null {
  const level = baselineLevel(questions);
  if (!level) return null;

  const byPrompt = new Map(
    level.criteria.map((c) => [normalise(promptOf(c.domain, c.text)), c.domain] as const),
  );
  const counted = questions
    .map((q) => ({ id: q.id, domain: byPrompt.get(normalise(q.prompt)) }))
    .filter((q): q is { id: string; domain: A79Domain } => Boolean(q.domain));
  const unmatched = questions.length - counted.length;

  let lastSubmittedAt: string | null = null;
  const children: BaselineChild[] = rows.map(({ child, response }) => {
    if (response && (!lastSubmittedAt || response.submittedAt > lastSubmittedAt)) {
      lastSubmittedAt = response.submittedAt;
    }
    const answers = new Map((response?.answers ?? []).map((a) => [a.questionId, a.value]));
    const byDomain = A79_DOMAINS.map((domain) => {
      const inDomain = counted.filter((q) => q.domain === domain);
      return {
        domain,
        total: inDomain.length,
        achieved: response ? inDomain.filter((q) => met(answers.get(q.id))).length : 0,
      };
    });
    return {
      childId: child.id,
      firstName: child.firstName,
      lastName: child.lastName ?? "",
      level: level.key,
      feeDue: false,
      achieved: byDomain.reduce((sum, d) => sum + d.achieved, 0),
      total: counted.length,
      byDomain,
      notFilled: !response,
      submittedAt: response?.submittedAt ?? null,
    };
  });

  return { level: level.key, children, unmatched, lastSubmittedAt };
}

/** Marks the children the server withholds figures for, by id. */
export function withFeeDue<T extends { children: BaselineChild[] }>(
  summary: T,
  feeDue: ReadonlySet<string>,
): T {
  if (feeDue.size === 0) return summary;
  return {
    ...summary,
    children: summary.children.map((child) =>
      feeDue.has(child.childId)
        ? {
            ...child,
            feeDue: true,
            achieved: 0,
            byDomain: child.byDomain.map((d) => ({ ...d, achieved: 0 })),
          }
        : child,
    ),
  };
}

/** The filled-in children, in the result screen's own shape. */
export function asGroupSummary(summary: { children: BaselineChild[] }): A79GroupSummary {
  return { children: summary.children.filter((c) => !c.notFilled) };
}

/** One А/79 baseline survey's sheet — what `mergeBaselines` takes. */
export interface BaselineSheet {
  questions: BaselineQuestion[];
  rows: BaselineRow[];
}

export interface MergedBaseline {
  /** Every child of the group, once. */
  children: (BaselineChild & { assessedTwice: boolean })[];
  /** Children assessed, per level — «IV түвшин 5 · III түвшин 7». */
  byLevel: { level: A79Level["key"]; count: number }[];
  unmatched: number;
  lastSubmittedAt: string | null;
}

/**
 * The group's whole baseline — 2026-10-21, the user: in one class a teacher
 * may assess five children with the IV-level survey and seven with the III,
 * and the report shows all twelve.
 *
 * ★ A child's level is the survey they were filled in — the teacher chose it
 * on the survey; nothing here guesses one from age. A child filled in no
 * survey has no level and no figures: they were not assessed (absent), and
 * the screen says so without asking for the row to be filled.
 *
 * ★★ Filled in two surveys, the later submission counts and `assessedTwice`
 * says so, rather than averaging two different levels into one figure.
 */
export function mergeBaselines(sheets: BaselineSheet[]): MergedBaseline | null {
  const summaries = sheets
    .map((sheet) => baselineSummary(sheet.questions, sheet.rows))
    .filter((s): s is BaselineSummary => s !== null);
  if (summaries.length === 0) return null;

  const order: string[] = [];
  const picked = new Map<string, { child: BaselineChild; at: string | null; times: number }>();
  for (const summary of summaries) {
    for (const child of summary.children) {
      if (!picked.has(child.childId)) order.push(child.childId);
      const current = picked.get(child.childId);
      if (child.notFilled) {
        if (!current) picked.set(child.childId, { child, at: null, times: 0 });
        continue;
      }
      const at = child.submittedAt;
      const times = (current?.times ?? 0) + 1;
      if (!current || current.child.notFilled || (at ?? "") > (current.at ?? "")) {
        picked.set(child.childId, { child, at, times });
      } else {
        current.times = times;
      }
    }
  }

  const children = order.map((id) => {
    const entry = picked.get(id)!;
    return { ...entry.child, assessedTwice: entry.times > 1 };
  });
  const byLevel = A79_LEVELS.map((level) => ({
    level: level.key,
    count: children.filter((c) => !c.notFilled && c.level === level.key).length,
  })).filter((row) => row.count > 0);

  return {
    children,
    byLevel,
    unmatched: summaries.reduce((sum, s) => sum + s.unmatched, 0),
    lastSubmittedAt: summaries.reduce<string | null>(
      (latest, s) =>
        s.lastSubmittedAt && (!latest || s.lastSubmittedAt > latest) ? s.lastSubmittedAt : latest,
      null,
    ),
  };
}
