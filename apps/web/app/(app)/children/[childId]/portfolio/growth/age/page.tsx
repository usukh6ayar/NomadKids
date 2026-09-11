"use client";

import { useParams } from "next/navigation";
import { AgeStepper } from "@/components/child/age-stepper";
import { BackButton } from "@/components/ui/back-button";
import { GradientUnderline } from "@/components/child/portfolio-hero";

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
      {/*
        ★ A bare Буцах, not the destination's name — 2026-09-11, at the client's
        instruction: "хүүхдийн нэрийг арилгаад зүгээр л буцах гэсэн тэмдэг
        болго … бүх газар … зөвхөн нэг удаа буцах тэмдэг."

        `BackButton` is one step back through history with `href` as the
        fallback, which is also the honest control: this link named a screen the
        reader may never have come from.
      */}
      <BackButton href={`/children/${childId}/portfolio`} />

      <div>
        <h1 className="text-heading font-semibold text-ink">Насны мэдээлэл</h1>
        <GradientUnderline className="mt-1.5" />
      </div>

      <AgeStepper childId={childId} />
    </div>
  );
}
