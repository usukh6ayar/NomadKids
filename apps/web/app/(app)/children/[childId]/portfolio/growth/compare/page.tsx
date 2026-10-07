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
import { cn } from "@/lib/utils";

const ageProfilesSchema = z.array(ageProfileSchema);

/**
 * "Хөгжлийн харьцуулалт" — client reference screenshot, 2026-08-30. Every
 * age's own record, side by side, read-only (editing happens on each age's
 * own page — `portfolio/growth/age/[age]/page.tsx`).
 *
 * ★ A card per section, a question at a time, its four ages as equal tiles
 * beneath it — client, 2026-10-07: the horizontal table read as "ойлгомжгүй
 * арзгар" on a phone, where it scrolled sideways and its rows grew to
 * whichever answer was longest. Two tiles a row on a phone, four from `sm`,
 * so the same question still reads straight across the ages. A list answer
 * (chosen skills, traits, family members) is chips, not a comma run. Empty
 * ages say so explicitly and the view never assigns a score or rank.
 * Growth, WHO references and birthday notes deliberately
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
      <header className="flex items-center gap-3">
        <BackButton href={`/children/${childId}/portfolio/growth/age`} />
        <div className="min-w-0">
          <h1 className="text-heading font-semibold text-ink">2-5 насны мэдээлэл</h1>
          <p className="mt-1 text-body text-muted">
            {data.firstName}-ийн нас насны мэдээллийг асуулт бүрээр харьцуулна уу.
          </p>
        </div>
      </header>

      <AgeDevelopmentComparison profiles={profiles} />
    </div>
  );
}

type CompareQuestion = {
  id: string;
  label: string;
  /** A list renders as chips — or as lines when `lines` is set; a string as text. */
  lines?: boolean;
  answer: (profile: AgeProfile, age: PortfolioAge) => string | string[] | null | undefined;
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

function listed(values: (string | null | undefined)[]): string[] {
  return values.map((value) => value?.trim() ?? "").filter(Boolean);
}

/** One note per line — joined with ", " they read «оролцсон., Цэцэрлэгт …». */
function noteLines(notes: Record<string, string>): string[] {
  return listed(Object.values(notes));
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
        answer: (profile) => listed(profile.kindergartenSkills),
      },
      {
        id: "kindergartenSkillNotes",
        label: "Нэмэлт тайлбар",
        lines: true,
        answer: (profile) => noteLines(profile.kindergartenSkillNotes),
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
        answer: (profile) => listed(profile.familyLearningSkills),
      },
      {
        id: "familyLearningNotes",
        label: "Нэмэлт тайлбар",
        lines: true,
        answer: (profile) => noteLines(profile.familyLearningNotes),
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
        answer: (profile) => listed(profile.characterTraits),
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
    // Named to match `FamilyCard`: the comparison is the same five sections
    // read across four ages, so a section that answers to two different names
    // depending on the screen is the one thing it must not do.
    title: "Миний гэр бүл",
    questions: [
      {
        id: "familyMemberTypes",
        label: "Гэр бүлийн гишүүд",
        answer: (profile) => listed(profile.familyMemberTypes),
      },
      {
        id: "familyDescription",
        label: "Хамтдаа хийх дуртай зүйлс",
        answer: (profile) => profile.familyDescription,
      },
      {
        /**
         * The memories' own titles, not a count. "3 дурсамж" across four
         * columns compares nothing; the titles are what a parent reads a
         * year against.
         */
        id: "familyMemories",
        label: "Гэр бүлийн дурсамж",
        answer: (profile) => listed(profile.familyMemories.map((memory) => memory.title)),
      },
    ],
  },
];

/** The age stepper's own colours, so «3 нас» is the same green everywhere. */
const AGE_CHIP: Record<PortfolioAge, string> = {
  2: "bg-sky text-sky-ink",
  3: "bg-mint text-mint-ink",
  4: "bg-sun text-sun-ink",
  5: "bg-pink text-pink-ink",
};

const TEXT = "whitespace-pre-line text-compact leading-snug text-ink sm:text-body";

function Answer({ value, lines }: { value: string | string[]; lines?: boolean }) {
  if (Array.isArray(value) && lines) {
    return (
      <ul className="flex flex-col gap-1.5">
        {value.map((item) => (
          <li key={item} className={TEXT}>
            {item}
          </li>
        ))}
      </ul>
    );
  }
  if (Array.isArray(value)) {
    return (
      <ul className="flex flex-wrap gap-1.5">
        {value.map((item) => (
          <li
            key={item}
            className="rounded-pill border border-border bg-surface px-2.5 py-0.5 text-caption text-ink"
          >
            {item}
          </li>
        ))}
      </ul>
    );
  }
  return <p className={TEXT}>{value}</p>;
}

function AgeDevelopmentComparison({ profiles }: { profiles: AgeProfile[] }) {
  const profileFor = (age: PortfolioAge) => profiles.find((profile) => profile.age === age);

  return (
    <div className="flex flex-col gap-4">
      {AGE_COMPARE_SECTIONS.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`compare-${section.id}`}
          className="overflow-hidden rounded-card border border-border bg-surface shadow-sm"
        >
          <h2
            id={`compare-${section.id}`}
            className="bg-primary-soft/60 px-4 py-3 text-lead font-semibold text-primary"
          >
            {section.title}
          </h2>
          <div className="flex flex-col divide-y divide-border-soft">
            {section.questions.map((question) => (
              <div key={question.id} role="group" aria-label={question.label} className="p-4">
                <h3 className="mb-2.5 text-body font-semibold text-ink">{question.label}</h3>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {PORTFOLIO_AGES.map((age) => {
                    const profile = profileFor(age);
                    const raw = profile ? question.answer(profile, age) : null;
                    const value = Array.isArray(raw)
                      ? raw.length > 0
                        ? raw
                        : null
                      : raw?.trim() || null;

                    return (
                      <div
                        key={age}
                        className="flex min-w-0 flex-col gap-2 rounded-row bg-sunken p-3"
                      >
                        <dt
                          className={cn(
                            "self-start rounded-pill px-2.5 py-0.5 text-caption font-semibold",
                            AGE_CHIP[age],
                          )}
                        >
                          {age} нас
                        </dt>
                        <dd className="min-w-0 break-words">
                          {value ? (
                            <Answer value={value} lines={question.lines} />
                          ) : (
                            <span aria-label="Мэдээлэлгүй" className="text-body text-faint">
                              —
                            </span>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="text-caption leading-relaxed text-muted">
        Энд зөвхөн нэг хүүхдийн нас насны ажиглалтыг харуулна. Оноо, зэрэглэл гаргахгүй бөгөөд бусад
        хүүхэдтэй харьцуулахгүй.
      </p>
    </div>
  );
}
