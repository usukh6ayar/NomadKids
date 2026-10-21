import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * «Явцын үнэлгээ» · «Үр дүнгийн үнэлгээ» — 2026-10-08, the client: the
 * result reading sits beside the progress one. Two routes rather than a tab in
 * state, so a result screen is linkable and Back walks between them.
 */
export function AssessmentSwitch({
  groupId,
  active,
  hrefs,
}: {
  groupId?: string;
  active: "baseline" | "progress" | "results";
  /** Where each side lives when it is not a group's — the director's overview. */
  hrefs?: { progress: string; results: string };
}) {
  const items = [
    /*
      «Гарааны үнэлгээ» first — 2026-10-21, the user: the year's order is
      Гарааны → Явцын → Үр дүнгийн. A group's only: the director's overview
      (`hrefs`) has no baseline of its own.
    */
    ...(hrefs
      ? []
      : [
          {
            key: "baseline",
            label: "Гарааны үнэлгээ",
            href: `/groups/${groupId}/baseline`,
          } as const,
        ]),
    {
      key: "progress",
      label: "Явцын үнэлгээ",
      href: hrefs?.progress ?? `/groups/${groupId}/assessment`,
    },
    {
      key: "results",
      label: "Үр дүнгийн үнэлгээ",
      href: hrefs?.results ?? `/groups/${groupId}/results`,
    },
  ] as const;
  return (
    <nav
      aria-label="Үнэлгээний төрөл"
      className={cn(
        "grid w-full gap-1 rounded-control bg-canvas p-1",
        items.length === 3 ? "grid-cols-3 sm:max-w-xl" : "grid-cols-2 sm:max-w-md",
      )}
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={cn(
            "flex min-h-[40px] items-center justify-center rounded-control px-2 text-center text-caption font-medium leading-tight transition-colors sm:text-body",
            active === item.key
              ? "bg-surface text-ink shadow-sm"
              : "text-muted hover:bg-surface/60 hover:text-ink",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
