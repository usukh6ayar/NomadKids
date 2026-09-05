import { readFileSync } from "node:fs";
import { join } from "node:path";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import GroupMealsPage from "@/app/(app)/groups/[groupId]/meals/page";
import { GroupsSection } from "@/components/dashboard/groups-section";

/**
 * The group meal register — `нэмэлт.md` §2.
 *
 * ★ What separates this from the attendance day sheet, and what most of this
 * file is checking: attendance writes on every tap, this one holds a draft and
 * saves the whole sitting in **one** `PUT`. The API takes a batch for a reason
 * written into its own DTO — a teacher marks twenty children at a serving hatch
 * and twenty round trips is the difference between a usable screen and a form
 * nobody fills in.
 *
 * ★★ A note on the stubs. `stubApi` matches by `startsWith` and a route with no
 * `method` answers every verb, so the sheet stub carries `method: "GET"`
 * explicitly — without it, it would serve the `PUT` as well and the mutation
 * would fail schema parse looking like a bug in the save. For the same reason
 * `?kind=BREAKFAST` and `?kind=LUNCH` cannot be given different bodies: both
 * start with the same prefix. Switching sittings is therefore asserted from the
 * recorded request URL, which is the fact that matters.
 */

const GROUP = "44444444-4444-4444-8444-444444444444";
const CHILD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHILD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
/** `mealRecordSchema.id` is a `uuidSchema`, so a placeholder like "r1" would
 *  fail the parse and surface as a generic load error. */
const RECORD_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MEALS_PATH = `/groups/${GROUP}/meals`;

const TODAY = new Date().toISOString().slice(0, 10);

function row(over: Record<string, unknown> = {}) {
  return {
    child: { id: CHILD_A, lastName: "Батбаяр", firstName: "Ганболд" },
    enrollmentId: "11111111-1111-4111-8111-111111111111",
    record: null,
    ...over,
  };
}

/** A second child, unmarked — the roster is never one row in practice. */
const secondRow = {
  child: { id: CHILD_B, lastName: "Дорж", firstName: "Сараа" },
  enrollmentId: "22222222-2222-4222-8222-222222222222",
  record: null,
};

/**
 * ★ Order matters, and the trap is subtle.
 *
 * `stubApi` matches by `startsWith`, and `/groups/<id>` is a prefix of
 * `/groups/<id>/meals`. Listed first, the group stub answers the sheet request
 * with `{ id, name }`, which fails the array schema and surfaces as a generic
 * "Алдаа гарлаа" — a load failure that looks nothing like its cause. The
 * narrower path goes first; the group detail is the fallback.
 */
function stubSheet(
  rows: unknown[] = [row(), secondRow],
  extra: Parameters<typeof stubApi>[0] = [],
) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    ...extra,
    // `method` is mandatory here — see the note above.
    { path: MEALS_PATH, method: "GET", body: rows },
    { path: `/groups/${GROUP}`, method: "GET", body: { id: GROUP, name: "Дунд бүлэг" } },
  ]);
}

/** The saved rows a successful `PUT` answers with. */
function saved(count = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: `99999999-9999-4999-8999-99999999999${i}`,
    childId: i === 0 ? CHILD_A : CHILD_B,
    date: TODAY,
    kind: "BREAKFAST",
    status: "TAKEN",
    note: null,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ groupId: GROUP });
  setSearchParams("");
});

