"use client";

import { useQuery } from "@tanstack/react-query";
import { cookDashboardSchema, type CookDashboard } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { TodayAttendance } from "@/components/kitchen/today-attendance";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { TableShell, Td, Th } from "@/components/ui/table";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Тогоочийн самбар — the client's 2026-09-17 design.
 *
 * ★ One screen for the morning: how many children are here to cook for and
 * which groups have not said yet. Today's menu and the store live on their own
 * screens since 2026-10-07, at the client's request.
 *
 * What it replaced answered two of those in three cards and sent the cook to
 * four other screens for the rest. The questions have not changed; what
 * changed is that they are all answered here, in the order the kitchen asks
 * them.
 *
 * ★★ Served, planned and expected are three different numbers and the screen
 * never blurs them:
 *
 *  - **Ирсэн** is the attendance register — children in the building.
 *  - **Тараасан порц** is the meal register — plates actually recorded.
 *  - **Нийт хүүхэд** is the roster — the denominator, not a plan.
 *
 * A kitchen that has cooked and a kitchen whose register is empty read
 * differently here, which is the whole point of separating them.
 */
export default function KitchenDashboardPage() {
  return (
    <RequireRole roles={["COOK", "ADMIN"]}>
      <KitchenDashboard />
    </RequireRole>
  );
}

function KitchenDashboard() {
  const date = today();

  const board = useQuery({
    queryKey: qk.dashboard.cook(),
    queryFn: () => get("/dashboard/cook", cookDashboardSchema),
  });

  const header = (
    <PageHeader
      title="Тогоочийн самбар"
      actions={
        <span className="inline-flex min-h-11 items-center rounded-pill bg-canvas px-4 text-body font-medium tabular-nums text-ink">
          {formatDate(date)}
        </span>
      }
    />
  );

  if (board.isLoading) {
    return (
      <div className="page-band">
        {header}
        <LoadingState rows={4} />
      </div>
    );
  }

  if (board.isError || !board.data) {
    return (
      <div className="page-band">
        {header}
        <ErrorState
          description={errorMessage(board.error)}
          action={
            <Button variant="secondary" onClick={() => void board.refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      </div>
    );
  }

  const data = board.data;

  return (
    <div className="page-band">
      {header}

      {/* «Өнөөдрийн цэс» and «Хүнсний нөөц» left the board — client, 2026-10-07. */}
      <div className="flex flex-col gap-2">
        <TodayAttendance data={data} />
        <GroupPortions groups={data.groups} />
      </div>
    </div>
  );
}

/** The groups' table, one tight line a group. */
const CELL = "px-3 py-2.5 text-body";

function GroupPortions({ groups }: { groups: CookDashboard["groups"] }) {
  if (groups.length === 0) return null;

  const totals = groups.reduce(
    (sum, group) => ({
      enrolled: sum.enrolled + group.enrolled,
      present: sum.present + group.present,
    }),
    { enrolled: 0, present: 0 },
  );

  return (
    <section aria-labelledby="group-portions" className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="group-portions" className="text-lead font-semibold text-ink">
          Бүлгүүдийн ирц
        </h2>
        <span className="text-body tabular-nums text-muted">{groups.length} бүлэг</span>
      </div>

      {/*
        Not stacked, on purpose — client, 2026-10-06: "бүр жижиг цэгцтэй".
        Four short columns fit a phone, and a stacked table turns each group
        into a card of its own. «Хоолох» was dropped: it printed the same
        number as «Ирсэн» on every row.
      */}
      <TableShell caption="Бүлгүүдийн ирц" minWidth="min-w-0">
        <thead>
          <tr>
            <Th className={CELL}>Бүлэг</Th>
            <Th className={CELL} numeric>
              Нийт
            </Th>
            <Th className={CELL} numeric>
              Ирсэн
            </Th>
            <Th className={CELL}>Төлөв</Th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.groupId}>
              <Td className={CELL}>{group.name}</Td>
              <Td className={CELL} numeric>
                {group.enrolled}
              </Td>
              <Td className={CELL} numeric>
                {group.recorded === 0 ? "—" : group.present}
              </Td>
              <Td className={CELL}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1",
                    group.recorded === 0 ? "text-sun-ink" : "text-mint-ink",
                  )}
                >
                  <span aria-hidden="true" className="size-2 rounded-pill bg-current" />
                  {group.recorded === 0 ? "Ирц дутуу" : "Бэлэн"}
                </span>
              </Td>
            </tr>
          ))}
          <tr className="font-semibold">
            <Td className={CELL}>Нийт</Td>
            <Td className={CELL} numeric>
              {totals.enrolled}
            </Td>
            <Td className={CELL} numeric>
              {totals.present}
            </Td>
            <Td className={CELL} />
          </tr>
        </tbody>
      </TableShell>
    </section>
  );
}
