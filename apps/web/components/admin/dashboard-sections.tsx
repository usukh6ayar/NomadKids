import Link from "next/link";
import type { AdminDashboard } from "@kinder/contracts";
import { AUDIT_ACTION_LABEL, AUDIT_OBJECT_LABEL } from "@kinder/contracts";
import { Button } from "@/components/ui/button";
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
            const percent =
              group.children > 0 ? Math.round((group.assessed / group.children) * 100) : 0;

            /*
              ★ The bar is what this row is for, and it was missing.

              The row said "Ахлах бүлэг" on the left edge and "5 / 5 үнэлгээ" on
              the right, with 900px of nothing between them — a reader had to
              cross the whole card to pair a group with its number, then do the
              division themselves to answer the question the section asks
              ("how far along is this group?"). A filled track answers it before
              the numbers are read, and it spends the width the row already had.

              `aria-hidden` rather than `StatBar`'s `progressbar` role: the
              fraction is rendered beside it as text, so it is already the
              accessible answer, and a bar announcing the same ratio would read
              it twice per group.
            */
            const body = (
              <>
                {/*
                  `w-`, not `max-w-`. A max width shrinks to the content, so
                  "Ахлах бүлэг" and "Дунд бүлэг" started their bars ten pixels
                  apart — which defeats the column the bars were given a fixed
                  length for in the first place.
                */}
                <span className="min-w-0 flex-1 truncate font-medium text-ink md:w-[220px] md:flex-none">
                  {group.name}
                </span>

                {/*
                  ★ A fixed 320px column, not `flex-1`.

                  Stretched across the row the bar was a thousand pixels of
                  solid colour — a rule rather than a gauge, and the loudest
                  thing on a screen whose whole argument is restraint. A gauge
                  is read by how *full* it is, which needs a length the eye can
                  take in at once and, more importantly, the same length on
                  every row: two groups at 5/5 and 3/8 are compared by looking
                  down the column, which only works if the tracks align.

                  The fill is `bg-primary` in both states, like `StatBar`. The
                  badge beside it already says which state this is, in words.
                */}
                <span
                  aria-hidden="true"
                  className="order-last h-2 w-full basis-full overflow-hidden rounded-pill bg-track md:order-none md:w-[320px] md:basis-auto"
                >
                  <span
                    className="block h-full rounded-pill bg-primary"
                    style={{ width: `${percent}%` }}
                  />
                </span>

                <span
                  className={`shrink-0 rounded-pill px-2.5 py-1 text-caption font-medium md:ml-auto ${
                    complete ? "bg-mint text-mint-ink" : "bg-sun text-sun-ink"
                  }`}
                >
                  {group.assessed} / {group.children} үнэлгээ
                </span>
              </>
            );

            const shared =
              "flex min-h-[56px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:flex-nowrap";

            if (!href) {
              return (
                <div key={group.groupId} className={shared}>
                  {body}
                </div>
              );
            }

            return (
              <Link
                key={group.groupId}
                href={href(group.groupId)}
                className={`${shared} transition-colors hover:bg-canvas`}
              >
                {body}
              </Link>
            );
          })}
        </Card>
      )}
    </section>
  );
}

export function RecentActivitySection({
  entries,
  /**
   * The full audit log this section shows the newest few rows of.
   *
   * ★ Optional, because only one of the two callers has such a screen.
   *
   * A kindergarten's own admin reaches `/admin/audit`; the platform operator
   * renders this same section on a tenant's detail page and has no route into
   * that tenant's audit log, so passing nothing leaves the heading without an
   * action rather than offering a link that 404s — the rule `app-shell.tsx`
   * holds the sidebar to, applied to a section header.
   */
  auditHref,
}: {
  entries: AdminDashboard["recentActivity"];
  auditHref?: string;
}) {
  return (
    <section aria-labelledby="activity-heading">
      <SectionHeader
        id="activity-heading"
        title="Сүүлийн үйлдэл"
        action={
          auditHref ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={auditHref}>Бүх түүх</Link>
            </Button>
          ) : null
        }
      />

      {/*
        ★ Three columns — what happened, who did it, when — rather than a
        two-line stack pinned to the left edge with a timestamp pinned to the
        right.

        The actor is the column an administrator actually reads this feed for:
        "Засварласан · Хүүхэд" is only half an answer, and it was set in
        `text-caption text-muted` underneath, which is the styling this product
        uses for supporting detail. Who changed a child's record is not
        supporting detail. Given its own column it lines up down the card, so
        the feed can be scanned by person as well as by time.
      */}
      {entries.length === 0 ? (
        <EmptyState title="Үйлдэл бүртгэгдээгүй байна" />
      ) : (
        <Card className="divide-y divide-border">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex min-h-[52px] flex-wrap items-center gap-x-4 gap-y-0.5 px-4 py-2.5 md:flex-nowrap"
            >
              <span className="min-w-0 flex-1 truncate text-body text-ink">
                {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}
                {entry.objectType
                  ? ` · ${AUDIT_OBJECT_LABEL[entry.objectType] ?? entry.objectType}`
                  : ""}
              </span>

              <span className="min-w-0 basis-full truncate text-caption text-muted md:basis-auto md:w-[200px] md:text-body">
                {entry.actorLabel ?? "—"}
              </span>

              <span className="shrink-0 whitespace-nowrap text-caption text-muted md:w-[96px] md:text-right">
                {formatRelative(entry.createdAt)}
              </span>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
