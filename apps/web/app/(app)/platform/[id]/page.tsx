"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { platformKindergartenDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import {
  AssessmentCoverageSection,
  RecentActivitySection,
  StatGrid,
} from "@/components/admin/dashboard-sections";
import { ToggleActiveButton } from "@/components/admin/toggle-kindergarten-active";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { formatRelative } from "@/lib/format";

/**
 * The platform operator's view into one kindergarten — the "info from
 * kindergartens" drill-down `/platform`'s flat list never offered. Same
 * counts/coverage/activity shape a kindergarten's own admin dashboard shows
 * (`/admin`), because the API computes both from the same queries scoped to
 * this one tenant rather than to the caller's memberships.
 *
 * Read-only beyond the active/inactive toggle — the operator's job stops at
 * registering and suspending a kindergarten; everything else belongs to that
 * kindergarten's own admin. See `platform/page.tsx`'s doc comment.
 */
export default function PlatformKindergartenPage() {
  return (
    <RequireSuperAdmin>
      <KindergartenDetail />
    </RequireSuperAdmin>
  );
}

function KindergartenDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: qk.platformKindergarten(id),
    queryFn: () => get(`/platform/kindergartens/${id}`, platformKindergartenDetailSchema),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <LoadingState rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-6">
        <ErrorState
          title={isNotFound(error) ? "Олдсонгүй" : "Алдаа гарлаа"}
          description={isNotFound(error) ? "Энэ цэцэрлэг олдсонгүй." : errorMessage(error)}
          action={
            <Button asChild variant="secondary">
              <Link href="/platform">Цэцэрлэгүүд рүү буцах</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const kg = data!;

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <Link
        href="/platform"
        className="inline-flex w-fit items-center gap-1.5 text-compact font-medium text-muted hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden />
        Цэцэрлэгүүд рүү буцах
      </Link>

      <PageHeader
        title={kg.name}
        lede={
          [kg.address, kg.phone, kg.email].filter(Boolean).join(" · ") ||
          `Бүртгэсэн: ${formatRelative(kg.createdAt)}`
        }
        actions={
          <span className="flex items-center gap-2">
            <Badge tone={kg.isActive ? "mint" : "neutral"}>
              {kg.isActive ? "Идэвхтэй" : "Идэвхгүй"}
            </Badge>
            <ToggleActiveButton kindergarten={kg} />
          </span>
        }
      />

      {kg.description ? <p className="text-body text-muted">{kg.description}</p> : null}

      <StatGrid counts={kg.counts} />

      <AssessmentCoverageSection
        coverage={kg.assessmentCoverage}
        hasCurrentTerm={Boolean(kg.currentTerm)}
      />

      <RecentActivitySection entries={kg.recentActivity} />
    </div>
  );
}
