"use client";

import { useQuery } from "@tanstack/react-query";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import Link from "next/link";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Eye, Palette, Plus, Search, Sprout } from "lucide-react";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { ChildGrowthAges } from "@/components/child/child-growth-ages";
import { ChildMilestones } from "@/components/child/child-milestones";
import { ChildArtwork } from "@/components/child/child-artwork";
import { ParentGrowthLauncher } from "@/components/child/parent-growth-launcher";
import { PORTFOLIO } from "@/lib/vocabulary";
import { ageInYears } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The three doors on this page, in the client's own reference screenshot's
 * order and colours (green, then blue, then a third tone this product's own
 * four-tone palette supplies in place of the screenshot's purple — see
 * `PortfolioHubNav`'s tiles for the same substitution).
 *
 * "Насны онцлог" is first and open by default, not "Ажиглалт" as the
 * screenshot shows: it is the one pane with no destination anywhere else in
 * the product (RFP §4.3's own ages 2–5), where the other two are quick
 * actions into screens that already exist. Content nobody else links to
 * should not need a tap to reach.
 */
const TABS = [
  { value: "ages", label: "Насны онцлог", Icon: Sprout, tone: "mint" as const },
  { value: "observations", label: "Ажиглалт", Icon: Search, tone: "sky" as const },
  { value: "artwork", label: "Бүтээл", Icon: Palette, tone: "peach" as const },
];

const TONE_CLASS: Record<string, string> = {
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  peach: "bg-peach text-peach-ink",
};

/**
 * "Хөгжил" — the portfolio hub's second door.
 *
 * ★ "Ажиглалт" is a launcher here, not a second copy of the list.
 *
 * `ChildObservations` already has one destination, `/observations` — linked
 * from the sidebar and from the child record's own primary button
 * (`general/page.tsx`'s `ChildActions`). Rendering it again inside a tab here
 * would be exactly the "route and tab both show the same thing" duplication
 * `general/page.tsx`'s own doc comment already fixed once for Ажиглалт and
 * Зураг. This tab is the screenshot's "+ Шинэ ажиглал" button and a link to
 * the list, not the list itself.
 *
 * ★★ "Бүтээл" is the opposite call, deliberately. `ChildArtwork` used to live
 * behind `general/page.tsx`'s "Бусад" overflow with no direct link pointing
 * at it. Now that this tile does point at it, it moved here rather than
 * staying in two places — the same "no outside link → stays behind Бусад,
 * otherwise it gets a real destination" rule that page's own doc comment
 * states.
 *
 * ★★★ Staff only, since 2026-08-30. A second client reference screenshot
 * replaced a *parent's* view of this page outright — `ParentGrowthLauncher`,
 * below — with a hero and three quick-share doors, dropping "Насны онцлог"
 * for that audience. Staff still see everything on this page exactly as
 * before: RFP §4.3's age-2–5 profile fields (`ChildGrowthAges`) are a
 * professional editing surface a family does not use the same way a teacher
 * does, and nothing here asked for that to change. `ChildMilestones` moved
 * into `ParentGrowthLauncher` itself rather than disappearing for parents —
 * it has no other route pointing at it, unlike Ажиглалт and Бүтээл.
 */
export default function GrowthPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { session, hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  const requested = searchParams.get("tab");
  const active = TABS.some((t) => t.value === requested) ? requested! : TABS[0]!.value;

  function onTabChange(next: string) {
    const query = new URLSearchParams(searchParams.toString());
    if (next === TABS[0]!.value) query.delete("tab");
    else query.set("tab", next);
    const qs = query.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

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
  const isGuardian = data.guardianships.some(
    (g) => g.guardian?.id === session?.user.id && g.canView !== false,
  );
  const currentAge = ageInYears(data.dateOfBirth);

  /*
   * ★ `isStaff` is read the instant `child` finishes loading, with no extra
   * wait for `useSession()` to settle. That is safe rather than reckless: in
   * the real app, `AppLayout` (`(app)/layout.tsx`) never renders any child of
   * the authenticated shell — this page included — until the session has
   * already resolved, so `hasRole` is correct on this component's very first
   * render every time it exists at all. Only a test that mounts this page
   * directly, bypassing `AppLayout`, can see `isStaff` settle a render after
   * `child` does; `portfolio.test.tsx` awaits the staff content it needs
   * rather than assuming it lands on the very first paint, for exactly that
   * reason.
   */
  if (!isStaff) {
    return (
      <div className="flex flex-col gap-6 py-2">
        <ParentGrowthLauncher child={data} />

        {/* The mockup's own back target — a parent's launch pad, not the hub. */}
        <Link
          href="/home"
          className="inline-flex min-h-11 w-fit items-center gap-1.5 text-body text-primary underline underline-offset-4"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Нүүр хуудас руу буцах
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/children/${childId}/portfolio`}>
          <ArrowLeft size={18} />
          {PORTFOLIO}
        </Link>
      </Button>

      <ChildHeroProfile child={data} showHealthAlert={isStaff} />

      <TabsPrimitive.Root value={active} onValueChange={onTabChange}>
        <TabsPrimitive.List aria-label="Хөгжлийн хэсгүүд" className="grid grid-cols-3 gap-2">
          {TABS.map(({ value, label, Icon, tone }) => (
            <TabsPrimitive.Trigger
              key={value}
              value={value}
              className="group flex flex-col items-center gap-2 rounded-control px-2 py-3 text-center transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-14 items-center justify-center rounded-card opacity-60 transition-opacity group-data-[state=active]:opacity-100",
                  TONE_CLASS[tone],
                )}
              >
                <Icon size={26} />
              </span>
              <span className="text-caption font-semibold leading-tight text-muted group-data-[state=active]:text-ink">
                {label}
              </span>
              <span
                aria-hidden="true"
                className="h-0.5 w-6 rounded-pill bg-transparent group-data-[state=active]:bg-primary"
              />
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>

        <TabsPrimitive.Content value="ages" className="pt-5 focus-visible:outline-none">
          <div className="flex flex-col gap-6">
            <ChildGrowthAges childId={childId} isGuardian={isGuardian} currentAge={currentAge} />
            <ChildMilestones childId={childId} isStaff={isStaff} />
          </div>
        </TabsPrimitive.Content>

        <TabsPrimitive.Content value="observations" className="pt-5 focus-visible:outline-none">
          <div className="flex flex-col gap-3">
            <Button asChild size="lg">
              <Link href={`/children/${childId}/observations/new`}>
                <Plus size={18} />
                {isStaff ? "Шинэ ажиглалт" : "Мөч хуваалцах"}
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href={`/children/${childId}/observations`}>
                <Eye size={18} />
                Бүх ажиглалтыг харах
              </Link>
            </Button>
          </div>
        </TabsPrimitive.Content>

        <TabsPrimitive.Content value="artwork" className="pt-5 focus-visible:outline-none">
          <ChildArtwork childId={childId} isStaff={isStaff} />
        </TabsPrimitive.Content>
      </TabsPrimitive.Root>
    </div>
  );
}
