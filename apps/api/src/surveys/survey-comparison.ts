import { indicatorsOf, maxScoreOf, meanScore, scoreOf } from "./survey-scoring";

/**
 * Pairing two waves of the same questionnaire — RFP Module 1.2.
 *
 * ★ Pure, like `survey-scoring.ts`, and for the same reason: Module 1.3's
 * Sheet 3 and Sheet 4 are this comparison rendered into a spreadsheet. One
 * implementation means the workbook and the screen cannot disagree.
 */

export interface WaveQuestion {
  id: string;
  type: string;
  prompt: string;
  options?: unknown;
  indicatorKey: string | null;
}

export interface WaveAnswer {
  questionId: string;
  childId: string | null;
  value: unknown;
}

export interface Wave {
  questions: WaveQuestion[];
  answers: WaveAnswer[];
}

export interface IndicatorComparison {
  indicatorKey: string;
  /** The matrix row, or null for a question that is one indicator on its own. */
  rowKey: string | null;
  label: string;
  baselineMean: number | null;
  endlineMean: number | null;
  maxScore: number | null;
  /** Endline minus baseline, in raw score points. */
  delta: number | null;
  /** RFP Module 1.2's "ахиц дэвшлийн хувь (+%)", against the scale's maximum. */
  deltaPercent: number | null;
  baselineCount: number;
  endlineCount: number;
}

/**
 * Compares two waves, indicator by indicator.
 *
 * ★ Only indicators present in **both** waves appear.
 *
 * An indicator added in May has nothing to compare against, and showing it with
 * a blank baseline invites the reader to treat the gap as a starting score of
 * zero — which would report a spectacular improvement that never happened.
 * Dropped indicators are equally absent. What is left is exactly the set the
 * phrase "ижил асуулга" refers to.
 *
 * ★★ A question with a null `indicatorKey` never participates. That is the
 * honest reading of "not comparable" — a one-off poll question is not a
 * development indicator, and guessing a pairing from its position is how a
 * progress figure becomes confidently wrong.
 */
export function compareWaves(baseline: Wave, endline: Wave): IndicatorComparison[] {
  const baselineIndex = indexWave(baseline);
  const endlineIndex = indexWave(endline);

  const results: IndicatorComparison[] = [];

  for (const [key, base] of baselineIndex) {
    const end = endlineIndex.get(key);
    if (!end) continue;

    const baselineMean = meanScore(base.scores);
    const endlineMean = meanScore(end.scores);
    const maxScore = base.maxScore;

    const delta = baselineMean !== null && endlineMean !== null ? endlineMean - baselineMean : null;

    /*
     * The percentage is of the *scale*, not of the baseline.
     *
     * Dividing by the baseline is the obvious reading of "+%" and it breaks in
     * the two places it matters most: a baseline of zero divides by zero, and a
     * baseline of 1 on a 1–5 scale turns a one-point gain into "+100%", which
     * overstates a modest improvement to a parent. A share of the full scale is
     * comparable across indicators, which is what Module 1.2's "хамгийн их
     * сайжирсан үзүүлэлт" ranking needs.
     */
    const deltaPercent =
      delta !== null && maxScore !== null && maxScore > 0
        ? Math.round((delta / maxScore) * 1000) / 10
        : null;

    results.push({
      indicatorKey: base.indicatorKey,
      rowKey: base.rowKey,
      label: base.label,
      baselineMean,
      endlineMean,
      maxScore,
      delta,
      deltaPercent,
      baselineCount: base.scores.filter((s) => s !== null).length,
      endlineCount: end.scores.filter((s) => s !== null).length,
    });
  }

  // Biggest improvement first — Module 1.2 asks for "хамгийн их сайжирсан
  // эсвэл нэмэлт дэмжлэг шаардлагатай үзүүлэлтүүд", so both ends of this
  // ordering are the answer to a question the RFP asks.
  return results.sort((a, b) => (b.deltaPercent ?? -Infinity) - (a.deltaPercent ?? -Infinity));
}

interface IndicatorBucket {
  indicatorKey: string;
  rowKey: string | null;
  label: string;
  maxScore: number | null;
  scores: (number | null)[];
}

