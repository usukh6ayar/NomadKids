/**
 * The А/79 criteria live in `@kinder/contracts` (2026-10-16), where the API
 * scores a child's result with the same list the screens draw.
 */
import { type A79Level } from "@kinder/contracts";

export { A79_LEVELS, type A79Domain, type A79Level } from "@kinder/contracts";

/**
 * One level as the survey wizard's questions: a SINGLE_CHOICE of "0" and "1"
 * per criterion, the domain leading the prompt. Kept here, pure, so the
 * wizard's template and its test read the same list.
 */
export function a79Questions(level: A79Level) {
  return level.criteria.map(({ domain, text }) => ({
    type: "SINGLE_CHOICE" as const,
    prompt: `${domain}: ${text}`,
    options: ["0", "1"],
  }));
}
