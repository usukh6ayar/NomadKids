"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BarChart3, FileText, Images, Sprout, User } from "lucide-react";
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
 * ★ A hero card and doors, not a single long scroll — 2026-08-29, on
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
 *  - "Насны харьцуулалт" → `portfolio/growth/compare/page.tsx` — added
 *    2026-09-04, on the client's instruction, when the age pills and "Бүх
 *    насыг харьцуулах" bar were pulled out of `about-me/page.tsx`'s merged
 *    card. This tile is now the one door in; `AgeStepper` carries a visitor
 *    on from there to any of the five age/compare pages.
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

const HUB_TONE_CLASS = {
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  peach: "bg-peach text-peach-ink",
} as const;

/**
 * Миний тухай / Хөгжил / Зургийн цомог / Насны харьцуулалт — real routes, on
 * the client's instruction, with a reference screenshot of this exact tile
 * row (the fourth tile added 2026-09-04, see this file's own doc comment).
 *
 * ★ Routes, not in-page anchors. This nav used to hold `#about-me`/`#growth`/
 * `#gallery` — anchors into the sections it now replaces — with a doc comment
 * noting dedicated routes were "follow-up work the client asked for
 * separately". That follow-up is this change.
 *
 * ★★ `grid-cols-2`, not `grid-cols-3` — CLAUDE.md §5's mobile-first rule.
 * Four labels this long ("Насны харьцуулалт") lose their two-line balance in
 * three narrow columns on a 375px screen; two wider ones keep every label
 * readable without truncation.
 *
 * ★★★ All four destinations' own back buttons return here now — unified
 * 2026-09-04, on the client's instruction, after each had drifted to a
 * different target (`/home`, `growth/page.tsx`, this hub, or nothing at all).
 * `overview/page.tsx` is the one exception that still branches: it is also
 * the bottom nav bar's own "Зураг" tab, so `?from=portfolio` on the href
 * above is how it tells the two entrances apart — see its own doc comment.
 */
function PortfolioHubNav({ childId }: { childId: string }) {
  const items: {
    href: string;
    label: string;
    tone: keyof typeof HUB_TONE_CLASS;
    Icon: typeof User;
  }[] = [
    { href: `/children/${childId}/portfolio/about-me`, label: "Миний тухай", tone: "mint", Icon: User },
    { href: `/children/${childId}/portfolio/growth`, label: "Хөгжил", tone: "mint", Icon: Sprout },
    // The bottom bar's own "Зураг" destination (`layout.tsx`'s `parentNav`) —
    // see this page's own doc comment for why it is the same route rather
    // than a second one. `?from=portfolio` is how that shared route tells
    // its own back button which of its two entrances this was — see
    // `overview/page.tsx`'s doc comment.
    {
      href: `/children/${childId}/overview?from=portfolio`,
      label: "Зургийн цомог",
      tone: "sky",
      Icon: Images,
    },
    // Moved out of `about-me/page.tsx`'s merged card — see this file's own
    // doc comment. `AgeStepper` on the destination page carries a visitor on
    // to any of the four per-age pages from here.
    {
      href: `/children/${childId}/portfolio/growth/compare`,
      label: "Насны харьцуулалт",
      tone: "peach",
      Icon: BarChart3,
    },
  ];

  return (
    <nav aria-label="Цахим хавтасны хэсгүүд">
      <ul className="grid grid-cols-2 gap-2">
        {items.map(({ href, label, tone, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex flex-col items-center gap-2 rounded-control px-2 py-3 text-center transition-transform hover:-translate-y-0.5"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-14 items-center justify-center rounded-card",
                  HUB_TONE_CLASS[tone],
                )}
              >
                <Icon size={26} />
              </span>
              <span className="text-caption font-semibold leading-tight text-ink">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
