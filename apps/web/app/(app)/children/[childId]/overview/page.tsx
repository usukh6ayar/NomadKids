"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChildOverviewContent } from "@/components/child/child-overview-content";
import { PORTFOLIO } from "@/lib/vocabulary";

/**
 * The child overview — the standalone route.
 *
 * ★ Just a frame around `ChildOverviewContent` — the back button, which only
 * makes sense when this is the whole screen.
 *
 * ★★ Two entrances, one back button that has to answer for both — the bottom
 * nav bar's own "Зураг" tab (`layout.tsx`'s `parentNav`) links straight here,
 * and so does the portfolio hub's "Зургийн цомог" tile
 * (`portfolio/page.tsx`'s `PortfolioHubNav`), on the client's 2026-09-04
 * instruction to unify all four of that hub's tiles onto one consistent back
 * destination. The route has no way to tell those apart on its own, so the
 * hub's own link carries `?from=portfolio`; without it, this defaults to the
 * bottom nav's own expectation, "Хүүхдийн бүртгэл", unchanged.
 */
export default function ChildOverviewPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;
  const searchParams = useSearchParams();
  const fromPortfolio = searchParams.get("from") === "portfolio";

  return (
    <div className="flex flex-col gap-6 py-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        {fromPortfolio ? (
          <Link href={`/children/${childId}/portfolio`}>
            <ArrowLeft size={18} />
            {PORTFOLIO}
          </Link>
        ) : (
          <Link href={`/children/${childId}/general`}>
            <ArrowLeft size={18} />
            Хүүхдийн бүртгэл
          </Link>
        )}
      </Button>

      <ChildOverviewContent childId={childId} />
    </div>
  );
}
