"use client";

import { AdminAssessmentOverview } from "@/components/admin/admin-assessment-overview";
import { RequireRole } from "@/components/shell/require-role";

export default function AdminAssessmentPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <div className="page-band py-2">
        <AdminAssessmentOverview />
      </div>
    </RequireRole>
  );
}
