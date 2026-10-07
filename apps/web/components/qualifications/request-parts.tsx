import type { ReactNode } from "react";
import { formatDate, fullName } from "@/lib/format";
import { QUALIFICATION_STATUS_LABEL, type QualificationRequest } from "@/lib/qualifications";
import { cn } from "@/lib/utils";

/** A card's head: title and lede on the left, a count or a control on the right. */
export function SectionTop({
  title,
  lede,
  divided = true,
  children,
}: {
  title: string;
  lede: string;
  divided?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 px-4 py-4",
        divided && "border-b border-border-soft",
      )}
    >
      <div className="min-w-0">
        <h2 className="text-lead font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 text-body text-muted">{lede}</p>
      </div>
      {children}
    </div>
  );
}

/** One request: the name, «position · degree», and the date or the verdict. */
export function RequestRow({
  row,
  showStatus = false,
  showName = true,
  showDate = !showStatus,
  bordered = false,
}: {
  row: QualificationRequest;
  showStatus?: boolean;
  /** Off beside a verdict by default, as the design draws «Шийдвэрлэгдсэн». */
  showDate?: boolean;
  /** A teacher's own list names the degree, not themselves. */
  showName?: boolean;
  bordered?: boolean;
}) {
  const detail = [row.position, row.degree].filter(Boolean).join(" · ") || "—";
  return (
    <li
      className={cn(
        "flex items-start justify-between gap-3 rounded-card bg-surface px-4 py-3",
        bordered && "border border-border-soft",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-body font-semibold text-ink">
          {showName ? fullName(row.person) : (row.degree ?? "—")}
        </p>
        <p className="truncate text-body text-muted">{showName ? detail : (row.position ?? "—")}</p>
        {showDate ? (
          <p className="mt-1 text-caption tabular-nums text-muted">{formatDate(row.submittedAt)}</p>
        ) : null}
      </div>
      {showStatus ? (
        <span
          className={cn(
            "shrink-0 text-body",
            row.status === "REJECTED" ? "text-danger" : "text-ink",
          )}
        >
          {QUALIFICATION_STATUS_LABEL[row.status]}
        </span>
      ) : null}
    </li>
  );
}
