"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { z } from "zod";
import { AlertTriangle, CloudOff, Utensils } from "lucide-react";
import { menuDayWithWarningsSchema, ALLERGY_SEVERITY_LABEL } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth/session";
import { Card, SectionHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/states";
import { MediaThumb } from "@/components/media/media-image";

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
  /*
    With dishes to show, the cards sit straight on the page — the drawing has
    no panel around them. Loading, error and empty keep the panel, which is
    what gives their one line of text a shape.
  */
  const hasDishes = !isLoading && !isError && Boolean(day && day.dishes.length > 0);

  const body = renderBody();

  return (
    <section aria-labelledby="today-menu-heading" className="flex h-full flex-col">
      <SectionHeader id="today-menu-heading" title="Хоолны цэс" />

      {hasDishes ? (
        <div className="flex flex-1 flex-col gap-3">{body}</div>
      ) : (
        <Card pad="roomy" className="flex flex-1 flex-col gap-3">
          {body}
        </Card>
      )}
    </section>
  );

  function renderBody() {
    return (
      <>
        {isLoading ? (
          /* Mirrors the dish grid, so the card does not resize when it lands. */
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="aspect-square w-full" />
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
            {/*
              ★ Picture cards — the client's 2026-09-25 drawing: the dish's
              photograph filling the top of a white card, its name centred
              underneath. Three across at every width — the client, the same
              day: "хэт том харагдаад байна утсан дээр 3х2", so six dishes are
              two rows of small cards rather than three rows of big ones. A dish with no photograph
              shows the menu's own fork-and-knife placeholder rather than a
              stock picture of some other food.

              A dish somebody reacts to keeps its danger border and its
              "Харшил" word on the picture — colour is never the carrier — and
              the warning list below still names who.
            */}
            <ul className="grid grid-cols-3 gap-2 sm:gap-3">
              {day.dishes.map((dish, i) => {
                const risky = day.warnings.some((w) => w.dishName === dish.name);

                return (
                  <li
                    key={`${dish.name}-${i}`}
                    className={cn(
                      "flex flex-col gap-1.5 rounded-card border bg-surface p-1.5 shadow-sm sm:gap-2 sm:p-2.5",
                      risky ? "border-danger/50" : "border-border-soft",
                    )}
                  >
                    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-control">
                      {dish.photoMediaFileId ? (
                        <MediaThumb
                          mediaId={dish.photoMediaFileId}
                          caption={dish.name}
                          flush
                          className="aspect-auto size-full"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="grid size-full place-items-center text-border"
                        >
                          <span className="grid aspect-square h-[75%] place-items-center rounded-pill border-[3px] border-current sm:border-[5px]">
                            <Utensils className="size-1/2" strokeWidth={2.5} />
                          </span>
                        </span>
                      )}
                      {risky ? (
                        <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-pill bg-danger px-1.5 text-caption font-medium leading-5 text-white">
                          <AlertTriangle size={10} aria-hidden="true" />
                          Харшил
                        </span>
                      ) : null}
                    </div>
                    <p className="line-clamp-2 text-center text-caption leading-snug text-ink sm:text-body">
                      {dish.name}
                    </p>
                  </li>
                );
              })}
            </ul>

            {day.warnings.length > 0 ? <AllergyWarnings warnings={day.warnings} /> : null}
          </>
        )}
      </>
    );
  }
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
