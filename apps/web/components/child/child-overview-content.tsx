"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CalendarPlus, GraduationCap } from "lucide-react";
import { z } from "zod";
import { ageProfileSchema, childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { TodayAttendanceRecorder } from "@/components/child/child-attendance";
import { useSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";

const ageProfilesSchema = z.array(ageProfileSchema);

const PORTFOLIO_AGES = [2, 3, 4, 5] as const;

/**
 * A card's colour, fixed per age rather than cycled — the product's own four
 * tones (`Badge`'s `mint`/`sky`/`sun`/`peach`), not a fifth invented for this
 * grid. `portfolio/page.tsx`'s age row uses `mint` for "filled" alone; here
 * all four ages render at once, so each gets its own of the same four.
 */
const AGE_TONE: Record<(typeof PORTFOLIO_AGES)[number], string> = {
  2: "bg-mint text-mint-ink",
  3: "bg-sky text-sky-ink",
  4: "bg-sun text-sun-ink",
  5: "bg-peach text-peach-ink",
};

function hasAgeContent(profile?: z.infer<typeof ageProfileSchema>): boolean {
  if (!profile) return false;
  return Object.entries(profile).some(
    ([key, value]) => key !== "age" && typeof value === "string" && value.trim().length > 0,
  );
}

/**
 * The child overview's actual content — the mock-up's own birth-to-now
 * timeline, without an opinion on how it got on screen.
 *
 * ★ Split out of `overview/page.tsx` so the identical body can also render
 * inline as the child hub's own "Зургийн цомог" tab panel
 * (`children/[childId]/page.tsx`) rather than navigating there, while the
 * bottom bar's own "Зураг" tab still lands on the standalone page. One body,
 * two frames around it, rather than the frame and the content drifting apart
 * the next time either changes.
 *
 * ★★ Two facts, and only one is always real. "Цэцэрлэгийн анхны өдөр" is
 * `min(enrollments[].startedOn)` — data the child-detail payload already
 * carries, no backend change needed. "Цэцэрлэгээс төгссөн" only renders when
 * an enrollment is actually `GRADUATED` (`EnrollmentStatus`, added for this
 * screen specifically — see the migration `add_enrollment_status_graduated`
 * and `edit/page.tsx`'s `GraduateCard`, the admin action that sets it).
 * Before that ever happens for a child, this chip is simply absent rather
 * than showing a date that isn't true yet.
 *
 * ★★★ `showHero` exists only because this body now has two homes. Standalone
 * on `/overview` it is the screen's one identity anchor; inline as the child
 * hub's own tab it would be the *second* `ChildHeroProfile` on the same
 * screen, right below the page's own — same name, same photo, read twice.
 */
export function ChildOverviewContent({
  childId,
  showHero = true,
}: {
  childId: string;
  showHero?: boolean;
}) {
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  const ageProfiles = useQuery({
    queryKey: qk.ageProfiles(childId),
    queryFn: () => get(`/children/${childId}/age-profiles`, ageProfilesSchema),
    enabled: child.isSuccess,
  });

  if (child.isLoading) return <LoadingState rows={4} />;

  if (child.isError) {
    return (
      <div className="py-6">
        <ErrorState description={errorMessage(child.error)} />
      </div>
    );
  }

  const data = child.data!;
  const enrollments = data.enrollments ?? [];

  const firstDay = enrollments
    .map((e) => e.startedOn)
    .filter((d): d is string => Boolean(d))
    .sort()[0];

  const graduatedOn = enrollments.find((e) => e.status === "GRADUATED")?.endedOn;

  return (
    <div className="flex flex-col gap-6">
      {showHero ? <ChildHeroProfile child={data} /> : null}

      {/*
        ★ Info chips, not buttons — neither opens anything, they state a
        fact. Rounded like the mock-up's pills, but a `<span>` rather than a
        `<button>` or `<Link>` for exactly that reason: a control that does
        nothing when tapped is worse than a plain fact.
      */}
      {firstDay || graduatedOn ? (
        <div className="flex flex-wrap gap-2">
          {firstDay ? (
            <span className="flex items-center gap-2 rounded-pill border border-border bg-surface px-3.5 py-2 text-body text-ink">
              <CalendarPlus size={16} className="shrink-0 text-primary" aria-hidden="true" />
              Цэцэрлэгийн анхны өдөр:{" "}
              <strong className="font-semibold">{formatDate(firstDay)}</strong>
            </span>
          ) : null}
          {graduatedOn ? (
            <span className="flex items-center gap-2 rounded-pill border border-border bg-surface px-3.5 py-2 text-body text-ink">
              <GraduationCap size={16} className="shrink-0 text-primary" aria-hidden="true" />
              Цэцэрлэгээс төгссөн:{" "}
              <strong className="font-semibold">{formatDate(graduatedOn)}</strong>
            </span>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="ages-heading">
        <SectionHeader
          id="ages-heading"
          title="Хөгжлийн түүх"
          lede="Насны бүлэг тус бүрийн тэмдэглэл рүү очих."
        />
        <div className="grid grid-cols-2 gap-3">
          {PORTFOLIO_AGES.map((age) => {
            const filled = hasAgeContent(ageProfiles.data?.find((p) => p.age === age));
            return (
              <Link
                key={age}
                href={`/children/${childId}/portfolio#age-${age}`}
                className="flex flex-col justify-between overflow-hidden rounded-card border border-border shadow-sm transition-transform hover:-translate-y-0.5"
              >
                <span
                  className={`flex flex-1 items-center justify-center py-6 text-display font-bold ${AGE_TONE[age]}`}
                >
                  {age}
                </span>
                <span className="flex items-center justify-between bg-surface px-3 py-2 text-caption">
                  <span className="font-medium text-ink">{age} нас</span>
                  <span className={filled ? "text-mint-ink" : "text-faint"}>
                    {filled ? "Тэмдэглэлтэй" : "Хоосон"}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {isStaff ? (
        <TodayAttendanceRecorder childId={childId} childFirstName={data.firstName} />
      ) : null}
    </div>
  );
}