describe("бүртгэлийн дэлгэц", () => {
  it("renders the register for the group", async () => {
    stubSheet();
    renderWithProviders(<GroupMealsPage />);

    expect(await screen.findByRole("heading", { name: "Хоолны бүртгэл" })).toBeInTheDocument();
    expect(await screen.findByText("Дунд бүлэг")).toBeInTheDocument();
  });

  it("lists every active enrolled child", async () => {
    stubSheet();
    renderWithProviders(<GroupMealsPage />);

    expect(await screen.findByText("Батбаяр Ганболд")).toBeInTheDocument();
    expect(screen.getByText("Дорж Сараа")).toBeInTheDocument();
    expect(screen.getByText("0/2 бүртгэсэн")).toBeInTheDocument();
  });

  /**
   * ★ `record: null` is deliberate on the API side — the roster comes from
   * `Enrollment`, not from the meal rows, so a child nobody marked appears
   * *unmarked* rather than absent. A row that looked identical to a marked one
   * would defeat the point of a register.
   */
  it("distinguishes a child nobody has marked yet", async () => {
    stubSheet([
      row({
        record: {
          id: RECORD_A,
          childId: CHILD_A,
          date: TODAY,
          kind: "BREAKFAST",
          status: "TAKEN",
          note: null,
        },
      }),
      secondRow,
    ]);
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    expect(screen.getByText("Бүртгээгүй")).toBeInTheDocument();
    expect(screen.getByText("1/2 бүртгэсэн")).toBeInTheDocument();
  });

  it("shows a saved status as selected", async () => {
    stubSheet([
      row({
        record: {
          id: RECORD_A,
          childId: CHILD_A,
          date: TODAY,
          kind: "BREAKFAST",
          status: "PARTIAL",
          note: null,
        },
      }),
    ]);
    renderWithProviders(<GroupMealsPage />);

    const group = await screen.findByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" });
    expect(within(group).getByRole("radio", { name: "Хэсэгчлэн" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Авсан" })).not.toBeChecked();
  });

  it("offers all four statuses and no others", async () => {
    stubSheet([row()]);
    renderWithProviders(<GroupMealsPage />);

    const group = await screen.findByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((b) => b.textContent),
    ).toEqual(["Авсан", "Аваагүй", "Хэсэгчлэн", "Тусгай хоол"]);
  });

  it("shows an empty roster as an empty state", async () => {
    stubSheet([]);
    renderWithProviders(<GroupMealsPage />);

    expect(await screen.findByText("Бүлэгт хүүхэд алга")).toBeInTheDocument();
  });

  it("reports a failed sheet load", async () => {
    stubSheet(undefined, [
      {
        path: MEALS_PATH,
        method: "GET",
        status: 500,
        body: { type: "about:blank", title: "Алдаа", status: 500, requestId: "test" },
      },
    ]);
    renderWithProviders(<GroupMealsPage />);

    expect(await screen.findByRole("button", { name: "Дахин оролдох" })).toBeInTheDocument();
  });
});

describe("хоолны цаг", () => {
  /** ★ One request for the first paint, not four. */
  it("defaults to BREAKFAST and fetches only that sitting", async () => {
    const { calls } = stubSheet();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");

    const sheetCalls = calls.filter((c) => c.method === "GET" && c.url.startsWith(MEALS_PATH));
    expect(sheetCalls).toHaveLength(1);
    expect(sheetCalls[0]!.url).toContain("kind=BREAKFAST");
    expect(screen.getByRole("button", { name: /Өглөө/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Өглөөний цай" })).toBeInTheDocument();
  });

  it("switching sitting fetches the newly selected one", async () => {
    const { calls } = stubSheet();
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    await u.click(screen.getByRole("button", { name: /Их үд/ }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "GET" && c.url.includes("kind=AFTERNOON_SNACK"))).toBe(
        true,
      ),
    );
    expect(await screen.findByRole("heading", { name: "Их үдийн цай" })).toBeInTheDocument();
  });

  /** All four `MealKind` members, including `EXTRA`. */
  it("offers every sitting the enum defines", async () => {
    stubSheet();
    renderWithProviders(<GroupMealsPage />);

    const picker = await screen.findByRole("group", { name: "Хоолны цаг" });
    expect(within(picker).getAllByRole("button")).toHaveLength(4);
    expect(within(picker).getByRole("button", { name: /Орой/ })).toBeInTheDocument();
  });
});

describe("огноо", () => {
  it("defaults to today and refetches on a new date", async () => {
    const { calls } = stubSheet();
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    const date = await screen.findByLabelText(/Огноо/);
    expect(date).toHaveValue(TODAY);

    await u.clear(date);
    await u.type(date, "2026-02-10");

    await waitFor(() =>
      expect(calls.some((c) => c.method === "GET" && c.url.includes("date=2026-02-10"))).toBe(true),
    );
  });

  /** The API refuses a future sitting; the picker says so before the request. */
  it("caps the date picker at today", async () => {
    stubSheet();
    renderWithProviders(<GroupMealsPage />);

    expect(await screen.findByLabelText(/Огноо/)).toHaveAttribute("max", TODAY);
  });

  /**
   * ★ A cleared `<input type="date">` sends the empty string, which the API's
   * `YYYY-MM-DD` regex answers with 400. The query is disabled instead.
   */
  it("does not fetch with an empty date", async () => {
    const { calls } = stubSheet();
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    const before = calls.filter((c) => c.method === "GET" && c.url.startsWith(MEALS_PATH)).length;

    await u.clear(await screen.findByLabelText(/Огноо/));

    // The roster unmounts with the disabled query — what matters is that no
    // request went out for it. `date=&kind=…` is a 400 the teacher could do
    // nothing about.
    await waitFor(() => expect(screen.queryByText("Батбаяр Ганболд")).toBeNull());
    const after = calls.filter((c) => c.method === "GET" && c.url.startsWith(MEALS_PATH));
    expect(after).toHaveLength(before);
    expect(after.every((c) => !c.url.includes("date=&"))).toBe(true);
  });
});

describe("хадгалаагүй өөрчлөлт", () => {
  it("marking a child stages the change without sending anything", async () => {
    const { calls } = stubSheet();
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    const group = screen.getByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" });
    await u.click(within(group).getByRole("radio", { name: "Авсан" }));

    expect(within(group).getByRole("radio", { name: "Авсан" })).toBeChecked();
    expect(screen.getByText("Хадгалаагүй")).toBeInTheDocument();
    expect(screen.getByText("1 хүүхдийн бүртгэл хадгалагдаагүй байна")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("counts several pending rows", async () => {
    stubSheet();
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    await u.click(
      within(screen.getByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" })).getByRole(
        "radio",
        {
          name: "Авсан",
        },
      ),
    );
    await u.click(
      within(screen.getByRole("radiogroup", { name: "Дорж Сараа — хоол" })).getByRole("radio", {
        name: "Аваагүй",
      }),
    );

    expect(screen.getByText("2 хүүхдийн бүртгэл хадгалагдаагүй байна")).toBeInTheDocument();
  });

  it("discarding restores the saved state and sends nothing", async () => {
    const { calls } = stubSheet([
      row({
        record: {
          id: RECORD_A,
          childId: CHILD_A,
          date: TODAY,
          kind: "BREAKFAST",
          status: "TAKEN",
          note: null,
        },
      }),
    ]);
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    const group = screen.getByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" });
    await u.click(within(group).getByRole("radio", { name: "Аваагүй" }));
    await u.click(screen.getByRole("button", { name: "Болих" }));

    expect(within(group).getByRole("radio", { name: "Авсан" })).toBeChecked();
    expect(screen.queryByText(/хадгалагдаагүй байна/)).toBeNull();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  /**
   * ★ A draft belongs to exactly one sitting.
   *
   * Carrying breakfast's marks into lunch would post them under the wrong
   * `kind`. The controls lock rather than clearing silently — twenty marks made
   * at a serving hatch is too much work to lose to a mistaken tap, and "Болих"
   * is one press away.
   */
  it("locks the sitting and date controls while marks are unsaved", async () => {
    stubSheet();
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    await u.click(
      within(screen.getByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" })).getByRole(
        "radio",
        {
          name: "Авсан",
        },
      ),
    );

    expect(screen.getByRole("button", { name: /Өдөр/ })).toBeDisabled();
    expect(screen.getByLabelText(/Огноо/)).toBeDisabled();
    // The one that is already selected stays pressable — it is a no-op.
    expect(screen.getByRole("button", { name: /Өглөө/ })).toBeEnabled();

    await u.click(screen.getByRole("button", { name: "Болих" }));
    expect(screen.getByRole("button", { name: /Өдөр/ })).toBeEnabled();
  });
});

describe("багц хадгалалт", () => {
  /**
   * ★★ One request for the whole sitting, carrying only the rows the teacher
   * marked. `MealStatus` has no "unrecorded" member, so an unmarked child has
   * no status to send — posting the whole roster would mean inventing one.
   */
  it("sends exactly one PUT with only the marked rows", async () => {
    const { calls } = stubSheet(undefined, [{ path: MEALS_PATH, method: "PUT", body: saved(1) }]);
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    await u.click(
      within(screen.getByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" })).getByRole(
        "radio",
        {
          name: "Авсан",
        },
      ),
    );
    await u.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const puts = calls.filter((c) => c.method === "PUT");
      expect(puts).toHaveLength(1);
      expect(puts[0]!.url).toBe(MEALS_PATH);
      expect(puts[0]!.body).toEqual({
        date: TODAY,
        kind: "BREAKFAST",
        entries: [{ childId: CHILD_A, status: "TAKEN", note: null }],
      });
    });
  });

  it("sends every marked child in the same request", async () => {
    const { calls } = stubSheet(undefined, [{ path: MEALS_PATH, method: "PUT", body: saved(2) }]);
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    await u.click(
      within(screen.getByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" })).getByRole(
        "radio",
        {
          name: "Тусгай хоол",
        },
      ),
    );
    await u.click(
      within(screen.getByRole("radiogroup", { name: "Дорж Сараа — хоол" })).getByRole("radio", {
        name: "Аваагүй",
      }),
    );
    await u.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const puts = calls.filter((c) => c.method === "PUT");
      expect(puts).toHaveLength(1);
      expect(puts[0]!.body).toMatchObject({
        entries: [
          { childId: CHILD_A, status: "SPECIAL" },
          { childId: CHILD_B, status: "NOT_TAKEN" },
        ],
      });
    });
  });

  /** No draft, no request — the API answers an empty batch with a 400 the
   *  teacher could do nothing about. */
  it("offers no save action when nothing is pending", async () => {
    stubSheet();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    expect(screen.queryByRole("button", { name: "Хадгалах" })).toBeNull();
  });

  /**
   * ★ The pending state, asserted by what it prevents rather than by its label.
   *
   * Catching "Хадгалж байна…" mid-flight is a race against a stub that resolves
   * in the same tick. What `disabled={save.isPending}` is actually for is the
   * double press — a teacher on a slow kindergarten connection tapping save
   * again because nothing visibly happened — and that is deterministic.
   */
  it("a second press cannot fire a second batch", async () => {
    const { calls } = stubSheet(undefined, [{ path: MEALS_PATH, method: "PUT", body: saved(1) }]);
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    await u.click(
      within(screen.getByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" })).getByRole(
        "radio",
        {
          name: "Авсан",
        },
      ),
    );

    const save = screen.getByRole("button", { name: "Хадгалах" });
    await u.click(save);
    await u.click(save);

    await waitFor(() => expect(screen.queryByText(/хадгалагдаагүй байна/)).toBeNull());
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("refetches the sitting, clears the draft and confirms with a toast", async () => {
    const { calls } = stubSheet(undefined, [{ path: MEALS_PATH, method: "PUT", body: saved(1) }]);
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    const before = calls.filter((c) => c.method === "GET" && c.url.startsWith(MEALS_PATH)).length;

    await u.click(
      within(screen.getByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" })).getByRole(
        "radio",
        {
          name: "Авсан",
        },
      ),
    );
    await u.click(screen.getByRole("button", { name: "Хадгалах" }));

    expect(await screen.findByText(/хоол бүртгэгдлээ/)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === "GET" && c.url.startsWith(MEALS_PATH)).length,
      ).toBeGreaterThan(before),
    );
    expect(screen.queryByText(/хадгалагдаагүй байна/)).toBeNull();
  });

  /** The draft survives a failure, so the marks can be retried rather than
   *  re-entered. */
  it("keeps the draft and reports the error when the save fails", async () => {
    stubSheet(undefined, [
      {
        path: MEALS_PATH,
        method: "PUT",
        status: 400,
        body: {
          type: "about:blank",
          title: "Мэдээлэл буруу байна",
          status: 400,
          requestId: "test",
          detail: "Хоолны огноо ирээдүйд байж болохгүй",
        },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    await u.click(
      within(screen.getByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" })).getByRole(
        "radio",
        {
          name: "Авсан",
        },
      ),
    );
    await u.click(screen.getByRole("button", { name: "Хадгалах" }));

    expect(await screen.findByText("Хоолны огноо ирээдүйд байж болохгүй")).toBeInTheDocument();
    expect(screen.getByText("1 хүүхдийн бүртгэл хадгалагдаагүй байна")).toBeInTheDocument();
    expect(screen.queryByText(/бүртгэгдлээ/)).toBeNull();
  });

  /** ★ There is no DELETE and no "unrecord": changing a saved mark to another
   *  status is the only correction the product offers. */
  it("changes an already-saved status", async () => {
    const { calls } = stubSheet(
      [
        row({
          record: {
            id: RECORD_A,
            childId: CHILD_A,
            date: TODAY,
            kind: "BREAKFAST",
            status: "TAKEN",
            note: null,
          },
        }),
      ],
      [{ path: MEALS_PATH, method: "PUT", body: saved(1) }],
    );
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    await u.click(
      within(screen.getByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" })).getByRole(
        "radio",
        {
          name: "Хэсэгчлэн",
        },
      ),
    );
    await u.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")!.body).toMatchObject({
        entries: [{ childId: CHILD_A, status: "PARTIAL" }],
      }),
    );
  });
});

describe("тэмдэглэл", () => {
  /** A note has nowhere to go without a status: `entries[]` requires one per
   *  row, so there is no note-only edit to make. */
  it("cannot be added before a status is chosen", async () => {
    stubSheet([row()]);
    renderWithProviders(<GroupMealsPage />);

    expect(
      await screen.findByRole("button", { name: "Батбаяр Ганболд — тэмдэглэл" }),
    ).toBeDisabled();
  });

  it("opens prefilled from the saved note", async () => {
    stubSheet([
      row({
        record: {
          id: RECORD_A,
          childId: CHILD_A,
          date: TODAY,
          kind: "BREAKFAST",
          status: "SPECIAL",
          note: "Харшлын улмаас тусгай хоол.",
        },
      }),
    ]);
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await u.click(await screen.findByRole("button", { name: "Батбаяр Ганболд — тэмдэглэл" }));

    expect(within(await screen.findByRole("dialog")).getByLabelText(/Тэмдэглэл/)).toHaveValue(
      "Харшлын улмаас тусгай хоол.",
    );
  });

  it("stages the note into the same batch as the status", async () => {
    const { calls } = stubSheet(
      [row(), secondRow],
      [{ path: MEALS_PATH, method: "PUT", body: saved(1) }],
    );
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    await u.click(
      within(screen.getByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" })).getByRole(
        "radio",
        {
          name: "Аваагүй",
        },
      ),
    );
    await u.click(screen.getByRole("button", { name: "Батбаяр Ганболд — тэмдэглэл" }));

    const dialog = await screen.findByRole("dialog");
    await u.type(within(dialog).getByLabelText(/Тэмдэглэл/), "Гэрээсээ хоолтой ирсэн.");
    await u.click(within(dialog).getByRole("button", { name: "Нэмэх" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await u.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")!.body).toMatchObject({
        entries: [{ childId: CHILD_A, status: "NOT_TAKEN", note: "Гэрээсээ хоолтой ирсэн." }],
      }),
    );
  });

  /** ★ Changing the status must not silently drop the note that explains it. */
  it("keeps a saved note when only the status changes", async () => {
    const { calls } = stubSheet(
      [
        row({
          record: {
            id: RECORD_A,
            childId: CHILD_A,
            date: TODAY,
            kind: "BREAKFAST",
            status: "SPECIAL",
            note: "Харшилтай.",
          },
        }),
      ],
      [{ path: MEALS_PATH, method: "PUT", body: saved(1) }],
    );
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await screen.findByText("Батбаяр Ганболд");
    await u.click(
      within(screen.getByRole("radiogroup", { name: "Батбаяр Ганболд — хоол" })).getByRole(
        "radio",
        {
          name: "Хэсэгчлэн",
        },
      ),
    );
    await u.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")!.body).toMatchObject({
        entries: [{ childId: CHILD_A, status: "PARTIAL", note: "Харшилтай." }],
      }),
    );
  });

  /** The DTO's own limit, enforced here because zod's overflow message is
   *  English and no screen in this product shows English. */
  it("refuses a note over 500 characters", async () => {
    stubSheet([
      row({
        record: {
          id: RECORD_A,
          childId: CHILD_A,
          date: TODAY,
          kind: "BREAKFAST",
          status: "TAKEN",
          note: null,
        },
      }),
    ]);
    const u = userEvent.setup();
    renderWithProviders(<GroupMealsPage />);

    await u.click(await screen.findByRole("button", { name: "Батбаяр Ганболд — тэмдэглэл" }));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText(/Тэмдэглэл/);

    expect(field).toHaveAttribute("maxLength", "500");
  });
});

describe("эрх", () => {
  /** `RequireRole roles={["TEACHER", "ADMIN"]}` gates the screen; the API
   *  refuses a parent independently with 404. */
  it("keeps a parent off the register entirely", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: MEALS_PATH, method: "GET", body: [row()] },
      { path: `/groups/${GROUP}`, method: "GET", body: { id: GROUP, name: "Дунд бүлэг" } },
    ]);
    renderWithProviders(<GroupMealsPage />);

    await waitFor(() => expect(screen.queryByText("Батбаяр Ганболд")).toBeNull());
    expect(screen.queryByRole("heading", { name: "Хоолны бүртгэл" })).toBeNull();
  });

  it("admits an admin", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: MEALS_PATH, method: "GET", body: [row()] },
      { path: `/groups/${GROUP}`, method: "GET", body: { id: GROUP, name: "Дунд бүлэг" } },
    ]);
    renderWithProviders(<GroupMealsPage />);

    expect(await screen.findByText("Батбаяр Ганболд")).toBeInTheDocument();
  });
});

