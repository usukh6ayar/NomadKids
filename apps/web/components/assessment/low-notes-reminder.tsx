"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import {
  MAX_PAGE_SIZE,
  childSummarySchema,
  groupObservationStatsSchema,
  paginated,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { shortName } from "@/lib/format";

const childrenPageSchema = paginated(childSummarySchema);

function thisMonth() {
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return { key, from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
}

/**
 * Who is behind this month: fewer than half the group's average notes. Pure,
 * so the rule is tested on its own.
 *
 * ★ Half the average, not "below average": half a group is always below its
 * own average, and a reminder that names ten children is one nobody reads.
 * Nothing is flagged while the group itself has under one note a child — at
 * the start of a month everyone is at zero and nobody is behind anyone.
 */
export function childrenBehind(
  children: { id: string }[],
  counts: { childId: string; count: number }[],
): { id: string; count: number }[] {
  if (children.length < 2) return [];
  const byId = new Map(counts.map((row) => [row.childId, row.count]));
  const rows = children.map((child) => ({ id: child.id, count: byId.get(child.id) ?? 0 }));
  const average = rows.reduce((sum, row) => sum + row.count, 0) / rows.length;
  if (average < 1) return [];
  return rows.filter((row) => row.count < average / 2).sort((a, b) => a.count - b.count);
}

function readDismissed(key: string): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/**
 * «Тэмдэглэл цөөн хүүхэд» on «Явцын үнэлгээ» — 2026-10-08, the client: the
 * children with fewer notes than the rest, each with an × to hide.
 *
 * ★ Hidden in this browser for this month only. Hiding is a teacher saying
 * "I know" — a convenience, not a record — so it lives where a remembered
 * filter does, and a child still behind next month is named again.
 */
export function LowNotesReminder({ groupId }: { groupId: string }) {
  const month = thisMonth();
  const storageKey = `nomadkids:low-notes-hidden:${groupId}:${month.key}`;
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => setHidden(readDismissed(storageKey)), [storageKey]);

  // The keys «Явцын үнэлгээ» already reads, so these are cached reads.
  const stats = useQuery({
    queryKey: qk.groupObservationStats(groupId, month.from, month.to),
    queryFn: () =>
      get(
        `/groups/${groupId}/observation-stats?from=${month.from}&to=${month.to}`,
        groupObservationStatsSchema,
      ),
    enabled: Boolean(groupId),
    staleTime: 60_000,
  });
  const roster = useQuery({
    queryKey: qk.children({ groupId, page: 1, pageSize: MAX_PAGE_SIZE }),
    queryFn: () =>
      get(`/children?groupId=${groupId}&page=1&pageSize=${MAX_PAGE_SIZE}`, childrenPageSchema),
    enabled: Boolean(groupId),
    staleTime: 60_000,
  });

  if (!stats.data || !roster.data) return null;
  const children = new Map(roster.data.items.map((child) => [child.id, child]));
  const behind = childrenBehind(roster.data.items, stats.data.byChild).filter(
    (row) => !hidden.includes(row.id),
  );
  if (behind.length === 0) return null;

  const hide = (id: string) => {
    const next = [...hidden, id];
    setHidden(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Private window or blocked storage: hidden for this visit only.
    }
  };

  return (
    <section
      aria-labelledby="low-notes-heading"
      className="flex flex-col gap-2 rounded-card border border-sun-ink/20 bg-sun/40 px-3 py-2.5"
    >
      <div className="flex items-center gap-2">
        <BellRing size={16} aria-hidden="true" className="shrink-0 text-sun-ink" />
        <h2 id="low-notes-heading" className="text-body font-semibold text-ink">
          Тэмдэглэл цөөн хүүхэд
        </h2>
        <span className="text-caption text-muted">· энэ сард бусдаасаа цөөн</span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {behind.map((row) => {
          const child = children.get(row.id)!;
          const name = shortName(child);
          return (
            <li
              key={row.id}
              className="inline-flex items-center rounded-pill border border-border bg-surface"
            >
              <Link
                href={`/children/${row.id}/observations?type=daily`}
                className="min-h-[36px] content-center pl-3 pr-1 text-caption font-medium text-ink hover:text-primary"
              >
                {name} <span className="tabular-nums text-muted">· {row.count}</span>
              </Link>
              <button
                type="button"
                aria-label={`${name}-г нуух`}
                onClick={() => hide(row.id)}
                className="grid size-8 place-items-center rounded-pill text-muted hover:bg-canvas hover:text-ink"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
