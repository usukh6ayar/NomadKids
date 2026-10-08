import { a79Level, type A79LevelKey } from "@/lib/a79-progress";

/**
 * А/79 criteria a note's own words point at — 2026-10-08, the client chose the
 * word-matching option over an AI one: "1".
 *
 * ★ No AI, no request. The text never leaves the browser, which is why this is
 * not RFP Phase IV's «AI observation suggestions» (CLAUDE.md §7): it is a
 * lookup over the 173 criteria already in `lib/a79-assessment.ts`. It suggests
 * and never ticks — the teacher adds a criterion with a press, or does not.
 *
 * ★★ Words are compared by their first four letters. Mongolian builds a word
 * by suffixing a stem — «тоолж», «тоолдог», «тоолов» — and four letters is
 * where most stems in the criteria end. It does not understand meaning:
 * «шидэв» finds the throwing criteria and «дамжуулав» may not.
 *
 * ★★★ Each shared stem counts for less the more criteria share it (inverse
 * document frequency), so «бусдын», which a dozen criteria contain, cannot
 * outrank the one word that names the skill.
 *
 * ★★★★ Two shared words, or one specific word (see `SPECIFIC` below). It was
 * two words only for an afternoon, which dropped noise but also dropped the
 * one-word note a teacher actually writes — «шидэв» — and the client asked
 * for it back.
 */

const STOP = new Set([
  "нь",
  "ба",
  "болон",
  "гэх",
  "мэт",
  "зэрэг",
  "гэж",
  "энэ",
  "тэр",
  "бол",
  "байна",
  "байв",
  "байсан",
  "хийв",
  "хийсэн",
  "хийдэг",
  "өөрөө",
  "маш",
  "их",
  "бага",
  "дээр",
  "үед",
  "хүүхэд",
  "хүүхдүүд",
  "өөр",
  "нэг",
  "нэгээр",
  "нэгэн",
  "хоёр",
  "гурав",
  "бүр",
  "зөв",
  "ч",
  "л",
  "дараа",
  "хамт",
]);

const STEM = 4;
/** Vowels and the two signs — what a consonant key skips. «й» is a consonant here. */
const VOWEL = /[аэиоуыөүеёяюьъ]/;

/**
 * One word, as two keys it can be matched on.
 *
 * `p` — its first four letters: «тоолж», «тоолдог» → «тоол».
 * `k` — its first two letters and the first two consonants after the first
 * letter. Mongolian drops a vowel when a suffix is added, so «үсэрч» and
 * «үсрэв» share no four-letter prefix but are both «үс:ср»; «жижиг» and
 * «жижгийг» are both «жи:жг». The first two letters stay whole because a
 * different first vowel is a different word — «халбага» is not «хэлбэр» —
 * and two consonants, not one, keep «хуваалцав» off «хувцаслаж».
 */
interface Word {
  p: string;
  k: string | null;
}

function words(text: string): Word[] {
  const out = new Map<string, Word>();
  for (const word of text.toLowerCase().match(/[0-9]+|[а-яёөү]+/g) ?? []) {
    if (STOP.has(word)) continue;
    if (/^[0-9]+$/.test(word)) {
      out.set(word, { p: word, k: null });
      continue;
    }
    if (word.length < 3) continue;
    const consonants = [...word.slice(1)].filter((ch) => !VOWEL.test(ch)).slice(0, 2);
    const p = word.slice(0, STEM);
    out.set(p, {
      p,
      k: consonants.length === 2 ? `${word.slice(0, 2)}:${consonants.join("")}` : null,
    });
  }
  return [...out.values()];
}

/** The comparable stems of a text — the four-letter keys. */
export function stems(text: string): Set<string> {
  return new Set(words(text).map((w) => w.p));
}

const same = (a: Word, b: Word) => a.p === b.p || (a.k !== null && a.k === b.k);

interface Index {
  rows: Word[][];
  /** How many criteria at the level contain a word like this one. */
  df: (word: Word) => number;
  total: number;
}

const indexCache = new Map<A79LevelKey, Index>();

function index(level: A79LevelKey): Index {
  const cached = indexCache.get(level);
  if (cached) return cached;
  const rows = a79Level(level).criteria.map((c) => words(c.text));
  const df = (word: Word) => rows.filter((row) => row.some((w) => same(w, word))).length;
  const built = { rows, df, total: rows.length };
  indexCache.set(level, built);
  return built;
}

/**
 * The criteria at `level` whose wording shares the most with `text`, best
 * first.
 *
 * ★ One shared word is enough when it is a specific one — in at most
 * `SPECIFIC` criteria at the level (client, 2026-10-08: "1 үг болон дөхүү
 * язгуураас"). «тоглов» is in a handful and alone suggests nothing; «ялгав»
 * or «шидэв» name a skill and do. Two shared words always do.
 */
const SPECIFIC = 3;

export function suggestA79(
  text: string,
  level: A79LevelKey,
  { limit = 3, exclude = [] as number[] } = {},
): { number: number; text: string; matched: string[] }[] {
  const note = words(text);
  if (note.length === 0) return [];
  const { rows, df, total } = index(level);
  const criteria = a79Level(level).criteria;
  const skip = new Set(exclude);
  return rows
    .map((row, i) => {
      const hits = row.filter((w) => note.some((n) => same(n, w)));
      const score = hits.reduce((sum, w) => sum + Math.log(1 + total / df(w)), 0);
      return {
        number: i + 1,
        text: criteria[i]!.text,
        matched: hits.map((w) => w.p),
        score,
        specific: hits.length === 1 && df(hits[0]!) <= SPECIFIC,
      };
    })
    .filter((row) => !skip.has(row.number) && (row.matched.length >= 2 || row.specific))
    .sort((a, b) => b.score - a.score || a.number - b.number)
    .slice(0, limit)
    .map(({ number, text, matched }) => ({ number, text, matched }));
}
