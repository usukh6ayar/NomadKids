"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarPlus, GraduationCap } from "lucide-react";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { TodayAttendanceRecorder } from "@/components/child/child-attendance";
import { ChildGallery } from "@/components/media/child-gallery";
import { useSession } from "@/lib/auth/session";
import { fullName } from "@/lib/format";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { cn } from "@/lib/utils";

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

/**
 * The child overview's actual content — the mock-up's own birth-to-now
 * timeline, without an opinion on how it got on screen.
 *
 * ★ Split out of `overview/page.tsx` originally so the identical body could
 * also render inline as the deleted child hub's own "Зургийн цомог" tab
 * panel. That hub is gone, but the split still earns its keep: this is now
 * also where the portfolio hub's own "Зургийн цомог" tile
 * (`portfolio/page.tsx`'s `PortfolioHubNav`) sends a reader, on the client's
 * instruction — the same destination the bottom bar's "Зураг" tab already
 * used, rather than a second screen that happens to show the same child.
 *
 * ★★ The album lives here now, not on the portfolio.
 *
 * `ChildGallery` used to render inline on the single-scroll portfolio page.
 * Once that page shrank to the hero and its three doors (2026-08-29), the
 * gallery needed a real home rather than disappearing — and this is the one
 * screen the product already calls "Зураг", by icon and by nav label
 * (`layout.tsx`'s `parentNav`). Putting the actual photographs behind that
 * name is what the name was always supposed to mean; before this, "Зураг"
 * opened an age timeline with no picture in it.
 *
 *
 * ★★★★ `showHero` stays a prop, kept from when this body had two homes at
 * once — cheap to keep, and it is what stops a caller that embeds this
 * elsewhere from getting a duplicate `ChildHeroProfile` for free.
 *
 * ★★★★★ The age tiles filter the album now instead of linking away —
 * 2026-09-05, on the client's instruction. They used to be four links into
 * `growth#age-N`, which meant tapping "3 нас" on the photo page left it for
 * an unrelated record screen; a reader who came here to look at pictures
 * wants that age's *pictures*, and `Media.age` (RFP §4.4) already carries
 * exactly that fact once a photo is tagged with it. `hasAgeContent`, the old
 * tiles' "Тэмдэглэлтэй/Хоосон" badge, went with them — it read
 * `ChildAgeProfile`, which has nothing to do with which photos exist.
 *
 * "Цэцэрлэгийн анхны өдөр" and "Төгсөлт" became galleries of their own the
 * same day, alongside the two new `MEDIA_CATEGORIES` values that back them.
 *
 * ★★★★★★ The two became one toggle, not two fixed sections, the same week —
 * on the client's instruction, dropping each gallery's own descriptive lede
 * ("Цэцэрлэгт анх ирсэн өдрийн дурсамж." and its graduation counterpart) for
 * a pair of buttons that name themselves, the same "Насаар шүүх" idiom the
 * age tiles already use. `selectedDay` is `null` by default rather than
 * defaulting to whichever fact exists — nothing about "look at photos" should
 * assume which of the two a visitor came here for.
 *
 * ★★★★★★★ Both buttons always render, the same day again — the client's own
 * correction: gating "Төгссөн өдөр" on `graduatedOn` being already true meant
 * nobody could ever tag or preview a graduation photo before the admin action
 * that flips `EnrollmentStatus` to `GRADUATED` actually happens, which is
 * backwards for a photo somebody wants to add on the day itself. The age
 * tiles above already set this precedent — all four render for a two-year-old
 * despite three of those years being years away — and the two here now match
 * it rather than being the one exception.
 */
