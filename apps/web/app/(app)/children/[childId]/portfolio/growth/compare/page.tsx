"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { z } from "zod";
import { ageProfileSchema, childDetailSchema, type AgeProfile } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { BackButton } from "@/components/ui/back-button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { FAVORITE_FIELDS, type PortfolioAge } from "@/lib/age-development";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";

const ageProfilesSchema = z.array(ageProfileSchema);

/**
 * "Хөгжлийн харьцуулалт" — client reference screenshot, 2026-08-30. Every
 * age's own record, side by side, read-only (editing happens on each age's
 * own page — `portfolio/growth/age/[age]/page.tsx`).
 *
 * ★ The five parent age-development sections are rows in one horizontal
 * table, with ages 2–5 as columns. Empty ages say so explicitly and the view
 * never assigns a score or rank.
 *
 * Every questionnaire prompt is its own row so the same answer can be scanned
 * straight across ages. Growth, WHO references and birthday notes deliberately
 * live outside this focused view.
 */
export default function GrowthComparePage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  const ageProfiles = useQuery({
    queryKey: qk.ageProfiles(childId),
    queryFn: () => get(`/children/${childId}/age-profiles`, ageProfilesSchema),
  });

  if (child.isLoading || ageProfiles.isLoading) {
    return <LoadingState rows={5} />;
  }

  const error = child.error ?? ageProfiles.error;
  if (child.isError || ageProfiles.isError) {
    return (
      <div className="py-6">
        <ErrorState
          title={isNotFound(error) ? "Олдсонгүй" : "Алдаа гарлаа"}
          description={isNotFound(error) ? "Энэ хүүхдийн мэдээлэл олдсонгүй." : errorMessage(error)}
        />
      </div>
    );
  }

  const data = child.data!;
  const profiles = ageProfiles.data!;

  return (
    <div className="flex flex-col gap-6 py-2">
      <BackButton href={`/children/${childId}/portfolio/growth/age`} />

      <header>
        <h1 className="text-heading font-semibold text-ink">2-5 насны мэдээлэл</h1>
        <p className="mt-1 text-body text-muted">
          {data.firstName}-ийн нас насны мэдээллийг хажуу тийш гүйлгэн харьцуулна уу.
        </p>
      </header>

      <AgeDevelopmentComparison profiles={profiles} />
    </div>
  );
}

type CompareQuestion = {
  id: string;
  label: string;
  answer: (profile: AgeProfile, age: PortfolioAge) => string | null | undefined;
};

type CompareSection = {
  id: string;
  title: string;
  questions: CompareQuestion[];
};

function joined(values: (string | null | undefined)[]): string | null {
  const answer = values
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(", ");
  return answer || null;
}

function joinedNotes(notes: Record<string, string>): string | null {
  return joined(Object.values(notes));
}

