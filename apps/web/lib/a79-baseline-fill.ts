import { A79_DOMAINS, type A79Domain } from "@kinder/contracts";
import type { BaselineCriterion, BaselineQuestion } from "@/lib/a79-baseline";

/**
 * Filling «Гарааны үнэлгээ» in for one child, one domain at a time
 * (2026-10-27, the user: «мэдлэг гээд тэндээс сонгож, чадвар гээд тусдаа»),
 * a «0» or «1» per criterion. The arithmetic only;
 * `components/assessment/a79-baseline-fill.tsx` draws it.
 *
 * ★ A criterion left blank has no answer, so «Чадвар 0/28» and «Чадвар —»
 * stay two different things. «Дуусгах» counts the blanks «0».
 *
 * ★★ The row goes to the server as the teacher sheet keeps it: every question
 * answered is the child's response, anything less a draft to continue.
 */
/** One question of the survey, as much of it as finishing a row reads. */
export interface FillQuestion extends BaselineQuestion {
  type: string;
  options?: unknown;
}

/** A child's answers, question id → value («0», «1»). */
export type FillAnswers = Record<string, unknown>;

/** A «1» — what the template writes; a number or `true` from an older row too. */
export function isMet(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

/** Any answer at all — a «0» too. */
export function isAnswered(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** A row's answers now — its response, else its draft, else none. */
export function rowAnswers(row: {
  response?: { answers: { questionId: string; value: unknown }[] } | null;
  draft?: { answers: { questionId: string; value: unknown }[] } | null;
}): FillAnswers {
  const answers = row.response?.answers ?? row.draft?.answers ?? [];
  return Object.fromEntries(answers.map((a) => [a.questionId, a.value]));
}

export interface DomainProgress {
  domain: A79Domain;
  total: number;
  answered: number;
  met: number;
  /** Every criterion of the domain answered. */
  done: boolean;
}

/** How far each domain is, in the order А/79 lists them; an empty domain is left out. */
export function domainProgress(
  criteria: BaselineCriterion[],
  answers: FillAnswers,
): DomainProgress[] {
  return A79_DOMAINS.flatMap((domain) => {
    const inDomain = criteria.filter((c) => c.domain === domain);
    if (inDomain.length === 0) return [];
    const answered = inDomain.filter((c) => isAnswered(answers[c.questionId])).length;
    return [
      {
        domain,
        total: inDomain.length,
        answered,
        met: inDomain.filter((c) => isMet(answers[c.questionId])).length,
        done: answered === inDomain.length,
      },
    ];
  });
}

/** The answers with one domain saved: what is ticked stays «1», the rest «0». */
export function settleDomain(
  criteria: BaselineCriterion[],
  answers: FillAnswers,
  domain: A79Domain,
): FillAnswers {
  const next = { ...answers };
  for (const c of criteria) {
    if (c.domain === domain) next[c.questionId] = isMet(answers[c.questionId]) ? "1" : "0";
  }
  return next;
}

/** «Дуусгах»: every domain saved, and a question that is no criterion «0» where it allows one. */
export function finishAnswers(
  criteria: BaselineCriterion[],
  others: FillQuestion[],
  answers: FillAnswers,
): FillAnswers {
  let next = answers;
  for (const domain of A79_DOMAINS) next = settleDomain(criteria, next, domain);
  next = { ...next };
  for (const q of others) {
    if (isAnswered(next[q.id])) continue;
    const options = Array.isArray(q.options) ? q.options : [];
    if ((q.type === "SINGLE_CHOICE" || q.type === "CHECKBOX") && options.includes("0")) {
      next[q.id] = q.type === "CHECKBOX" ? ["0"] : "0";
    }
  }
  return next;
}

/** Every question of the survey answered — the row is the child's response. */
export function isCompleteRow(questions: FillQuestion[], answers: FillAnswers): boolean {
  return questions.every((q) => isAnswered(answers[q.id]));
}

/** The body of a row, in the survey's question order, answered questions only. */
export function answersBody(questions: FillQuestion[], answers: FillAnswers) {
  return questions
    .filter((q) => isAnswered(answers[q.id]))
    .map((q) => ({ questionId: q.id, value: answers[q.id] }));
}

/**
 * Where a row goes: complete, the child's response; less, a draft. ★ A child
 * who has a response is corrected whole — the server refuses them a draft —
 * so such a row that is not complete cannot be saved (`blocked`).
 */
export function saveKind(
  questions: FillQuestion[],
  answers: FillAnswers,
  hasResponse: boolean,
): "response" | "draft" | "blocked" {
  if (isCompleteRow(questions, answers)) return "response";
  return hasResponse ? "blocked" : "draft";
}
