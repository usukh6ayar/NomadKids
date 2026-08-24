import Link from "next/link";
import { NotebookPen, Users } from "lucide-react";
import type { TeacherDashboard } from "@kinder/contracts";
import { ChildAvatar } from "@/components/media/media-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { excerpt, formatRelative, fullName } from "@/lib/format";

/**
 * The last few observations across this teacher's children.
 *
 * ★ Who, what kind, and how long ago — in that order.
 *
 * The child's name is what a teacher scans for, so it leads and the note's text
 * is the supporting line. `PARENT` entries are marked, because "the family
 * wrote this" changes what the row means: it may be waiting for review, and it
 * is the one kind of row a teacher did not write themselves.
 *
 * The empty case is a real state, not a failure — a new kindergarten has no
 * observations for its first week — so it gets an `EmptyState` that says what
 * would appear here and offers the way to create the first one, rather than the
 * section silently vanishing.
 */
export function RecentObservations({
  observations,
}: {
  observations: TeacherDashboard["recentObservations"];
}) {
  const isEmpty = observations.length === 0;

  // `aria-label`, not `aria-labelledby`: `SectionHeader` renders the heading and
  // does not take an id, so pointing at one would name this section after an
  // element that does not exist.
  return (
    <section aria-label="Сүүлийн үйл явдал">
      <SectionHeader
        title="Сүүлийн үйл явдал"
        lede={isEmpty ? undefined : "Хамгийн сүүлд бичигдсэн ажиглалтууд."}
        // The empty state already offers this exact link, and two identical
        // buttons three inches apart is a question about which one is the real
        // one. The header keeps it only when there is a list to look past.
        action={
          isEmpty ? undefined : (
            <Button asChild variant="secondary" size="sm">
              <Link href="/children">Хүүхдүүд</Link>
            </Button>
          )
        }
      />

      {isEmpty ? (
        <EmptyState
          icon={<NotebookPen size={28} aria-hidden="true" />}
          title="Ажиглалт хараахан бичигдээгүй"
          description="Хүүхэд сонгоод эхний ажиглалтаа бичихэд энд харагдана."
          action={
            <Button asChild>
              <Link href="/children">Хүүхдүүд</Link>
            </Button>
          }
        />
      ) : (
        <Card className="divide-y divide-border">
          {observations.map((obs) => {
            const fromParent = obs.source === "PARENT";

            return (
              <Link
                key={obs.id}
                href={obs.child ? `/children/${obs.child.id}` : "/children"}
                className="flex min-h-[64px] items-start gap-3 px-4 py-3 transition-colors hover:bg-canvas"
              >
                <ChildAvatar child={obs.child ?? {}} size={40} />

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-medium text-ink">{fullName(obs.child)}</span>
                    {/* The label is the signal; the tint only reinforces it. */}
                    {fromParent ? <Badge tone="sky">Эцэг эх</Badge> : null}
                    {obs.reviewStatus === "PENDING" ? (
                      <Badge tone="sun">Хүлээгдэж буй</Badge>
                    ) : null}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-body text-muted">
                    {fromParent ? (
                      <Users size={14} aria-hidden="true" className="shrink-0" />
                    ) : (
                      <NotebookPen size={14} aria-hidden="true" className="shrink-0" />
                    )}
                    <span className="truncate">
                      {obs.type?.name ? `${obs.type.name} · ` : ""}
                      {excerpt(obs.situation, 70) || "Тайлбаргүй"}
                    </span>
                  </span>
                </span>

                <span className="shrink-0 whitespace-nowrap text-caption text-muted">
                  {formatRelative(obs.observedOn)}
                </span>
              </Link>
            );
          })}
        </Card>
      )}
    </section>
  );
}
