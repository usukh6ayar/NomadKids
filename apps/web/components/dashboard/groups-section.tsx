"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { groupSchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";

const groupsSchema = paginated(groupSchema);

/**
 * The way into assessment.
 *
 * ★ Assessment has no top-level menu item, because it cannot start without a
 * group — a menu entry would open a screen whose first act is to ask "which
 * group?". So the groups a teacher actually teaches are listed here, and each
 * one is a direct link into its assessment column.
 *
 * Without this the `/groups/[groupId]/assessment` route would be unreachable
 * through the UI, which is its own kind of dead route.
 *
 * ★★ It fetches its own data, deliberately.
 *
 * `GET /dashboard/teacher` does not carry the group list, and widening that
 * response to serve one section would couple the dashboard endpoint to this
 * component's layout. A second query, cached under its own key, is the cheaper
 * coupling — and the same key is already used by the children screen's filter.
 */
export function GroupsSection() {
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.groups({ pageSize: 20 }),
    queryFn: () => get("/groups?page=1&pageSize=20", groupsSchema),
  });

  // A failure here is not worth an error block on the dashboard: the section is
  // a shortcut, and the same screens are reachable from Хүүхдүүд.
  if (isLoading || isError || !data || data.items.length === 0) return null;

  /*
   * ★ One group is not a list.
   *
   * A teacher here is responsible for a single group, so this section rendered
   * a heading, a supporting line and one row — three lines of chrome around one
   * link, naming a group the teacher already knows they teach. The name is not
   * the information; "go and assess them" is.
   *
   * So a single group collapses to the action itself. The list survives for the
   * cases that are genuinely lists: an admin sees every group in the
   * kindergarten, and `TeacherAssignment` permits a teacher covering two. The
   * shape follows the data rather than an assumption about it — hard-coding
   * "always one" would hide a second group from whoever is covering it.
   */
  if (data.items.length === 1) {
    const group = data.items[0]!;

    return (
      <section aria-label="Улирлын үнэлгээ">
        <Card pad="roomy" className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{group.name}</p>
            <p className="text-body text-muted">Улирлын үнэлгээ хийх.</p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/groups/${group.id}/assessment`}>
              <ClipboardList size={18} />
              Үнэлгээ
            </Link>
          </Button>
        </Card>
      </section>
    );
  }

  return (
    <section aria-label="Бүлгүүд">
      <SectionHeader title="Бүлгүүд" lede="Хариуцсан бүлгүүд, улирлын үнэлгээ рүү шууд." />
      <Card className="divide-y divide-border">
        {data.items.map((group) => (
          <Link
            key={group.id}
            href={`/groups/${group.id}/assessment`}
            className="flex min-h-[56px] items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-canvas md:px-4 md:py-3"
          >
            <span className="min-w-0 truncate font-medium text-ink">{group.name}</span>
            <span className="shrink-0 text-body text-primary-strong">Үнэлгээ →</span>
          </Link>
        ))}
      </Card>
    </section>
  );
}
