"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { platformRevenueSchema, platformStatsSchema } from "@kinder/contracts";
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
import {
  usePendingApplicationsCount,
  useSoloWorkspacesCount,
} from "@/components/platform/platform-counts";
import { PlatformStatsStrip } from "@/components/platform/platform-stats-strip";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { LoadingState } from "@/components/ui/states";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";

/**
 * «Самбар» — the operator's first screen (2026-10-13, the user: "илүү
 * ойлгомжтой"). What is waiting to be done comes first, as rows that link to
 * the work; then the platform's figures; then this month's income.
 *
 * ★ Only what the API can count is listed. Contracts about to run out need a
 * route the backend does not have yet (asked in #222), so there is no row for
 * them rather than a guessed one.
 */
export default function PlatformOverviewPage() {
  return (
    <RequireSuperAdmin>
      <Overview />
    </RequireSuperAdmin>
  );
}

/** `YYYY-MM` for this month, in local time. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function amount(value: string): string {
  return `${Math.round(Number(value)).toLocaleString("en-US")}₮`;
}

function Overview() {
  const month = thisMonth();
  const applications = usePendingApplicationsCount();
  const solo = useSoloWorkspacesCount();

  const stats = useQuery({
    queryKey: qk.platformStats(),
    queryFn: () => get("/platform/stats", platformStatsSchema),
  });
  const revenue = useQuery({
    queryKey: qk.platformRevenueMonth(month),
    queryFn: () => get(`/platform/revenue?month=${month}`, platformRevenueSchema),
  });

  const todo = [
    {
      count: applications,
      text: "байгууллагын хүсэлт хүлээгдэж байна",
      href: "/platform/applications",
    },
    {
      count: solo,
      text: "бие даасан багшийн орчин цэцэрлэгт нэгтгэгдээгүй",
      href: "/platform/solo-workspaces",
    },
  ].filter((row) => (row.count ?? 0) > 0);
  const counted = applications !== null && solo !== null;

  return (
    <div className="flex flex-col gap-5 pb-8">
      <PlatformPageHeading
        title="Самбар"
        lede="Өнөөдөр анхаарах ажил болон платформын товч мэдээлэл."
        backHref={null}
        mark={<LayoutGrid />}
      />

      <section aria-label="Анхаарах" className="flex flex-col gap-2">
        <h2 className="text-caption font-semibold uppercase tracking-[0.12em] text-muted">
          Анхаарах
        </h2>
        {!counted ? (
          <LoadingState rows={2} />
        ) : todo.length === 0 ? (
          <p className="rounded-card border border-border bg-white px-4 py-3 text-body text-muted">
            Хүлээгдэж буй ажил алга.
          </p>
        ) : (
          <ul className="divide-y divide-border-soft overflow-hidden rounded-card border border-border bg-white">
            {todo.map((row) => (
              <li key={row.href}>
                <Link
                  href={row.href}
                  className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-body text-ink hover:bg-canvas"
                >
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-danger" />
                  <span className="min-w-0 flex-1">
                    <strong className="tabular-nums">{row.count}</strong> {row.text}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {stats.data ? <PlatformStatsStrip stats={stats.data} /> : null}

      {revenue.data ? (
        <section
          aria-label="Энэ сарын орлого"
          className="flex flex-wrap items-baseline justify-between gap-2 rounded-card border border-border bg-white px-4 py-3"
        >
          <div>
            <p className="text-caption text-muted">Энэ сарын платформын орлого</p>
            <p className="text-title font-bold tabular-nums text-ink">
              {amount(revenue.data.platform.total)}
            </p>
          </div>
          <Link href="/platform/revenue" className="text-caption font-semibold text-primary">
            Дэлгэрэнгүй
          </Link>
        </section>
      ) : null}
    </div>
  );
}
