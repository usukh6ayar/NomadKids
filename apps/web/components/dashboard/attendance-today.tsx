"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ClipboardCheck, CloudOff, Users } from "lucide-react";
import { groupAttendanceRowSchema } from "@kinder/contracts";
import { z } from "zod";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/states";
import { TileShell } from "./tile-shell";
import { useMyGroup } from "./use-my-group";
import { Ring } from "@/components/ui/chart/ring";

const daySheetSchema = z.array(groupAttendanceRowSchema);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The register's face — the product's own illustration, not a lucide glyph.
 *
 * ★ `/home` already gives this drawing to the parent's attendance tile, so a
 * teacher and a parent now recognise the same feature by the same picture.
 * `alt=""` because the label beside it says "Өнөөдрийн ирц"; `IconChip` sizes
 * it to the chip and hides it from the accessibility tree.
 */
const ATTENDANCE_ART = <Image src="/icons/icon-attendance.webp" alt="" width={48} height={48} />;

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
 * ★★★★ It is a `feature` tile now, and it owns a column rather than a quarter
 * of a row.
 *
 * The four-across row gave the register the same 250px as the sex split, so the
 * one figure a teacher opens this screen for was the same size as a piece of
 * demographic context. It takes the wider half of the "today" band instead,
 * with a `lg` ring, `icon-attendance.webp` for its identity and the `sky` wash
 * — three things that rank it above its neighbours without changing what it
 * says. The illustration is the reason the chip is `lg`: at 40px the drawing is
 * a smudge, and `IconChip` sizes a `.webp` to the chip.
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
      <TileShell icon={ATTENDANCE_ART} size="feature" label="Өнөөдрийн ирц">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-16 shrink-0 place-items-center rounded-pill bg-track text-faint"
          >
            <CloudOff size={22} />
          </span>
          <div className="min-w-0">
            <p className="text-lead font-medium text-ink">Ирцийн мэдээлэл алга</p>
            <p className="mt-0.5 text-caption text-muted">
              {group ? "Дахин ачаалж үзнэ үү." : "Бүлэг хуваарилагдаагүй байна."}
            </p>
          </div>
        </div>
      </TileShell>
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
      <TileShell icon={ATTENDANCE_ART} size="feature" label="Өнөөдрийн ирц">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-16 shrink-0 place-items-center rounded-pill bg-track text-faint"
          >
            <Users size={22} />
          </span>
          <div className="min-w-0">
            <p className="text-lead font-medium text-ink">Бүлэгт хүүхэд бүртгэлгүй</p>
            <p className="mt-0.5 text-caption text-muted">Хүүхэд бүртгэсний дараа ирц харагдана.</p>
          </div>
        </div>
      </TileShell>
    );
  }

  const nothingMarked = marked === 0;

  return (
    <TileShell
      icon={ATTENDANCE_ART}
      size="feature"
      surface
      label="Өнөөдрийн ирц"
      tone={nothingMarked ? "sun" : "sky"}
      footer={
        /*
          ★ The action is a filled button when the register is empty and a
          quiet link once it is done.

          Marking the register is the one thing this tile exists to prompt, and
          before 9am it is the most useful control on the screen. After it is
          filled the same destination is still worth offering, but it is
          reference rather than a task — a second primary button competing with
          the rest of the dashboard for attention it no longer needs.
        */
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
            className="inline-flex items-center gap-1.5 text-body font-medium text-primary hover:text-primary-strong"
          >
            Ирцийн бүртгэл
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        )
      }
    >
      <div className="flex items-center gap-4 md:gap-5">
        {/*
          ★ `lg`, and the percentage lives inside it rather than beside it.

          At `md` the dial was 64px next to a 34px numeral, so the chart was the
          smaller of the two things saying the same thing. At `lg` it is 96px
          and reads as the figure of the card — which is what "make the visual
          hierarchy immediately understandable" comes down to here. It stays
          `aria-hidden` (no `label`): the count and the share are both on the
          card as text, and a ring that re-announces them is noise.
        */}
        <Ring percent={percent} size="lg" muted={nothingMarked} />

        <div className="min-w-0">
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
                <span className="text-display text-faint">/{total}</span>
              </p>
              <p className="mt-1 text-caption text-muted">ирсэн · хагас өдөр</p>
            </>
          )}
        </div>
      </div>

      {/*
        The breakdown, only when there is one. Three zeroes under a full
        register is noise; a sick child is the thing a teacher acts on.

        ★ Chips on a white ground, not bare dotted text. The card carries a
        tint now, and `--color-muted` measures under the 4.5:1 floor on every
        one of the six accents (`tone.ts`) — so the statuses sit on their own
        `bg-surface` pills, where the grey is the 4.76:1 it was measured at.
      */}
      {!nothingMarked && (sick > 0 || excused > 0 || absent > 0 || unmarked > 0) ? (
        <ul className="mt-3.5 flex flex-wrap gap-1.5">
          {sick > 0 ? <Tally tone="peach" label="Өвчтэй" value={sick} /> : null}
          {excused > 0 ? <Tally tone="sun" label="Чөлөөтэй" value={excused} /> : null}
          {absent > 0 ? <Tally tone="danger" label="Тасалсан" value={absent} /> : null}
          {unmarked > 0 ? <Tally tone="track" label="Бүртгээгүй" value={unmarked} /> : null}
        </ul>
      ) : null}
    </TileShell>
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
      <div className="flex items-center gap-2.5 md:gap-3">
        <Skeleton className="size-12 shrink-0 rounded-card" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="flex flex-1 items-center gap-4 md:gap-5">
        <Skeleton className="size-24 shrink-0 rounded-pill" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="mt-auto border-t border-border-soft pt-2.5">
        <Skeleton className="h-4 w-32" />
      </div>
    </Card>
  );
}
