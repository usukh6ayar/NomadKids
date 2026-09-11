"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  List,
  ArrowLeft,
  MoreHorizontal,
  PackageMinus,
  PencilLine,
  Plus,
  Table2,
} from "lucide-react";
import { useRef, useState, type MutableRefObject } from "react";
import { z } from "zod";
import {
  ingredientUnitSchema,
  menuDayWithWarningsSchema,
  recipeSummarySchema,
  type MealKind,
  type MenuDish,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { FamilyMenu, WeekTable, type MenuRowActions } from "@/components/child/family-menu";
import { MenuExcelImport } from "@/components/menu/menu-excel-import";
import {
  MenuDishEditor,
  fromDraft,
  toDraft,
  type DishDraft,
  type RecipeOption,
} from "@/components/menu/menu-dish-editor";
import { useEsisFoodProducts } from "@/components/esis/use-esis-food-products";
import { formatDate, formatLongDate, formatMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const weekSchema = z.array(menuDayWithWarningsSchema);
/*
 * ★ `mealKind` joined the picked fields on 2026-09-02 so the picker can group
 * its options by sitting. `listApprovedRecipes` has always selected it — the
 * client was simply throwing it away.
 */
const approvedRecipesSchema = z.array(
  recipeSummarySchema.pick({ id: true, name: true, yieldPortions: true, mealKind: true }),
);

/** `GET .../menu/:date/sufficiency` — this day's recipe-linked, portioned
 * dishes against current stock, using the exact deduction math `consume`
 * commits with. Only the ingredients actually required by the day appear. */
const sufficiencySchema = z.array(
  z.object({
    ingredient: z.object({ id: z.string(), name: z.string(), unit: ingredientUnitSchema }),
    required: z.string(),
    available: z.string(),
    sufficient: z.boolean(),
    shortfall: z.string().nullable(),
  }),
);

/** Today, as `YYYY-MM-DD`, in UTC — matches how every other date here is keyed. */
function todayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10);
}

/** Monday of the week `date` falls in, as `YYYY-MM-DD`. */
function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // getUTCDay: Sunday is 0, so Sunday belongs to the week that began six days ago.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The first and last day of the calendar month `date` falls in — for the
 * "Сараар" export, always this month rather than whatever week is open. */
