"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { z } from "zod";
import { AlertTriangle, CloudOff, UtensilsCrossed } from "lucide-react";
import { menuDayWithWarningsSchema, ALLERGY_SEVERITY_LABEL } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth/session";
import { Card, SectionHeader } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
import { Skeleton } from "@/components/ui/states";
import { Art } from "@/components/ui/art";

const menuSchema = z.array(menuDayWithWarningsSchema);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Today's dishes, and who must not eat them — the sketch's "Хоолны цэс".
 *
 * ★ This is the staff route, `GET /kindergartens/:id/menu/with-warnings`, and
 * the difference from the plain menu is the whole reason the card exists. RFP
 * Module 2 asks for the cross-check between the day's dishes and the roster's
 * active allergies; the API has computed it since 2026-08-25 and, until now,
 * nothing in the product called it. The menu was reachable only from inside a
 * child's page, without warnings.
 *
 * ★★ The warnings name other children and their medical conditions.
 *
 * That is why the endpoint is `@Roles("TEACHER", "ADMIN")` and why this
 * component is on the teacher dashboard and nowhere else. It must never be
 * rendered on a parent surface — a guardian reading the menu learns what is
 * for lunch, never which child reacts to it. `apps/web/app/(app)/home/page.tsx`
 * is the parent equivalent and deliberately does not import this.
 *
 * ★★★ One day, not the week. `child-menu.tsx` already renders the week inside
 * a child's page; a dashboard answers "today", and a seven-day grid in a
 * quarter-width tile is a table nobody can read at a glance.
 */
