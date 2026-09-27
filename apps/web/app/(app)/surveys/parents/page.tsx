"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Art, type ArtName } from "@/components/ui/art";
import {
  groupListItemSchema,
  paginated,
  SURVEY_KIND_LABEL,
  SURVEY_PERIOD_LABEL,
  SURVEY_RESPONDENT_LABEL,
  surveyPeriodSchema,
  type SurveyKind,
  type SurveyPeriod,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { RequireRole } from "@/components/shell/require-role";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { SearchField } from "@/components/ui/search-field";
import { canManageSurvey, staffSurveysSchema } from "@/lib/survey-access";
import { cn } from "@/lib/utils";
import { BackButton } from "@/components/ui/back-button";
import { PeriodButtons } from "@/components/survey/period-buttons";
import {
  AdministrationSurveysCard,
  SchoolYearSelect,
  SurveyListRow,
  schoolYearStart,
  schoolYearsOf,
} from "@/components/survey/survey-hub-parts";

const groupsSchema = paginated(groupListItemSchema);

/**
 * ★ Two kinds, two colours, and the colours are the navigation.
 *
 * The client's drawing gives Судалгаа blue and Асуулга green, and a reader who
 * has been here once knows which list they are on before reading a word, which
 * is most of what a hub is for.
 *
 * ★★ `mint` for a *kind*, which `tone.ts` would normally refuse.
 *
 * That file says a tone is a meaning and `mint` means "complete" — the rule
 * exists so a screen does not pick an accent because it looks nice. This is
 * the same exception `chat-widget.tsx` already makes, drawing a group room
 * `bg-mint text-mint-ink` against a direct room's `bg-primary-soft`: when two
 * kinds of one thing sit side by side, the accent is telling them apart rather
 * than reporting a state. Written down here because the next reader will
 * check.
 *
 * ★★★ `art` is the drawing the two choice cards are built around. The rows
 * below carry no glyph since 2026-09-25 — the kind is named there in its
 * colour instead.
 */
const KINDS: {
  kind: SurveyKind;
  href: string;
  art: ArtName;
  card: string;
  title: string;
}[] = [
  {
    kind: "FORM",
    href: "/surveys/forms",
    art: "teacherSurvey",
    card: "hover:border-primary",
    title: "text-primary",
  },
  {
    kind: "POLL",
    href: "/surveys/polls",
    art: "teacherPoll",
    card: "hover:border-mint-ink",
    title: "text-mint-ink",
  },
];

/**
 * Судалгаа, асуулга — the hub, 2026-09-10, at the client's request.
 *
 * ★ A screen whose whole job is a choice, which is why it is not a tab strip.
 *
 * The two lived on one page behind tabs until this drawing arrived, and the
 * client's words about it were plain: "Энэ 2 тусдаа байх ёстой." Tabs claim
 * two views of one thing. A poll is answered in a tap and read as a bar; a
 * questionnaire is filled in and read as a report. They share a table and
 * almost nothing else.
 *
 * ★★ The recent list underneath is the reason this is not merely a menu.
 *
 * A hub of two links is a screen a teacher resents, because it costs a tap and
 * answers nothing. "Сүүлийн үүсгэсэн" makes the landing worth arriving at: the
 * thing you came back for is usually the thing you made last, and it is a
 * direct link rather than a route through whichever list it belongs to.
 */
export default function ParentSurveysHubPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      {/* `Suspense` because the hub reads `?period=` through `useSearchParams`. */}
      <Suspense fallback={<LoadingState rows={4} />}>
        <SurveysHub />
      </Suspense>
    </RequireRole>
  );
}