/**
 * How the screen is reached.
 *
 * ★ The register has no sidebar entry, deliberately — like attendance and
 * assessment it cannot start without a group, so a menu item would open a
 * screen whose first act is "which group?". `groups-section.tsx` is the only
 * way in, and its own docstring names the failure this guards: without the
 * link the route is built, tested and unreachable, which is its own kind of
 * dead route. Someone tidying that card must fail a test, not ship a feature
 * nobody can open.
 */
describe("хүрэх зам", () => {
  const GROUP_B = "77777777-7777-4777-8777-777777777777";

  function stubGroups(items: unknown[]) {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups",
        method: "GET",
        body: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 },
      },
    ]);
  }

  it("links to the register from a single group's action card", async () => {
    stubGroups([{ id: GROUP, name: "Дунд бүлэг" }]);
    renderWithProviders(<GroupsSection />);

    const link = await screen.findByRole("link", { name: /Хоол/ });
    expect(link).toHaveAttribute("href", `/groups/${GROUP}/meals`);
    // Beside the two that were already there, not instead of them.
    expect(screen.getByRole("link", { name: /Ирц/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Үнэлгээ/ })).toBeInTheDocument();
  });

  it("links to the register from every row when a teacher covers several groups", async () => {
    stubGroups([
      { id: GROUP, name: "Дунд бүлэг" },
      { id: GROUP_B, name: "Ахлах бүлэг" },
    ]);
    renderWithProviders(<GroupsSection />);

    const links = await screen.findAllByRole("link", { name: /Хоол/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      `/groups/${GROUP}/meals`,
      `/groups/${GROUP_B}/meals`,
    ]);
  });
});

