import Link from "next/link";
import type { AdminDashboard } from "@kinder/contracts";
import { AUDIT_ACTION_LABEL } from "@kinder/contracts";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatRelative } from "@/lib/format";

/**
 * The three read-only blocks a kindergarten's own admin dashboard and the
 * platform operator's per-kindergarten detail view both show: counts, this
 * term's assessment coverage, and recent activity. `AdminDashboard`'s shape
 * (`@kinder/contracts`) is what both endpoints return, so one set of
 * components renders either.
 */

export function StatGrid({ counts }: { counts: AdminDashboard["counts"] }) {
  return (
    <section aria-label="Товч мэдээлэл" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Хүүхэд" value={counts.children} />
      <Stat label="Бүлэг" value={counts.groups} />
      <Stat label="Багш, ажилтан" value={counts.staff} />
      <Stat label="Эцэг эх" value={counts.guardians} />
    </section>
  );
}

/** Exported so a differently-shaped grid (the platform-wide totals on
 * `/platform`) can reuse the same tile instead of a second copy of it. */
export function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card pad="compact">
      <p className="text-body text-muted">{label}</p>
      <p className="mt-1 text-display font-semibold tabular-nums text-ink">{value}</p>
    </Card>
  );
}

export function AssessmentCoverageSection({
  coverage,
  hasCurrentTerm,
  /** Kindergarten-admin links to its own group's assessment screen; the
   * platform operator has no route into another tenant's assessment work, so
   * this stays undefined there and the rows render as plain text. */
  href,
}: {
  coverage: AdminDashboard["assessmentCoverage"];
  hasCurrentTerm: boolean;
  href?: (groupId: string) => string;
}) {
  return (
    <section aria-labelledby="coverage-heading">
      <SectionHeader id="coverage-heading" title="Улирлын үнэлгээний явц" />

      {coverage.length === 0 ? (
        <EmptyState
          title="Мэдээлэл алга"
          description={
            hasCurrentTerm
              ? "Идэвхтэй бүлэг бүртгэгдээгүй байна."
              : "Улирал тохируулсны дараа үнэлгээний явц харагдана."
          }
        />
      ) : (
        <Card className="divide-y divide-border">
          {coverage.map((group) => {
            const complete = group.children > 0 && group.assessed >= group.children;
            const badge = (
              <span
                className={`shrink-0 rounded-pill px-2.5 py-1 text-caption font-medium ${
                  complete ? "bg-mint text-mint-ink" : "bg-sun text-sun-ink"
                }`}
              >
                {group.assessed} / {group.children} үнэлгээ
              </span>
            );

            if (!href) {
              return (
                <div
                  key={group.groupId}
                  className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="min-w-0 truncate font-medium text-ink">{group.name}</span>
                  {badge}
                </div>
              );
            }

            return (
              <Link
                key={group.groupId}
                href={href(group.groupId)}
                className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 hover:bg-canvas"
              >
                <span className="min-w-0 truncate font-medium text-ink">{group.name}</span>
                {badge}
              </Link>
            );
          })}
        </Card>
      )}
    </section>
  );
}

export function RecentActivitySection({ entries }: { entries: AdminDashboard["recentActivity"] }) {
  return (
    <section aria-labelledby="activity-heading">
      <SectionHeader id="activity-heading" title="Сүүлийн үйлдэл" />

      {entries.length === 0 ? (
        <EmptyState title="Үйлдэл бүртгэгдээгүй байна" />
      ) : (
        <Card className="divide-y divide-border">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-2.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-body text-ink">
                  {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}
                  {entry.objectType ? ` · ${entry.objectType}` : ""}
                </span>
                {entry.actorLabel ? (
                  <span className="block truncate text-caption text-muted">
                    {entry.actorLabel}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 whitespace-nowrap text-caption text-muted">
                {formatRelative(entry.createdAt)}
              </span>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
