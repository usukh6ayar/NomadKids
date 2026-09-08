"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { groupSchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { CalendarCheck, ClipboardList, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
import { Art } from "@/components/ui/art";

const groupsSchema = paginated(groupSchema);

/**
 * The way into the attendance sheet, the meal register and assessment.
 *
 * ★ None of the three has a top-level menu item, because none can start without
 * a group — a menu entry would open a screen whose first act is to ask "which
 * group?". So the groups a teacher actually teaches are listed here, and each
 * one links straight into its day sheets and its assessment column.
 *
 * Without this `/groups/[groupId]/assessment`, `/groups/[groupId]/attendance`
 * and `/groups/[groupId]/meals` would be unreachable through the UI, which is
 * its own kind of dead route. `group-meals.test.ts` asserts the third link for
 * exactly that reason — the register shipped with a backend, a screen and no
 * way in would still look finished.
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
   * the information; "go and act on them" is — now three actions, attendance,
   * meals and assessment, since all three are real, recurring tasks that
   * start here (daily, per sitting, and quarterly respectively).
   *
   * So a single group collapses to its actions. The list survives for the
   * cases that are genuinely lists: an admin sees every group in the
   * kindergarten, and `TeacherAssignment` permits a teacher covering two. The
   * shape follows the data rather than an assumption about it — hard-coding
   * "always one" would hide a second group from whoever is covering it.
   */
  if (data.items.length === 1) {
    const group = data.items[0]!;

    return (
      /*
       * ★ It carries a heading now, and that is a consequence of where it
       * moved rather than a change of mind about headings.
       *
       * This used to sit in a 6/6 row beside the term's progress, which gave a
       * bare card the context a neighbour provides. The restructure put it at
       * the very foot of the page, below the observation feed — and there an
       * unlabelled strip reading "Дунд бүлэг" with three buttons is an orphan:
       * nothing above it says what it is for, and it follows a section that
       * has both a heading and a lede.
       *
       * The alternative was to drop it, and that is not available. It is the
       * only route to `/groups/:id/meals` anywhere in the product —
       * `group-meals.test.ts` asserts the link for exactly that reason, since
       * the meal register shipped with a backend, a screen and no way in.
       */
      <section aria-labelledby="group-actions-heading">
        <SectionHeader
          id="group-actions-heading"
          title="Бүлгийн бүртгэлүүд"
          lede="Өдөр тутмын ба улирлын бүртгэл рүү шууд."
        />
        <Card pad="roomy" className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{group.name}</p>
            <p className="text-body text-muted">Ирц, хоол бүртгэх, улирлын үнэлгээ хийх.</p>
          </div>
          {/* Wraps rather than pinning the card wide — three actions plus a
              group name do not fit one 390px line. */}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href={`/groups/${group.id}/attendance`}>
                <CalendarCheck size={18} />
                Ирц
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/groups/${group.id}/meals`}>
                <UtensilsCrossed size={18} />
                Хоол
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/groups/${group.id}/assessment`}>
                <ClipboardList size={18} />
                Үнэлгээ
              </Link>
            </Button>
          </div>
        </Card>
      </section>
    );
  }

  return (
    <section aria-label="Бүлгүүд">
      <SectionHeader
        title="Бүлгүүд"
        lede="Хариуцсан бүлгүүд, ирц болон үнэлгээ рүү шууд."
        icon={<IconChip icon={<Art name="group" />} tone="mint" size="lg" />}
      />
      <Card className="divide-y divide-border">
        {data.items.map((group) => (
          <div
            key={group.id}
            className="flex min-h-[56px] flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <span className="min-w-0 truncate font-medium text-ink">{group.name}</span>
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/groups/${group.id}/attendance`}
                className="shrink-0 text-body text-primary-strong hover:underline"
              >
                Ирц →
              </Link>
              <Link
                href={`/groups/${group.id}/meals`}
                className="shrink-0 text-body text-primary-strong hover:underline"
              >
                Хоол →
              </Link>
              <Link
                href={`/groups/${group.id}/assessment`}
                className="shrink-0 text-body text-primary-strong hover:underline"
              >
                Үнэлгээ →
              </Link>
            </div>
          </div>
        ))}
      </Card>
    </section>
  );
}
