/**
 * The Mongolian genitive of a name — "Батбаяр" → "Батбаярын" — and the chat
 * name built from it, "Г.Батбаярын ээж".
 *
 * ★ Added 2026-10-04 at the user's request: a guardian in chat is called by
 * their child, "тэрний аав, тэрний ээж". The name used to read
 * "Г.Батбаяр — ээж", which avoided the inflection rather than doing it —
 * `attendance-meta.ts` explains why the product had been avoiding it: the
 * suffix depends on the word's last sound, and an arbitrary name can come out
 * wrong. The rules below are the written-standard ones for names, and the
 * cases in `mn-genitive.test.ts` are real names from the roster's shape.
 *
 * The rules, in the order they are tried:
 *
 * 1. Ends in **й** (а diphthong: Сарнай, Хангай) → `+н`.
 * 2. Ends in **н** (Хулан, Тэмүүлэн, Номин) → `+гийн`.
 * 3. Ends in a **long vowel or diphthong** (Сараа, Батхүү, Энхтуяа) → `+гийн`.
 * 4. Ends in a short **э** or **и** (Эрдэнэ, Сэлэнги) → the vowel drops, `+ийн`.
 * 5. Ends in any other short vowel (Ану) → `+гийн`.
 * 6. Ends in **г, ж, ч, ш, щ, к** (Ганзориг, Дорж) → `+ийн`.
 * 7. Any other consonant: by vowel harmony — the last vowel that is not the
 *    neutral **и** decides. Back (а, о, у, я, ё) → `+ын` (Болдын); front →
 *    `+ийн` (Энхийн, Төгсийн).
 *
 * A hyphenated name inflects its last part only, which is what the rules do
 * anyway since they read the end of the string. Anything that is not Cyrillic
 * at the end gets a hyphenated "-ийн", the one form that is never misspelt.
 */

const VOWELS = "аэиоуөүыяеёю";
const BACK_VOWELS = "аоуяёы";
const ALWAYS_IIN_AFTER = "гжчшщк";

export function genitive(name: string): string {
  const word = name.trim();
  if (!word) return word;

  const lower = word.toLocaleLowerCase("mn-MN");
  const last = lower.at(-1)!;
  const previous = lower.at(-2) ?? "";

  if (!/[а-яёөү]/.test(last)) return `${word}-ийн`;

  if (last === "й") return `${word}н`;
  if (last === "н") return `${word}гийн`;

  if (VOWELS.includes(last)) {
    if (VOWELS.includes(previous)) return `${word}гийн`;
    if (last === "э" || last === "и") return `${word.slice(0, -1)}ийн`;
    return `${word}гийн`;
  }

  if (last === "ь" || last === "ъ") return `${word.slice(0, -1)}ийн`;
  if (ALWAYS_IIN_AFTER.includes(last)) return `${word}ийн`;

  for (const letter of [...lower].reverse()) {
    if (letter === "и" || !VOWELS.includes(letter)) continue;
    return BACK_VOWELS.includes(letter) ? `${word}ын` : `${word}ийн`;
  }
  return `${word}ийн`;
}

/** What a guardian is to the child, as the word that follows the genitive. */
const RELATION_WORD: Record<string, string> = {
  MOTHER: "ээж",
  FATHER: "аав",
  GRANDPARENT: "өвөө/эмээ",
  SIBLING: "ах/эгч",
  OTHER: "асран хамгаалагч",
};

/**
 * "Г.Батбаярын ээж" — a guardian, named by their child.
 *
 * The surname's initial stays: two children with one first name in one group
 * is ordinary, and the initial is what tells their mothers apart.
 */
export function guardianChatName(
  child: { lastName?: string | null; firstName: string },
  relation: string,
): string {
  const first = child.firstName.trim();
  const initial = child.lastName?.trim().slice(0, 1).toLocaleUpperCase("mn-MN") ?? "";
  const childName = initial ? `${initial}.${first}` : first;
  return `${genitive(childName)} ${RELATION_WORD[relation] ?? RELATION_WORD.OTHER}`;
}
