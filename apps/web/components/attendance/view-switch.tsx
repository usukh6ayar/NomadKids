"use client";

import Link from "next/link";
import { CalendarRange, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Бүлгээр | Хүүхдээр" — the two grains the attendance register is read at.
 *
 * ★ Added 2026-09-06, at the client's request: "өдөр тутмын бүртгэлийг
 * бүлгээр нь мөн шууд сурагчдаар нь харуулдаг болгох".
 *
 * Both views already existed and neither knew about the other. `/attendance/daily`
 * is one row per group per day; `/attendance/journal` is one row per child with
 * a column per day. A director's question moves between the two constantly —
 * "Дэлбээ has four absences this week, which children?" — and answering it
 * meant leaving the screen, finding another sidebar row, and setting the same
 * two dates again.
 *
 * ★★ It navigates rather than swapping a component in place.
 *
 * The alternative was to render the journal's grid inside the daily page behind
 * a tab, and it would have meant two screens' worth of filters, exports and
 * selection state in one file — with two different `useSelection` scopes and
 * two different Excel endpoints under one set of controls. These are two pages
 * that answer two questions; what they were missing was a door between them,
 * not a merge.
 *
 * ★★★ The filters travel. `from`, `to` and `groupId` are carried across as
 * query parameters and both pages seed their state from them, so switching
 * grain keeps the period you were looking at. A switch that reset the dates
 * would be slower than the sidebar it replaces.
 */
export function AttendanceViewSwitch({
  current,
  from,
  to,
  groupId,
}: {
  current: "group" | "child";
  from: string;
  to: string;
  groupId?: string;
}) {
  const params = new URLSearchParams({ from, to });
  if (groupId) params.set("groupId", groupId);
  const query = `?${params}`;

  return (
    /*
      `role="group"` with `aria-current` on the active link, not a tablist:
      these are two URLs, and `groups/[groupId]/meals` records the same
      reasoning — claiming `role="tab"` for something that navigates promises a
      screen reader a panel that never arrives.
    */
    <div
      role="group"
      aria-label="Ирцийг харах хэлбэр"
      className="inline-flex rounded-control border border-border bg-surface p-1"
    >
      <Tab href={`/attendance/daily${query}`} active={current === "group"}>
        <CalendarRange size={16} aria-hidden />
        Бүлгээр
      </Tab>
      <Tab href={`/attendance/journal${query}`} active={current === "child"}>
        <Users size={16} aria-hidden />
        Хүүхдээр
      </Tab>
    </div>
  );
}

function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-[38px] items-center gap-1.5 rounded-control px-3 text-body font-medium transition-colors",
        active
          ? "bg-primary text-primary-ink shadow-sm"
          : "text-muted hover:bg-canvas hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
