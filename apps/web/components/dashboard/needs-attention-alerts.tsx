import Link from "next/link";
import { Cake, ClipboardList, ClipboardX } from "lucide-react";
import type { ReactNode } from "react";
import type { TeacherDashboard } from "@kinder/contracts";
import { ChildAvatar } from "@/components/media/media-image";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
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
  return (
    <section aria-label="Анхаарах зүйлс" className="flex flex-col gap-3">
      <SectionHeader
        as="h2"
        title="Анхаарах зүйлс"
        lede="Өнөөдөр таны хариу үйлдэл шаардаж буй зүйлс."
        className="mb-0"
      />

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
                  className="flex min-h-[44px] items-center gap-2 rounded-control border border-border bg-surface px-3 py-1.5 hover:bg-canvas"
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
          <ul className="flex flex-col gap-1.5">
            {missing.slice(0, VISIBLE_MISSING).map((child) => (
              <li key={child.id}>
                <Link
                  href={`/children/${child.id}`}
                  className="flex min-h-[52px] items-center gap-3 rounded-control border border-border bg-surface px-3 py-2 hover:bg-canvas"
                >
                  <ChildAvatar child={child} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{fullName(child)}</span>
                    {child.group ? (
                      <span className="block truncate text-body text-muted">
                        {child.group.name}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-body text-primary-strong">Үнэлэх →</span>
                </Link>
              </li>
            ))}
          </ul>
          {missing.length > VISIBLE_MISSING ? (
            <p className="mt-2 text-body text-peach-ink">
              Бусад {missing.length - VISIBLE_MISSING} хүүхэд…
            </p>
          ) : null}
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

/** Beyond this the card stops being a list and starts being a page. */
const VISIBLE_MISSING = 6;

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
    <Card className={`border-l-4 px-4 py-4 ${rule}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-control ${tint}`}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink">{title}</h3>
          {lede ? <p className="mt-0.5 text-body text-muted">{lede}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {children ? <div className="mt-3">{children}</div> : null}
    </Card>
  );
}
