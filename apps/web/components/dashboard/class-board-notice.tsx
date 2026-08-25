import Link from "next/link";
import { Eye, Megaphone } from "lucide-react";
import type { TeacherDashboard } from "@kinder/contracts";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { excerpt, formatDate } from "@/lib/format";

/**
 * Ангийн самбар — the latest notice, and whether it landed.
 *
 * ★ The read count is the point of the widget.
 *
 * A teacher who posts "ангийн хурал" wants to know it was seen, and until now
 * the only way to find out was to open the notice. `NotificationRead` has
 * always recorded it; this is the first screen to ask.
 *
 * ★★ A number, never a list of names.
 *
 * `notifications.repository.ts` refuses to expose who reacted — "a parent
 * should not learn which other families are reading the board" — and reads are
 * the same fact about the same people. The endpoint returns a count and no
 * identities, and a test asserts the response carries neither.
 *
 * ★★★ The body is an excerpt, and the card is a link.
 *
 * A notice can be several paragraphs. Rendering all of it would make the
 * dashboard's tallest element the one nobody came for, so it shows the opening
 * and sends you to the board for the rest.
 */
export function ClassBoardNotice({ notice }: { notice: TeacherDashboard["boardNotice"] }) {
  // Nothing published yet renders nothing — the same rule `ObservationMix`
  // follows. An empty board is a new kindergarten, not a broken screen.
  if (!notice) return null;

  return (
    <section aria-labelledby="class-board-heading">
      <SectionHeader
        id="class-board-heading"
        title="Ангийн самбар"
        action={
          <Link
            href="/notifications"
            className="inline-flex min-h-[44px] items-center text-caption font-medium text-primary hover:underline"
          >
            Бүгдийг харах
          </Link>
        }
      />

      <Card pad="roomy">
        <Link href={`/notifications/${notice.id}`} className="group flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-control bg-primary-soft text-primary">
              <Megaphone size={16} aria-hidden="true" />
            </span>
            <h3 className="min-w-0 flex-1 truncate text-body font-semibold text-ink group-hover:underline md:text-lead">
              {notice.title}
            </h3>
            {/* The label carries the state; the tint only reinforces it. */}
            {notice.isImportant ? <Badge tone="peach">Чухал</Badge> : null}
          </div>

          <p className="whitespace-pre-wrap text-body text-muted">{excerpt(notice.body, 180)}</p>

          <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted">
            <span>{notice.publishedAt ? formatDate(notice.publishedAt) : "—"}</span>
            {/*
              Read as "N people have opened this". The icon is decorative — the
              phrase carries it, because a bare number beside an eye is a puzzle
              to anyone who cannot see the eye.
            */}
            <span className="flex items-center gap-1.5">
              <Eye size={14} aria-hidden="true" />
              <span className="tabular-nums">{notice.readCount} хүн үзсэн</span>
            </span>
          </div>
        </Link>
      </Card>
    </section>
  );
}
