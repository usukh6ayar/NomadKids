"use client";

import { GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { GroupPicker } from "@/components/shell/group-picker";

/**
 * Termly assessment, by group.
 *
 * ★ It was reachable and unlisted, which is worse than either.
 *
 * `layout.tsx` records that assessment and reports "were marked `soon` while
 * both are fully built", and that advertising a working feature as missing is
 * worse than not listing it — so they were reached from a dashboard card
 * instead. This is the page that lets the sidebar name it honestly.
 */
export default function AssessmentPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <div className="flex flex-col gap-6 lg:gap-8">
        <PageHeader title="Үнэлгээ" lede="Улирлын үнэлгээ бүлгээр хийгдэнэ. Бүлэг сонгоно уу." />

        <GroupPicker
          icon={<GraduationCap size={20} aria-hidden />}
          href={(groupId) => `/groups/${groupId}/assessment`}
          emptyDescription="Үнэлгээ хийхийн өмнө бүлэг үүсгэх шаардлагатай."
        />
      </div>
    </RequireRole>
  );
}
