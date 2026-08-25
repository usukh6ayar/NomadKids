import Link from "next/link";
import { Cake } from "lucide-react";
import type { TeacherDashboard } from "@kinder/contracts";
import { Card, SectionHeader } from "@/components/ui/card";
import { ChildAvatar } from "@/components/media/media-image";
import { formatDayMonth, fullName } from "@/lib/format";

/**
 * Энэ сард төрсөн хүүхдүүд — the month's birthdays, day-ordered.
 *
 * ★ Separate from the birthday alert, and both earn their place.
 *
 * `NeedsAttentionAlerts` shows whose birthday is *today* — it is an alert, and
 * it is absent on the twenty-nine days when nobody has one. This is a plan: a
 * teacher ordering a cake or printing a card needs the week ahead, not the
 * morning. The API returns two lists for the same reason rather than one the
 * client filters, so neither can drift from the other.
 *
 * ★★ Ordered by day of month, so it reads as a calendar. The API does that
 * sorting — `EXTRACT(DAY …)` — because children in one group span three birth
 * years and a full-date sort would group them by age instead.
 */
export function MonthBirthdays({
  birthdays,
}: {
  birthdays: TeacherDashboard["birthdaysThisMonth"];
}) {
  // Nothing this month is a real and common answer, not a failure — and an
  // empty frame saying so is a card a teacher learns to skip.
  if (birthdays.length === 0) return null;

  return (
    <section aria-labelledby="month-birthdays-heading">
      <SectionHeader
        id="month-birthdays-heading"
        title="Энэ сард төрсөн хүүхдүүд"
        lede={`${birthdays.length} хүүхэд`}
      />

      <Card className="divide-y divide-border">
        {birthdays.map((child) => (
          <Link
            key={child.id}
            href={`/children/${child.id}`}
            className="flex min-h-[56px] items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-canvas md:gap-3 md:px-4 md:py-3"
          >
            <ChildAvatar child={child} size={36} />
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{fullName(child)}</span>
            {/*
              The date, not "in 3 days": a relative phrase is re-read every
              morning, and this list is scanned once when planning the month.
            */}
            <span className="flex shrink-0 items-center gap-1.5 text-caption tabular-nums text-muted">
              <Cake size={14} aria-hidden="true" />
              {formatDayMonth(child.dateOfBirth)}
            </span>
          </Link>
        ))}
      </Card>
    </section>
  );
}
