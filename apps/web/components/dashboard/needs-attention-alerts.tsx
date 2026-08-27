import Link from "next/link";
import { Cake, ClipboardList, ClipboardX } from "lucide-react";
import type { ReactNode } from "react";
import type { TeacherDashboard } from "@kinder/contracts";
import { ChildAvatar } from "@/components/media/media-image";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fullName } from "@/lib/format";

/**
 * Everything on this screen that is asking for something.
 *
 * ★ One section, three possible rows, and it disappears entirely when there is
 * nothing to say.
 *
 * A dashboard that always renders the same boxes trains people to stop looking
 * at them. This block is present only when it has content, which is what makes
 * its presence itself the signal — a teacher who sees nothing here is done.
 *
 * ★★ Warm tints, not red.
 *
 * The brief asked for "red/orange" alerts. Orange is right and red is not: none
 * of these is an error. `--color-danger` is reserved for something that has
 * failed, and spending it on a birthday would leave the product with no way to
 * say "this actually went wrong". So the roster gap uses `peach` — the token
 * whose documented meaning is "needs attention" — the review queue uses `sun`
 * ("waiting on someone"), and a birthday gets the same warm amber for a happy
 * reason rather than an alarming one. The icon and the wording carry the
 * difference; colour never carries it alone.
 */
export function NeedsAttentionAlerts({
  birthdaysToday,
  needsAttention,
}: {
  birthdaysToday: TeacherDashboard["birthdaysToday"];
  needsAttention: TeacherDashboard["needsAttention"];
}) {
  const missing = needsAttention.childrenMissingAssessment;
  const pendingReviews = needsAttention.pendingReviews;

  if (birthdaysToday.length === 0 && missing.length === 0 && pendingReviews === 0) return null;

  // `aria-label` rather than `aria-labelledby`: which card renders first depends
  // on the day, so an id pinned to one of them would resolve to nothing on a day
  // that card is absent — a silent accessibility failure, since the section
  // still looks right.
  /*
   * ★ No heading of its own any more.
   *
   * "Анхаарах зүйлс" sat above these cards as a full `SectionHeader`, and with
   * one birthday to report the block occupied a third of the screen to say so.
   * The heading was also the third thing naming the same idea: the section's
   * `aria-label`, the heading, and then each card's own title.
   *
   * These read as inline notifications now — the row is what it is without a
   * label announcing that a notification is a notification. The landmark keeps
   * the name for a screen reader.
   */
  return (
    <section aria-label="Анхаарах зүйлс" className="flex flex-col gap-2">
      {birthdaysToday.length > 0 ? (
        <AlertCard
          tone="sun"
          icon={<Cake size={20} aria-hidden="true" />}
          title="Өнөөдөр төрсөн өдөртэй"
        >
          <ul className="flex flex-wrap items-center gap-2">
            {birthdaysToday.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/children/${child.id}`}
                  className="flex min-h-[44px] items-center gap-2 rounded-control border border-border bg-surface px-2.5 py-1.5 hover:bg-canvas md:px-3"
                >
                  <ChildAvatar child={child} size={28} />
                  <span className="truncate font-medium text-ink">{fullName(child)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </AlertCard>
      ) : null}

      {missing.length > 0 ? (
        <AlertCard
          tone="peach"
          icon={<ClipboardX size={20} aria-hidden="true" />}
          title="Энэ улиралд үнэлгээ хийгдээгүй"
          /*
           * ★ The gap, not the coverage.
           *
           * Children who are already assessed need nothing from this teacher, so
           * they are not on the list. A "12 of 20 assessed" line reads as
           * progress; eight names read as work.
           */
          lede={`${missing.length} хүүхэд. Улирал хаагдахаас өмнө үнэлгээ шаардлагатай.`}
        >
          {/*
            ★ Chips, not rows — and the same chips the birthday alert above
            uses.

            Six full-width rows at 52px each is 312px, which put this one
            notification above the fold and pushed today's attendance and the
            menu below it. On a 900px laptop the alerts owned half the first
            screen to report a task with no deadline today.

            A chip carries the same link to the same child and keeps the group
            name. The group is *not* redundant here even though a teacher has
            only one: this screen is `RequireRole ["TEACHER", "ADMIN"]`, and an
            administrator sees children from every group in the kindergarten,
            which is why the contract carries `group` on each row at all.

            What it drops is the "Үнэлэх →" affordance, which repeated what
            tapping the row already did.
          */}
          <ul className="flex flex-wrap items-center gap-2">
            {missing.slice(0, VISIBLE_MISSING).map((child) => (
              <li key={child.id}>
                <Link
                  href={`/children/${child.id}`}
                  className="flex min-h-[44px] items-center gap-2 rounded-control border border-border bg-surface px-2.5 py-1.5 transition-colors hover:border-peach-ink/40 hover:bg-canvas md:px-3"
                >
                  <ChildAvatar child={child} size={28} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium leading-tight text-ink">
                      {fullName(child)}
                    </span>
                    {child.group ? (
                      <span className="block truncate text-caption leading-tight text-muted">
                        {child.group.name}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}

            {missing.length > VISIBLE_MISSING ? (
              <li className="text-body text-peach-ink">
                +{missing.length - VISIBLE_MISSING} хүүхэд
              </li>
            ) : null}
          </ul>
        </AlertCard>
      ) : null}

      {pendingReviews > 0 ? (
        <AlertCard
          tone="sun"
          icon={<ClipboardList size={20} aria-hidden="true" />}
          title="Эцэг эхийн ажиглалт хянах"
          lede={`${pendingReviews} бичлэг хүлээгдэж байна.`}
          action={
            <Button asChild size="sm">
              <Link href="/observations/review">Хянах</Link>
            </Button>
          }
        />
      ) : null}
    </section>
  );
}

/**
 * Beyond this the card stops being a notification and starts being a page.
 *
 * Was 6, as full rows. Five chips wrap to two lines at worst and the count
 * carries the rest — the roster screen is where the whole list belongs.
 */
const VISIBLE_MISSING = 5;

/**
 * One alert.
 *
 * The tint is on a left rule and the icon rather than flooding the card: a
 * saturated block behind body text is what pushes contrast under the floor, and
 * three of them stacked is a warning banner rather than a dashboard.
 */
function AlertCard({
  tone,
  icon,
  title,
  lede,
  action,
  children,
}: {
  tone: "sun" | "peach";
  icon: ReactNode;
  title: string;
  lede?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const tint = tone === "sun" ? "bg-sun text-sun-ink" : "bg-peach text-peach-ink";
  const rule = tone === "sun" ? "border-l-sun" : "border-l-peach";

  return (
    <Card pad="compact" className={`border-l-4 ${rule}`}>
      <div className="flex flex-wrap items-center gap-3">
        {/* 32px, not 40px: this labels a line of text, it is not a feature. */}
        <span className={`grid size-8 shrink-0 place-items-center rounded-control ${tint}`}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-semibold leading-tight text-ink md:text-lead">{title}</h3>
          {lede ? <p className="mt-0.5 text-body text-muted">{lede}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {children ? <div className="mt-2.5">{children}</div> : null}
    </Card>
  );
}
