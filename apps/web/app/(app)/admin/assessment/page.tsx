"use client";

import { Suspense } from "react";
import { AdminAssessmentOverview } from "@/components/admin/admin-assessment-overview";
import { RequireRole } from "@/components/shell/require-role";

export default function AdminAssessmentPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <div className="page-band py-2">
        {/* The view is read from `?view=`, which suspends during prerender. */}
        <Suspense fallback={null}>
          <AdminAssessmentOverview />
        </Suspense>
      </div>
    </RequireRole>
  );
}