function monthRange(date: Date): { from: string; to: string } {
  const first = new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));
  const last = new Date(Date.UTC(date.getFullYear(), date.getMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

const WEEKDAY_BY_INDEX = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"];

/** The Mongolian weekday name for any date — not just the Mon–Fri five the
 * week view sticks to, so "Өнөөдөр"/"Маргааш" still label themselves
 * correctly on a weekend. */
function weekdayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return WEEKDAY_BY_INDEX[d.getUTCDay()]!;
}

/** Monday-first weekday index for `iso`, clamped into the Mon–Fri range this
 * screen shows — a weekend date (Сар/Ба clicked "Маргааш" on a Friday) lands
 * on Friday rather than pointing at a day the strip has no button for. */
function weekdayOffset(iso: string): number {
  const day = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
  return Math.min((day + 6) % 7, 4);
}

const WEEKDAYS_SHORT = ["Да", "Мя", "Лх", "Пү", "Ба"];

/**
 * Долоо хоногийн цэс — the kitchen's own screen.
 *
 * ★ `PUT /kindergartens/:id/menu/:date` has existed since the meal register
 * shipped and had no screen at all. `TodayMenu` on the dashboard reads one day
 * for one group and `child-menu.tsx` shows a parent what their child ate;
 * neither writes, so the week was planned in the database or not at all.
 *
 * ★★ The role this exists for is Тогооч, added 2026-08-30.
 * `assertCanManageMeals` is COOK, TEACHER or ADMIN — a cook decides what goes
 * in the pot, and a teacher serves it and answers for it when a parent asks.
 *
 * ★★★ The allergy warnings are the reason this reads `with-warnings` rather
 * than the plain menu. They name which children react to what, which is why
 * that is a separate route from the one a parent reads — and the cook is
 * exactly the person who can act on it. RFP Module 2.
 *
 * ★★★★ Every dish field, not just its name — fixed 2026-08-30. `PUT
 * .../menu/:date` **replaces** the day's dishes outright, so this screen and
 * `child-menu.tsx`'s own editor share one implementation
 * (`components/menu/menu-dish-editor.tsx`) rather than risk disagreeing
 * about what a full dish record looks like.
 *
 * ★★★★★ 2026-09-01 — a dish may point at an APPROVED технологийн карт
 * ("батлагдсан цэс") and carry a photo of the plated result. Both are
 * `MenuDishEditor`'s `kitchen` prop, which only this screen supplies —
 * technology cards are the kitchen's own planning concept, so `child-menu.tsx`'s
 * quick edit from inside a child's page does not offer to set one, though it
 * still preserves one that is already there (`DishDraft` round-trips it either
 * way). A recipe-linked dish's name/allergens/calories come frozen from the
 * recipe (`MealsService.saveDay` resolves them, not this screen), and its
 * `portions` is what `consume` scales the recipe's ingredients by when stock
 * is deducted.
 */
export default function MenuPage() {
  return (
    <RequireRole roles={["COOK", "TEACHER", "ADMIN"]}>
      <WeeklyMenu />
    </RequireRole>
  );
}

function WeeklyMenu() {
  const { session, hasRole } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const isKitchen = hasRole("COOK") || hasRole("ADMIN");
  /*
    ★ Who may *write* the menu — COOK and TEACHER, 2026-09-11.

    Narrower than `isKitchen`, which gates approving and the sufficiency check
    and stays COOK/ADMIN. The client's line: "Багш болон тогооч засаж болдог …
    нягтлан, удирдлага, эцэг эх оруулсан цэсүүдийг зүгээр харна." An ADMIN still
    opens this screen and reads the week; `assertCanEditMenu` on the API is the
    guarantee and this is what keeps them from being offered controls that would
    answer 404.
  */
  const canEdit = hasRole("COOK") || hasRole("TEACHER");

  const today = todayIso();
  const tomorrow = addDays(today, 1);

  /*
    ★ Paged again — 2026-09-11, the client's drawing puts `‹ 2026.09.07 –
    2026.09.13 ›` in the header.

    It was a constant from 2026-09-05, when the Өмнөх/Энэ долоо хоног/Дараах row
    was removed for duplicating a tri-toggle that has itself since gone. What is
    left is one pager and no second way to move, which is what made the old pair
    worth cutting.

    A kitchen plans *next* week — the whole point of the Excel round trip — so a
    screen fixed to this one could not do the job the import exists for.
  */
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));

  /** "Хүснэгтээр" or "Жагсаалтаар" — the client's two views, while editing. */
  const [view, setView] = useState<"table" | "list">("table");
  /*
    ★ Reading and editing are two screens, not one — 2026-09-11, at the
    client's clarification: "эцэг эхийн хоолны цэсний харагдац огт өөрчлөгдөж
    болохгүй; тогооч, багш, удирдлагад эцэг эхийнх шиг харагдаад зөвхөн засах
    үйл явцыг [зургаар илгээсэн]."

    So this screen opens as the family's own — `FamilyMenu`, unchanged — and
    the toolbar, the week table and the day form the client drew are what
    "Цэс засах" opens. A director never leaves the first state; they have no
    button to.
  */
  const [editing, setEditing] = useState(false);
  /*
    ★ Which day is open for editing, or none — 2026-09-11, the client's second
    drawing.

    Editing a day is its own screen, not a form under a week: the drawing has
    its own toolbar ("← Жагсаалтад буцах", Excel оруулах, "+ Хоолны цаг нэмэх"),
    its own day pager and its own footer. A week view with a form stapled
    underneath was answering two questions at once.
  */
  const [openDay, setOpenDay] = useState<number | null>(null);
  /*
    ★ The day card hands its "add a sitting" up, so the toolbar can press it.

    A ref rather than lifting the draft: the draft, its dirty flag and its save
    all belong to the open day and moving them into this component would make
    the week's screen own a day's form. One callback crosses the boundary and
    nothing else.
  */
  const addRowRef = useRef<(() => void) | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  /*
    ★ Editing a sitting without leaving the day — 2026-09-11, the client's
    report: the teacher's Өнөөдөр card carries two small photo buttons and a ⋮
    of Засах · Хуулах · Устгах.

    Every one of these writes the whole day back through the same
    `PUT .../menu/:date` the form uses, so there is one way a day is saved and
    the allergy cross-check re-runs the same way whichever control was pressed.
  */
  const saveDay = useMutation({
    mutationFn: ({ date, dishes }: { date: string; dishes: MenuDish[] }) =>
      mutate(`/kindergartens/${kindergartenId}/menu/${date}`, menuDayWithWarningsSchema, {
        method: "PUT",
        // `note` is left out: these controls do not touch the day's note, and
        // omitting it is what tells the API to leave the column alone.
        body: { dishes: fromDraft(toDraft(dishes)) },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["kindergarten", kindergartenId, "menu"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /** The day's dishes, with one sitting's rewritten. */
  function rewrite(date: string, kind: MealKind, next: (rows: MenuDish[]) => MenuDish[]) {
    const dishes = byDate.get(date)?.dishes ?? [];
    const inKind = dishes.filter((dish) => (dish.kind ?? "BREAKFAST") === kind);
    const rest = dishes.filter((dish) => (dish.kind ?? "BREAKFAST") !== kind);
    saveDay.mutate({ date, dishes: [...rest, ...next(inKind)] });
  }

  const rowActions: MenuRowActions | undefined =
    canEdit && kindergartenId
      ? {
          onEdit: (_kind, date) => {
            const offset = weekDates.indexOf(date);
            if (offset < 0) return;
            setEditing(true);
            setView("list");
            setSelectedOffset(offset);
            setOpenDay(offset);
          },
          /*
            Хуулах duplicates the sitting's dishes in place. The copy lands on
            the same sitting, which is what makes it useful: a cook who serves
            the same thing twice re-times one of them from the form rather than
            typing the dishes again.
          */
          onDuplicate: (kind, date) => rewrite(date, kind, (rows) => [...rows, ...rows]),
          onDelete: (kind, date) => rewrite(date, kind, () => []),
          photoEndpoint: `/kindergartens/${kindergartenId}/menu/dish-photo`,
          onPhotoUploaded: (kind, date, mediaId) =>
            rewrite(date, kind, (rows) =>
              rows.length === 0
                ? rows
                : rows.map((dish, index) =>
                    index === 0 ? { ...dish, photoMediaFileId: mediaId } : dish,
                  ),
            ),
          onPhotoRemoved: (kind, date) =>
            rewrite(date, kind, (rows) =>
              rows.map((dish) => ({ ...dish, photoMediaFileId: null })),
            ),
        }
      : undefined;
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  /*
    ★ Seven for reading, five for editing.

    ★ Seven days, Даваа–Ням — the client's table has all seven columns, and a
    kindergarten that serves on Saturday had no way to enter it while this was
    Mon–Fri.
  */

  // Which weekday the edit strip has open — an offset into `weekDates`,
  // not a stored date, the same reasoning `child-menu.tsx`'s `selectedOffset`
  // gives: it is what turns a week into one day's detail instead of five
  // full editors stacked and scrolled past to reach Friday.
  const [selectedOffset, setSelectedOffset] = useState(() => weekdayOffset(today));
  /** Whether the Excel panel is open — it is a step, not a permanent block. */
  const [importing, setImporting] = useState(false);

  // The whole Mon–Fri range for "week" — the strip needs every day's
  // fill-state at once, not just the one currently open — versus a single
  // day for "today"/"tomorrow", which have no strip to feed.
  /*
    ★ Always the whole week now.

    The range used to follow the tri-toggle — one day for Өнөөдөр, one for
    Маргааш — because the screen only ever drew the open day. `FamilyMenu` draws
    all seven at once, so a narrower fetch would leave its table empty on every
    tab but the one that happened to be selected.
  */
  const from = weekDates[0]!;
  const to = weekDates[6]!;
  // The one day actually rendered below: the strip's selection in "week",
  // otherwise whichever of "today"/"tomorrow" is active.
  const activeDate = weekDates[selectedOffset]!;

  const week = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.weeklyMenu(kindergartenId ?? "", from, to),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/menu/with-warnings?from=${from}&to=${to}`, weekSchema),
  });

  const recipes = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.kitchen.approvedRecipes(kindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${kindergartenId}/recipes/approved`, approvedRecipesSchema),
  });

  const byDate = new Map((week.data ?? []).map((day) => [day.date.slice(0, 10), day]));
  /** Every warning the week raises, each carrying the day it falls on. */
  const weekWarnings = weekDates.flatMap((date) =>
    (byDate.get(date)?.warnings ?? []).map((warning) => ({ ...warning, date })),
  );

  const weekEnd = weekDates[6]!;
  const month = monthRange(new Date());

  /*
   * ★ One icon button, not three text ones — client request, 2026-09-05.
   *
   * The Өмнөх/Энэ долоо хоног/Дараах row that used to sit here duplicated the
   * tri-toggle below it (both moved between "today"/"this week") without
   * adding a destination of its own once "7 хоног" already means *this*
   * week — it was removed rather than kept for a "previous week" case
   * nothing else on the screen offers. This slot is Excel instead: the three
   * ranges from a fixed period each, not from whatever `quickView` happens to
   * be showing, same reasoning `menu-workbook.ts`'s doc comment gives.
   */
  const exportItems: MenuItem[] = kindergartenId
    ? [
        {
          href: downloadUrl(
            `/kindergartens/${kindergartenId}/menu/export?from=${today}&to=${today}`,
          ),
          label: "Өдрөөр",
          hint: formatDate(today),
        },
        {
          href: downloadUrl(
            `/kindergartens/${kindergartenId}/menu/export?from=${weekStart}&to=${weekEnd}`,
          ),
          label: "7 хоногоор",
          hint: `${formatDate(weekStart)} – ${formatDate(weekEnd)}`,
        },
        {
          href: downloadUrl(
            `/kindergartens/${kindergartenId}/menu/export?from=${month.from}&to=${month.to}`,
          ),
          label: "Сараар",
          hint: formatMonthLabel(month.from.slice(0, 7)),
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      {/*
        ★ The client's 2026-09-11 drawing, top to bottom: a title with the week
        it is showing, then one row of controls, then the week itself.

        What it replaces is a header carrying a single ⋮ and a body that opened
        straight into one day's form. The two questions this screen answers are
        "what does the week look like" and "let me change a day", and the design
        puts the first one on screen and the second behind a control.
      */}
      <PageHeader
        title={openDay === null ? "Хоолны цэс" : "Хоолны цэс засах"}
        lede={
          openDay !== null
            ? `${formatLongDate(activeDate)}, ${weekdayLabel(activeDate)} гараг`
            : editing
              ? "7 хоногийн хоолны цэсийг удирдах"
              : undefined
        }
        actions={
          !editing ? null : openDay !== null ? (
            /*
              ★ The day's pager, in the header — the client's drawing puts
              `‹ 2026.09.11 ›` at the top right of the day screen, not inside
              the form, where it was a second header on one screen.
            */
            <div className="flex items-center gap-1 rounded-control border border-border bg-surface px-1 py-0.5">
              <button
                type="button"
                aria-label="Өмнөх өдөр"
                disabled={openDay === 0}
                onClick={() => {
                  setSelectedOffset(openDay - 1);
                  setOpenDay(openDay - 1);
                }}
                className="grid size-9 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink disabled:opacity-40"
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <span className="inline-flex items-center gap-2 px-1 text-body font-medium tabular-nums text-ink">
                <CalendarDays size={16} aria-hidden="true" className="text-muted" />
                {formatDate(activeDate)}
              </span>
              <button
                type="button"
                aria-label="Дараах өдөр"
                disabled={openDay >= weekDates.length - 1}
                onClick={() => {
                  setSelectedOffset(openDay + 1);
                  setOpenDay(openDay + 1);
                }}
                className="grid size-9 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink disabled:opacity-40"
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-control border border-border bg-surface px-1 py-0.5">
              <button
                type="button"
                aria-label="Өмнөх долоо хоног"
                onClick={() => setWeekStart((current) => addDays(current, -7))}
                className="grid size-9 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <span className="inline-flex items-center gap-2 px-1 text-body font-medium tabular-nums text-ink">
                <CalendarDays size={16} aria-hidden="true" className="text-muted" />
                {formatDate(from)} – {formatDate(to)}
              </span>
              <button
                type="button"
                aria-label="Дараах долоо хоног"
                onClick={() => setWeekStart((current) => addDays(current, 7))}
                className="grid size-9 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          )
        }
      />

      {/*
        ★ One toolbar: how to look, then what to do.

        The two view buttons are a `radiogroup` rather than tabs, because they
        do not switch panels of unrelated content — they are two renderings of
        the same week, and "Жагсаалтаар" is where a day is actually edited.

        Excel оруулах and Нэмэх are drawn only for someone who may write
        (`assertCanEditMenu`, COOK/TEACHER). An administrator reads the same
        week with neither, rather than being offered controls the API answers
        with 404.
      */}
      {!editing ? (
        /*
          ★ The family's own screen, unchanged — the client's clarification.

          A cook, a teacher and a director open this and see exactly what a
          parent sees: today, tomorrow, the week. The only thing added is the
          door into the editing flow, and only for someone who may walk through
          it.
        */
        <>
          {kindergartenId && !week.isLoading ? (
            <FamilyMenu
              byDate={byDate}
              weekDates={weekDates}
              todayIso={today}
              tomorrowIso={tomorrow}
              healthNotes={null}
              actions={rowActions}
            />
          ) : null}

          {canEdit ? (
            <Button className="self-start" onClick={() => setEditing(true)}>
              <PencilLine size={16} aria-hidden="true" />
              Цэс засах
            </Button>
          ) : null}
        </>
      ) : null}

      {editing && openDay === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditing(false);
              setView("table");
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Буцах
          </Button>

          <div
            role="radiogroup"
            aria-label="Харагдац"
            className="flex items-center gap-1 rounded-control bg-canvas p-1"
          >
            {(
              [
                ["table", "Хүснэгтээр", <Table2 key="t" size={16} aria-hidden="true" />],
                ["list", "Жагсаалтаар", <List key="l" size={16} aria-hidden="true" />],
              ] as const
            ).map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={view === value}
                onClick={() => setView(value)}
                className={cn(
                  "inline-flex min-h-[40px] items-center gap-2 rounded-control px-3 text-body font-medium transition-colors",
                  view === value
                    ? "bg-primary text-primary-ink shadow-sm"
                    : "text-muted hover:bg-surface hover:text-ink",
                )}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {kindergartenId && canEdit ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="border-mint bg-mint/30 text-mint-ink hover:bg-mint/50"
                  onClick={() => setImporting((current) => !current)}
                  aria-expanded={importing}
                >
                  <FileSpreadsheet size={16} aria-hidden="true" />
                  Excel оруулах
                </Button>

                {/*
                Нэмэх opens the day's form — the list view *is* the form, so
                this switches to it rather than opening a dialog that would then
                have to ask which day.
              */}
                <Button size="sm" onClick={() => setView("list")}>
                  <Plus size={16} aria-hidden="true" />
                  Нэмэх
                </Button>
              </>
            ) : null}

            {kindergartenId ? (
              <Menu
                variant="secondary"
                ariaLabel="Excel татах"
                items={exportItems}
                label={
                  <>
                    <MoreHorizontal size={18} aria-hidden="true" />
                    <span className="sr-only">Excel татах</span>
                  </>
                }
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {/*
        ★ The day screen's toolbar — the client's drawing, exactly these three.

        No view toggle here: there is one day on screen and nothing to switch
        it to. "Жагсаалтад буцах" is the way out, which is also why the week's
        own Буцах is hidden while a day is open.
      */}
      {editing && openDay !== null ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setOpenDay(null)}>
            <ArrowLeft size={16} aria-hidden="true" />
            Жагсаалтад буцах
          </Button>

          {kindergartenId && canEdit ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="border-mint bg-mint/30 text-mint-ink hover:bg-mint/50"
                onClick={() => setImporting((current) => !current)}
                aria-expanded={importing}
              >
                <FileSpreadsheet size={16} aria-hidden="true" />
                Excel оруулах
              </Button>

              {/*
                ★ In the toolbar, where the client drew it. The editor still
                owns the row it adds — this only presses the same button,
                through a ref the card hands up.
              */}
              <Button variant="secondary" size="sm" onClick={() => addRowRef.current?.()}>
                <Plus size={16} aria-hidden="true" />
                Хоолны цаг нэмэх
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {kindergartenId && canEdit && editing && importing ? (
        <MenuExcelImport kindergartenId={kindergartenId} />
      ) : null}

      {week.isLoading ? <LoadingState rows={1} /> : null}
      {week.isError ? <ErrorState description={errorMessage(week.error)} /> : null}

      {/*
        ★ The week's allergy warnings, above both views — 2026-09-11.

        They used to live inside the open day's card, which the table view does
        not draw: switching to the week hid the one thing on this screen that is
        about a child's safety rather than the kitchen's convenience (RFP Module
        2). A cook reading the week has to see them without having to find the
        right day first, so this names the day each one falls on.

        `isKitchen` because the warnings name other people's children and what
        they react to — medical information about another family.
      */}
      {isKitchen && weekWarnings.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-row bg-peach/40 px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-body font-medium text-peach-ink">
            <AlertTriangle size={16} aria-hidden="true" />
            Харшлын анхааруулга
          </p>
          <ul className="flex flex-col gap-1">
            {weekWarnings.map((warning, index) => (
              <li key={index} className="text-caption text-peach-ink">
                {formatDate(warning.date)} · {warning.childName} — {warning.allergen}
                {warning.dishName ? ` (${warning.dishName})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {kindergartenId && editing && openDay === null && view === "table" && !week.isLoading ? (
        <WeekTable byDate={byDate} weekDates={weekDates} todayIso={today} />
      ) : null}

      {editing && openDay === null && view === "list" ? (
        <div className="grid grid-cols-7 gap-1.5">
          {weekDates.map((date, i) => {
            const day = byDate.get(date);
            const filled = (day?.dishes.length ?? 0) > 0;
            const isToday = date === today;
            const active = i === selectedOffset;

            return (
              <button
                key={date}
                type="button"
                aria-pressed={active}
                aria-label={`${WEEKDAYS_SHORT[i]}, ${formatDate(date)}${filled ? " — цэстэй" : ""}`}
                onClick={() => {
                  setSelectedOffset(i);
                  setOpenDay(i);
                }}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-row border px-1 py-2 text-caption font-semibold transition-colors",
                  active
                    ? "border-primary bg-primary-soft text-primary-strong"
                    : "border-border bg-surface text-ink hover:border-primary",
                  isToday && !active && "border-primary/50",
                )}
              >
                <span className="text-faint">{WEEKDAYS_SHORT[i]}</span>
                <span>{Number(date.slice(8, 10))}</span>
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 rounded-pill", filled ? "bg-mint" : "bg-transparent")}
                />
              </button>
            );
          })}
        </div>
      ) : null}

      {kindergartenId && editing && openDay !== null && !week.isLoading ? (
        <MenuDayCard
          key={activeDate}
          kindergartenId={kindergartenId}
          queryFrom={from}
          queryTo={to}
          date={activeDate}
          weekday={weekdayLabel(activeDate)}
          day={byDate.get(activeDate) ?? null}
          recipes={recipes.data ?? []}
          isKitchen={isKitchen}
          canEdit={canEdit}
          /* Цуцлах leaves the day rather than reverting it — the drawing's
             footer pairs it with Хадгалах, and the draft is per-day state that
             unmounting discards anyway. */
          onCancel={() => setOpenDay(null)}
          onPreview={() => {
            setOpenDay(null);
            setEditing(false);
          }}
          addRowRef={addRowRef}
        />
      ) : null}
    </div>
  );
}

/**
 * One day, edited in place.
 *
 * ★ Saved per day rather than per week.
 *
 * `PUT /kindergartens/:id/menu/:date` is the endpoint's shape, and it matches
 * how the work is actually done: a cook writes Monday on Friday and Tuesday
 * when the delivery arrives. One save button for five days would make a
 * half-planned week unsaveable.
 *
 * ★★ Always the editor, never a read-only view — unlike `child-menu.tsx`'s
 * `DayDetail`, which toggles between the two for a teacher. Entering the menu
 * is this screen's whole job; there is no "done reading" state for a cook to
 * fall back to, so `MenuDishEditor` renders with no `onCancel`.
 */
function MenuDayCard({
  kindergartenId,
  queryFrom,
  queryTo,
  date,
  weekday,
  day,
  recipes,
  isKitchen,
  canEdit,
  onCancel,
  onPreview,
  addRowRef,
}: {
  kindergartenId: string;
  queryFrom: string;
  queryTo: string;
  date: string;
  weekday: string;
  day: z.infer<typeof menuDayWithWarningsSchema> | null;
  recipes: RecipeOption[];
  isKitchen: boolean;
  /** COOK or TEACHER — see `WeeklyMenu`'s own note. */
  canEdit: boolean;
  /** Leaves the day. Drawn as "Цуцлах" beside "Хадгалах". */
  onCancel?: () => void;
  /** Shows the day as a family would read it — the drawing's "Уръдчилан харах". */
  onPreview?: () => void;
  /** Handed the card's "add a sitting", so the page toolbar can press it. */
  addRowRef?: MutableRefObject<(() => void) | null>;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const esisProducts = useEsisFoodProducts();
  const [draftDishes, setDraftDishes] = useState<DishDraft[]>(() => toDraft(day?.dishes ?? []));
  const [note, setNote] = useState(day?.note ?? "");
  const [dirty, setDirty] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: qk.weeklyMenu(kindergartenId, queryFrom, queryTo),
    });
  };

  const save = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/menu/${date}`, z.unknown(), {
        method: "PUT",
        body: { dishes: fromDraft(draftDishes), note: note.trim() || null },
      }),
    onSuccess: () => {
      toast.success(`${weekday} гарагийн цэс хадгалагдлаа.`);
      setDirty(false);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const approve = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/menu/${date}/approve`, z.unknown(), {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success(`${weekday} гарагийн цэс батлагдлаа.`);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const consume = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/menu/${date}/consume`, z.unknown(), {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success(`${weekday} гарагийн хэрэглээ нөөцөд бүртгэгдлээ.`);
      void queryClient.invalidateQueries({ queryKey: ["kitchen", "stock"] });
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const warnings = day?.warnings ?? [];
  const isApproved = day?.status === "APPROVED";
  const isConsumed = Boolean(day?.consumedAt);

  /*
   * ★ Хангамжийн шалгалт — reads the exact numbers `consume` will deduct
   * with, not an estimate. Kitchen-only (the endpoint is COOK/ADMIN,
   * `assertCanManageKitchen`), so a teacher's screen never fires this query.
   * Skipped once the day is already consumed — the ledger is already the
   * fact by then, and a shortfall found afterward is a stock ADJUSTMENT, not
   * something this screen can still act on.
   */
  const sufficiency = useQuery({
    enabled: isKitchen && !isConsumed,
    queryKey: qk.kitchen.sufficiency(kindergartenId, date),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/menu/${date}/sufficiency`, sufficiencySchema),
  });
  const shortages = (sufficiency.data ?? []).filter((row) => !row.sufficient);

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      {/*
        ★ The badges alone — the heading, the date and the pager moved to the
        page header, where the client drew them. Two headers on one screen was
        the shape this replaces.
      */}
      {day || (day && !dirty) ? (
        <div className="flex flex-wrap items-center gap-2">
          {day ? (
            <Badge tone={isApproved ? "mint" : "neutral"}>
              {isApproved ? "Батлагдсан" : "Ноорог"}
            </Badge>
          ) : null}
          {day && !dirty ? <Badge tone="mint">Хадгалагдсан</Badge> : null}
        </div>
      ) : null}

      {/*
        ★ The cross-check, RFP Module 2 — and the reason this screen reads the
        staff route.

        A warning names a child and what they react to. It is shown to the
        person who can act on it and to nobody else: `menu/with-warnings` is a
        separate endpoint from the menu a parent reads for exactly this reason.
        It only ever fires once a dish below actually carries an allergen tag.
      */}
      {warnings.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-row bg-peach/40 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-body font-medium text-peach-ink">
            <AlertTriangle size={16} aria-hidden="true" />
            Харшлын анхааруулга
          </p>
          <ul className="flex flex-col gap-1">
            {warnings.map((warning, index) => (
              <li key={index} className="text-caption text-peach-ink">
                {warning.childName} — {warning.allergen}
                {warning.dishName ? ` (${warning.dishName})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        ★ Same shape as the allergy warning above, own colour — this is an
        operational shortage, not a safety warning, and the two must not read
        as the same kind of alert. `required`/`available` are already in the
        ingredient's own unit; no conversion happens anywhere in this module.
        ★★ Not just advisory since 2026-09-08 — `consume` actually refuses
        while any row here is short, so the wording says so rather than
        hedging with "may be".
      */}
      {shortages.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-row bg-sky/40 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-body font-medium text-sky-ink">
            <PackageMinus size={16} aria-hidden="true" />
            Нөөц хүрэлцэхгүй байна — хэрэглээ бүртгэх боломжгүй
          </p>
          <ul className="flex flex-col gap-1">
            {shortages.map((row) => (
              <li key={row.ingredient.id} className="text-caption text-sky-ink">
                {row.ingredient.name} — хэрэгтэй {row.required}, байгаа {row.available}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!canEdit ? (
        /*
          ★ A reader gets the dishes, not a form — 2026-09-11.

          `assertCanEditMenu` refuses their save with a 404, so drawing the
          editor would offer an administrator a Хадгалах that always fails.
          The week, the warnings and the Excel download above are unchanged.
        */
        <ul className="flex flex-col gap-1.5">
          {draftDishes.length === 0 ? (
            <li className="text-body text-muted">Цэс оруулаагүй.</li>
          ) : (
            draftDishes.map((dish, index) => (
              <li key={index} className="flex flex-wrap items-baseline gap-x-2 text-body text-ink">
                <span className="font-medium">{dish.name}</span>
                {dish.calories ? (
                  <span className="text-caption text-muted">{dish.calories} ккал</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : (
        <MenuDishEditor
          draftDishes={draftDishes}
          onChange={(next) => {
            setDraftDishes(next);
            setDirty(true);
          }}
          onSave={() => save.mutate()}
          onCancel={onCancel}
          onPreview={onPreview}
          chrome="none"
          addRowRef={addRowRef}
          footer={
            /*
              ★ "Нэмэлт мэдээлэл" — the day's own note, `MenuDay.note`.

              A dish already had one; this is about the day, which is where
              "цэс өөрчлөгдсөн" or "бага хэмжээгээр өгсөн" belongs. Added
              2026-09-11 with the client's drawing, which puts it under the
              cards and above the footer.
            */
            <Field label="Нэмэлт мэдээлэл" hint={`${note.length}/500`}>
              {({ id }) => (
                <Textarea
                  id={id}
                  rows={2}
                  value={note}
                  maxLength={500}
                  onChange={(event) => {
                    setNote(event.target.value);
                    setDirty(true);
                  }}
                />
              )}
            </Field>
          }
          saving={save.isPending}
          error={save.isError ? errorMessage(save.error) : null}
          /*
          ★ ESIS-ийн бэлэн бүтээгдэхүүн joins the same picker as the local
          cards — 2026-09-09, at the client's request ("тогоочийн хэсэгт бэлэн
          хоол сонгох хэсэгт API-г дуудах").

          `useEsisFoodProducts` reads the role-scoped catalog first, so a
          teacher opening this screen gets an empty list and a picker that
          looks exactly as it did before. Nothing here has to know that.
        */
          kitchen={{ kindergartenId, recipes, esisProducts }}
        />
      )}

      {isKitchen ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border-soft pt-3">
          {/* Батлагдсан цэс — COOK/ADMIN only, and only once saved. */}
          {day && !dirty && !isApproved ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={approve.isPending}
              onClick={() => approve.mutate()}
            >
              <CheckCircle2 size={16} aria-hidden="true" />
              {approve.isPending ? "Батлаж байна…" : "Батлах"}
            </Button>
          ) : null}

          {/* Зарцуулалт — deducts this day's cooking from stock. Disabled
              while a shortage is showing above: the server refuses the same
              way (2026-09-08), this just saves the round trip. */}
          {isApproved && !isConsumed ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={consume.isPending || shortages.length > 0}
              onClick={() => consume.mutate()}
            >
              <PackageMinus size={16} aria-hidden="true" />
              {consume.isPending ? "Бүртгэж байна…" : "Хэрэглээ бүртгэх"}
            </Button>
          ) : null}
          {isConsumed ? <Badge tone="sky">Нөөцөд бүртгэсэн</Badge> : null}
        </div>
      ) : null}
    </Card>
  );
}
