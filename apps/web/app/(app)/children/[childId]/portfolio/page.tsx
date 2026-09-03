"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ChevronRight, FileText, Images, Sprout, User } from "lucide-react";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { ReportDialog } from "@/components/reports/report-dialog";
import { useSession } from "@/lib/auth/session";
import { PORTFOLIO } from "@/lib/vocabulary";
import { cn } from "@/lib/utils";

/**
 * The portfolio — RFP §4.3.
 *
 * ★ A hero card and three doors, not a single long scroll — 2026-08-29, on
 * the client's instruction, with a reference screenshot of exactly this hub.
 * Everything the old single-scroll page rendered inline still exists; it
 * moved to whichever door now owns it:
 *
 *  - "Миний тухай" → `portfolio/about-me/page.tsx` — identity, the birth-date
 *    facts (Монгол жил / Одны орд) and the birthday notes.
 *  - "Хөгжил" → `portfolio/growth/page.tsx` — ages 2–5, milestones, and quick
 *    actions into Ажиглалт and Бүтээл.
 *  - "Зургийн цомог" → `/overview`, the same destination the bottom bar's
 *    own "Зураг" tab already used — one album, reached two ways, rather than
 *    a second screen that happens to show the same photographs.
 *
 * The PDF button stays here: `type: "CHILD_PORTFOLIO"` exports this whole
 * record, not any one door of it, so it belongs on the hub the doors share
 * rather than on one of them.
 */
export default function PortfolioPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  if (child.isLoading) return <LoadingState rows={4} />;

  if (child.isError) {
    return (
      <div className="py-6">
        <ErrorState
          title={isNotFound(child.error) ? "Олдсонгүй" : "Алдаа гарлаа"}
          description={
            isNotFound(child.error) ? `${PORTFOLIO} олдсонгүй.` : errorMessage(child.error)
          }
          action={
            <Button asChild variant="secondary">
              <Link href="/children">Жагсаалт руу буцах</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const data = child.data!;

  return (
    <div className="flex flex-col gap-6 py-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/children/${childId}/general`}>
          <ArrowLeft size={18} />
          Хүүхдийн бүртгэл
        </Link>
      </Button>

      <SectionHeader as="h1" title={PORTFOLIO} className="mb-0" />

      <ChildHeroProfile
        child={data}
        showHealthAlert={isStaff}
        actions={
          <ReportDialog
            childId={childId}
            // The current enrolment's year — what the annual report compares.
            schoolYearId={
              data.enrollments?.find((e) => e.status === "ACTIVE")?.schoolYear?.id ??
              data.enrollments?.[0]?.schoolYear?.id
            }
            trigger={
              <Button variant="secondary" size="sm">
                <FileText size={18} />
                PDF татах
              </Button>
            }
          />
        }
      />

      <PortfolioHubNav childId={childId} />
    </div>
  );
}

/**
 * Миний тухай / Хөгжил / Зургийн цомог — three real routes, on the client's
 * instruction, with a reference screenshot of this exact tile row.
 *
 * ★ Routes, not in-page anchors. This nav used to hold `#about-me`/`#growth`/
 * `#gallery` — anchors into the sections it now replaces — with a doc comment
 * noting dedicated routes were "follow-up work the client asked for
 * separately". That follow-up is this change.
 */
function PortfolioHubNav({ childId }: { childId: string }) {
  const items: { href: string; label: string; tone: "mint" | "sky"; Icon: typeof User }[] = [
    {
      href: `/children/${childId}/portfolio/about-me`,
      label: "Миний тухай",
      tone: "mint",
      Icon: User,
    },
    { href: `/children/${childId}/portfolio/growth`, label: "Хөгжил", tone: "mint", Icon: Sprout },
    // The bottom bar's own "Зураг" destination (`layout.tsx`'s `parentNav`) —
    // see this page's own doc comment for why it is the same route rather
    // than a second one.
    { href: `/children/${childId}/overview`, label: "Зургийн цомог", tone: "sky", Icon: Images },
  ];

  /*
    ★ REDESIGN 2026-09-03 — the tiles became cards.

    This is the emotional centre of the family's experience and the brief asks
    it to carry the most design care, but the row was three loose glyphs on the
    page background with a caption under each — visually the weakest element on
    a screen that should be the warmest. They now sit on real surfaces with the
    product's interactive treatment, a generous 64px tinted disc, and a chevron
    that says the tile opens something.

    The tint stays warm and restrained — the accent is the *disc*, not the card,
    so the row reads as friendly rather than as three coloured rectangles. Card
    surfaces stay white, which is what keeps this from tipping into the
    "childish / game-like" register the direction explicitly rules out.

    `items-stretch` on the grid so all three cards match height whatever their
    label wraps to — "Зургийн цомог" wraps at 375px and the other two do not.
  */
  return (
    <nav aria-label="Цахим хавтасны хэсгүүд">
      <ul className="grid grid-cols-3 items-stretch gap-2 sm:gap-3">
        {items.map(({ href, label, tone, Icon }) => (
          <li key={href} className="flex">
            <Link
              href={href}
              className="card-interactive flex w-full flex-col items-center gap-2.5 rounded-card border border-border bg-surface px-2 py-4 text-center shadow-sm sm:px-3 sm:py-5"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-16 items-center justify-center rounded-card",
                  tone === "mint" ? "bg-mint text-mint-ink" : "bg-sky text-sky-ink",
                )}
              >
                <Icon size={28} />
              </span>
              <span className="text-body font-semibold leading-snug text-ink">{label}</span>
              <ChevronRight size={16} aria-hidden="true" className="text-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
