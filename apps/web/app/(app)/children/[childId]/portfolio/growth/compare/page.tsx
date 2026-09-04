"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, BarChart3 } from "lucide-react";
import {
  ageProfileSchema,
  birthdaySectionSchema,
  childDetailSchema,
  growthChartSchema,
  type GrowthPoint,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { AgeStepper } from "@/components/child/age-stepper";
import { PortfolioHero } from "@/components/child/portfolio-hero";
import { AGE_FIELDS } from "@/components/child/child-growth-ages";
import { ChildBirthdayNotes } from "@/components/child/child-birthday";
import { GrowthChartFigure } from "@/components/child/growth-chart";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { PORTFOLIO } from "@/lib/vocabulary";
import { ageInYears } from "@/lib/format";
import { isPresent } from "@/lib/utils";

const ageProfilesSchema = z.array(ageProfileSchema);

/** RFP fields the favourites table doesn't already cover — see this page's own doc comment. */
const OTHER_FIELD_KEYS = ["personality", "emotionalTraits", "learningInterest", "newSkills", "familyMembers"] as const;

/**
 * "Хөгжлийн харьцуулалт" — client reference screenshot, 2026-08-30. Every
 * age's own record, side by side, read-only (editing happens on each age's
 * own page — `portfolio/growth/age/[age]/page.tsx`).
 *
 * ★ The favourites/character table has one more section than the screenshot
 * shows — the crop only reached "Гэр бүлийн гишүүд" before cutting off.
 * `OTHER_FIELD_KEYS` covers the RFP fields not already in the favourites
 * table (`AGE_FIELDS`'s `favorite*` entries), so a screen whose whole job is
 * "compare everything" doesn't quietly compare only some of it.
 *
 * ★★ The growth section reuses `GrowthChartFigure` wholesale rather than
 * drawing new charts — it already plots height and weight against age, and a
 * second hand-rolled chart for the same two quantities would be a second
 * implementation of a component this product already has.
 *
 * ★★★ `ChildBirthdayNotes` moved here from `about-me/page.tsx` on 2026-09-04,
 * on the client's instruction — a birthday note is written per age, the same
 * axis every other section on this page already compares by, and it stopped
 * having a home on "Миний тухай" once that page's own age-comparison door
 * moved out to the portfolio hub. `birthdays` is fetched the same way
 * `about-me/page.tsx` used to: not part of the blocking loading/error state
 * above, since `ChildBirthdayNotes` already renders its own loading rows.
 *
 * ★★★★ The back button points at the portfolio hub, not `growth/page.tsx` —
 * unified 2026-09-04, on the client's instruction, with the other three of
 * `PortfolioHubNav`'s tiles (`about-me/page.tsx`, `growth/page.tsx`,
 * `overview/page.tsx`), all of which had drifted to different back
 * destinations. `AgeStepper` still moves a visitor between this page and
 * `growth/age/[age]/page.tsx` without touching either's own back button.
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

  const growth = useQuery({
    queryKey: qk.growth(childId),
    queryFn: () => get(`/children/${childId}/growth`, growthChartSchema),
  });

  const birthdays = useQuery({
    queryKey: qk.birthdayNotes(childId),
    queryFn: () => get(`/children/${childId}/birthday-notes`, birthdaySectionSchema),
  });

  if (child.isLoading || ageProfiles.isLoading || growth.isLoading) {
    return <LoadingState rows={5} />;
  }

  const error = child.error ?? ageProfiles.error ?? growth.error;
  if (child.isError || ageProfiles.isError || growth.isError) {
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
  const profileFor = (age: number) => profiles.find((p) => p.age === age);
  const byAge = latestMeasurementPerAge(growth.data!.points);
  const currentAge = ageInYears(data.dateOfBirth);

  return (
    <div className="flex flex-col gap-6 py-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/children/${childId}/portfolio`}>
          <ArrowLeft size={18} />
          {PORTFOLIO}
        </Link>
      </Button>

      <PortfolioHero
        child={data}
        icon={<BarChart3 size={26} aria-hidden="true" />}
        overline="ХӨГЖЛИЙН ХАРЬЦУУЛАЛТ"
        title="Хөгжлийн харьцуулалт"
        subtitle={`${data.firstName}-ийн 2-5 насны өсөлт, хөгжлийн түүх.`}
      />

      <AgeStepper childId={childId} current="compare" />

      <section aria-labelledby="growth-compare-heading">
        <SectionHeader id="growth-compare-heading" title="Өндөр - Жингийн ахиц" />
        <AgeTable
          rows={[
            {
              label: "Өндөр",
              cells: PORTFOLIO_AGES.map((age) =>
                isPresent(byAge[age]?.heightCm) ? `${byAge[age]!.heightCm} см` : "—",
              ),
            },
            {
              label: "Жин",
              cells: PORTFOLIO_AGES.map((age) =>
                isPresent(byAge[age]?.weightKg) ? `${byAge[age]!.weightKg} кг` : "—",
              ),
            },
          ]}
        />

        <div className="mt-4">
          {growth.data!.points.length === 0 ? (
            <EmptyState
              title="Хэмжилт бүртгэгдээгүй байна"
              description="Бүх насны график энд харагдана."
            />
          ) : (
            <GrowthChartFigure chart={growth.data!} layout="grid" />
          )}
        </div>
      </section>

      <section aria-labelledby="favorites-compare-heading">
        <SectionHeader id="favorites-compare-heading" title="Дуртай зүйлс" />
        <AgeTable
          rows={AGE_FIELDS.filter((f) => f.key.startsWith("favorite")).map((field) => ({
            label: field.label,
            cells: PORTFOLIO_AGES.map((age) => String(profileFor(age)?.[field.key] ?? "—")),
          }))}
        />
      </section>

      <section aria-labelledby="character-compare-heading">
        <SectionHeader id="character-compare-heading" title="Хувь хүний онцлог" />
        <AgeTable
          rows={AGE_FIELDS.filter((f) => (OTHER_FIELD_KEYS as readonly string[]).includes(f.key)).map(
            (field) => ({
              label: field.label,
              cells: PORTFOLIO_AGES.map((age) => String(profileFor(age)?.[field.key] ?? "—")),
            }),
          )}
        />
      </section>

      <ChildBirthdayNotes
        childId={childId}
        section={birthdays.data ?? null}
        isLoading={birthdays.isLoading}
        currentAge={currentAge}
      />
    </div>
  );
}

/** The latest point per whole year of age — a re-measurement corrects that age, same rule `ChildGrowth`'s own `PUT :date` encodes for a single day. */
function latestMeasurementPerAge(points: GrowthPoint[]): Partial<Record<number, GrowthPoint>> {
  const byAge: Partial<Record<number, GrowthPoint>> = {};
  for (const point of points) {
    const age = Math.floor(point.ageYears);
    if (!PORTFOLIO_AGES.includes(age as (typeof PORTFOLIO_AGES)[number])) continue;
    const existing = byAge[age];
    if (!existing || point.measuredOn >= existing.measuredOn) byAge[age] = point;
  }
  return byAge;
}

/** A small, scrollable table — ages as columns, one row per quantity. */
function AgeTable({ rows }: { rows: { label: string; cells: string[] }[] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-105 border-collapse text-body">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th scope="col" className="px-4 py-2.5 font-medium">
              &nbsp;
            </th>
            {PORTFOLIO_AGES.map((age) => (
              <th key={age} scope="col" className="px-4 py-2.5 text-center font-medium">
                {age} нас
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-border/60 last:border-0">
              <th scope="row" className="px-4 py-2.5 text-left font-medium text-ink">
                {row.label}
              </th>
              {row.cells.map((cell, i) => (
                <td key={i} className="px-4 py-2.5 text-center tabular-nums text-ink">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