/**
 * The sizing contract, asserted on source.
 *
 * jsdom has no layout engine, so a `getBoundingClientRect` check here would
 * pass at every viewport while asserting nothing — `responsive.test.tsx` makes
 * the same point at length and checks the constraints instead. These pin the
 * three that keep a roster of four 44px controls usable on a 390px phone.
 */
describe("нарийвчилсан байрлал", () => {
  const GLOBALS_CSS = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

  const PAGE = readFileSync(
    join(__dirname, "..", "app", "(app)", "groups", "[groupId]", "meals", "page.tsx"),
    "utf8",
  );

  it("drops the status controls onto their own line on a phone", () => {
    expect(PAGE).toMatch(/flex basis-full flex-wrap gap-2 sm:basis-auto/);
  });

  it("lets the child name shrink and truncate", () => {
    expect(PAGE).toMatch(/block truncate font-medium text-ink/);
    expect(PAGE).toMatch(/flex min-w-0 flex-1 items-center gap-3/);
  });

  it("scrolls the sitting picker inside itself rather than widening the page", () => {
    expect(PAGE).toMatch(/-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0/);
  });

  it("keeps every control at or above the 44px touch floor", () => {
    // The status buttons and the sitting pills. A floor, not a count — pinning
    // the number would break this on an unrelated third control, and a
    // responsive test that fails for the wrong reason gets deleted.
    expect((PAGE.match(/min-h-\[44px\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  /**
   * ★ The literal became a token on 2026-08-29, and the reason is the point.
   *
   * This asserted `bottom-[76px]`, and 76px was a guess at the height of the
   * phone's bottom bar. Three other surfaces guessed it too — the toast
   * viewport and the assessment save bar at `4.5rem`, the floating chat button
   * at the same — and every one of them was wrong the moment the bar grew to
   * 79px, which happened when the tabs went to `min-h-[60px]` to fit "Явцын
   * үнэлгээ" on two lines. Measured in a browser: the chat button sat 7px
   * *under* the navigation.
   *
   * Pinning the token rather than the number is what makes the next change to
   * the bar's height one edit instead of four — and `globals.css` is where the
   * measurement is written down.
   */
  /*
   * ★★ Read from `components/register/save-bar.tsx`, not from this page —
   * 2026-09-03.
   *
   * The bar was copied markup in all three registers, which is what let them
   * drift apart on padding and on whether "Болих" disables while saving. It is
   * one component now (§6 asks these three to stay one pattern, and a pattern
   * that lives as three copies is one until somebody edits a copy).
   *
   * The assertion follows the code rather than the page, and it covers *more*
   * than it did: proving the shared bar clears the navigation proves it for
   * Ирц, Хоол ба цэс and Явцын үнэлгээ at once, where this file could only
   * ever speak for meals.
   */
  it("floats the save bar clear of the mobile navigation", () => {
    const saveBar = readFileSync(
      join(__dirname, "..", "components", "register", "save-bar.tsx"),
      "utf8",
    );
    expect(saveBar).toMatch(/sticky bottom-\[var\(--size-bottom-nav\)\] z-10 lg:bottom-4/);
    expect(GLOBALS_CSS).toMatch(/--size-bottom-nav:\s*5rem/);
  });
});
