"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";
import { ChevronRight } from "lucide-react";
import { groupListItemSchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

const groupsSchema = paginated(groupListItemSchema);

/**
 * "Which group?" — the landing page for a feature that is recorded per group.
 *
 * ★ Three screens needed the same page, so it is one component.
 *
 * Attendance, assessment and the meal register are all recorded against a
 * group, so each has a `/groups/[groupId]/…` route and none had a top-level
 * one. `layout.tsx` records the rule that followed from that: a sidebar entry
 * which opens nothing teaches a teacher the product is broken, so a feature
 * with no top-level page got no top-level link — and the client's own
 * navigation drawing lists all three at the top level.
 *
 * The rule is right; the conclusion was wrong. The answer to "this needs a
 * group chosen first" is a screen that asks which group, not the absence of a
 * screen. A director of a twelve-group kindergarten was otherwise reaching the
 * register by opening a dashboard and reading down its cards.
 *
 * ★★ It lists destinations and records nothing.
 *
 * Every row goes to the sheet where the work happens, so attendance keeps one
 * editable surface rather than two that can disagree about the same morning.
 *
 * ★★★ No per-group status, on purpose.
 *
 * "12 / 14 бүртгэсэн" beside each name would need one request per group — the
 * only endpoint that knows is `/groups/:id/attendance?date=…` — which is the
 * N+1 §3.4 forbids, on a screen a teacher opens every morning. The
 * administrator's dashboard already carries that figure kindergarten-wide in a
 * single query.
 */
export function GroupPicker({
  icon,
  href,
  emptyDescription,
}: {
  /** The feature's own glyph, so the three pages are not interchangeable. */
  icon: ReactNode;
  href: (groupId: string) => string;
  emptyDescription: string;
}) {
  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 20 }),
    queryFn: () => get("/groups?page=1&pageSize=20", groupsSchema),
  });

  const items = groups.data?.items ?? [];

  if (groups.isLoading) return <LoadingState rows={3} />;
  if (groups.isError) return <ErrorState description={errorMessage(groups.error)} />;

  if (items.length === 0) {
    return <EmptyState title="Бүлэг байхгүй байна" description={emptyDescription} />;
  }

  return (
    <Card className="divide-y divide-border overflow-hidden">
      {items.map((group) => (
        <GroupRow key={group.id} group={group} icon={icon} href={href(group.id)} />
      ))}
    </Card>
  );
}

function GroupRow({
  group,
  icon,
  href,
}: {
  group: z.infer<typeof groupListItemSchema>;
  icon: ReactNode;
  href: string;
}) {
  const children = group._count?.enrollments ?? 0;

  return (
    <Link
      href={href}
      className="group flex min-h-[72px] items-center gap-3 px-4 py-3 transition-colors hover:bg-canvas"
    >
      <IconChip icon={icon} tone="primary" />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-lead font-semibold text-ink">{group.name}</span>
          {group.status === "ARCHIVED" ? <Badge tone="neutral">Архивласан</Badge> : null}
        </span>
        <span className="mt-px block text-compact text-muted">{children} хүүхэд</span>
      </span>

      <ChevronRight
        size={18}
        aria-hidden
        className="shrink-0 text-faint transition-colors group-hover:text-primary"
      />
    </Link>
  );
}
