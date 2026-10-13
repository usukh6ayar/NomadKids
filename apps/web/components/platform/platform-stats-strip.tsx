import type { PlatformStats } from "@kinder/contracts";

/**
 * The platform's five figures in one hairline-divided strip — 2026-10-13, the
 * user: minimal, compact, formal. Shared by «Самбар» and «Цэцэрлэгүүд».
 */
export function PlatformStatsStrip({ stats }: { stats: PlatformStats }) {
  return (
    <section
      aria-label="Системийн товч мэдээлэл"
      className="grid grid-cols-2 overflow-hidden rounded-card border border-border bg-white sm:grid-cols-5 [&>div]:border-border-soft [&>div:not(:last-child)]:border-b sm:[&>div:not(:last-child)]:border-b-0 sm:[&>div:not(:last-child)]:border-r"
    >
      {[
        { label: "Цэцэрлэг", value: stats.kindergartens },
        { label: "Бүлэг", value: stats.groups },
        { label: "Хүүхэд", value: stats.children },
        { label: "Багш, ажилтан", value: stats.staff },
        { label: "Идэвхтэй эцэг эх", value: stats.guardians },
      ].map(({ label, value }) => (
        <div key={label} className="px-4 py-3">
          <p className="text-caption text-muted">{label}</p>
          <p className="mt-0.5 text-title font-bold tabular-nums text-ink">
            {value.toLocaleString("en-US")}
          </p>
        </div>
      ))}
    </section>
  );
}
