import type { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import type { GradientTone } from "@/lib/gradient-tones";

type Age = (typeof PORTFOLIO_AGES)[number];

/**
 * A per-age tint, matching the reference build's own 2/3/4 нас colours
 * (`GRADIENT_TONE_STYLE`'s doc comment has the source) — shared by
 * `child-growth-ages.tsx`'s own nav and `AgeStepper`, so an age reads the
 * same colour on the staff accordion and the parent's pages.
 */
export const AGE_TONE: Record<Age, GradientTone> = {
  2: "green",
  3: "blue",
  4: "orange",
  5: "purple",
};

export { AGE_FAMILY_OPTIONS, LEARNING_DOMAINS, type LearningDomain } from "@kinder/contracts";
