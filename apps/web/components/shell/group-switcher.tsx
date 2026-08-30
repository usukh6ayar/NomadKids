"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { z } from "zod";
import { groupListItemSchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { cn } from "@/lib/utils";

const groupsSchema = paginated(groupListItemSchema);

/** Every group in the kindergarten, for the switcher and the landing redirect. */
export function useSwitchableGroups(enabled = true) {
  return useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    // One key for all three registers, so switching from Ирц to Үнэлгээ for
    // the same group does not refetch the list of groups. It is also the key
    // the deleted `GroupPicker` used, which is why this reads from a warm
    // cache on the way in from anywhere that had already listed groups.
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Switching groups without leaving the register.
 *
 * ★ It replaces a whole screen, and that is the point.
 *
 * Ирц, Хоол ба цэс and Үнэлгээ were each two screens: a "which group?" page,
 * then the register. For a teacher with one group the first screen had exactly
 * one row — a click whose answer was never in doubt, every morning — and for a
 * director it was a menu they had to return to in order to look at a second
 * group, losing the date and the sitting they had chosen on the way.
 *
 * One screen with the groups along the top is what those two pages were trying
 * to be. The landing routes now resolve a group and go straight there, so the
 * picker page is gone rather than merely skipped.
 *
 * ★★ Links, not a `<select>` and not local state.
 *
 * The group is in the URL (`/groups/:id/attendance`), which is what makes a
 * register linkable — a director sends "look at Наран бүлэг today" as a URL,
 * and the back button walks the groups they looked at. A select that swapped
 * the data underneath one address would break both.
 *
 * ★★★ Renders nothing when there is one group.
 *
 * A switcher with a single option is a control that cannot do anything, which
 * is the same rule the sidebar and `Pagination` are held to. The group's name
 * is already in the page header.
 */
export function GroupSwitcher({
  groups,
  activeGroupId,
  href,
  className,
}: {
  groups: z.infer<typeof groupListItemSchema>[];
  activeGroupId: string;
  /** The same feature, for another group — `(id) => /groups/${id}/attendance`. */
  href: (groupId: string) => string;
  className?: string;
}) {
  if (groups.length < 2) return null;

  return (
    /*
      ★ Scrolls sideways rather than wrapping.

      A kindergarten with twelve groups would wrap to three rows above a
      register that is itself the page — the chrome would outgrow the content on
      a phone. One row that scrolls keeps the register where it was; the active
      chip is what tells a reader where they are in the row.

      `-mx-4 px-4` lets the row bleed to the screen edge inside a padded column,
      so a chip half off the edge reads as "there are more" instead of as a
      clipped card.
    */
    <nav
      aria-label="Бүлэг сонгох"
      className={cn("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}
    >
      <ul className="flex w-max gap-2">
        {groups.map((group) => {
          const active = group.id === activeGroupId;
          const children = group._count?.enrollments ?? 0;

          return (
            <li key={group.id}>
              <Link
                href={href(group.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // 44px, the tap floor `responsive.test.tsx` asserts for
                  // everything pressable in this product.
                  "flex min-h-11 items-center gap-2 rounded-pill border px-3.5 text-compact font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-ink"
                    : "border-border bg-surface text-muted hover:bg-canvas hover:text-ink",
                )}
              >
                <span className="whitespace-nowrap">{group.name}</span>
                {/*
                  The headcount is the second thing a reader wants from a group
                  name and the reason the old picker page had rows rather than
                  a dropdown. It stays, quietly.
                */}
                <span className={cn("tabular-nums", active ? "text-primary-ink/70" : "text-faint")}>
                  {children}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
