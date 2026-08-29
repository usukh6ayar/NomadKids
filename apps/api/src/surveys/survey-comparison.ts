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
