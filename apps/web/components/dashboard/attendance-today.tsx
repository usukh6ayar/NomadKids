"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardCheck, CloudOff, Users } from "lucide-react";
import Link from "next/link";
import { groupAttendanceRowSchema } from "@kinder/contracts";
import { z } from "zod";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/states";
import { BoardCard, BoardCardEmpty } from "./board-card";
import { useMyGroup } from "./use-my-group";
import { Ring } from "@/components/ui/chart/ring";

const daySheetSchema = z.array(groupAttendanceRowSchema);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Today's attendance — the sketch's bold top-left tile, "Өнөөдрийн ирц 30/35".
 *
 * ★ Held out of this screen three times (2026-08-22/23/24) for one stated
 * reason: "there is no model, no migration and no endpoint anywhere in the
 * API". That stopped being true on 2026-08-25, when CLAUDE.md §7 pulled RFP
 * Module 2 into scope and `Attendance`, `GET /groups/:id/attendance` and the
 * day sheet shipped. The figure is now read from that endpoint, not invented.
 *
 * ★★ The numerator is a decision, and it is written down here because the card
 * is meaningless without it.
 *
 * `PRESENT + HALF_DAY` counts as attending. A child who came for the morning
 * was at the kindergarten, and a register that files them with the absent
 * children is wrong in the direction that matters — a teacher scanning for who
 * is missing would go looking for a child who is asleep in the next room. They
 * are counted whole rather than as 0.5: this tile answers "who is here", not
 * "what may be claimed", and the funding calculation deliberately keeps its own
 * per-status breakdown for the second question.
 *
 * `EXCUSED`, `SICK` and `ABSENT` are all "not here" for this figure, and the
 * breakdown underneath keeps them apart so the one number never has to carry
 * three meanings.
 *
 * ★★★ "Nobody has marked the register yet" is its own state, not 0%.
 *
 * A day sheet returns every enrolled child with `record: null` until someone
 * marks them, so at 8am a naive present/total renders 0/35 — an alarming red
 * figure whose real meaning is "the register is not filled in". That case gets
 * its own copy and its own tint, and the call to action is the register itself.
 *
 * ★★★★ A plain white `BoardCard` since 2026-08-28 — no illustration, no wash,
 * no footer link.
 *
 * It was a `feature` `TileShell`: `icon-attendance.png` in a 48px chip, the
 * whole card washed `sky` (or `sun` before the register was marked) and a
 * filled "Ирц бүртгэх" button at the foot. Each of those was doing real work in
 * a band of four differently-sized tiles — they ranked this one above its
 * neighbours. The client's dashboard has no such hierarchy to express: six
 * white cards, plain dark titles, and the only colour on the screen in the data
 * itself. See `board-card.tsx`.
 *
 * ★★★★★ The register link went with them, and that is the one removal with a
 * consequence outside this file. `/groups/:id/attendance` was reachable from
 * here, from `QuickLinks` and from `GroupsSection`, and this pass took all
 * three off the dashboard — so the route now lives in the sidebar's own
 * "Бүлгийн бүртгэл" section (`app/(app)/layout.tsx`) rather than nowhere.
 */
