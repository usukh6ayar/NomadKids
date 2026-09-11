import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { ChildMenu } from "@/components/child/child-menu";

const KG_ID = "33333333-3333-4333-8333-333333333333";
const CHILD_ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Today and tomorrow in UTC — the two days the screen opens on. */
function iso(offsetDays = 0): string {
  const now = new Date();
  const day = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day.toISOString().slice(0, 10);
}

/*
  ★ Real UUIDs. `menuDaySchema.id` is `uuidSchema`, and a malformed one makes the
  whole list fail to parse — which the screen renders as "Алдаа гарлаа", not as
  an empty menu. Four of these tests failed that way before the ids were real.
*/
let dayCounter = 0;
function day(date: string, dishes: Record<string, unknown>[]) {
  dayCounter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(dayCounter).padStart(12, "0")}`,
    date: `${date}T00:00:00.000Z`,
    dishes,
    status: "APPROVED",
  };
}

const TODAY = iso();
const TOMORROW = iso(1);

const MENU = [
  day(TODAY, [
    { name: "Тараг", allergenTags: ["сүү"], kind: "BREAKFAST", calories: 120 },
    { name: "Мюсли", allergenTags: [], kind: "BREAKFAST", calories: 180 },
    { name: "Ногоотой хуурга", allergenTags: [], kind: "MID_MORNING_SNACK", calories: 240 },
    { name: "Шөл", allergenTags: [], kind: "EXTRA" },
  ]),
  day(TOMORROW, [{ name: "Бууз", allergenTags: [], kind: "BREAKFAST" }]),
];

function stub(menu = MENU) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["PARENT"]) },
    { path: `/children/${CHILD_ID}/meals/notes`, body: [] },
    { path: `/kindergartens/${KG_ID}/menu`, body: menu },
  ]);
}

function render(healthNotes: string | null = null) {
  return renderWithProviders(
    <ChildMenu
      kindergartenId={KG_ID}
      childId={CHILD_ID}
      healthNotes={healthNotes}
      isStaff={false}
    />,
  );
}

/**
 * The family's meal screen — the client's 2026-09-11 design.
 *
 * ★ It replaced a screen with a week pager, a weekday strip and a "Хоолны цаг"
 * jump list. A family asks two questions — what is my child eating today, and
 * what is coming — so the tabs are the whole navigation, and these assert that
 * none of the old machinery came back with the new paint.
 */
describe("the family's meal screen", () => {
  it("opens on today, with the sittings in order", async () => {
    stub();
    render();

    const panel = await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    expect(within(panel).getByText("Өглөөний цай")).toBeInTheDocument();
    expect(within(panel).getByText("Тараг")).toBeInTheDocument();
    expect(within(panel).getByText("Мюсли")).toBeInTheDocument();

    // A sitting with no dish that day is not drawn as an empty card.
    expect(within(panel).queryByText("Өдрийн хоол")).not.toBeInTheDocument();
  });

  it("prints the time of each sitting", async () => {
    stub();
    render();

    const panel = await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    expect(within(panel).getByText("08:30")).toBeInTheDocument();
    expect(within(panel).getByText("17:30")).toBeInTheDocument();
  });

  /*
    ★ Summed across the sitting, not printed per dish — the client asked for the
    calories on the meal, and five numbers down a card is a table nobody reads.
  */
  it("adds up the sitting's calories for the family", async () => {
    stub();
    render();

    const panel = await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    expect(within(panel).getByText("300 ккал")).toBeInTheDocument();
    expect(within(panel).getByText("240 ккал")).toBeInTheDocument();
  });

  /** A menu whose calories were never entered says nothing rather than "0 ккал". */
  it("says nothing about energy when the kitchen entered none", async () => {
    stub();
    render();

    const panel = await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    // Шөл carries no `calories`, so its card has no figure.
    const soup = within(panel).getByText("Оройн хоол").closest('[data-ui="card"]')!;
    expect(within(soup as HTMLElement).queryByText(/ккал/)).not.toBeInTheDocument();
  });

  it("moves to tomorrow without touching the week", async () => {
    const user = userEvent.setup();
    stub();
    render();

    await user.click(await screen.findByRole("tab", { name: "Маргааш" }));

    const panel = await screen.findByRole("tabpanel", { name: "Маргааш" });
    expect(within(panel).getByText("Бууз")).toBeInTheDocument();
    expect(within(panel).queryByText("Тараг")).not.toBeInTheDocument();
  });

  /*
    ★ A table, and it scrolls inside its own box.

    Seven days of dish names does not fit a phone and never will — CLAUDE.md §5
    and the harness rule that wide content scrolls in its own container rather
    than making the page scroll sideways.
  */
  it("lays the week out as a table of sittings by day", async () => {
    const user = userEvent.setup();
    stub();
    render();

    await user.click(await screen.findByRole("tab", { name: "7 хоног" }));

    const table = await screen.findByRole("table", { name: "Долоо хоногийн цэс" });
    expect(within(table).getByRole("rowheader", { name: /Өглөөний цай/ })).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader")).toHaveLength(8); // Хоолны цаг + 7 days
    expect(within(table).getByText("Тараг, Мюсли")).toBeInTheDocument();

    expect(table.parentElement?.className).toContain("overflow-x-auto");
  });

  /*
    ★ Best-effort, and the screen has always said so — `healthNotes` is free
    text and this is a substring match, not an allergy database. It is still the
    one thing on this screen a parent must not miss.
  */
  it("flags a dish whose allergen tag matches the child's health notes", async () => {
    stub();
    render("Сүү үл тэвчих");

    expect(await screen.findByText(/сүү агуулсан/)).toBeInTheDocument();
  });

  /*
    ★ A parent's card carries none of the staff controls — the client said the
    family's view must not change at all, and `FamilyMenu` draws them only when
    `actions` are handed in.
  */
  it("offers a family no editing controls on the card", async () => {
    stub();
    render();

    const panel = await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    expect(within(panel).queryByLabelText("Зураг нэмэх")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /үйлдэл/ })).not.toBeInTheDocument();
  });

  /*
    ★ Nothing between the sitting's ⋮ and the page clips it — 2026-09-11: the
    client saw Засах and no Устгах, because an 88px card with `overflow-hidden`
    cut a 150px popup off below its own edge. On a phone that is the menu gone
    but for its first line.

    Asserted on the class, the way `responsive.test.tsx` does: jsdom has no
    layout engine, so nothing here can measure a clip. What it defends is the
    next person restoring `overflow-hidden` to round a corner.
  */
  it("lets a sitting's menu escape the card", async () => {
    stub();
    render();

    const panel = await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    for (const card of panel.querySelectorAll('[data-ui="card"]')) {
      expect(card.className).not.toContain("overflow-hidden");
    }
    expect(panel.firstElementChild!.className).not.toContain("overflow-hidden");
  });

  it("says nothing about allergens when the child has no notes", async () => {
    stub();
    render();

    await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    expect(screen.queryByText(/агуулсан/)).not.toBeInTheDocument();
  });

  /** The screen this replaced. None of it should still be reachable. */
  it("carries none of the old pager, strip or jump list", async () => {
    stub();
    render();

    await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    expect(screen.queryByRole("button", { name: "Өмнөх долоо хоног" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Дараах долоо хоног" })).not.toBeInTheDocument();
    expect(screen.queryByText("Хоолны цаг")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Засах" })).not.toBeInTheDocument();
  });

  it("says so when the kitchen has entered nothing", async () => {
    stub([]);
    render();

    expect(await screen.findByText("Цэс оруулаагүй байна")).toBeInTheDocument();
  });
});

/**
 * "Нэмэлт мэдээлэл" — the box under the menu.
 *
 * ★ It posts to `/children/:id/meals/notes`, not to chat. The only chat rooms
 * that exist hold a whole group, and a dietary restriction is one child's
 * business — `menu-note-box.tsx` carries the argument.
 */
describe("the family's note to the kitchen", () => {
  it("sends what was typed, against today's date", async () => {
    const user = userEvent.setup();
    const { calls } = stub();
    render();

    await user.type(
      await screen.findByLabelText("Нэмэлт мэдээлэл"),
      "Сүүн бүтээгдэхүүн өгч болохгүй.",
    );
    await user.click(screen.getByRole("button", { name: "Илгээх" }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/notes"))).toBe(
        true,
      ),
    );
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.body).toMatchObject({ date: TODAY, body: "Сүүн бүтээгдэхүүн өгч болохгүй." });
  });

  /** No example text in the box — the client read grey text as content. */
  it("offers an empty box, with no placeholder", async () => {
    stub();
    render();

    expect(await screen.findByLabelText("Нэмэлт мэдээлэл")).not.toHaveAttribute("placeholder");
  });

  it("will not send an empty note", async () => {
    stub();
    render();

    expect(await screen.findByRole("button", { name: "Илгээх" })).toBeDisabled();
  });

  it("counts the characters against the limit", async () => {
    const user = userEvent.setup();
    stub();
    render();

    expect(await screen.findByText("0/500")).toBeInTheDocument();
    await user.type(await screen.findByLabelText("Нэмэлт мэдээлэл"), "Сайн");
    expect(screen.getByText("4/500")).toBeInTheDocument();
  });

  /*
    A box that empties and says "sent" leaves a parent unable to check whether
    they already mentioned the thing they are about to mention again.
  */
  it("shows what has already been sent", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/meals/notes`,
        body: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            date: TODAY,
            body: "Өчигдөр хоолны дуршил муутай байсан.",
            createdAt: `${TODAY}T08:00:00.000Z`,
            // `personRefSchema` needs both names; one alone fails the parse silently.
            author: {
              id: "66666666-6666-4666-8666-666666666666",
              lastName: "Болд",
              firstName: "Сараа",
            },
          },
        ],
      },
      { path: `/kindergartens/${KG_ID}/menu`, body: MENU },
    ]);
    render();

    const sent = await screen.findByRole("list", { name: "Илгээсэн мэдээлэл" });
    expect(within(sent).getByText("Өчигдөр хоолны дуршил муутай байсан.")).toBeInTheDocument();
  });
});

