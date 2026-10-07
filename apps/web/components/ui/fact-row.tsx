import type { ReactNode } from "react";

/**
 * One «label | value» line of a person's or a place's card — the shape the
 * family's «Багш нар» cards use, shared since 2026-10-06 so a teacher's own
 * settings and their co-teacher's card read the same way (client: "эцэг эх
 * дээр харагддаг шиг").
 *
 * A hairline under every line but the last. Wrap the rows in a `<dl>`.
 */
export function FactRow({
  label,
  children,
  last = false,
}: {
  label: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-3 py-2 ${
        last ? "" : "border-b border-border-soft"
      }`}
    >
      <dt className="text-body text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-body font-medium text-ink">{children}</dd>
    </div>
  );
}