function SurveysHub() {
  const { primaryKindergartenId, hasRole, session } = useSession();
  const isAdmin = hasRole("ADMIN");
  const [groupSearch, setGroupSearch] = useState("");
  const [schoolYear, setSchoolYear] = useState(() => schoolYearStart(new Date().toISOString()));
  const router = useRouter();
  const searchParams = useSearchParams();
  const period = surveyPeriodSchema.safeParse(searchParams.get("period")).data ?? null;
  const selectPeriod = (next: SurveyPeriod | null) =>
    router.replace(next ? `/surveys/parents?period=${next}` : "/surveys/parents", {
      scroll: false,
    });

  const surveys = useQuery({
    queryKey: qk.kindergartenSurveys(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/surveys`, staffSurveysSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled: isAdmin,
    staleTime: 60_000,
  });

  /*
    ★ The same query key both lists use, so arriving here fills their cache.

    `listForKindergarten` returns every survey in one bounded response, which
    is what makes that safe: this screen shows five of them and the list screen
    that follows shows the rest without a second request.
  */
  // A teacher's own assessments live on `/surveys/teacher`, not here.
  const manageableSurveys = (surveys.data ?? []).filter(
    (survey) =>
      survey.respondent !== "TEACHER" && canManageSurvey(survey, session?.user.id, isAdmin),
  );
  const schoolYears = schoolYearsOf(manageableSurveys);
  const surveysInYear = manageableSurveys.filter(
    (survey) => schoolYearStart(survey.createdAt) === schoolYear,
  );
  const recent = surveysInYear.slice(0, 5);
  const periodSurveys = period ? surveysInYear.filter((survey) => survey.period === period) : [];
  const groupTerm = groupSearch.trim().toLowerCase();
  const visibleGroups = (groups.data?.items ?? []).filter((group) =>
    group.name.toLowerCase().includes(groupTerm),
  );

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <header className="flex items-center gap-2 sm:gap-3">
        <BackButton href="/surveys" />
        <h1 className="min-w-0 flex-1 text-lead font-semibold leading-heading text-ink sm:text-title">
          {SURVEY_RESPONDENT_LABEL.GUARDIAN}
        </h1>
        <SchoolYearSelect years={schoolYears} value={schoolYear} onChange={setSchoolYear} />
      </header>

      {/*
        ★ Side by side on a phone too — 2026-09-10, at the client's request.

        They stacked below `md`, which is the safe default for a card carrying
        an icon, a name and a sentence: at 390px each column is about 170px and
        that content does not fit across. It fits *down*. So the card turns its
        axis instead of the grid turning its own — drawing over name over hint,
        going back to a row from `sm` where the width exists.

        ★★ REDESIGN 2026-09-12, to the client's own design: the tinted chip with
        a 20px glyph in it became the drawing itself, sitting on the card with
        no tile behind it, and the chevron went with the chip. The card is two
        things now — a picture and a name — which is the whole of what a choice
        between two screens needs.

        The chevron is dropped at every width rather than only in the stacked
        layout. It was an affordance for a card that is already the only
        pressable thing on the row, and the drawing is what the eye lands on.
      */}
      <div className="grid grid-cols-2 gap-3">
        {KINDS.map(({ kind, href, art, card, title }) => (
          <Link
            key={kind}
            href={href}
            className={cn(
              "group flex min-h-[88px] items-center gap-3 rounded-card border border-border-soft bg-surface p-3 text-start shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md sm:min-h-[104px] sm:gap-5 sm:p-4",
              card,
            )}
          >
            <Art
              name={art}
              size={128}
              className="size-14 shrink-0 object-contain transition-transform group-hover:scale-105 sm:size-20"
            />
            <span className="min-w-0 flex-1">
              <span
                className={cn("block text-lead font-bold leading-heading sm:text-title", title)}
              >
                {isAdmin ? `${SURVEY_KIND_LABEL[kind]} үүсгэх` : SURVEY_KIND_LABEL[kind]}
              </span>
            </span>
          </Link>
        ))}
      </div>

      <PeriodButtons selected={period} onSelect={selectPeriod} />

      {period ? (
        <section aria-labelledby="period-surveys" className="flex flex-col gap-2.5">
          <h2 id="period-surveys" className="text-lead font-semibold leading-heading text-ink">
            {SURVEY_PERIOD_LABEL[period]}
          </h2>
          {surveys.isLoading ? <LoadingState rows={3} /> : null}
          {surveys.isError ? <ErrorState description={errorMessage(surveys.error)} /> : null}
          {surveys.data && periodSurveys.length === 0 ? (
            <EmptyState
              title={`${SURVEY_PERIOD_LABEL[period]} алга`}
              description="Шинэ судалгаа, асуулга үүсгэхдээ үнэлгээний төрлийг сонгоно уу."
            />
          ) : null}
          {periodSurveys.map((survey) => (
            <SurveyListRow key={survey.id} survey={survey} />
          ))}
        </section>
      ) : null}

      <AdministrationSurveysCard />

      {period ? null : isAdmin ? (
        <section aria-labelledby="survey-groups" className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="survey-groups" className="text-title font-bold leading-heading text-ink">
              Бүлгүүд
            </h2>
            <SearchField
              label="Бүлгийн нэрээр хайх"
              placeholder="Бүлгийн нэрээр хайх..."
              value={groupSearch}
              onChange={setGroupSearch}
              className="w-full flex-none sm:max-w-[320px]"
            />
          </div>

          {groups.isLoading ? <LoadingState rows={4} /> : null}
          {groups.isError ? <ErrorState description={errorMessage(groups.error)} /> : null}

          {groups.data && groups.data.items.length === 0 ? (
            <EmptyState title="Бүлэг алга" description="Судалгаа харахын өмнө бүлэг үүсгэнэ үү." />
          ) : null}

          {groups.data && groups.data.items.length > 0 && visibleGroups.length === 0 ? (
            <EmptyState
              title="Тохирох бүлэг олдсонгүй"
              description="Хайлтын үгээ өөрчилж үзнэ үү."
            />
          ) : null}

          {visibleGroups.length > 0 ? (
            /*
              ★ Plain white rows, as the teacher's lists are — 2026-09-25, the
              client: "удирдлага судалгаа хэсэг багшийнх шиг цэвэрхэн". The
              tinted squares and the drawing in each went; name, count and a
              chevron remain.
            */
            <div className="flex flex-col gap-2.5">
              {visibleGroups.map((group) => (
                <Link
                  key={group.id}
                  href={`/surveys/groups/${group.id}`}
                  className="group flex min-h-[60px] items-center gap-3 rounded-card border border-border-soft bg-surface px-4 py-2.5 shadow-sm transition-all hover:border-primary hover:shadow-md sm:px-5"
                >
                  <span className="min-w-0 flex-1 truncate text-lead text-ink transition-colors group-hover:text-primary">
                    {group.name}
                  </span>
                  <span className="shrink-0 text-body tabular-nums text-muted">
                    {group._count?.enrollments ?? 0} хүүхэд
                  </span>
                  <ChevronRight
                    size={20}
                    aria-hidden="true"
                    className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                  />
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <section aria-labelledby="recent-surveys" className="flex flex-col gap-2.5">
          <h2 id="recent-surveys" className="text-title font-bold leading-heading text-ink">
            Сүүлийн үүсгэсэн
          </h2>

          {surveys.isLoading ? <LoadingState rows={3} /> : null}
          {surveys.isError ? <ErrorState description={errorMessage(surveys.error)} /> : null}

          {surveys.data && recent.length === 0 ? (
            <EmptyState
              title="Хараахан юу ч үүсгээгүй байна"
              description="Дээрх хоёрын аль нэгийг сонгон эхлүүлнэ үү."
            />
          ) : null}

          {recent.map((survey) => (
            <SurveyListRow key={survey.id} survey={survey} />
          ))}
        </section>
      )}
    </div>
  );
}