export function AttendanceToday() {
  const { group, isLoading: groupLoading, isError: groupError } = useMyGroup();
  const date = todayIso();

  const {
    data,
    isLoading: sheetLoading,
    isError: sheetError,
  } = useQuery({
    queryKey: qk.groupAttendance(group?.id ?? "", date),
    queryFn: () => get(`/groups/${group!.id}/attendance?date=${date}`, daySheetSchema),
    // The group id arrives from a separate request; without this the query
    // fires once against `/groups//attendance` and 404s before it can succeed.
    enabled: Boolean(group?.id),
  });

  if (groupLoading || (Boolean(group?.id) && sheetLoading)) return <AttendanceSkeleton />;

  /*
   * No group, or the sheet failed. Both render the same quiet tile rather than
   * an alert: this is one tile in a row of four, and an error block here would
   * shout louder than every section that loaded correctly. The other tiles
   * still answer their own questions.
   */
  if (groupError || sheetError || !group || !data) {
    return (
      <BoardCard title="Өнөөдрийн ирц">
        <BoardCardEmpty
          icon={<CloudOff size={22} />}
          title="Ирцийн мэдээлэл алга"
          hint={group ? "Дахин ачаалж үзнэ үү." : "Бүлэг хуваарилагдаагүй байна."}
        />
      </BoardCard>
    );
  }

  const total = data.length;
  const marked = data.filter((row) => row.record).length;
  const present = data.filter(
    (row) => row.record?.status === "PRESENT" || row.record?.status === "HALF_DAY",
  ).length;

  const sick = data.filter((row) => row.record?.status === "SICK").length;
  const excused = data.filter((row) => row.record?.status === "EXCUSED").length;
  const absent = data.filter((row) => row.record?.status === "ABSENT").length;

  const percent = total === 0 ? 0 : Math.round((present / total) * 100);
  const unmarked = total - marked;

  /* An empty roster is not 0% attendance — there is nobody to be absent. */
  if (total === 0) {
    return (
      <BoardCard title="Өнөөдрийн ирц">
        <BoardCardEmpty
          icon={<Users size={22} />}
          title="Бүлэгт хүүхэд бүртгэлгүй"
          hint="Хүүхэд бүртгэсний дараа ирц харагдана."
        />
      </BoardCard>
    );
  }

  const nothingMarked = marked === 0;

  return (
    <BoardCard
      title="Өнөөдрийн ирц"
      /*
        ★ The way into the register, back on the card — 2026-08-29.

        The link came off when this became a plain `BoardCard`, and the state
        that most needs it is the one where the card says "Бүртгээгүй байна · 5
        хүүхэд бүртгэхийг хүлээж байна" — a sentence that names a task and then
        offers no way to do it. It is the most useful control on the screen at
        8am and it was a dead end.

        Filled while the register is empty, quiet once it is done: marking the
        register is the one thing this card exists to prompt, and after it is
        filled the same destination is reference rather than a task competing
        with the rest of the dashboard.
      */
      footer={
        nothingMarked ? (
          <Button asChild size="sm" className="w-full">
            <Link href={`/groups/${group.id}/attendance`}>
              <ClipboardCheck size={16} aria-hidden="true" />
              Ирц бүртгэх
            </Link>
          </Button>
        ) : (
          <Link
            href={`/groups/${group.id}/attendance`}
            className="inline-flex min-h-[44px] items-center gap-1.5 text-body font-medium text-primary hover:text-primary-strong"
          >
            Ирцийн бүртгэл
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        )
      }
    >
      {/*
        ★ Ring, then the fraction — the sketch's own arrangement, and the
        reason the card carries no wash or chip any more. See `board-card.tsx`.

        `flex-col` below `sm`, because the two cards in this row share a 375px
        screen: each is about 168px wide, and a 96px dial plus "30/35" at
        `text-figure` beside it does not fit. Stacked they both do, and from
        `sm` the row is the sketch's.
      */}
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-4 md:gap-5">
        {/*
          ★ `mint`, not the brand blue this drew until 2026-08-28.

          The client's dashboard shows the attendance dial in green, and green
          is what this figure means in `tone.ts`'s vocabulary — `mint` is
          documented there as "positive, completed, healthy", which is exactly
          what a full register is. The arc is a graphic fill and never carries
          text (the percentage sits in the hole, in `--color-ink` on
          `--color-surface`), so the floor it must clear is 3:1, not 4.5:1.

          `muted` still wins: an unmarked register draws a flat grey track,
          because a green ring at 0% would read as "0% attended" rather than as
          "nobody has filled this in".
        */}
        <Ring percent={percent} size="lg" tone="mint" muted={nothingMarked} />

        <div className="min-w-0 text-center sm:text-left">
          {nothingMarked ? (
            <>
              <p className="text-lead font-semibold leading-heading text-ink">Бүртгээгүй байна</p>
              <p className="mt-0.5 text-caption text-muted">
                {total} хүүхэд бүртгэхийг хүлээж байна
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold tabular-nums leading-none text-ink text-figure">
                {present}
                <span className="text-display text-faint"> / {total}</span>
              </p>
              <p className="mt-1 text-caption text-muted">ирцтэй</p>
            </>
          )}
        </div>
      </div>

      {/*
        The breakdown, only when there is one. Three zeroes under a full
        register is noise; a sick child is the thing a teacher acts on.

        ★ The card is white now rather than washed, so these could have gone
        back to bare dotted text — they stay as pills because the dot alone was
        never the signal: `--color-muted` measures under 4.5:1 on every one of
        the six accents (`tone.ts`), and the pill is what keeps the label on
        `bg-surface` where the grey is the 4.76:1 it was measured at.
      */}
      {!nothingMarked && (sick > 0 || excused > 0 || absent > 0 || unmarked > 0) ? (
        <ul className="mt-3.5 flex flex-wrap justify-center gap-1.5 sm:justify-start">
          {sick > 0 ? <Tally tone="peach" label="Өвчтэй" value={sick} /> : null}
          {excused > 0 ? <Tally tone="sun" label="Чөлөөтэй" value={excused} /> : null}
          {absent > 0 ? <Tally tone="danger" label="Тасалсан" value={absent} /> : null}
          {unmarked > 0 ? <Tally tone="track" label="Бүртгээгүй" value={unmarked} /> : null}
        </ul>
      ) : null}
    </BoardCard>
  );
}

const TALLY_TONE = {
  peach: "bg-peach",
  sun: "bg-sun",
  danger: "bg-danger",
  track: "bg-track border border-border",
} as const;

/** One status in the breakdown. The dot is decoration; the label carries it. */
function Tally({
  tone,
  label,
  value,
}: {
  tone: keyof typeof TALLY_TONE;
  label: string;
  value: number;
}) {
  return (
    <li className="flex items-center gap-1.5 rounded-pill border border-border bg-surface px-2.5 py-1 text-caption text-muted">
      <span aria-hidden="true" className={`size-2 rounded-pill ${TALLY_TONE[tone]}`} />
      {label}
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </li>
  );
}

/**
 * The skeleton mirrors the tile it replaces — chip, label, dial, figure, action.
 *
 * A generic run of grey bars would collapse to a different height and shove the
 * three tiles beside it down the moment this one resolved.
 */
function AttendanceSkeleton() {
  return (
    <Card pad="roomy" className="flex h-full flex-col gap-3">
      <Skeleton className="h-4 w-28" />
      <div className="flex flex-1 flex-col items-center gap-3 sm:flex-row sm:gap-4 md:gap-5">
        <Skeleton className="size-24 shrink-0 rounded-pill" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    </Card>
  );
}
