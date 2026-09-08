import {
  Activity,
  BarChart3,
  Brain,
  HeartHandshake,
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
};

export const SURVEY_TONE_BG: Record<string, string> = {
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  sun: "bg-sun text-sun-ink",
  peach: "bg-peach text-peach-ink",
};
