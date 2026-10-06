"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Package, UtensilsCrossed } from "lucide-react";
import { z } from "zod";
import {
  MEAL_KIND_LABEL,
  cookDashboardSchema,
  mealKindSchema,
  menuDayWithWarningsSchema,
  stockLevelSchema,
  type CookDashboard,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { TodayAttendance } from "@/components/kitchen/today-attendance";
import { mediaUrl } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TableShell, Td, Th } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const weekSchema = z.array(menuDayWithWarningsSchema);
const levelsSchema = z.array(stockLevelSchema);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Тогоочийн самбар — the client's 2026-09-17 design.
 *
 * ★ One screen for the morning: how many children are here to cook for, what
 * today's menu is, what the store holds, and which groups have not said yet.
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
  const { primaryKindergartenId } = useSession();
  const date = today();

  const board = useQuery({
    queryKey: qk.dashboard.cook(),
    queryFn: () => get("/dashboard/cook", cookDashboardSchema),
  });

  /* Today's menu, from the screen the cook writes it on — one day's window. */
  const menu = useQuery({
    enabled: Boolean(primaryKindergartenId),
    queryKey: ["kitchen-board", "menu", primaryKindergartenId, date],
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/menu/with-warnings?from=${date}&to=${date}`,
        weekSchema,
      ),
  });

  const stock = useQuery({
    enabled: Boolean(primaryKindergartenId),
    queryKey: qk.kitchen.stock(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/stock`, levelsSchema),
  });

  const header = (
    <PageHeader
      title="Тогоочийн самбар"
      lede="Өнөөдрийн хоолны бэлтгэл, тараалт, нөөцийн мэдээлэл"
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
  const dishes = menu.data?.[0]?.dishes ?? [];

  return (
    <div className="page-band">
      {header}

      <div className="flex flex-col gap-2">
        <TodayAttendance data={data} />
        <GroupPortions groups={data.groups} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <TodayMenu dishes={dishes} loading={menu.isPending} />
        <StockPanel levels={stock.data ?? []} loading={stock.isPending} />
      </div>
    </div>
  );
}

/**
 * Today's menu, one card per sitting, each led by a photograph of its dish.
 *
 * ★ Read from the menu screen's own endpoint rather than copied onto the
 * dashboard payload: the cook writes it on `/menu` and reads it here, and two
 * sources for one day's dishes is how a board comes to show yesterday's soup.
 *
 * ★★ Pictures and no clock — client, 2026-10-06 ("хоолны цэс зурагтай
 * аятайхан", "цаггүй"). The photo is the first one the sitting's dishes carry
 * (the cook attaches it on `/menu`). A sitting with none gets a plate on a
 * tint, never a stock picture: an image of food nobody cooked is a menu that
 * lies, the same reason no stand-in faces are drawn elsewhere.
 */
