"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { z } from "zod";
import { ageProfileSchema, childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { BackButton } from "@/components/ui/back-button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { AgeProfileProgress } from "@/components/child/age-profile-progress";
import {
  CharacterCard,
  FamilyLearningCard,
  FamilyCard,
  FavoritesCard,
  KindergartenSkillsCard,
} from "@/components/child/age-profile-cards";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";

const ageProfilesSchema = z.array(ageProfileSchema);

/**
 * "Миний {age} нас" — client reference screenshot, 2026-08-30. A parent's own
 * destination for one age's whole record: favourites, character, family,
 * dream and learned things.
 *
 * ★ No hero card, unlike `ParentGrowthLauncher` and the comparison page — the
 * screenshot draws this one as a plain heading over the page background, not
 * a card. Both other screens' gradient hero is `PortfolioHero`; this page is
 * deliberately not one of its call sites.
 *
 * ★★ Guardian-only, same as `ParentGrowthLauncher`. Staff keep editing every
 * one of these fields through `ChildGrowthAges`'s accordion on
 * `growth/page.tsx` — this route has no staff branch of its own and nothing
 * links here for a teacher. `AgeStepper` carries a visitor between the five
 * age/compare pages once they've arrived; the one door in from elsewhere is
 * the portfolio hub's "Насны харьцуулалт" tile (`portfolio/page.tsx`'s
 * `PortfolioHubNav`), which lands on the compare page — `AboutMeSummaryCard`
 * carried the pills that used to point here directly until they were pulled
 * out of "Миний тухай" on 2026-09-04.
 */
export default function AgeProfilePage() {
  const params = useParams<{ childId: string; age: string }>();
  const childId = params.childId;
  const requestedAge = Number(params.age);
  const age = PORTFOLIO_AGES.find((a) => a === requestedAge);

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  const ageProfiles = useQuery({
    queryKey: qk.ageProfiles(childId),
    queryFn: () => get(`/children/${childId}/age-profiles`, ageProfilesSchema),
    enabled: age !== undefined,
  });

  const backLink = <BackButton href={`/children/${childId}/portfolio/growth/age`} />;

  // RFP §4.3 fixes this at 2–5; anything else in the URL is a bad link, not a
  // record this page can render.
  if (age === undefined) {
    return (
      <div className="flex flex-col gap-6 py-2">
        {backLink}
        <ErrorState title="Олдсонгүй" description="Энэ нас бүртгэлгүй байна." />
      </div>
    );
  }

  if (child.isLoading || ageProfiles.isLoading) return <LoadingState rows={4} />;

  if (child.isError || ageProfiles.isError) {
    const error = child.error ?? ageProfiles.error;
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
  const profile = ageProfiles.data?.find((p) => p.age === age);

  return (
    <div className="flex flex-col gap-4 py-1 sm:gap-5 sm:py-2">
      {backLink}

      {/*
        ★ One heading, not a heading over a subtitle — 2026-09-10.
        "Миний {age} нас" with "{age} насны дурсамж" beneath it said the same
        thing twice at two weights, which reads as a mistake rather than
        emphasis. The subtitle was never carrying anything the title did not.
      */}
      <div className="text-center">
        <h1 className="text-display font-bold text-ink">Миний {age} нас дурсамжууд</h1>
      </div>

      <AgeProfileProgress
        age={age}
        childName={data.firstName}
        childSex={data.sex}
        profile={profile}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3" data-testid="age-profile-sections">
        <div className="min-w-0">
          <FavoritesCard childId={childId} age={age} profile={profile} />
        </div>
        <div className="min-w-0">
          <KindergartenSkillsCard childId={childId} age={age} profile={profile} />
        </div>
        <div className="min-w-0">
          <FamilyLearningCard childId={childId} age={age} profile={profile} />
        </div>
        <div className="min-w-0">
          <CharacterCard childId={childId} age={age} profile={profile} />
        </div>
        <div className="col-span-2 min-w-0">
          <FamilyCard childId={childId} age={age} profile={profile} />
        </div>
      </div>
    </div>
  );
}
