"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChildOverviewContent } from "@/components/child/child-overview-content";

/**
 * The child overview — the standalone route.
 *
 * ★ Just a frame around `ChildOverviewContent` — the back button, which only
 * makes sense when this is the whole screen. The child hub's own "Зургийн
 * цомог" tab (`children/[childId]/page.tsx`) renders the same content inline,
 * as a tab panel rather than a route.
 */
export default function ChildOverviewPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;

  return (
    <div className="flex flex-col gap-6 py-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/children/${childId}`}>
          <ArrowLeft size={18} />
          Хүүхдийн бүртгэл
        </Link>
      </Button>

      <ChildOverviewContent childId={childId} />
    </div>
  );
}
