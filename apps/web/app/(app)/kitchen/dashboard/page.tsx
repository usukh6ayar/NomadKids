"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  HeartPulse,
  Package,
  UtensilsCrossed,
} from "lucide-react";
import { z } from "zod";
import {
  MEAL_KIND_LABEL,
  cookDashboardSchema,
  mealKindSchema,
  menuDayWithWarningsSchema,
  stockLevelSchema,
  type CookDashboard,
  localDate,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
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
import { formatDate, capitalize, groupLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const weekSchema = z.array(menuDayWithWarningsSchema);
const levelsSchema = z.array(stockLevelSchema);

function today(): string {
  return localDate();
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
  const lowStock = (stock.data ?? []).filter((level) => level.low);

  return (
    <div className="page-band">
      {header}

      <TodayFigures data={data} lowStock={lowStock.length} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <TodayMenu dishes={dishes} loading={menu.isPending} />
        <StockPanel levels={stock.data ?? []} loading={stock.isPending} />
      </div>

      <GroupPortions groups={data.groups} />
    </div>
  );
}

/**
 * The four figures the morning turns on.
 *
 * ★ The attendance card carries its own warning rather than a separate banner:
 * "18 of 20 groups have said" is the same fact as "2 have not", and a cook
 * reading the first wants the second in the same breath.
 */
function TodayFigures({ data, lowStock }: { data: CookDashboard; lowStock: number }) {
  const { attendanceToday, groups, meals } = data;
  const percent =
    attendanceToday.expected > 0
      ? Math.round((attendanceToday.present / attendanceToday.expected) * 100)
      : 0;

  const withRegister = groups.filter((group) => group.recorded > 0).length;
  const missing = groups.filter((group) => group.recorded === 0);

  const byKind = new Map(meals.byKind.map((row) => [row.kind, row.portions]));

  /*
    Every alert is a fact this payload already carries — nothing here is
    computed from a guess, and a kitchen with nothing outstanding gets no list
    rather than a reassuring sentence.
  */
  const alerts = [
    missing.length > 0 ? `${missing.length} бүлэг ирцээ оруулаагүй байна` : null,
    lowStock > 0 ? `${lowStock} төрлийн орцын нөөц бага` : null,
    data.pendingFoodOrders > 0
      ? `${data.pendingFoodOrders} хүнсний захиалга хүлээгдэж байна`
      : null,
    meals.allergyChildren > 0 ? `Харшилтай ${meals.allergyChildren} хүүхэд` : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <section aria-label="Өнөөдрийн дүн" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card pad="compact" className="flex flex-col gap-2">
        <span className="flex items-center gap-2">
          <Chip tone="mint">
            <ClipboardList size={18} aria-hidden="true" />
          </Chip>
          <span className="text-caption font-medium text-muted">Өнөөдөр хоолох хүүхэд</span>
        </span>

        <span className="flex items-baseline gap-1.5">
          <span className="text-figure font-bold tabular-nums leading-none text-ink">
            {attendanceToday.present}
          </span>
          <span className="text-body tabular-nums text-muted">/ {attendanceToday.expected}</span>
        </span>

        <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-pill bg-track">
          <span
            className="block h-full rounded-pill bg-mint-ink"
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </span>

        <span className="text-caption text-muted">
          {groups.length} бүлгээс {withRegister} бүлгийн ирц бүртгэгдсэн
        </span>

        {missing.length > 0 ? (
          <span className="flex items-start gap-1.5 rounded-row bg-sun/30 px-2.5 py-1.5 text-caption text-ink">
            <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-sun-ink" />
            {missing.length} бүлэг ирцээ оруулаагүй байна
          </span>
        ) : null}
      </Card>

      <Card pad="compact" className="flex flex-col gap-2">
        <span className="flex items-center gap-2">
          <Chip tone="sky">
            <UtensilsCrossed size={18} aria-hidden="true" />
          </Chip>
          <span className="text-caption font-medium text-muted">Тараасан порц</span>
        </span>

        <span className="flex items-baseline gap-1.5">
          <span className="text-figure font-bold tabular-nums leading-none text-ink">
            {meals.served}
          </span>
          <span className="text-body text-muted">порц</span>
        </span>

        {/*
          ★ The register's own figure, and it says so. A portion count taken
          from the roster would be what the kitchen *plans*; this is what was
          recorded as served, and before a teacher fills the register in it is
          honestly zero rather than optimistically the roster.
        */}
        <span className="text-caption text-muted">
          {mealKindSchema.options
            .filter((kind) => (byKind.get(kind) ?? 0) > 0)
            .map((kind) => `${MEAL_KIND_LABEL[kind]} ${byKind.get(kind)}`)
            .join(" · ") || "Хоолны бүртгэл хараахан хийгдээгүй"}
        </span>
      </Card>

      <Card pad="compact" className="flex flex-col gap-2">
        <span className="flex items-center gap-2">
          <Chip tone="peach">
            <HeartPulse size={18} aria-hidden="true" />
          </Chip>
          <span className="text-caption font-medium text-muted">Тусгай хоол</span>
        </span>

        <dl className="flex flex-col gap-1 text-caption">
          <Row label="Харшилтай" value={meals.allergyChildren} />
          <Row label="Тусгай хоол" value={meals.special} />
          <Row label="Хоолноос чөлөөлсөн" value={meals.excused} />
        </dl>

        <Link
          href="/kitchen/attendance"
          className="inline-flex items-center gap-1 text-caption font-medium text-primary hover:underline"
        >
          Жагсаалт харах
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </Card>

      <Card pad="compact" className="flex flex-col gap-2">
        <span className="flex items-center gap-2">
          <Chip tone="sun">
            <AlertTriangle size={18} aria-hidden="true" />
          </Chip>
          <span className="text-caption font-medium text-muted">Анхаарах зүйлс</span>
        </span>

        {alerts.length === 0 ? (
          <span className="flex items-center gap-1.5 text-caption text-mint-ink">
            <CheckCircle2 size={14} aria-hidden="true" />
            Бэлтгэл бүрэн
          </span>
        ) : (
          <ul className="flex flex-col gap-1">
            {alerts.map((line) => (
              <li key={line} className="flex items-start gap-1.5 text-caption text-ink">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-1.5 shrink-0 rounded-pill bg-sun-ink"
                />
                {line}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function Chip({ tone, children }: { tone: "mint" | "sky" | "peach" | "sun"; children: ReactNode }) {
  const tones = {
    mint: "bg-mint text-mint-ink",
    sky: "bg-sky text-sky-ink",
    peach: "bg-peach text-peach-ink",
    sun: "bg-sun text-sun-ink",
  } as const;

  return (
    <span
      aria-hidden="true"
      className={cn("grid size-9 shrink-0 place-items-center rounded-card", tones[tone])}
    >
      {children}
    </span>
  );
}

/**
 * Today's menu, one card per sitting.
 *
 * ★ Read from the menu screen's own endpoint rather than copied onto the
 * dashboard payload: the cook writes it on `/menu` and reads it here, and two
 * sources for one day's dishes is how a board comes to show yesterday's soup.
 */
function TodayMenu({
  dishes,
  loading,
}: {
  dishes: { name: string; kind?: string | null; time?: string | null }[];
  loading: boolean;
}) {
  const sittings = mealKindSchema.options
    .map((kind) => ({
      kind,
      label: MEAL_KIND_LABEL[kind],
      rows: dishes.filter((dish) => dish.kind === kind),
    }))
    .filter((sitting) => sitting.rows.length > 0);

  return (
    <section aria-labelledby="today-menu" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="today-menu" className="text-body font-semibold text-ink">
          Өнөөдрийн цэс
        </h2>
        <Button size="sm" variant="secondary" asChild>
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
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {sittings.map((sitting) => (
            <Card key={sitting.kind} pad="compact" className="flex flex-col gap-1.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-body font-semibold text-ink">{sitting.label}</span>
                {sitting.rows[0]?.time ? (
                  <span className="text-caption tabular-nums text-muted">
                    {sitting.rows[0].time}
                  </span>
                ) : null}
              </span>

              <ul className="flex flex-col gap-0.5">
                {sitting.rows.map((dish, index) => (
                  <li key={`${dish.name}-${index}`} className="text-caption text-ink">
                    · {capitalize(dish.name)}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : null}
    </section>
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
                {capitalize(level.ingredient.name)}
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
    <section aria-labelledby="group-portions" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="group-portions" className="text-body font-semibold text-ink">
          Бүлгүүдийн хоолны тоо
        </h2>
        <span className="text-caption tabular-nums text-muted">{groups.length} бүлэг</span>
      </div>

      <TableShell caption="Бүлгүүдийн хоолны тоо" stacked minWidth="min-w-0">
        <thead>
          <tr>
            <Th>Бүлгийн нэр</Th>
            <Th numeric>Нийт хүүхэд</Th>
            <Th numeric>Өнөөдөр ирсэн</Th>
            <Th numeric>Хоолох</Th>
            <Th>Төлөв</Th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.groupId}>
              <Td data-label="Бүлгийн нэр">{groupLabel(group.name)}</Td>
              <Td data-label="Нийт хүүхэд" numeric>
                {group.enrolled}
              </Td>
              <Td data-label="Өнөөдөр ирсэн" numeric>
                {group.recorded === 0 ? "—" : group.present}
              </Td>
              <Td data-label="Хоолох" numeric>
                {group.recorded === 0 ? "—" : group.present}
              </Td>
              <Td data-label="Төлөв">
                <Badge tone={group.recorded === 0 ? "sun" : "mint"}>
                  {group.recorded === 0 ? "Ирц дутуу" : "Бэлэн"}
                </Badge>
              </Td>
            </tr>
          ))}
          <tr>
            <Td data-label="Бүлгийн нэр">
              <strong>Нийт</strong>
            </Td>
            <Td data-label="Нийт хүүхэд" numeric>
              <strong>{totals.enrolled}</strong>
            </Td>
            <Td data-label="Өнөөдөр ирсэн" numeric>
              <strong>{totals.present}</strong>
            </Td>
            <Td data-label="Хоолох" numeric>
              <strong>{totals.present}</strong>
            </Td>
            <Td data-label="Төлөв">—</Td>
          </tr>
        </tbody>
      </TableShell>
    </section>
  );
}
