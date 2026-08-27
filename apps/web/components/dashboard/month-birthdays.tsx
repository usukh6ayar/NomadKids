import Link from "next/link";
import { Cake } from "lucide-react";
import type { TeacherDashboard } from "@kinder/contracts";
import { TileShell } from "./tile-shell";
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
 *
 * ★★★ It takes the `sun` wash, one of exactly two tinted tiles on the screen.
 *
 * Every other card here reports work: a register to fill, an assessment to
 * finish, an allergy to avoid. This one reports that something nice is coming,
 * and a white card with a small cake on it says that no differently from a
 * white card with an overdue task on it. `tone.ts` files `sun` as "waiting,
 * upcoming", which is literally what a birthday later this month is.
 *
 * ★★★★ There is no birthday illustration in `public/`, and none was invented.
 *
 * The eight mascots are children and a teacher, and none of them is holding a
 * cake — dropping `mascot-girl-purple.webp` here would be a picture of *a*
 * child on a card that lists *these* children by name and face. Lucide's `Cake`
 * on the tone chip is the honest version, and the avatars are the real artwork:
 * they are the children's own photographs where a family has uploaded one.
 */
export function MonthBirthdays({
  birthdays,
}: {
  birthdays: TeacherDashboard["birthdaysThisMonth"];
}) {
  // Nothing this month is a real and common answer, not a failure — and an
  // empty frame saying so is a card a teacher learns to skip.
  if (birthdays.length === 0) return null;

  /*
   * ★ Three names, then a count.
   *
   * A month with eleven birthdays would make this the tallest thing in a row
   * of four tiles, for a list nobody reads past the top of. The link at the
   * foot goes to the roster, where the whole month is legible.
   */
  const shown = birthdays.slice(0, 3);
  const rest = birthdays.length - shown.length;

  return (
    <TileShell
      icon={<Cake size={18} aria-hidden="true" />}
      tone="sun"
      surface
      label="Энэ сард төрсөн"
      footer={
        <p className="text-caption text-muted">
          <span className="font-semibold tabular-nums text-ink">{birthdays.length}</span> хүүхэд
          {rest > 0 ? ` · +${rest} нэр` : ""}
        </p>
      }
    >
      <ul className="flex flex-col gap-1.5">
        {shown.map((child) => (
          <li key={child.id}>
            {/*
              ★ A white row on the wash, not a transparent one.

              The tile is tinted now, so a row that only changed colour on hover
              had no shape at rest — three names floating on amber. Each child
              gets their own surface, which is the `RowCard` idea at tile scale:
              a list is a column of small cards, not text on a background.
            */}
            <Link
              href={`/children/${child.id}`}
              className="flex items-center gap-2.5 rounded-row border border-border bg-surface px-2.5 py-2 transition-colors hover:border-sun-ink/40"
            >
              <ChildAvatar child={child} size={32} />
              <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                {fullName(child)}
              </span>
              {/*
                The date, not "in 3 days": a relative phrase is re-read every
                morning, and this list is scanned once when planning the month.

                A tinted pill rather than a grey line — the sketch writes the
                day beside each name as the point of the card, and this is the
                one section on the dashboard that is meant to feel like good
                news rather than a task.
              */}
              <span className="shrink-0 rounded-pill bg-sun px-2 py-0.5 text-caption font-medium tabular-nums text-sun-ink">
                {formatDayMonth(child.dateOfBirth)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </TileShell>
  );
}
