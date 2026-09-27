import { createHash } from "node:crypto";

/**
 * The indicator key a question gets when nobody gave it one — client,
 * 2026-09-21: "Үзүүлэлтийн түлхүүр ... ойлгохгүй байна".
 *
 * ★ The key is what pairs a September question with its May repeat
 * (`survey-comparison.ts`), and asking a teacher to invent `social_skills` in
 * Latin letters was asking them to do the pairing by hand. So the field left
 * the editor and the server names each question itself.
 *
 * ★★ Derived from the prompt, not random. A clone copies the key, so the
 * "Хувилах" path pairs whatever this returns; deriving it from the words
 * additionally pairs two surveys a teacher typed out separately with the same
 * question, which is what `compareQuestions` already treats as the same
 * question. It is also exactly what migration
 * `20260921120000_survey_indicator_keys` computed for the questions that
 * existed before this — `q_` and the first twelve hex digits of the MD5 of
 * the prompt with surrounding whitespace removed — so old and new keys agree.
 *
 * Not lower-cased: Postgres `lower()` follows the database's locale and would
 * not agree with JavaScript on Cyrillic everywhere, and a key the migration
 * and the server compute differently pairs nothing.
 */
export function promptIndicatorKey(prompt: string): string {
  const digest = createHash("md5").update(trimWhitespace(prompt), "utf8").digest("hex");
  return `q_${digest.slice(0, 12)}`;
}

/** Space, tab, newline and carriage return — the set the migration's `btrim` removes. */
function trimWhitespace(text: string): string {
  return text.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "");
}

/**
 * Fills in every missing key, keeping the ones a question already carries.
 * Two questions in one survey with the same words get `_2`, `_3` — a key must
 * name one question within its survey or the pairing would be ambiguous.
 */
export function withIndicatorKeys<T extends { prompt: string; indicatorKey?: string | null }>(
  questions: T[],
): (T & { indicatorKey: string })[] {
  const taken = new Set(
    questions.map((q) => q.indicatorKey).filter((key): key is string => Boolean(key)),
  );
  return questions.map((question) => {
    if (question.indicatorKey) return { ...question, indicatorKey: question.indicatorKey };
    const base = promptIndicatorKey(question.prompt);
    let key = base;
    for (let n = 2; taken.has(key); n += 1) key = `${base}_${n}`;
    taken.add(key);
    return { ...question, indicatorKey: key };
  });
}