/**
 * The same design on every role's screen — 2026-09-11, at the client's request.
 *
 * ★ "Эцэг эх дээр хийгдсэн байгаа хоолны цэс хэсгийг яг тэр загвараар эцэг эх,
 * удирдлага, тогоочид оруул." Staff read what a family reads and keep the
 * editor underneath, rather than reading through a form.
 */
describe("the staff view of a child's menu", () => {
  function renderStaff() {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/children/${CHILD_ID}/meals/notes`, body: [] },
      { path: `/kindergartens/${KG_ID}/menu`, body: MENU },
    ]);
    return renderWithProviders(
      <ChildMenu kindergartenId={KG_ID} childId={CHILD_ID} healthNotes={null} isStaff />,
    );
  }

  it("reads the same three tabs a family gets", async () => {
    renderStaff();

    const panel = await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    expect(within(panel).getByText("Тараг")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "7 хоног" })).toBeInTheDocument();
  });

  /*
    ★ Reading first, editing behind a door — the client's clarification: staff
    see exactly what a family sees, and everything they drew is the editing
    flow, which is a separate thing to open.
  */
  it("keeps the editor behind Цэс засах", async () => {
    const user = userEvent.setup();
    renderStaff();

    await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    expect(screen.queryByText("Хоолны цэс засах")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Цэс засах" }));
    expect(await screen.findByText("Хоолны цэс засах")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Засах" })).toBeInTheDocument();
  });

  /** The old staff shape: a week pager and a jump list, both gone. */
  it("carries none of the old pager or jump list", async () => {
    renderStaff();

    await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    expect(screen.queryByRole("button", { name: "Өмнөх долоо хоног" })).not.toBeInTheDocument();
    expect(screen.queryByText("Долоо хоногийн цэс")).not.toBeInTheDocument();
  });

  /** A note box is the family's; staff have the register for what a child ate. */
  it("does not offer staff the family's note box", async () => {
    renderStaff();

    await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    expect(screen.queryByLabelText("Нэмэлт мэдээлэл")).not.toBeInTheDocument();
  });
});
