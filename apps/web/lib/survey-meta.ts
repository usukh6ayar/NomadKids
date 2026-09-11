import {
  Activity,
  BarChart3,
  Brain,
  HeartHandshake,
  School,
  Smile,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { SURVEY_CATEGORY_LABEL, type SurveyCategory } from "@kinder/contracts";

/** Category presentation shared by staff, notifications and parent survey lists. */
export const SURVEY_CATEGORY_META: Record<
  SurveyCategory,
  { label: string; tone: "mint" | "sky" | "sun" | "peach"; Icon: typeof BarChart3 }
> = {
  PARENT_ENGAGEMENT: {
    label: SURVEY_CATEGORY_LABEL.PARENT_ENGAGEMENT,
    tone: "sky",
    Icon: UsersRound,
  },
  SATISFACTION: {
    label: SURVEY_CATEGORY_LABEL.SATISFACTION,
    tone: "sun",
    Icon: Smile,
  },
  SOCIAL_DEVELOPMENT: {
    label: SURVEY_CATEGORY_LABEL.SOCIAL_DEVELOPMENT,
    tone: "mint",
    Icon: HeartHandshake,
  },
  PHYSICAL_DEVELOPMENT: {
    label: SURVEY_CATEGORY_LABEL.PHYSICAL_DEVELOPMENT,
    tone: "peach",
    Icon: Activity,
  },
  COGNITIVE_DEVELOPMENT: {
    label: SURVEY_CATEGORY_LABEL.COGNITIVE_DEVELOPMENT,
    tone: "sky",
    Icon: Brain,
  },
  HABITS_INDEPENDENCE: {
    label: SURVEY_CATEGORY_LABEL.HABITS_INDEPENDENCE,
    tone: "sun",
    Icon: Sparkles,
  },
  CLASS_GROUP: {
    label: SURVEY_CATEGORY_LABEL.CLASS_GROUP,
    tone: "mint",
    Icon: School,
  },
  /*
   * `BarChart3` — the neutral one, and the only category whose icon says
   * nothing about the subject. That is the point of the category: a survey
   * filed here is one the other seven did not describe, and an icon
   * suggesting a subject would put it back in one of them by the picture.
   */
  OTHER: {
    label: SURVEY_CATEGORY_LABEL.OTHER,
    tone: "peach",
    Icon: BarChart3,
  },
};

export const SURVEY_TONE_BG: Record<string, string> = {
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  sun: "bg-sun text-sun-ink",
  peach: "bg-peach text-peach-ink",
};
