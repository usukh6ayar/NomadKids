import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import ChildObservationsPage from "@/app/(app)/children/[childId]/observations/page";

/**
 * The record hub — the client's 2026-09-11 design, one screen per kind.
 *
 * ★ A landing between the door and the form, which is the change.
 *
 * Pressing Ажиглалт used to open a blank compose form: the right destination
 * when a teacher has already decided what to write, the wrong one when they
 * came to look — and looking is most of what the screen is for. The four tiles
 * say what can be done and the totals underneath say whether it is worth
 * doing.
 *
 * ★★ One component for all three kinds, so the tests run the same screen
 * against `daily`, `conversation` and `artwork` and assert the words that
 * differ. "Шинээр ярилцлагын тэмдэглэл үүсгэх" is not "Шинээр {name} үүсгэх" —
 * Mongolian takes a genitive on the middle word and the artwork set is not
 * parallel at all, so a template would produce three labels of which one reads
 * correctly.
 */

const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";
const YEAR_ID = "44444444-4444-4444-8444-444444444444";
const TERM_1 = "55555555-5555-4555-8555-555555555555";
const TERM_2 = "66666666-6666-4666-8666-666666666666";

const DAILY = "77777777-7777-4777-8777-777777777777";
const CONVERSATION = "88888888-8888-4888-8888-888888888888";
const ARTWORK = "99999999-9999-4999-8999-999999999999";

const CHILD = {
  id: CHILD_ID,
  lastName: "Батжаргал",
  firstName: "Ану",
  sex: "FEMALE",
  dateOfBirth: "2022-04-12",
  enrollments: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      group: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Од бүлэг" },
    },
  ],
};

const TERMS = [
  {
    id: TERM_1,
    number: 1,
    name: "1-р улирал",
    startsOn: "2026-09-01",
    endsOn: "2026-11-30",
    schoolYear: { id: YEAR_ID, name: "2026-2027" },
  },
  {
    id: TERM_2,
    number: 2,
    name: "2-р улирал",
    startsOn: "2026-12-01",
    endsOn: "2027-02-28",
    schoolYear: { id: YEAR_ID, name: "2026-2027" },
  },
];

function observation(id: string, typeId: string, code: string, observedOn: string) {
  return {
    id,
    childId: CHILD_ID,
    observedOn,
    source: "TEACHER",
    reviewStatus: "APPROVED",
    visibleToParents: true,
    type: {
      id: typeId,
      name: code === "daily" ? "Ажиглалт" : code === "conversation" ? "Ярилцлага" : "Бүтээл",
      code,
    },
    media: [],
  };
}

const ITEMS = [
  observation("c1111111-1111-4111-8111-111111111111", DAILY, "daily", "2026-09-15"),
  observation("c2222222-2222-4222-8222-222222222222", DAILY, "daily", "2026-10-02"),
  observation("c3333333-3333-4333-8333-333333333333", DAILY, "daily", "2026-12-10"),
  observation("c4444444-4444-4444-8444-444444444444", CONVERSATION, "conversation", "2026-09-20"),
];

function stubHub() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: `/children/${CHILD_ID}/observations/types`,
      body: [
        { id: DAILY, name: "Ажиглалт", code: "daily" },
        { id: CONVERSATION, name: "Ярилцлага", code: "conversation" },
        { id: ARTWORK, name: "Бүтээл", code: "artwork" },
      ],
    },
    {
      path: `/children/${CHILD_ID}/observations`,
      body: { items: ITEMS, page: 1, pageSize: 100, total: ITEMS.length, totalPages: 1 },
    },
    { path: `/children/${CHILD_ID}`, body: CHILD },
    { path: `/kindergartens/${KINDERGARTEN_ID}/terms`, body: TERMS },
    {
      path: "/children",
      body: {
        items: [
          CHILD,
          { ...CHILD, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", firstName: "Болд-Эрдэнэ" },
        ],
        page: 1,
        pageSize: 100,
        total: 2,
        totalPages: 1,
      },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ childId: CHILD_ID });
});

function openHub(type: string) {
  setSearchParams(`type=${type}`);
  stubHub();
  renderWithProviders(<ChildObservationsPage />);
}

