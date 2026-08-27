/**
 * Matching a dish's allergen tags against a child's recorded allergies —
 * RFP Module 2's automatic warning.
 *
 * ★ The hard part is not the loop, it is deciding what counts as a match.
 *
 * Both sides are free text typed by different people: a cook tags a dish
 * "Самар", a teacher recorded the allergy as "самар" or "самрын тос". The rule
 * that reconciles them is in `allergenMatches`, and it is more than a substring
 * check for a reason the test found — Mongolian suffixation changes the stem.
 *
 * ★★ It errs towards warning, deliberately.
 *
 * A false positive costs a teacher ten seconds of reading. A false negative
 * feeds a child something that stops their breathing.
 */

export interface AllergyLike {
  childId: string;
  allergen: string;
  severity: string;
  child?: { id: string; lastName: string; firstName: string } | null;
}

export interface DishLike {
  name: string;
  allergenTags: string[];
}

export interface AllergenWarning {
  childId: string;
  childName: string;
  dishName: string;
  /** The tag as the kitchen typed it. */
  allergenTag: string;
  /** The allergy as the kindergarten recorded it. */
  allergen: string;
  severity: string;
}

/**
 * Case- and whitespace-insensitive.
 *
 * `toLocaleLowerCase` rather than `toLowerCase`: Mongolian Cyrillic is served
 * correctly by the invariant path today, but the locale-aware form is the one
 * that stays right if a kindergarten records an allergy in a language with
 * different casing rules, and it costs nothing here.
 */
function normalise(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * The shortest prefix two words must share to be treated as the same word.
 *
 * Three characters: "сүү" is a whole allergen at three, and dropping to two
 * would make "мах" match "махи"-anything and start warning about unrelated
 * dishes.
 */
const STEM_LENGTH = 3;

/** How many leading characters two strings have in common. */
function commonPrefixLength(x: string, y: string): number {
  const limit = Math.min(x.length, y.length);
  let i = 0;
  while (i < limit && x[i] === y[i]) i += 1;
  return i;
}

/**
 * True when a dish's allergen tag and a child's recorded allergy are the same
 * thing.
 *
 * ★ Substring matching alone is not enough for Mongolian, and the test is what
 * proved it.
 *
 * The obvious rule — "either string contains the other" — was written first and
 * failed on the very case this feature exists for: **самар** (nut) becomes
 * **самрын** in the genitive, and the second *а* elides. "самрын тос" does not
 * contain "самар" as a substring, so a dish tagged "самрын тос" would not have
 * warned about a child allergic to "самар". Mongolian is agglutinative and
 * suffixation frequently changes the stem, so this is the normal case rather
 * than an edge one.
 *
 * So a shared stem counts too: two words that agree on their first three
 * characters are treated as the same allergen. That catches самар/самрын,
 * сүү/сүүтэй, загас/загасны.
 *
 * ★★ It errs towards warning, deliberately. A stem match also fires on
 * сүү/сүүж — milk against hip — and that is the trade taken on purpose: a false
 * positive costs a teacher ten seconds of reading, a false negative feeds a
 * child something that stops their breathing. The warning names the tag *and*
 * the allergy so a human can dismiss it in one glance.
 */
export function allergenMatches(tag: string, allergen: string): boolean {
  const t = normalise(tag);
  const a = normalise(allergen);
  if (t.length === 0 || a.length === 0) return false;

  // Below the stem length there is nothing to be clever about: "с" sharing a
  // prefix with everything would warn on every dish, which teaches people to
  // ignore warnings.
  if (t.length < STEM_LENGTH || a.length < STEM_LENGTH) return t === a;

  if (t.includes(a) || a.includes(t)) return true;

  // A tag is often a phrase ("самрын тос"), so each word is checked separately
  // against the allergen's stem rather than only the phrase as a whole.
  return t
    .split(/\s+/)
    .some((word) => word.length >= STEM_LENGTH && commonPrefixLength(word, a) >= STEM_LENGTH);
}

/**
 * Every warning for one day's dishes against one kindergarten's allergies.
 *
 * Returns a flat list rather than a map keyed by child: the screen this feeds
 * is a menu, and it reads "энэ хоол эдгээр хүүхдэд аюултай" dish by dish. A
 * caller that wants it by child can group it; a caller that wants it by dish
 * would have had to flatten a map.
 */
export function findAllergenWarnings(
  dishes: DishLike[],
  allergies: AllergyLike[],
): AllergenWarning[] {
  const warnings: AllergenWarning[] = [];

  for (const dish of dishes) {
    for (const tag of dish.allergenTags) {
      for (const allergy of allergies) {
        if (!allergenMatches(tag, allergy.allergen)) continue;

        warnings.push({
          childId: allergy.childId,
          childName: allergy.child ? `${allergy.child.lastName} ${allergy.child.firstName}` : "",
          dishName: dish.name,
          allergenTag: tag,
          allergen: allergy.allergen,
          severity: allergy.severity,
        });
      }
    }
  }

  // Severe first — a teacher reading a long list must meet anaphylaxis before a
  // mild reaction, whatever order the dishes happened to be typed in.
  const rank: Record<string, number> = { SEVERE: 0, MODERATE: 1, MILD: 2 };
  return warnings.sort((x, y) => (rank[x.severity] ?? 3) - (rank[y.severity] ?? 3));
}