/** Every scorable indicator in a wave, keyed by `indicatorKey` and matrix row. */
function indexWave(wave: Wave): Map<string, IndicatorBucket> {
  const byQuestionId = new Map(wave.questions.map((q) => [q.id, q]));
  const buckets = new Map<string, IndicatorBucket>();

  for (const question of wave.questions) {
    if (question.indicatorKey === null) continue;

    const matrix = matrixRowLabels(question);

    for (const { rowKey } of indicatorsOf(question)) {
      buckets.set(bucketKey(question.indicatorKey, rowKey), {
        indicatorKey: question.indicatorKey,
        rowKey,
        // A matrix row carries its own label; a scalar question's label is the
        // prompt. Taken from the *baseline* wave when they differ, since that
        // is the wording the year started with.
        label: rowKey !== null ? (matrix.get(rowKey) ?? rowKey) : question.prompt,
        maxScore: maxScoreOf(question),
        scores: [],
      });
    }
  }

  for (const answer of wave.answers) {
    const question = byQuestionId.get(answer.questionId);
    if (!question || question.indicatorKey === null) continue;

    for (const { rowKey } of indicatorsOf(question)) {
      const bucket = buckets.get(bucketKey(question.indicatorKey, rowKey));
      if (bucket) bucket.scores.push(scoreOf(question, answer.value, rowKey));
    }
  }

  return buckets;
}

/**
 * A composite map key.
 *
 * `JSON.stringify` rather than joining on a separator character: an
 * `indicatorKey` is free text an administrator types, so any separator picked
 * could appear inside one and silently merge two indicators into a single
 * bucket. Encoding both parts makes a collision impossible.
 */
function bucketKey(indicatorKey: string, rowKey: string | null): string {
  return JSON.stringify([indicatorKey, rowKey]);
}

function matrixRowLabels(question: WaveQuestion): Map<string, string> {
  const options = question.options;
  if (typeof options !== "object" || options === null || Array.isArray(options)) return new Map();

  const rows = (options as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) return new Map();

  const labels = new Map<string, string>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;

    const { key, label } = row as { key?: unknown; label?: unknown };
    if (typeof key === "string" && typeof label === "string") labels.set(key, label);
  }

  return labels;
}

/**
 * The same comparison, per child — Module 1.3's Sheet 3.
 *
 * Children with no answer in either wave are omitted rather than listed with
 * blank progress: a child who joined in January has no September baseline, and
 * a row of dashes reads as a data fault rather than as the ordinary thing it is.
 */
export function compareWavesByChild(
  baseline: Wave,
  endline: Wave,
): { childId: string; indicators: IndicatorComparison[] }[] {
  const childIds = new Set<string>();
  for (const answer of [...baseline.answers, ...endline.answers]) {
    if (answer.childId !== null) childIds.add(answer.childId);
  }

  const rows: { childId: string; indicators: IndicatorComparison[] }[] = [];

  for (const childId of childIds) {
    const indicators = compareWaves(
      { questions: baseline.questions, answers: forChild(baseline.answers, childId) },
      { questions: endline.questions, answers: forChild(endline.answers, childId) },
    ).filter((row) => row.baselineCount > 0 || row.endlineCount > 0);

    if (indicators.length > 0) rows.push({ childId, indicators });
  }

  return rows;
}

function forChild(answers: WaveAnswer[], childId: string): WaveAnswer[] {
  return answers.filter((answer) => answer.childId === childId);
}

/** One question's answer distribution in each wave — the comparison table. */
export interface QuestionComparison {
  questionId: string;
  prompt: string;
  type: string;
  baselineCounts: Record<string, number>;
  endlineCounts: Record<string, number>;
}

/**
 * The same question in both waves, counted answer by answer.
 *
 * ★ Distributions, not means — the client's own table: "Маш сайн 8 (40%) →
 * 12 (60%)". `compareWaves` above answers "did the average move", which is the
 * RFP's indicator question; this answers "what did the shape of the answers
 * do", which is what a teacher reads to a parents' meeting. Both come off the
 * same two waves, so they cannot disagree about a count.
 *
 * ★★ Paired by `indicatorKey` first and by the exact prompt second.
 *
 * An endline is usually a clone, so the question *ids* differ and cannot be the
 * key. The indicator is an explicit statement that two questions measure one
 * thing; an identical prompt is the next best evidence, and anything less —
 * pairing by position, say — is how a chart comes to compare the food question
 * against the playground one.
 */
export function compareQuestions(baseline: Wave, endline: Wave): QuestionComparison[] {
  const countByQuestion = (wave: Wave, questionId: string): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const answer of wave.answers) {
      if (answer.questionId !== questionId) continue;
      const value = answer.value;
      // Only scalar answers have a distribution. A checkbox's array and a
      // matrix's record are several answers at once, and folding them into one
      // tally would count a family more than once.
      if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
        const key = String(value);
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  };

  const out: QuestionComparison[] = [];

  for (const question of endline.questions) {
    const match = baseline.questions.find((candidate) =>
      question.indicatorKey && candidate.indicatorKey
        ? candidate.indicatorKey === question.indicatorKey
        : candidate.prompt === question.prompt,
    );
    if (!match) continue;

    out.push({
      questionId: question.id,
      prompt: question.prompt,
      type: question.type,
      baselineCounts: countByQuestion(baseline, match.id),
      endlineCounts: countByQuestion(endline, question.id),
    });
  }

  return out;
}
