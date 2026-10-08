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
  active: "progress" | "results";
  /** Where each side lives when it is not a group's — the director's overview. */
  hrefs?: { progress: string; results: string };
}) {
  const items = [
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
      className="grid w-full grid-cols-2 gap-1 rounded-control bg-canvas p-1 sm:max-w-md"
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={cn(
            "flex min-h-[40px] items-center justify-center rounded-control px-2 text-body font-medium transition-colors",
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
