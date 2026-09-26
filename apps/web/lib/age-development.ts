import type { AgeProfile } from "@kinder/contracts";
import { AGE_FAMILY_OPTIONS, LEARNING_DOMAINS } from "@/lib/age-content";
import type { PORTFOLIO_AGES } from "@/lib/portfolio-ages";

export type PortfolioAge = (typeof PORTFOLIO_AGES)[number];

export const FAVORITE_FIELDS = [
  { key: "favoriteToy", label: "Тоглоом" },
  { key: "favoriteSong", label: "Дуу" },
  { key: "favoriteClothes", label: "Хувцас" },
  { key: "favoriteStory", label: "Үлгэр" },
  { key: "favoriteMovie", label: "Хүүхэлдэйн кино / кино" },
  { key: "favoriteTreat", label: "Амттан" },
  { key: "favoriteColor", label: "Өнгө" },
  { key: "favoriteBook", label: "Ном" },
  { key: "favoriteActivity", label: "Хийх дуртай зүйл" },
  { key: "favoriteFood", label: "Хоол" },
] as const;

export const CHARACTER_TRAITS = [
  "Хөгжилтэй",
  "Эелдэг",
  "Баяр хөөртэй",
  "Тайван",
  "Гунигтай",
  "Зөрүүд",
  "Ууртай",
  "Сандруу",
  "Унтамхай",
  "Ичимхий",
  "Зоригтой",
] as const;

/**
 * A face for each observation — client, 2026-09-24: "cute emoji той болго".
 *
 * ★ Decoration, not data. The stored value is still the word (`characterTraits`
 * is a `String[]`), so nothing in the database, the PDF or the comparison
 * changes; the emoji is `aria-hidden` in the picker, which keeps each choice's
 * accessible name the word a parent reads aloud.
 */
export const CHARACTER_TRAIT_EMOJI: Record<(typeof CHARACTER_TRAITS)[number], string> = {
  Хөгжилтэй: "😄",
  Эелдэг: "🤗",
  "Баяр хөөртэй": "🥳",
  Тайван: "😌",
  Гунигтай: "😢",
  Зөрүүд: "😤",
  Ууртай: "😠",
  Сандруу: "😰",
  Унтамхай: "😴",
  Ичимхий: "🙈",
  Зоригтой: "🦁",
};

export const FAMILY_MEMBER_TYPES = [
  "Эмээ, өвөө",
  "Аав, ээж",
  "Ах, эгч",
  "Хүү, охин",
  "Нялх охин, нялх хүү",
] as const;

/**
 * The client will provide the final kindergarten curriculum wording later.
 * Until then we keep the existing age-specific choices in one neutral
 * observation category. The UI/data shape is category-aware, so adding the
 * approved categories later changes this map, not stored answers.
 */
export function kindergartenSkillCategories(_age: PortfolioAge) {
  return LEARNING_DOMAINS.map((label) => ({ id: label, label, options: [] }));
}

/** The client's age-specific family questions, grouped by development domain. */
export function familyLearningCategories(age: PortfolioAge) {
  return LEARNING_DOMAINS.map((label) => ({
    id: label,
    label,
    options: AGE_FAMILY_OPTIONS[age][label],
  }));
}

export const AGE_SECTION_TITLES = [
  "Миний дуртай бүх зүйлс",
  "Миний цэцэрлэгтээ сурсан зүйлс",
  "Миний гэр бүлээсээ суралцсан зүйлс",
  "Миний зан араншин",
  "Гэр бүл",
] as const;

export function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

export function hasNotes(value: Record<string, string> | null | undefined): boolean {
  return Object.values(value ?? {}).some(hasText);
}

export function ageSectionCompletion(profile: AgeProfile | undefined) {
  const sections = [
    FAVORITE_FIELDS.some(({ key }) => hasText(profile?.[key])),
    Boolean(profile?.kindergartenSkills.length) ||
      hasNotes(profile?.kindergartenSkillNotes) ||
      hasText(profile?.kindergartenOtherSkill) ||
      hasText(profile?.newSkills),
    Boolean(profile?.familyLearningSkills.length) ||
      hasNotes(profile?.familyLearningNotes) ||
      hasText(profile?.familyLearningOther) ||
      hasText(profile?.familyMembers),
    Boolean(profile?.characterTraits.length) ||
      hasText(profile?.characterObservation) ||
      hasText(profile?.personality) ||
      hasText(profile?.emotionalTraits),
    Boolean(profile?.familyMemberTypes.length) ||
      hasText(profile?.familyDescription) ||
      Boolean(profile?.familyMemories.length),
  ];
  const completed = sections.filter(Boolean).length;
  return { completed, total: sections.length, percent: completed * 20, sections };
}