function TodayMenu({
  dishes,
  loading,
}: {
  dishes: { name: string; kind?: string | null; photoMediaFileId?: string | null }[];
  loading: boolean;
}) {
  const sittings = mealKindSchema.options
    .map((kind) => {
      const rows = dishes.filter((dish) => dish.kind === kind);
      return {
        kind,
        label: MEAL_KIND_LABEL[kind] ?? kind,
        rows,
        photo: rows.find((dish) => dish.photoMediaFileId)?.photoMediaFileId ?? null,
      };
    })
    .filter((sitting) => sitting.rows.length > 0);

  return (
    <section aria-labelledby="today-menu" className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="today-menu" className="text-caption font-semibold text-muted">
          Өнөөдрийн цэс
        </h2>
        <Button size="sm" variant="ghost" asChild>
          <Link href="/menu">
            Цэс засах
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </Button>
      </div>

      {loading ? <LoadingState rows={2} /> : null}

      {!loading && sittings.length === 0 ? (
        <EmptyState
          title="Өнөөдрийн цэс оруулаагүй байна"
          description="Хоолны цэс рүү орж өнөөдрийн хоолыг бүртгэнэ үү."
        />
      ) : null}

      {sittings.length > 0 ? (
        /*
          A phone scrolls the sittings sideways, a card and a bit at a time;
          from `sm` they sit in a grid.
        */
        <ul className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 xl:grid-cols-4">
          {sittings.map((sitting) => (
            <li
              key={sitting.kind}
              aria-label={sitting.label}
              className="w-[42%] shrink-0 snap-start sm:w-auto"
            >
              <Card pad="none" className="flex h-full flex-col overflow-hidden">
                <DishPhoto mediaId={sitting.photo} alt={sitting.rows[0]?.name ?? sitting.label} />
                <div className="flex flex-col gap-0.5 px-2 py-1.5">
                  <span className="text-caption font-semibold leading-tight text-muted">
                    {sitting.label}
                  </span>
                  <ul className="flex flex-col">
                    {sitting.rows.map((dish, index) => (
                      <li
                        key={`${dish.name}-${index}`}
                        className="truncate text-caption font-medium leading-snug text-ink"
                      >
                        {dish.name}
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The sitting's photograph, or a plate on a tint when the cook attached none. */
function DishPhoto({ mediaId, alt }: { mediaId: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!mediaId || failed) {
    return (
      <div className="flex aspect-[16/10] w-full items-center justify-center bg-peach text-peach-ink">
        <UtensilsCrossed size={20} aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={mediaUrl(mediaId)}
      alt={alt}
      loading="lazy"
      className="aspect-[16/10] w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * The store, worst first.
 *
 * ★ Only ingredients with a threshold set can be "low" — `minStock` is opt-in
 * per ingredient (`stockLevelSchema.low`), so this panel never invents a
 * shortage for something nobody is tracking.
 */
function StockPanel({
  levels,
  loading,
}: {
  levels: { ingredient: { name: string; unit: string }; onHand: string; low: boolean }[];
  loading: boolean;
}) {
  const rows = [...levels].sort((a, b) => Number(b.low) - Number(a.low)).slice(0, 6);

  return (
    <section aria-labelledby="stock-panel" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="stock-panel" className="text-body font-semibold text-ink">
          Хүнсний нөөц
        </h2>
        <Button size="sm" variant="secondary" asChild>
          <Link href="/kitchen/stock">
            Бүгдийг харах
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </Button>
      </div>

      {loading ? <LoadingState rows={3} /> : null}

      {!loading && rows.length === 0 ? (
        <EmptyState
          title="Нөөцийн бүртгэл алга"
          description="Түүхий эд бүртгэсний дараа энд харагдана."
        />
      ) : null}

      {rows.length > 0 ? (
        <Card pad="none" className="divide-y divide-border-soft">
          {rows.map((level) => (
            <div key={level.ingredient.name} className="flex items-center gap-3 px-3.5 py-2.5">
              <Package size={16} aria-hidden="true" className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-body text-ink">
                {level.ingredient.name}
              </span>
              <span className="shrink-0 text-body font-semibold tabular-nums text-ink">
                {Number(level.onHand)} {level.ingredient.unit}
              </span>
              <Badge tone={level.low ? "sun" : "mint"}>
                {level.low ? "Нөөц бага" : "Хангалттай"}
              </Badge>
            </div>
          ))}
        </Card>
      ) : null}
    </section>
  );
}

/**
 * How many plates each group needs — the design's own table.
 *
 * ★ "Хоолох" is the present count, not the roster: a child who is not here
 * does not eat, and cooking to the roster is the waste this column exists to
 * stop. A group whose register is empty shows a dash rather than a zero,
 * because "nobody came" and "nobody said" are different mornings.
 */
/** The groups' table, one tight line a group. */
const CELL = "px-2.5 py-1.5 text-caption";

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
        <h2 id="group-portions" className="text-caption font-semibold text-muted">
          Бүлгүүдийн ирц
        </h2>
        <span className="text-caption tabular-nums text-muted">{groups.length} бүлэг</span>
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
                  <span aria-hidden="true" className="size-1.5 rounded-pill bg-current" />
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