const AGE_COMPARE_SECTIONS: CompareSection[] = [
  {
    id: "favorites",
    title: "Миний дуртай бүх зүйлс",
    questions: FAVORITE_FIELDS.map(({ key, label }) => ({
      id: key,
      label,
      answer: (profile) => profile[key],
    })),
  },
  {
    id: "kindergarten-skills",
    title: "Миний цэцэрлэгтээ сурсан зүйлс",
    questions: [
      {
        id: "kindergartenSkills",
        label: "Сонгосон чадварууд",
        answer: (profile) => joined(profile.kindergartenSkills),
      },
      {
        id: "kindergartenSkillNotes",
        label: "Нэмэлт тайлбар",
        answer: (profile) => joinedNotes(profile.kindergartenSkillNotes),
      },
      {
        id: "kindergartenOtherSkill",
        label: "Өөр сурсан зүйл",
        answer: (profile) => profile.kindergartenOtherSkill ?? profile.newSkills,
      },
    ],
  },
  {
    id: "family-learning",
    title: "Миний гэр бүлээсээ суралцсан зүйлс",
    questions: [
      {
        id: "familyLearningSkills",
        label: "Сонгосон чадварууд",
        answer: (profile) => joined(profile.familyLearningSkills),
      },
      {
        id: "familyLearningNotes",
        label: "Нэмэлт тайлбар",
        answer: (profile) => joinedNotes(profile.familyLearningNotes),
      },
      {
        id: "familyLearningOther",
        label: "Өөр сурсан зүйл",
        answer: (profile) => profile.familyLearningOther ?? profile.familyMembers,
      },
    ],
  },
  {
    id: "character",
    title: "Миний зан араншин",
    questions: [
      {
        id: "characterTraits",
        label: "Зан араншингийн ажиглалт",
        answer: (profile) => joined(profile.characterTraits),
      },
      {
        id: "characterObservation",
        label: "Тухайн насны зан араншин",
        answer: (profile) =>
          profile.characterObservation ??
          joined([profile.personality, profile.emotionalTraits].filter(Boolean)),
      },
    ],
  },
  {
    id: "family",
    title: "Гэр бүл",
    questions: [
      {
        id: "familyMemberTypes",
        label: "Гэр бүлийн гишүүд",
        answer: (profile) => joined(profile.familyMemberTypes),
      },
      {
        id: "familyDescription",
        label: "Гэр бүлийн тухай, хамтдаа хийх дуртай зүйлс",
        answer: (profile) => profile.familyDescription,
      },
    ],
  },
];

function AgeDevelopmentComparison({ profiles }: { profiles: AgeProfile[] }) {
  const profileFor = (age: PortfolioAge) => profiles.find((profile) => profile.age === age);

  return (
    <section aria-labelledby="age-information-table-heading">
      <h2 id="age-information-table-heading" className="sr-only">
        2-5 насны мэдээллийн хүснэгт
      </h2>
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-sm">
        <table
          aria-label="2-5 насны мэдээллийн хэвтээ харьцуулалт"
          className="w-full min-w-280 table-fixed border-collapse text-body"
        >
          <colgroup>
            <col className="w-56" />
            {PORTFOLIO_AGES.map((age) => (
              <col key={age} className="w-64" />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b-2 border-border bg-sunken">
              <th
                scope="col"
                className="sticky left-0 z-10 bg-sunken px-4 py-3 text-left font-semibold text-ink"
              >
                Сэдэв
              </th>
              {PORTFOLIO_AGES.map((age) => (
                <th
                  key={age}
                  scope="col"
                  className="border-l border-border px-4 py-3 text-left font-semibold text-primary"
                >
                  {age} нас
                </th>
              ))}
            </tr>
          </thead>
          {AGE_COMPARE_SECTIONS.map((section) => (
            <tbody key={section.id}>
              <tr className="border-y border-border bg-primary-soft/60">
                <th
                  scope="rowgroup"
                  colSpan={5}
                  className="px-4 py-2.5 text-left font-semibold text-primary"
                >
                  {section.title}
                </th>
              </tr>
              {section.questions.map((question) => (
                <tr key={question.id} className="border-b border-border last:border-0">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface px-4 py-3 text-left align-top font-medium text-ink"
                  >
                    {question.label}
                  </th>
                  {PORTFOLIO_AGES.map((age) => {
                    const profile = profileFor(age);
                    const answer = profile ? question.answer(profile, age)?.trim() : null;

                    return (
                      <td
                        key={age}
                        className={
                          answer
                            ? "border-l border-border px-4 py-3 align-top text-ink"
                            : "border-l border-border px-4 py-3 text-center align-middle text-muted"
                        }
                      >
                        {answer || <span aria-label="Мэдээлэлгүй">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="mt-2 text-caption leading-relaxed text-muted">
        Энд зөвхөн нэг хүүхдийн нас насны ажиглалтыг харуулна. Оноо, зэрэглэл гаргахгүй бөгөөд бусад
        хүүхэдтэй харьцуулахгүй.
      </p>
    </section>
  );
}
