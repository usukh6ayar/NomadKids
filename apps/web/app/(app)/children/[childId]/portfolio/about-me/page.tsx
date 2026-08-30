"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { birthdaySectionSchema, childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { ChildAboutMe, aboutMeResponseSchema } from "@/components/child/child-about-me";
import { ChildBirthdayFacts, ChildBirthdayNotes } from "@/components/child/child-birthday";
import { PORTFOLIO } from "@/lib/vocabulary";
import { ageInYears } from "@/lib/format";

/**
 * "Миний тухай" — RFP §4.1, its own page since 2026-08-29.
 *
 * ★ Split off the single-scroll portfolio, on the client's instruction, with
 * a reference screenshot of a dedicated hub tile row (`PortfolioHubNav`, on
 * `portfolio/page.tsx`). Everything a family or a teacher would call "who
 * this child is" lives here now: the identity fields, and — moved down from
 * where they used to sit above the age timeline — the birth-date facts
 * (Монгол жил / Одны орд) and the birthday notes. Reached only from that
 * tile, so the back button returns to the hub rather than to
 * "Хүүхдийн бүртгэл" the way a standalone route normally would.
 */
export default function AboutMePage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;

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
  const currentAge = ageInYears(data.dateOfBirth);

  return (
    <div className="flex flex-col gap-6 py-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/children/${childId}/portfolio`}>
          <ArrowLeft size={18} />
          {PORTFOLIO}
        </Link>
      </Button>

      <ChildHeroProfile child={data} />

      <ChildAboutMe
        childId={childId}
        child={data}
        data={aboutMe.data}
        isLoading={aboutMe.isLoading}
        error={aboutMe.error}
      />

      {!birthdays.isLoading && birthdays.data ? (
        <ChildBirthdayFacts section={birthdays.data} />
      ) : null}

      <ChildBirthdayNotes
        childId={childId}
        section={birthdays.data ?? null}
        isLoading={birthdays.isLoading}
        currentAge={currentAge}
      />
    </div>
  );
}
