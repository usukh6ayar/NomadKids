"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { birthdaySectionSchema, childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { AboutMeSummaryCard } from "@/components/child/about-me-summary-card";
import { ChildAboutMe, aboutMeResponseSchema } from "@/components/child/child-about-me";
import { ChildBirthdayFacts } from "@/components/child/child-birthday";
import { PORTFOLIO } from "@/lib/vocabulary";

/**
 * "Миний тухай" — RFP §4.1, its own page since 2026-08-29.
 *
 * ★ Split off the single-scroll portfolio, on the client's instruction, with
 * a reference screenshot of a dedicated hub tile row (`PortfolioHubNav`, on
 * `portfolio/page.tsx`). Everything a family or a teacher would call "who
 * this child is" lives here now: the identity fields and — moved down from
 * where they used to sit above the age timeline — the birth-date facts
 * (Монгол жил / Одны орд). Reached only from that tile, so the back button
 * returns to the hub rather than to "Хүүхдийн бүртгэл" the way a standalone
 * route normally would.
 *
 * ★★ `AboutMeSummaryCard`, not `ChildHeroProfile`, leads this page —
 * 2026-08-30, another client reference screenshot, this time of the top card
 * alone. `ChildHeroProfile` is the identity block every other per-child page
 * shares; this page's own job (name/DOB/sex) earned it a purpose-built card
 * instead. `AboutMeSummaryCard` carries the page's one `h1`; `ChildAboutMe`
 * has had no heading of its own since the follow-up merge below.
 *
 * ★★★ `AboutMeSummaryCard` and `ChildAboutMe` share one `<Card>` here as of
 * 2026-09-04, on the client's instruction — the page used to render each in
 * its own card, and now reads as a single "Миний тухай" surface with a
 * hairline divider between the identity tiles and the detailed fields. The
 * age pills and "Бүх насыг харьцуулах" bar that `AboutMeSummaryCard` used to
 * carry moved out at the same time, to their own tile on the portfolio hub
 * (`portfolio/page.tsx`'s `PortfolioHubNav`) — age browsing is not "about
 * this child" the way the identity and story fields are, and the client asked
 * for it out of this page rather than folded into the merged card.
 *
 * ★★★★ `ChildBirthdayFacts` (нас/орд/жил) joined the same merged card the
 * same day — it used to sit below it as its own card. `ChildBirthdayNotes`
 * moved the other way, off this page entirely, to
 * `portfolio/growth/compare/page.tsx` — a birthday note is written per age,
 * the same axis the comparison page already organises everything else by,
 * where this page no longer has an age axis of its own to hang it on.
 *
 * ★★★★★ `editing` lives here, not inside `ChildAboutMe`, as of a same-week
 * follow-up — `AboutMeSummaryCard`'s "…" button is the merged card's one edit
 * entry now, so the flag it flips has to be visible to both components rather
 * than local to the one that used to own its own "Засах" button.
 */
export default function AboutMePage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;
  const [editing, setEditing] = useState(false);

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  const aboutMe = useQuery({
    queryKey: qk.aboutMe(childId),
    queryFn: () => get(`/children/${childId}/about-me`, aboutMeResponseSchema),
    enabled: child.isSuccess,
  });

  const birthdays = useQuery({
    queryKey: qk.birthdayNotes(childId),
    queryFn: () => get(`/children/${childId}/birthday-notes`, birthdaySectionSchema),
    enabled: child.isSuccess,
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
        <Link href={`/children/${childId}/portfolio`}>
          <ArrowLeft size={18} />
          {PORTFOLIO}
        </Link>
      </Button>

      <Card pad="roomy" className="flex flex-col gap-5">
        <AboutMeSummaryCard child={data} editing={editing} onEdit={() => setEditing(true)} />

        {!birthdays.isLoading && birthdays.data ? (
          <ChildBirthdayFacts section={birthdays.data} />
        ) : null}

        <div className="border-t border-border" />

        <ChildAboutMe
          childId={childId}
          child={data}
          data={aboutMe.data}
          isLoading={aboutMe.isLoading}
          error={aboutMe.error}
          editing={editing}
          onEditingChange={setEditing}
        />
      </Card>
    </div>
  );
}
