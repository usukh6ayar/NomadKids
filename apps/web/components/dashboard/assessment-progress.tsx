import Link from "next/link";
import type { TeacherDashboard } from "@kinder/contracts";
import { ArrowRight } from "lucide-react";
import { BoardCard } from "./board-card";
import { percentOf } from "./percent";

/** The roster-level assessment completion shown in the teacher dashboard. */
export function AssessmentProgress({
  progress,
  href,
}: {
  progress: TeacherDashboard["termProgress"];
  href: string;
}) {
  const percent = percentOf(progress);
  const pending = Math.max(0, progress.total - progress.assessed);

  return (
    <BoardCard
      title="Явцын үнэлгээ"
      footer={
        <Link
          href={href}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-body font-medium text-primary hover:text-primary-strong"
        >
          Үнэлгээ оруулах
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      }
    >
      <div
        role="progressbar"
        aria-label="Улирлын үнэлгээний явц"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${progress.total} хүүхдээс ${progress.assessed} үнэлэгдсэн`}
      >
        <p className="font-semibold tabular-nums leading-none text-ink text-figure">
          {progress.assessed}
          <span className="text-display text-faint"> / {progress.total}</span>
        </p>
        <p className="mt-1 text-caption text-muted">хүүхэд үнэлэгдсэн</p>

        <div aria-hidden="true" className="mt-5 h-3 overflow-hidden rounded-pill bg-track">
          <div
            className="h-full rounded-pill bg-mint-ink transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-caption text-muted">
          <span>
            <span className="font-semibold tabular-nums text-ink">{progress.assessed}</span>{" "}
            бөглөсөн
          </span>
          <span>
            <span className="font-semibold tabular-nums text-ink">{pending}</span> дутуу
          </span>
          <span className="font-semibold tabular-nums text-primary">{percent}%</span>
        </div>
      </div>
    </BoardCard>
  );
}