export function TodayMenu() {
  const { primaryKindergartenId } = useSession();
  const date = todayIso();

  const { data, isLoading, isError } = useQuery({
    queryKey: qk.menuWithWarnings(primaryKindergartenId ?? "", date, date),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/menu/with-warnings?from=${date}&to=${date}`,
        menuSchema,
      ),
    enabled: Boolean(primaryKindergartenId),
  });

  const day = data?.[0] ?? null;

  return (
    <section aria-labelledby="today-menu-heading" className="flex h-full flex-col">
      {/*
        ★ The section carries the drawing, not each dish.

        The shared food artwork also appears on the parent's menu tile, so it identifies
        the feature on both sides of the product. Repeating it on every dish
        card was the first attempt and it was wrong twice over: three copies of
        one picture says nothing about three different dishes, and §13's own
        rule is not to force an asset that does not fit. Dishes take a glyph;
        the section takes the drawing.
      */}
      <SectionHeader
        id="today-menu-heading"
        title="Хоолны цэс"
        lede="Өнөөдрийн хоол, харшлын шалгалттай"
        icon={<IconChip icon={<Art name="food" />} tone="sun" size="lg" surface={false} />}
      />

      <Card pad="roomy" className="flex flex-1 flex-col gap-3">
        {isLoading ? (
          /* Mirrors the dish grid, so the card does not resize when it lands. */
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-[132px] w-full" />
            <Skeleton className="h-[132px] w-full" />
            <Skeleton className="h-[132px] w-full" />
          </div>
        ) : isError ? (
          /*
            Quiet, like the attendance tile: one failed section on a dashboard
            of eight is a gap, not an outage. The menu is also on each child's
            page, so this is not the only way to it — and the error says so
            rather than leaving a dead end.
          */
          <div className="flex items-center gap-3 rounded-row border border-border bg-canvas p-3">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-control bg-track text-faint"
            >
              <CloudOff size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-body font-medium text-ink">Цэс ачаалж чадсангүй</p>
              <p className="text-caption text-muted">
                Хүүхдийн хуудасны “Хоол ба цэс” хэсгээс харна уу.
              </p>
            </div>
          </div>
        ) : !day || day.dishes.length === 0 ? (
          /*
            Empty says what would appear and who puts it there. "Цэс алга" on
            its own leaves a teacher unsure whether the kitchen has not filed
            it or the screen is broken.
          */
          /*
            ★ Horizontal, unlike the product's usual centred empty state.

            This section is full width. A 96px mascot centred over two centred
            lines of text turned the most prominent card on the dashboard into
            a 280px void — measured at 1440px, taller than the entire tile row
            above it. Centring is right for a narrow card and wrong for a wide
            one, where the same content simply leaves the middle empty.

            The mascot stays — `child-menu.tsx` uses this same drawing for this
            same condition, and `alt=""` because it repeats the text beside it.
          */
          <div className="flex flex-col items-center gap-3 py-1 text-center sm:flex-row sm:gap-4 sm:text-left">
            <Image
              src="/background/mascot-boy-orange.webp"
              alt=""
              width={72}
              height={72}
              className="shrink-0"
            />
            <div className="min-w-0">
              <p className="text-lead font-semibold text-ink">Өнөөдрийн цэс оруулаагүй</p>
              <p className="mt-0.5 text-body text-muted">
                Хүүхдийн хуудасны “Хоол ба цэс” хэсгээс долоо хоногийн цэсийг бөглөнө.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/*
              The sketch draws three dish cards in a row. The count is whatever
              the kitchen filed — `auto-fit` lets three sit side by side and two
              or four look deliberate rather than stretched or clipped.
            */}
            <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {day.dishes.map((dish, i) => {
                const dishWarnings = day.warnings.filter((w) => w.dishName === dish.name);
                const risky = dishWarnings.length > 0;

                return (
                  <li
                    key={`${dish.name}-${i}`}
                    /*
                      ★ A dish that somebody reacts to is bordered, not just
                      badged. The tag pill alone put the only signal at the
                      bottom of the card, where a teacher scanning three dishes
                      reads it last — after they have already decided the card
                      is fine.

                      ★★ A safe dish is a white card on the canvas now, not a
                      canvas card on white. The section is the most prominent
                      thing on the screen and its dishes were the flattest —
                      three grey rectangles inside a white panel. Lifting them
                      onto `bg-surface` with the product's own hairline makes
                      them read as objects on a tray, and it puts the risky
                      one's `danger-soft` wash a full step away rather than a
                      shade away.
                    */
                    className={cn(
                      "flex flex-col gap-2.5 rounded-row border p-3.5 transition-colors md:p-4",
                      risky
                        ? "border-danger/40 bg-danger-soft"
                        : "border-border bg-surface shadow-sm",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      {/*
                        A glyph, not a picture of food. There is no per-dish
                        illustration in the product and inventing one would mean
                        showing a bowl of rice next to "Талх" — the "do not
                        invent images" line, met exactly.

                        `sun` for a dish that is fine — `tone.ts`'s warm accent,
                        which is what a meal should feel like — and the danger
                        pair for one that is not. Colour is never alone: the
                        warning badge beside it says the word.
                      */}
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid size-10 shrink-0 place-items-center rounded-control",
                          risky ? "bg-danger/10 text-danger" : "bg-sun text-sun-ink",
                        )}
                      >
                        <UtensilsCrossed size={20} />
                      </span>

                      {risky ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-danger px-2 py-0.5 text-caption font-medium text-white">
                          <AlertTriangle size={12} aria-hidden="true" />
                          Харшил
                        </span>
                      ) : null}
                    </div>

                    <p className="text-lead font-semibold leading-heading text-ink">{dish.name}</p>

                    {dish.allergenTags.length > 0 ? (
                      <p className="mt-auto flex flex-wrap gap-1">
                        {dish.allergenTags.map((tag) => (
                          <span
                            key={tag}
                            className={
                              risky
                                ? // White, not another wash: a `danger-soft` pill on a
                                  // `danger-soft` card is the same colour twice and the
                                  // allergen stops being legible as a separate thing.
                                  "rounded-pill border border-danger/30 bg-surface px-2 py-0.5 text-caption font-medium text-danger"
                                : "rounded-pill bg-track px-2 py-0.5 text-caption text-muted"
                            }
                          >
                            {tag}
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {day.warnings.length > 0 ? <AllergyWarnings warnings={day.warnings} /> : null}
          </>
        )}
      </Card>
    </section>
  );
}

/**
 * Who reacts to what is on today's menu.
 *
 * ★ `role="alert"` is deliberately NOT used. The list is present on every load
 * for as long as the menu contains a trigger, so announcing it as an alert
 * would interrupt a screen-reader user on every visit to the dashboard. It is
 * a labelled region instead — findable, not shouted.
 *
 * ★★ Severity leads each row, and the API sorts severe first. Colour is never
 * the only carrier: the word "Ноцтой" is there too, per the palette's own rule.
 */
function AllergyWarnings({
  warnings,
}: {
  warnings: z.infer<typeof menuDayWithWarningsSchema>["warnings"];
}) {
  return (
    <div className="rounded-row border border-danger/30 bg-danger-soft px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-body font-semibold text-danger">
        <AlertTriangle size={16} aria-hidden="true" />
        Харшлын анхааруулга ({warnings.length})
      </p>

      <ul className="mt-2 flex flex-col gap-1.5">
        {warnings.map((w, i) => (
          <li key={`${w.childId}-${w.dishName}-${i}`} className="text-caption text-ink">
            <span className="font-semibold">{w.childName}</span>
            {" — "}
            {w.dishName}
            <span className="text-muted">
              {" ("}
              {w.allergen}
              {", "}
              {ALLERGY_SEVERITY_LABEL[w.severity] ?? w.severity}
              {")"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
