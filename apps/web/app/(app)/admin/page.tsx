"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { adminDashboardSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import {
  AssessmentCoverageSection,
  RecentActivitySection,
  StatGrid,
} from "@/components/admin/dashboard-sections";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";

/**
 * Administration.
 *
 * ★ Only what the API actually implements is linked from here.
 *
 * The brief is explicit about no dead navigation, and the temptation on an
 * admin screen is to lay out the whole eventual product — user management,
 * kindergarten settings, domain and level configuration — and wire the links
 * later. Every link here goes somewhere that exists today. The configuration
 * tables (domains, levels, observation types) have read endpoints but no admin
 * UI, so they are not linked at all rather than linked and empty.
 */
export default function AdminPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminDashboard />
    </RequireRole>
  );
}

function AdminDashboard() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard.admin(),
    queryFn: () => get("/dashboard/admin", adminDashboardSchema),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 py-2">
        <h1 className="text-heading font-semibold text-ink">Удирдлага</h1>
        <LoadingState rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-2">
        <h1 className="mb-4 text-heading font-semibold text-ink">Удирдлага</h1>
        <ErrorState
          description={errorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      </div>
    );
  }

  const { counts, assessmentCoverage, recentActivity, currentTerm } = data!;

  return (
    <div className="flex flex-col gap-6 py-2">
      <header>
        <h1 className="text-heading font-semibold text-ink">Удирдлага</h1>
        <p className="mt-0.5 text-body text-muted">
          {currentTerm ? `${currentTerm.name} · идэвхтэй улирал` : "Идэвхтэй улирал тохируулаагүй"}
        </p>
      </header>

      <StatGrid counts={counts} />
      {/*
        The admin's actual work lives on these screens; this page is the read-only
        summary. Ordered by the dependency chain — a group needs a school year,
        a child needs a group — so a new kindergarten can be set up top to bottom.
      */}
      <section aria-label="Удирдлагын хэсгүүд">
        <SectionHeader
          title="Удирдлага"
          lede="Цэцэрлэг, хичээлийн жил, бүлэг, хэрэглэгчийн бүртгэл."
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <AdminLink href="/admin/school-years" title="Хичээлийн жил" note="Эхлээд үүсгэнэ" />
          <AdminLink href="/admin/groups" title="Бүлгүүд" note="Багш хуваарилах" />
          <AdminLink href="/admin/users" title="Хэрэглэгчид" note="Багш, админ урих" />
          <AdminLink href="/admin/terms" title="Улирал" note="Үнэлгээний хугацаа" />
          <AdminLink
            href="/admin/kindergarten"
            title="Цэцэрлэгийн мэдээлэл"
            note="Нэр, хаяг, холбоо барих"
          />
        </div>
      </section>

      <AssessmentCoverageSection
        coverage={assessmentCoverage}
        hasCurrentTerm={Boolean(currentTerm)}
        href={(groupId) => `/groups/${groupId}/assessment`}
      />

      <RecentActivitySection entries={recentActivity} />
    </div>
  );
}

/** One destination in the admin hub. */
function AdminLink({ href, title, note }: { href: string; title: string; note: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-[64px] flex-col justify-center rounded-row border border-border bg-surface px-4 py-3 transition-colors hover:border-primary"
    >
      <span className="text-lead font-semibold text-ink">{title}</span>
      <span className="mt-px text-compact text-muted">{note}</span>
    </Link>
  );
}
