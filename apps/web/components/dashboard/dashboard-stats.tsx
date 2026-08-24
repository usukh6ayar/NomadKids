import type { TeacherDashboard } from "@kinder/contracts";
import { Card } from "@/components/ui/card";
import { percentOf } from "./percent";

/**
 * The four counts at the top of the teacher's dashboard.
 *
 * ★ Context, not the point of the screen.
 *
 * These answer "how big is my world today" in one glance — roster, groups, how
 * far this term's assessment has got, how many parent notes are waiting. What
 * needs *doing* is below, in the alerts. That ordering is deliberate: a
 * dashboard whose largest elements are four numbers teaches a teacher to read
 * numbers rather than to act.
 *
 * Every value is a real field of `GET /dashboard/teacher`. None is derived from
 * a placeholder, and the tile set does not grow to fill the row.
 */
export function DashboardStats({
  counts,
  needsAttention,
  termProgress,
}: {
  counts: TeacherDashboard["counts"];
  /**
   * ★ The review count comes from here, not from `counts.pendingReviews`.
   *
   * `dashboard.service.ts` currently computes one number and writes it to both
   * fields, so today they cannot disagree. That is an implementation detail:
   * `counts` is the "how big is my world" block and `needsAttention` is the
   * work queue, and the day the queue is narrowed to a teacher's own groups
   * they will diverge. Reading the field that means "waiting for you" keeps the
   * tile correct through that change instead of one commit after it.
   */
  needsAttention: TeacherDashboard["needsAttention"];
  termProgress: TeacherDashboard["termProgress"];
}) {
  const percent = percentOf(termProgress);
  const pendingReviews = needsAttention.pendingReviews;

  return (
    <section aria-label="Товч мэдээлэл" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Хүүхэд" value={counts.children} />
      <Stat label="Бүлэг" value={counts.groups} />
      <Stat
        label="Улирлын явц"
        value={`${percent}%`}
        // The one tile that carries the brand colour: it is the only one whose
        // number is a *share* rather than a count, and the tint is what makes
        // that legible without reading the label.
        tone="sky"
        detail={`${termProgress.assessed} / ${termProgress.total} үнэлэгдсэн`}
      />
      <Stat
        label="Хянах"
        value={pendingReviews}
        tone={pendingReviews > 0 ? "sun" : "neutral"}
        detail={pendingReviews > 0 ? "Эцэг эхийн бичлэг" : undefined}
      />
    </section>
  );
}

/**
 * One tile.
 *
 * The tint sits on the number rather than on the card, so four tiles in a row
 * stay a row of tiles instead of four competing coloured blocks — and a tile
 * whose count is zero loses its colour, because there is nothing to notice.
 */
function Stat({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  /** The line under the number, where the count alone is ambiguous. */
  detail?: string;
  tone?: "neutral" | "sun" | "peach" | "mint" | "sky";
}) {
  const toneClass =
    tone === "sun"
      ? "bg-sun text-sun-ink"
      : tone === "peach"
        ? "bg-peach text-peach-ink"
        : tone === "mint"
          ? "bg-mint text-mint-ink"
          : tone === "sky"
            ? "bg-sky text-sky-ink"
            : "";

  return (
    <Card className="px-4 py-3.5">
      <p className="text-body text-muted">{label}</p>
      <p
        className={`mt-1 inline-flex min-w-[2ch] justify-center rounded-control px-1.5 text-display font-semibold tabular-nums ${
          toneClass || "text-ink"
        }`}
      >
        {value}
      </p>
      {detail ? <p className="mt-1 truncate text-caption text-muted">{detail}</p> : null}
    </Card>
  );
}