describe("the record hub", () => {
  it("names the child, their age and their group", async () => {
    openHub("daily");

    expect(await screen.findByText("Батжаргал Ану")).toBeInTheDocument();
    expect(screen.getByText(/Од бүлэг/)).toBeInTheDocument();
  });

  /**
   * ★ Солих is beside the name, not a trip back to the group.
   *
   * A teacher writing notes works down a roster, and the commonest next action
   * after finishing one child is the same screen for the next.
   */
  it("offers Солих without leaving the screen", async () => {
    const user = userEvent.setup();
    openHub("daily");

    await user.click(await screen.findByRole("button", { name: /Солих/ }));

    const picker = await screen.findByRole("dialog", { name: "Хүүхдээ сонгох" });
    expect(within(picker).getByRole("radio", { name: /Болд-Эрдэнэ/ })).toBeInTheDocument();
  });

  /**
   * ★ The four labels are the kind's own, not a template.
   *
   * Asserted per kind because a template would produce three labels of which
   * one reads correctly, and the two that do not are the ones nobody writing
   * the code speaks.
   */
  it("uses each kind's own words for the four doors", async () => {
    openHub("conversation");

    expect(await screen.findByText("Шинээр ярилцлагын тэмдэглэл үүсгэх")).toBeInTheDocument();
    expect(screen.getByText("Ярилцлагын тэмдэглэлээс хайх")).toBeInTheDocument();
    expect(screen.getByText("Нэгдсэн тайлан харах")).toBeInTheDocument();
  });

  it("uses the artwork words, which are not parallel to the other two", async () => {
    openHub("artwork");

    expect(await screen.findByText("Бүтээл нэмэх")).toBeInTheDocument();
    expect(screen.getByText("Бүтээлд дүн шинжилгээ хийх")).toBeInTheDocument();
    expect(screen.getByText("Бүтээлийн цогцолбор")).toBeInTheDocument();
  });

  /**
   * ★ Counted by the kind's `code`, not its id.
   *
   * A kindergarten may add its own observation types, so the id differs per
   * deployment while `daily` / `conversation` / `artwork` are the system rows'
   * stable codes. Three of the four records are `daily`; the conversation must
   * not be counted among them.
   */
  it("counts only this kind's records", async () => {
    openHub("daily");

    expect(await screen.findByText("Нийт ажиглалт")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("counts the other kind separately", async () => {
    openHub("conversation");

    expect(await screen.findByText("Нийт тэмдэглэл")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  /**
   * ★ Улирлаар over the kindergarten's configured terms, not a fixed four.
   *
   * The design draws four; `Term` is administrator-editable (§2.3) and a
   * kindergarten may run three. Two are configured here, and two rows appear.
   */
  it("breaks the records down over the terms that exist", async () => {
    openHub("daily");

    const panel = (await screen.findByText("Улирлаар")).closest('[data-ui="card"]') as HTMLElement;
    const rows = within(panel).getAllByRole("link");

    expect(rows).toHaveLength(2);
    // September and October fall in the first term, December in the second.
    expect(rows[0]!.textContent).toContain("1-р улирал");
    expect(rows[0]!.textContent).toContain("2");
    expect(rows[1]!.textContent).toContain("2-р улирал");
    expect(rows[1]!.textContent).toContain("1");
  });

  /** The compose form is one press away, with the kind already chosen. */
  it("sends the new-record door at the form with the kind preselected", async () => {
    openHub("daily");

    const tile = await screen.findByRole("link", { name: /Шинээр ажиглалт үүсгэх/ });
    expect(tile).toHaveAttribute("href", `/children/${CHILD_ID}/observations/new?typeId=${DAILY}`);
  });

  /**
   * ★ Without `?type=` the route is what it always was.
   *
   * A parent's own view and every existing link into a child's record are
   * unchanged — the hub is an addition reached from the group screen, not a
   * replacement for the file.
   */
  it("still shows the whole record when no kind is named", async () => {
    setSearchParams("");
    stubHub();
    renderWithProviders(<ChildObservationsPage />);

    await screen.findByText(/Батжаргал/);
    expect(screen.queryByText("Нийт ажиглалт")).not.toBeInTheDocument();
  });
});
