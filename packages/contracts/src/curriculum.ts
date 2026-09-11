/**
 * СҮД indicator codes, which are written differently at every level.
 *
 * ★ The level is *part* of the code, and the stored code does not carry it.
 *
 * The client's curriculum writes an indicator as
 * `<strand><level>.<standard><letter>` — `ХЭМ4.1н` is the Хөдөлгөөн-эрүүл мэнд
 * strand, level IV, standard 1, indicator н. The same indicator at level III is
 * `ХЭМ3.1н`: one row of the curriculum, four codes.
 *
 * `CurriculumIndicator.code` holds the part that does *not* change — the strand,
 * the standard and the letter, as `ХЭМ1н` — because that is what identifies one
 * indicator across its four levels and what a foreign key has to be stable
 * against. The level-qualified form is therefore a rendering of
 * (indicator, level) rather than a column, and this is where it is rendered.
 *
 * ★★ It lives in contracts rather than in the web app because the observation
 * form is not the only place that shows a code with a level beside it — the
 * note's own detail, the portfolio PDF and the assessment reports all do, and a
 * second copy of this string surgery is a second chance to spell the client's
 * own notation wrong.
 *
 * ★★★ This was transcribed wrong on 2026-09-11 and found by the client the same
 * day. The import derived one indicator per spreadsheet *row* — correctly, the
 * row is the indicator — and in doing so dropped the level digit and the dot
 * from every code, so the picker offered `ХЭМ1н` where the curriculum says
 * `ХЭМ4.1н`. The identity was right; only the display was short.
 */

/** `ХЭМ1н` → strand `ХЭМ`, standard `1`, letter `н`. */
const CODE = /^(\D+?)(\d+)(\D+)$/u;

/**
 * The code as the curriculum writes it at one level.
 *
 * ★ Returns the stored code unchanged when it cannot be parsed.
 *
 * A kindergarten may add indicators of its own (`CurriculumIndicator` carries a
 * nullable `kindergartenId` for exactly that) and nothing obliges those to
 * follow the national notation. Showing such a code as it was entered is right;
 * refusing to show it, or splicing a digit into the middle of something that is
 * not a national code, is not.
 */
export function curriculumCodeAtLevel(code: string, level: number | null | undefined): string {
  if (level === null || level === undefined) return code;

  const parts = CODE.exec(code.trim());
  if (!parts) return code;

  const [, strand, standard, letter] = parts;
  return `${strand}${level}.${standard}${letter}`;
}
