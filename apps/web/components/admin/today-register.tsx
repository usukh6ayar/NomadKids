"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { dailyAttendanceSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Art } from "@/components/ui/art";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";

/**
 * «Өнөөдрийн бүлгийн ирц» — every group, today, on the director's board.
 *
 * ★ Added 2026-09-26, after the ministry SIS dashboard, which opens on one row
 * per group for the day: how many came, how many are away and why, and whether
 * the register is filled in and sent. `/admin` already had today as one dial
 * and the last month as bars per group, which between them could not say
 * *which* group has not taken its register this morning — the one thing a
 * director acts on before nine.
 *
 * ★★ It is the daily register's own endpoint, for one day. `summariseDays`
 * already defines "recorded", "complete" and "sent" for `/attendance/daily`,
 * and a second definition on the board is how the two would come to disagree.
 * The query key is the register's too, so opening it for today is a cache hit.
 *
 * ★★★ No buttons. The client's 2026-09-04 rule for the director's register
 * holds here: the director reads, the teacher records. The group name opens
 * that group's day sheet, which is where a behind register is filled in.
 */
export function TodayRegister() {
  const { primaryKindergartenId } = useSession();
  const day = new Date().toISOString().slice(0, 10);
  const filters = { from: day, to: day };

  const daily = useQuery({
    queryKey: qk.attendanceDaily(primaryKindergartenId ?? "", filters),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/attendance/daily?${new URLSearchParams(filters)}`,
        dailyAttendanceSchema,
      ),
    enabled: Boolean(primaryKindergartenId),
  });

  return (
    <section aria-labelledby="today-register">
      <SectionHeader
        id="today-register"
        title="Өнөөдрийн бүлгийн ирц"
        action={
          <Link
            href={`/attendance/daily?from=${day}&to=${day}`}
            className="text-caption text-primary underline-offset-2 hover:underline"
          >
            Өдөр тутмын ирц
          </Link>
        }
        icon={<Art name="attendance" size={40} />}
      />

      {daily.isLoading ? <LoadingState rows={3} /> : null}
      {daily.isError ? <ErrorState description={errorMessage(daily.error)} /> : null}

      {daily.data && daily.data.items.length === 0 ? (
        <Card pad="roomy" className="text-body text-muted">
          Өнөөдөр ирц бүртгэх өдөр биш. Амралтын өдрүүдийг «Өдөр тутмын ирц» хэсгийн хуанлиас
          тохируулна.
        </Card>
      ) : null}

      {daily.data && daily.data.items.length > 0 ? (
        <TableShell caption="Өнөөдрийн бүлгийн ирц" minWidth="min-w-[560px]">
          <thead>
            <tr>
              <Th>Бүлэг</Th>
              <Th numeric>Ирсэн</Th>
              <Th numeric>Өвчтэй</Th>
              <Th numeric>Чөлөөтэй</Th>
              <Th numeric>Тасалсан</Th>
              <Th>Бүртгэл</Th>
            </tr>
          </thead>
          <tbody>
            {daily.data.items.map((row) => (
              <tr key={row.groupId}>
                <Td className="whitespace-nowrap font-medium">
                  <Link
                    href={`/groups/${row.groupId}/attendance?date=${row.date}`}
                    className="text-ink underline-offset-2 hover:text-primary hover:underline"
                  >
                    {row.group}
                  </Link>
                </Td>
                <Td numeric className="text-ink">
                  {row.present}
                  <span className="text-muted">/{row.expected}</span>
                </Td>
                <Td numeric className="text-muted">
                  {row.sick}
                </Td>
                <Td numeric className="text-muted">
                  {row.excused}
                </Td>
                <Td numeric className="text-muted">
                  {row.absent}
                </Td>
                <Td className="whitespace-nowrap">
                  {/*
                    ★ Three states, most urgent first. "N дутуу" names how far
                    off rather than a bare "Үгүй", because 1 missing and 20
                    missing are different mornings.
                  */}
                  {!row.complete ? (
                    <Badge tone="sun">{row.unrecorded} дутуу</Badge>
                  ) : row.sentAt ? (
                    <Badge tone="mint">Илгээсэн</Badge>
                  ) : (
                    <Badge tone="sky">Бүрэн</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      ) : null}
    </section>
  );
}
