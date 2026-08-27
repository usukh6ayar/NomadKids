import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Eye, Megaphone } from "lucide-react";
import type { TeacherDashboard } from "@kinder/contracts";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
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
 *
 * ★★★★ **An empty board now renders, where it used to disappear — and that
 * reverses a decision this file argued for.**
 *
 * The old note read "an empty board is a new kindergarten, not a broken
 * screen", and returning `null` was the compact way to say nothing. Two things
 * overturned it. The section is one half of the communication band, so its
 * absence left the survey and the birthdays in a five-column strip beside 58%
 * of nothing — the exact hole the grid was restructured to remove. And a
 * teacher with an empty board is precisely the teacher who should be offered
 * the way to post the first notice; a section that vanishes offers nothing and
 * teaches nobody that the board exists.
 *
 * The empty state is two lines and an action on one row — not the product's
 * centred 96px mascot, which is right for a full page and would make the
 * emptiest card on the screen the tallest.
 */
export function ClassBoardNotice({ notice }: { notice: TeacherDashboard["boardNotice"] }) {
  return (
    <section aria-labelledby="class-board-heading">
      <SectionHeader
        id="class-board-heading"
        title="Ангийн самбар"
        lede={notice ? "Хамгийн сүүлд нийтэлсэн зарлал" : undefined}
        /*
          `icon-notice.webp` — the same drawing the parent's home page puts on
          its notice tile, so one feature has one face on both sides of the
          product. `IconChip` hides it from the accessibility tree; the heading
          is the name.
        */
        icon={
          <IconChip
            icon={<Image src="/icons/icon-notice.webp" alt="" width={48} height={48} />}
            tone="sky"
            size="lg"
          />
        }
        action={
          <Link
            href="/notifications"
            className="inline-flex min-h-[44px] items-center text-caption font-medium text-primary hover:underline"
          >
            Бүгдийг харах
          </Link>
        }
      />

      {notice ? (
        <Card pad="roomy">
          <Link href={`/notifications/${notice.id}`} className="group flex flex-col gap-2.5">
            {/*
              ★ No icon chip beside the title any more.

              The section header carries `icon-notice.webp` about forty pixels
              above this line, so a 32px lucide megaphone under it was the same
              idea twice in two different visual languages — the mixing §14
              warns about, inside one small component. The heading has the
              face; the notice has the words.
            */}
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-body font-semibold text-ink group-hover:underline md:text-lead">
                {notice.title}
              </h3>
              {/* The label carries the state; the tint only reinforces it. */}
              {notice.isImportant ? <Badge tone="peach">Чухал</Badge> : null}
            </div>

            <p className="whitespace-pre-wrap text-body text-muted">{excerpt(notice.body, 180)}</p>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-2.5 text-caption text-muted">
              <span>{notice.publishedAt ? formatDate(notice.publishedAt) : "—"}</span>
              {/*
                Read as "N people have opened this". The icon is decorative —
                the phrase carries it, because a bare number beside an eye is a
                puzzle to anyone who cannot see the eye.

                ★ A chip rather than a grey line: the read count is the one
                piece of feedback this widget exists to deliver, and it was the
                quietest text on the card.
              */}
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-canvas px-2.5 py-1">
                <Eye size={14} aria-hidden="true" />
                <span className="tabular-nums">{notice.readCount} хүн үзсэн</span>
              </span>
            </div>
          </Link>
        </Card>
      ) : (
        <Card pad="roomy" className="flex flex-wrap items-center gap-3">
          <IconChip icon={<Megaphone size={20} aria-hidden="true" />} tone="sky" size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium text-ink">Зарлал хараахан нийтлээгүй</p>
            <p className="text-caption text-muted">
              Ангийн самбарт бичсэн зарлал эцэг эхийн утсанд харагдана.
            </p>
          </div>
          <Link
            href="/notifications/new"
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 text-body font-medium text-primary hover:text-primary-strong"
          >
            Зарлал нийтлэх
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </Card>
      )}
    </section>
  );
}
