"use client";

import Link from "next/link";
import { Art } from "@/components/ui/art";
import { ArrowRight, Eye, Megaphone } from "lucide-react";
import { notificationSchema, type TeacherDashboard } from "@kinder/contracts";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { MediaThumb } from "@/components/media/media-image";
import { Badge } from "@/components/ui/badge";
import { BoardCard, BoardCardEmpty } from "./board-card";
import { excerpt, formatDate } from "@/lib/format";

/**
 * Сүүлийн нийтлэл — the latest notice, and whether it landed.
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
  /*
   * ★ One extra request, for the one thing `boardNotice` does not carry.
   *
   * `teacherDashboardSchema`'s projection is id, title, body, `publishedAt`,
   * `isImportant` and `readCount` — no media. The client's sketch puts a large
   * photograph on the right of this card, and the photographs exist: they are
   * on `notificationSchema.media`, which `GET /notifications/:id` returns.
   *
   * So it is fetched rather than faked, and it costs less than it looks:
   * `qk.notification(id)` is byte-identical to the key
   * `/notifications/[notificationId]` registers, so opening the notice this
   * card links to is a cache hit rather than a second round trip. `retry:
   * false` and no error branch — a missing photograph falls back to the
   * illustration below, which is not a reason to interrupt the dashboard.
   */
  const { data: full } = useQuery({
    queryKey: qk.notification(notice?.id ?? ""),
    queryFn: () => get(`/notifications/${notice!.id}`, notificationSchema),
    enabled: Boolean(notice?.id),
    staleTime: 60_000,
    retry: false,
  });

  const photo = full?.media[0] ?? null;

  return (
    /*
      ★ One card, titled inside it — no `SectionHeader` above, no icon chip, no
      "Бүгдийг харах" beside the heading.

      The sketch draws this as the screen's sixth white card: a small grey
      "Сүүлийн нийтлэл" label, the post's title under it, the date, the picture,
      and one row at the foot with the read count and an arrow. Everything the
      old header carried is in that: the arrow *is* "go to the board", and a
      second link three inches above it was two ways to the same place.
    */
    <BoardCard
      title="Сүүлийн нийтлэл"
      id="class-board-heading"
      footer={
        notice ? (
          /*
            ★ The read count is the point of the widget, and the arrow is the
            way in — one row, as the sketch draws it.

            A teacher who posts "ангийн хурал" wants to know it was seen, and
            until this card existed the only way to find out was to open the
            notice. Read as "N people have opened this": the eye is decorative
            and the phrase carries it, because a bare number beside an icon is a
            puzzle to anyone who cannot see the icon.

            The arrow is a real link with a real accessible name — never a bare
            "→", which a screen reader announces as "link, right arrow".
          */
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border-soft pt-3 text-caption text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Eye size={14} aria-hidden="true" />
              <span className="tabular-nums">{notice.readCount} хүн үзсэн</span>
            </span>
            <Link
              href="/notifications"
              aria-label="Бүх нийтлэлийг харах"
              className="grid size-11 -my-3 place-items-center rounded-control text-primary transition-colors hover:bg-canvas"
            >
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <div className="mt-3 border-t border-border-soft pt-3">
            <Link
              href="/notifications/new"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-body font-medium text-primary hover:text-primary-strong"
            >
              Зарлал нийтлэх
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        )
      }
    >
      {notice ? (
        <Link href={`/notifications/${notice.id}`} className="group flex flex-col gap-3">
          {/* The preview stays stacked at every width. In the dashboard's
              three-column band a side-by-side layout left the Mongolian title
              in a one-word-wide column; a shallow image followed by full-width
              text is both denser and easier to scan. */}
          {photo ? (
            <MediaThumb
              mediaId={photo.id}
              caption={photo.caption}
              className="aspect-[12/5] w-full rounded-row"
            />
          ) : (
            <div
              aria-hidden="true"
              className="grid aspect-[12/5] w-full place-items-center rounded-row bg-primary-soft"
            >
              <Art name="notice" size={72} />
            </div>
          )}

          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {/*
                ★ No title falls back to the opening of the body — the same
                thing the notifications list does, so one notice reads the same
                way in both places. An empty `<h3>` would leave the date and
                the "Чухал" badge floating under nothing.
              */}
              <h3 className="min-w-0 flex-1 text-lead font-semibold leading-heading text-ink group-hover:underline">
                {notice.title ?? excerpt(notice.body, 80)}
              </h3>
              {/* The label carries the state; the tint only reinforces it. */}
              {notice.isImportant ? <Badge tone="peach">Чухал</Badge> : null}
            </div>

            <p className="text-caption tabular-nums text-muted">
              {notice.publishedAt ? formatDate(notice.publishedAt) : "—"}
            </p>

            {/*
              The excerpt is `lg`-only. On a phone the sketch shows a title, a
              date and the picture — the body is what the post itself is for,
              and three lines of it above a photograph is the card growing into
              the feed it links to.
            */}
            <p className="line-clamp-2 whitespace-pre-wrap text-body leading-relaxed text-muted">
              {excerpt(notice.body, 180)}
            </p>
          </div>
        </Link>
      ) : (
        <BoardCardEmpty
          icon={<Megaphone size={22} />}
          title="Зарлал хараахан нийтлээгүй"
          hint="Ангийн самбарт бичсэн зарлал эцэг эхийн утсанд харагдана."
        />
      )}
    </BoardCard>
  );
}
