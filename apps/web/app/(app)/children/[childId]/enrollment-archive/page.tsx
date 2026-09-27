"use client";

import { useParams } from "next/navigation";
import { PageHeader } from "@/components/shell/app-shell";
import { ChildEnrollmentArchive } from "@/components/child/enrollment-archive";

/**
 * The enrolment archive — the standalone route.
 *
 * ★ A frame around `ChildEnrollmentArchive`: the back button, which only makes
 * sense when this is the whole screen. The identity strip the component used
 * to draw above it went on 2026-09-24, at the client's request — this header
 * already says which screen this is, and the child is chosen on the home
 * page before a parent ever arrives here.
 *
 * The route stays because a parent reaches it directly from their home tile and
 * from `parentSections` in `(app)/layout.tsx` — those links point at a URL, not
 * at a tab, and a parent has no child-record screen to open a tab on.
 */
export default function EnrollmentArchivePage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;

  return (
    <div className="flex flex-col gap-6 py-2">
      <PageHeader backHref={`/children/${childId}/general`} title="Цэцэрлэгийн мэдээлэл" />

      <ChildEnrollmentArchive childId={childId} />
    </div>
  );
}
