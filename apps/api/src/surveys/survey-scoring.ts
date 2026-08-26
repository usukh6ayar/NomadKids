/**
 * Turning an answer into a number — RFP Module 1.2 and 1.3.
 *
 * ★ One module, used by both the comparison endpoint and the Excel workbook.
 *
 * Module 1.3's Sheet 3 is Module 1.2's comparison rendered into a spreadsheet.
 * If the scoring lived in each of them the client would eventually open the
 * workbook beside the screen and find two different progress figures for the
 * same child — and there would be no way to say which was right. Pure functions
 * here, no Prisma, no HTTP, for the same reason `funding-rules.ts` is.
 *
 * ★★ `null` means "no score", and it is not zero.
 *
 * A TEXT answer, an unanswered question and a matrix row nobody filled in all
 * score `null`. Folding them to 0 would drag a class average down in exactly
 * the direction that reads as "these children got worse", which is the one
 * conclusion this feature must not invent.
 */

/** A matrix's shape, as stored in `SurveyQuestion.options`. */
export interface MatrixOptions {
  rows: { key: string; label: string }[];
  columns: { value: number; label: string }[];
}

export interface ScorableQuestion {
  type: string;
  options?: unknown;
}

/**
 * The indicators one question contributes.
 *
 * ★ A MATRIX fans out to one indicator per row; everything else is a single
 * indicator with `rowKey: null`.
 *
 * This is what stops a matrix collapsing into one meaningless average. Module
 * 1.2 asks for "хамгийн их сайжирсан үзүүлэлт" — the indicator that improved
 * most — and a seven-row matrix averaged to one number cannot answer that,
 * which is the entire reason the RFP asks for the type.
 */
export function indicatorsOf(question: ScorableQuestion): { rowKey: string | null }[] {
  if (question.type !== "MATRIX") return [{ rowKey: null }];

  const options = matrixOptions(question);
  if (!options) return [];

  return options.rows.map((row) => ({ rowKey: row.key }));
}

/**
 * One answer's score for one indicator, or `null` if it has none.
 *
 * The scales, and why each is what it is:
 *
 *   RATING    the number as given (1–5, or 1–10)
 *   YES_NO    1 or 0 — the only two-point scale there is
 *   CHECKBOX  how many boxes were ticked
 *   MATRIX    the chosen column's `value`, for that row
 *   TEXT      null — prose has no score, and inventing one from its length
 *             would be worse than admitting it
 *
 * ★ CHECKBOX scoring as a *count* is a deliberate, arguable choice. "How many
 * of these does the child do" is the way the RFP's development checklists are
 * written, so more ticks means more progress. It is recorded here rather than
 * buried, because a kindergarten using checkboxes for something else — "which
 * of these worry you" — would want it inverted, and that is a conversation to
 * have with the client rather than a default to hide.
 */
export function scoreOf(
  question: ScorableQuestion,
  value: unknown,
  rowKey: string | null = null,
): number | null {
  if (value === null || value === undefined) return null;

  switch (question.type) {
    case "RATING":
      return typeof value === "number" && Number.isFinite(value) ? value : null;

    case "YES_NO":
      return typeof value === "boolean" ? (value ? 1 : 0) : null;

    case "CHECKBOX":
      return Array.isArray(value) ? value.length : null;

    case "MATRIX": {
      if (rowKey === null || typeof value !== "object" || Array.isArray(value)) return null;

      const cell = (value as Record<string, unknown>)[rowKey];
      if (typeof cell !== "number" || !Number.isFinite(cell)) return null;

      // The cell must name a column this question actually offers. A stale
      // answer whose column was removed scores null rather than carrying a
      // value the scale no longer defines.
      const options = matrixOptions(question);
      if (!options) return null;

      return options.columns.some((column) => column.value === cell) ? cell : null;
    }

    default:
      // TEXT, and anything a future migration adds before this file knows about
      // it. Returning null keeps an unknown type out of the averages instead of
      // silently scoring it zero.
      return null;
  }
}

/**
 * The highest score an indicator can reach, for turning a mean into a percent.
 *
 * Returns `null` where there is no ceiling to divide by — a CHECKBOX with no
 * options, or a type that does not score. Module 1.2's "+%" is only meaningful
 * against a known maximum.
 */
export function maxScoreOf(question: ScorableQuestion): number | null {
  switch (question.type) {
    case "RATING":
      // The RFP names both 1–5 and 1–10 scales and the column does not record
      // which. Five is the scale every existing survey in this system uses;
      // a wrong ceiling only rescales the percentage, and it is better than
      // refusing to show progress at all.
      return 5;

    case "YES_NO":
      return 1;

    case "CHECKBOX": {
      const options = question.options;
      return Array.isArray(options) && options.length > 0 ? options.length : null;
    }

    case "MATRIX": {
      const options = matrixOptions(question);
      if (!options || options.columns.length === 0) return null;

      return Math.max(...options.columns.map((column) => column.value));
    }

    default:
      return null;
  }
}

/**
 * The mean of the scores that exist, ignoring the ones that do not.
 *
 * `null` for an empty list rather than 0 — see the note at the top of the file.
 */
export function meanScore(scores: (number | null)[]): number | null {
  const present = scores.filter((score): score is number => score !== null);
  if (present.length === 0) return null;

  return present.reduce((sum, score) => sum + score, 0) / present.length;
}

/**
 * Reads `options` as a matrix shape, or `null` if it is not one.
 *
 * Defensive because `options` is a `Json` column: a hand-edited row, or a
 * question whose type was changed after it was written, can hold anything.
 */
export function matrixOptions(question: ScorableQuestion): MatrixOptions | null {
  const options = question.options;
  if (typeof options !== "object" || options === null || Array.isArray(options)) return null;

  const { rows, columns } = options as Record<string, unknown>;
  if (!Array.isArray(rows) || !Array.isArray(columns)) return null;

  const validRows = rows.filter(
    (row): row is { key: string; label: string } =>
      typeof row === "object" &&
      row !== null &&
      typeof (row as Record<string, unknown>).key === "string" &&
      typeof (row as Record<string, unknown>).label === "string",
  );

  const validColumns = columns.filter(
    (column): column is { value: number; label: string } =>
      typeof column === "object" &&
      column !== null &&
      typeof (column as Record<string, unknown>).value === "number" &&
      typeof (column as Record<string, unknown>).label === "string",
  );

  if (validRows.length === 0 || validColumns.length === 0) return null;

  return { rows: validRows, columns: validColumns };
}
