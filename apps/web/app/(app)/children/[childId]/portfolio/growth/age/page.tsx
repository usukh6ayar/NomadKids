"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AgeStepper } from "@/components/child/age-stepper";
import { Button } from "@/components/ui/button";
import { GradientUnderline } from "@/components/child/portfolio-hero";
import { PORTFOLIO } from "@/lib/vocabulary";

/**
 * Navigation-only landing for the age folders.
 *
 * Keeping this route free of profile cards makes the hierarchy explicit:
 * choose a folder first, then view that age's five private sections. The
 * comparison content follows the same rule and lives only at `/compare`.
 */
export default function AgeFolderLandingPage() {
  const { childId } = useParams<{ childId: string }>();

  return (
    <div className="flex flex-col gap-6 py-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/children/${childId}/portfolio`}>
          <ArrowLeft size={18} />
          {PORTFOLIO}
        </Link>
      </Button>

      <div>
        <h1 className="text-heading font-semibold text-ink">Насны мэдээлэл</h1>
        <GradientUnderline className="mt-1.5" />
      </div>

      <AgeStepper childId={childId} />
    </div>
  );
}
