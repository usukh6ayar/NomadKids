"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SURVEY_RESPONDENT_LABEL, type SurveyRespondent } from "@kinder/contracts";
import { RequireRole } from "@/components/shell/require-role";
import { BackButton } from "@/components/ui/back-button";

/**
 * Who a survey is filled in by.
 *
 * ★ Two plain rows — the client's 2026-09-25 drawing. The pink and blue
 * cards with a drawing and a hint (2026-09-21) became white rows carrying
 * only the name and a chevron: the two names already say which is which.
 */
const CHOICES: { respondent: SurveyRespondent; href: string }[] = [
  { respondent: "GUARDIAN", href: "/surveys/parents" },
  { respondent: "TEACHER", href: "/surveys/teacher" },
];

export default function SurveysChooserPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <div className="flex flex-col gap-5 lg:gap-6">
        <header className="flex items-center gap-2 sm:gap-3">
          <BackButton href="/dashboard" />
          <h1 className="min-w-0 flex-1 text-lead font-semibold leading-heading text-ink sm:text-title">
            Судалгаа, асуулга
          </h1>
        </header>

        <div className="flex flex-col gap-4">
          {CHOICES.map(({ respondent, href }) => (
            <Link
              key={respondent}
              href={href}
              className="group flex min-h-[76px] items-center gap-3 rounded-card border border-border-soft bg-surface px-5 shadow-sm transition-shadow hover:shadow-md sm:px-6"
            >
              <span className="min-w-0 flex-1 text-lead font-medium text-primary">
                {SURVEY_RESPONDENT_LABEL[respondent]}
              </span>
              <ChevronRight
                size={22}
                aria-hidden="true"
                className="shrink-0 text-primary transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          ))}
        </div>
      </div>
    </RequireRole>
  );
}
