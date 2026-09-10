"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { BarChart3, ChevronRight, MessageSquare } from "lucide-react";
import {
  SURVEY_KIND_HINT,
  SURVEY_KIND_LABEL,
  surveySchema,
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
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const surveysSchema = z.array(surveySchema);

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
 */
const KINDS: {
  kind: SurveyKind;
  href: string;
  Icon: typeof BarChart3;
  chip: string;
  card: string;
  title: string;
}[] = [
  {
    kind: "FORM",
    href: "/surveys/forms",
    Icon: BarChart3,
    chip: "bg-primary-soft text-primary",
    card: "border-primary/25 bg-primary-soft/60 hover:border-primary",
    title: "text-primary",
  },
  {
    kind: "POLL",
    href: "/surveys/polls",
    Icon: MessageSquare,
    chip: "bg-mint text-mint-ink",
    card: "border-mint bg-mint/25 hover:border-mint-ink/40",
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
  const { primaryKindergartenId } = useSession();

  const surveys = useQuery({
    queryKey: qk.kindergartenSurveys(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/surveys`, surveysSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  /*
    ★ The same query key both lists use, so arriving here fills their cache.

    `listForKindergarten` returns every survey in one bounded response, which
    is what makes that safe: this screen shows five of them and the list screen
    that follows shows the rest without a second request.
  */
  const recent = (surveys.data ?? []).slice(0, 5);

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <header>
        <h1 className="text-title font-semibold leading-heading text-ink">Судалгаа, асуулга</h1>
        <p className="mt-0.5 text-body text-muted">Эцэг эхийн санал, оролцоог хялбархан аваарай.</p>
      </header>

      <div className="flex flex-col gap-3 md:flex-row">
        {KINDS.map(({ kind, href, Icon, chip, card, title }) => (
          <Link
            key={kind}
            href={href}
            className={cn(
              "group flex flex-1 items-center gap-3.5 rounded-card border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md",
              card,
            )}
          >
            <span
              aria-hidden="true"
              className={cn("grid size-12 shrink-0 place-items-center rounded-control", chip)}
            >
              <Icon size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-lead font-semibold leading-heading", title)}>
                {SURVEY_KIND_LABEL[kind]}
              </span>
              <span className="mt-0.5 block text-caption text-muted">{SURVEY_KIND_HINT[kind]}</span>
            </span>
            <ChevronRight
              size={20}
              aria-hidden="true"
              className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        ))}
      </div>

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
    </div>
  );
}
