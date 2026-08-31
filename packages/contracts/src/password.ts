/**
 * The password policy, in one place.
 *
 * ★ It lives here rather than in the API because two clients need it and only
 * one of them can enforce it. The API is where the rule is *enforced* — a form
 * can be bypassed and a mobile client will exist one day. The web form needs
 * the same rule to *explain* it: the list of requirements printed above the
 * field, and the message shown when the typed password fails one. Two copies
 * drift, and the copy that drifts is the one users read.
 *
 * ★★ The character classes include Cyrillic on purpose. `Нууцүг123` is a
 * legitimate password in the language this product is written in; `[A-Z]`
 * alone would reject it and tell a Mongolian parent their Mongolian password
 * has no capital letter.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/** Upper case, Latin or Cyrillic — including the two letters unique to Mongolian. */
const UPPER = /[A-ZА-ЯӨҮ]/;
const LOWER = /[a-zа-яөү]/;
const DIGIT = /\d/;

/**
 * What the user must satisfy, phrased for a list above the field.
 *
 * Kept parallel to `validatePasswordStrength` below — same order, same rules.
 * A screen that lists a requirement nobody checks, or checks one it never
 * listed, is how error messages come to be read as noise.
 */
export const PASSWORD_RULES: readonly string[] = [
  `${PASSWORD_MIN_LENGTH}-аас доошгүй тэмдэгт`,
  "Том, жижиг үсэг хоёулаа",
  "Дор хаяж нэг тоо",
];

/**
 * Every rule the password fails, in Mongolian, ready to show.
 *
 * Returns all of them rather than the first: a person retyping a password
 * should learn everything that is wrong with it in one attempt.
 */
export function validatePasswordStrength(password: string): string[] {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Нууц үг дор хаяж ${PASSWORD_MIN_LENGTH} тэмдэгт байх ёстой`);
  }
  if (!UPPER.test(password)) errors.push("Нууц үгэнд том үсэг байх ёстой");
  if (!LOWER.test(password)) errors.push("Нууц үгэнд жижиг үсэг байх ёстой");
  if (!DIGIT.test(password)) errors.push("Нууц үгэнд тоо байх ёстой");
  return errors;
}