export function ChildOverviewContent({
  childId,
  showHero = true,
}: {
  childId: string;
  showHero?: boolean;
}) {
  const { session, hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");
  const [selectedAge, setSelectedAge] = useState<(typeof PORTFOLIO_AGES)[number] | null>(null);
  const [selectedDay, setSelectedDay] = useState<"FIRST_DAY" | "GRADUATION" | null>(null);

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
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
  const isGuardian = data.guardianships.some(
    (g) => g.guardian?.id === session?.user.id && g.canView !== false,
  );

  return (
    <div className="flex flex-col gap-6">
      {showHero ? <ChildHeroProfile child={data} /> : null}

      <section aria-labelledby="ages-heading">
        <SectionHeader
          id="ages-heading"
          title="Насаар шүүх"
          lede="Аль насных болохыг сонгож, тухайн насны зургуудыг харна уу."
        />
        <div className="grid grid-cols-2 gap-3">
          {PORTFOLIO_AGES.map((age) => {
            const active = selectedAge === age;
            return (
              <button
                key={age}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedAge((was) => (was === age ? null : age))}
                className={cn(
                  "flex flex-col justify-between overflow-hidden rounded-card border shadow-sm transition-transform hover:-translate-y-0.5",
                  active ? "border-primary ring-2 ring-primary" : "border-border",
                )}
              >
                <span
                  className={`flex flex-1 items-center justify-center py-6 text-display font-bold ${AGE_TONE[age]}`}
                >
                  {age}
                </span>
                <span className="flex items-center justify-center bg-surface px-3 py-2 text-caption font-medium text-ink">
                  {age} нас
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {selectedAge ? (
        <ChildGallery
          childId={childId}
          childName={fullName(data)}
          canEdit={isStaff || isGuardian}
          sectionId="age-gallery"
          title={`${selectedAge} насны зургууд`}
          lede={`${selectedAge} нас дээр тавьсан зургууд.`}
          age={selectedAge}
          emptyTitle="Энэ насны зураг алга"
          emptyDescription={
            isStaff || isGuardian
              ? `${selectedAge} насных гэж тэмдэглэсэн зураг одоогоор алга.`
              : "Багш зураг нэмэхэд энд харагдана."
          }
          uploadLabel={`${selectedAge} насны зураг нэмэх`}
        />
      ) : null}

      {isStaff ? (
        <TodayAttendanceRecorder childId={childId} childName={data.firstName} />
      ) : null}

      <section aria-labelledby="special-days-heading">
        <SectionHeader id="special-days-heading" title="Онцгой өдрүүд" />
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            aria-pressed={selectedDay === "FIRST_DAY"}
            onClick={() => setSelectedDay((was) => (was === "FIRST_DAY" ? null : "FIRST_DAY"))}
            className={cn(
              "flex items-center justify-center gap-2 rounded-card border px-3 py-4 text-center text-body font-medium shadow-sm transition-transform hover:-translate-y-0.5",
              selectedDay === "FIRST_DAY"
                ? "border-primary bg-primary-soft text-primary-strong ring-2 ring-primary"
                : "border-border bg-surface text-ink",
            )}
          >
            <CalendarPlus size={18} aria-hidden="true" className="shrink-0" />
            Эхний өдөр
          </button>

          <button
            type="button"
            aria-pressed={selectedDay === "GRADUATION"}
            onClick={() => setSelectedDay((was) => (was === "GRADUATION" ? null : "GRADUATION"))}
            className={cn(
              "flex items-center justify-center gap-2 rounded-card border px-3 py-4 text-center text-body font-medium shadow-sm transition-transform hover:-translate-y-0.5",
              selectedDay === "GRADUATION"
                ? "border-primary bg-primary-soft text-primary-strong ring-2 ring-primary"
                : "border-border bg-surface text-ink",
            )}
          >
            <GraduationCap size={18} aria-hidden="true" className="shrink-0" />
            Төгссөн өдөр
          </button>
        </div>
      </section>

      {selectedDay ? (
        <ChildGallery
          childId={childId}
          childName={fullName(data)}
          canEdit={isStaff || isGuardian}
          sectionId="special-day-gallery"
          title={selectedDay === "FIRST_DAY" ? "Эхний өдөр" : "Төгссөн өдөр"}
          lede=""
          category={selectedDay}
          emptyTitle="Зураг алга"
          emptyDescription={
            isStaff || isGuardian ? "Зургаа нэмээрэй." : "Багш зураг нэмэхэд энд харагдана."
          }
        />
      ) : null}
    </div>
  );
}
