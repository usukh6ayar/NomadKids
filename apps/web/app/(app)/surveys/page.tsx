"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BarChart3, ChevronRight, MessageSquare } from "lucide-react";
import { Art, type ArtName } from "@/components/ui/art";
import {
  groupListItemSchema,
  paginated,
  SURVEY_KIND_HINT,
  SURVEY_KIND_LABEL,
  type SurveyKind,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { SearchField } from "@/components/ui/search-field";
import { formatDate } from "@/lib/format";
import { canManageSurvey, staffSurveysSchema } from "@/lib/survey-access";
import { cn } from "@/lib/utils";

const groupsSchema = paginated(groupListItemSchema);

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Ноорог",
  PUBLISHED: "Идэвхтэй",
  CLOSED: "Дууссан",
};

const STATUS_TONE: Record<string, "neutral" | "mint" | "sun"> = {
  DRAFT: "neutral",
  PUBLISHED: "mint",
  CLOSED: "sun",
};

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
 * ★★★ Each kind carries a drawing as well as a glyph — 2026-09-12, to the
 * client's own design.
 *
 * `art` is the big illustration the two choice cards are built around; `Icon`
 * is the small glyph the "Сүүлийн үүсгэсэн" rows below still use, where a
 * 36px chip has no room for a drawing. Two fields rather than one because they
 * are answering at two sizes, and a drawing shrunk to 17px is a smudge.
 */
const KINDS: {
  kind: SurveyKind;
  href: string;
  art: ArtName;
  Icon: typeof BarChart3;
  chip: string;
  card: string;
  title: string;
}[] = [
  {
    kind: "FORM",
    href: "/surveys/forms",
    art: "teacherSurvey",
    Icon: BarChart3,
    chip: "bg-primary-soft text-primary",
    card: "border-primary/30 bg-primary-soft/40 hover:border-primary",
    title: "text-primary",
  },
  {
    kind: "POLL",
    href: "/surveys/polls",
    art: "teacherPoll",
    Icon: MessageSquare,
    chip: "bg-mint text-mint-ink",
    card: "border-mint-ink/50 bg-surface hover:border-mint-ink",
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
export default function SurveysHubPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <SurveysHub />
    </RequireRole>
  );
}

function SurveysHub() {
  const { primaryKindergartenId, hasRole, session } = useSession();
  const isAdmin = hasRole("ADMIN");
  const [groupSearch, setGroupSearch] = useState("");

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
  const recent = (surveys.data ?? [])
    .filter((survey) => canManageSurvey(survey, session?.user.id, isAdmin))
    .slice(0, 5);
  const groupTerm = groupSearch.trim().toLowerCase();
  const visibleGroups = (groups.data?.items ?? []).filter((group) =>
    group.name.toLowerCase().includes(groupTerm),
  );

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <header>
        <h1 className="text-title font-semibold leading-heading text-ink">Судалгаа, асуулга</h1>
        <p className="mt-0.5 text-body text-muted">Эцэг эхийн санал, оролцоог хялбархан аваарай.</p>
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
              "group flex min-h-[118px] items-center gap-3 rounded-card border p-3 text-start transition-all hover:-translate-y-0.5 hover:shadow-md sm:min-h-[138px] sm:gap-5 sm:p-5",
              card,
            )}
          >
            <Art
              name={art}
              size={128}
              className="size-16 shrink-0 object-contain transition-transform group-hover:scale-105 sm:size-24"
            />
            <span className="min-w-0 flex-1">
              <span
                className={cn("block text-lead font-bold leading-heading sm:text-title", title)}
              >
                {isAdmin ? `${SURVEY_KIND_LABEL[kind]} үүсгэх` : SURVEY_KIND_LABEL[kind]}
              </span>
              <span className="mt-1 block text-caption leading-snug text-muted sm:text-body">
                {SURVEY_KIND_HINT[kind]}
              </span>
            </span>
          </Link>
        ))}
      </div>

      {isAdmin ? (
        <section aria-labelledby="survey-groups" className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="survey-groups" className="text-title font-semibold leading-heading text-ink">
                Бүлгүүд
              </h2>
              <p className="mt-0.5 text-body text-muted">
                Судалгаа, асуулгыг харах бүлгээ сонгоно уу.
              </p>
            </div>
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
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {visibleGroups.map((group, index) => {
                const tones = [
                  "bg-primary-soft text-primary",
                  "bg-mint text-mint-ink",
                  "bg-sun text-sun-ink",
                  "bg-cornflower text-cornflower-ink",
                ] as const;
                const children = group._count?.enrollments ?? 0;

                return (
                  <Link
                    key={group.id}
                    href={`/surveys/groups/${group.id}`}
                    className="group flex min-h-[76px] items-center gap-3 rounded-row border border-border bg-surface px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-11 shrink-0 place-items-center rounded-control",
                        tones[index % tones.length],
                      )}
                    >
                      <Art name="group" size={34} className="size-[34px] object-contain" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-lead font-semibold text-ink transition-colors group-hover:text-primary">
                        {group.name}
                      </span>
                      <span className="mt-0.5 block text-caption tabular-nums text-muted">
                        {children} хүүхэд
                      </span>
                    </span>
                    <ChevronRight
                      size={18}
                      aria-hidden="true"
                      className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                    />
                  </Link>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : (
        <section aria-labelledby="recent-surveys" className="flex flex-col gap-2.5">
          <h2 id="recent-surveys" className="text-lead font-semibold leading-heading text-ink">
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

          {recent.map((survey) => {
            const look = KINDS.find((k) => k.kind === survey.kind) ?? KINDS[0]!;
            return (
              <Link key={survey.id} href={`/surveys/${survey.id}`} className="group block">
                <Card
                  pad="compact"
                  className="flex items-center gap-3 transition-all group-hover:border-primary group-hover:shadow-sm"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-control",
                      look.chip,
                    )}
                  >
                    <look.Icon size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium leading-snug text-ink transition-colors group-hover:text-primary">
                      {survey.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONE[survey.status]}>{STATUS_LABEL[survey.status]}</Badge>
                      <span className="text-caption tabular-nums text-muted">
                        {formatDate(survey.closedAt ?? survey.publishedAt ?? survey.createdAt)}
                      </span>
                    </span>
                  </span>
                  <ChevronRight
                    size={18}
                    aria-hidden="true"
                    className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                  />
                </Card>
              </Link>
            );
          })}
        </section>
      )}
    </div>
  );
}
