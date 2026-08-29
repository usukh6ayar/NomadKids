import type { TeacherDashboard } from "@kinder/contracts";
import { Ring } from "@/components/ui/chart/ring";
import { Art } from "@/components/ui/art";
import { TileShell } from "./tile-shell";
import { percentOf } from "./percent";

/**
 * This term's assessment progress — RFP §12.1 "улирлын үнэлгээний явц".
 *
 * ★ A `Ring` now, where this was a full-width rule under a heading.
 *
 * The rule was the right answer while this was a section of its own: a bar
 * reads a ratio at a glance and announces itself properly, which a canvas chart
 * does not. It moved into the "явц" band beside the observation mix, where two
 * cards of the same shape have to be comparable, and a 600px horizontal rule
 * beside a stack of four short bars is not a pair. `Ring` is the shared
 * primitive for exactly one percentage (§16), the tile shell is the one the mix
 * already wears, and the two now read as one band.
 *
 * ★★ **The `progressbar` role survived the change, and that was the constraint
 * the redraw had to satisfy rather than a detail.**
 *
 * `Ring` is `aria-hidden` unless it is given a name, because on every screen
 * that has one the figure is also on the card as text. That is right here too —
 * but the *ratio* is the thing an assistive technology should be able to report,
 * and dropping to three separate text nodes would have lost it. So the role sits
 * on the group that holds the ring and the counts, with `aria-valuenow` and an
 * `aria-valuetext` that says the fraction in words. One progressbar on the
 * screen, the same one `flows.test.tsx` has always asserted on.
 *
 * ★★★ Completed and pending, and no third state — because there is no third
 * state in the data.
 *
 * `termProgress` is `{ assessed, total }`. "Partial" would need a per-domain
 * count of what has been filled in for a child mid-assessment, and neither the
 * endpoint nor `Assessment` carries one; a tile that named it would be
 * inventing a number. Pending is `total - assessed`, which is arithmetic on
 * what the server sent.
 *
 * ★★★★ And still no target. The denominator is the roster, which is a fact —
 * not a quota somebody set, which is what `ObservationMix` refuses to imply.
 */
export function TermProgress({
  term,
  progress,
}: {
  term: string;
  progress: TeacherDashboard["termProgress"];
}) {
  const { assessed, total } = progress;
  const percent = percentOf(progress);
  const pending = Math.max(0, total - assessed);

  return (
    <section aria-label="Улирлын үнэлгээний явц" className="h-full">
      <TileShell
        icon={<Art name="progress" />}
        tone="teal"
        size="feature"
        label="Улирлын үнэлгээний явц"
        footer={<p className="text-caption text-muted">{term}</p>}
      >
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${term} үнэлгээний явц`}
          aria-valuetext={`${total} хүүхдээс ${assessed} үнэлэгдсэн`}
          className="flex items-center gap-4 md:gap-5"
        >
          <Ring percent={percent} size="lg" />

          <div className="min-w-0 flex-1">
            <p className="font-semibold tabular-nums leading-none text-ink text-figure">
              {assessed}
              <span className="text-display text-faint">/{total}</span>
            </p>
            <p className="mt-1 text-caption text-muted">хүүхэд үнэлэгдсэн</p>

            {/*
              Two states, each with the dot of its own arc — the same legend
              shape the sex split and the attendance breakdown use. `mint` is
              `tone.ts`'s "complete" and `sun` its "waiting", which is exactly
              what these two are.
            */}
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              <Legend tone="mint" label="Дууссан" value={assessed} />
              <Legend tone="sun" label="Хүлээгдэж буй" value={pending} />
            </ul>
          </div>
        </div>
      </TileShell>
    </section>
  );
}

function Legend({ tone, label, value }: { tone: "mint" | "sun"; label: string; value: number }) {
  return (
    <li className="flex items-center gap-1.5 text-caption text-muted">
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 rounded-pill ${tone === "mint" ? "bg-mint-ink" : "bg-sun-ink"}`}
      />
      {label}
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </li>
  );
}
