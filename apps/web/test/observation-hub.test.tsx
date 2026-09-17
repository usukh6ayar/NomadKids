import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
const CREATIVE = "a3333333-3333-4333-8333-333333333333";

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
  const december = observedOn.startsWith("2026-12");
  return {
    id,
    childId: CHILD_ID,
    observedOn,
    observedTime: code === "daily" ? "09:30" : null,
    source: "TEACHER",
    reviewStatus: "APPROVED",
    visibleToParents: true,
    includeInReport: code === "daily",
    activityName: code === "daily" ? "Өглөөний дасгал" : null,
    indicatorLevel: code === "daily" ? 3 : null,
    indicator:
      code === "daily"
        ? {
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            code: "ХЯ3а",
            domainId: "a1111111-1111-4111-8111-111111111111",
          }
        : null,
    situation: `${observedOn} өдөр бичсэн ажиглалт`,
    domains:
      code === "daily"
        ? [
            {
              domain: {
                id: december
                  ? "a2222222-2222-4222-8222-222222222222"
                  : "a1111111-1111-4111-8111-111111111111",
                name: december ? "Математик" : "Хэл яриа",
                color: "#3b82f6",
              },
              level: null,
            },
          ]
        : [],
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
  // Filed under Зураг, урлал, which is the only strand Бүтээл offers.
  {
    ...observation("c6666666-6666-4666-8666-666666666666", ARTWORK, "artwork", "2026-09-22"),
    activityName: "Наамал",
    domains: [{ domain: { id: CREATIVE, name: "Зураг, урлал", color: "#10b981" }, level: null }],
  },
  // Sent in by a family: the Эцэг эх panel's only row.
  {
    ...observation("c5555555-5555-4555-8555-555555555555", DAILY, "daily", "2026-09-18"),
    source: "PARENT",
  },
];

/**
 * The conclusion the teacher wrote from the notes, as the API returns it.
 *
 * The stub answers every `?termId=`, so both terms carry it — which is what a
 * teacher with two terms written up would see.
 */
const TERM_REPORT = {
  id: "f1111111-1111-4111-8111-111111111111",
  exists: true,
  status: "FINAL",
  strengths: "Үг хэллэг нь өргөжсөн",
  needsSupport: null,
  nextGoals: null,
  adviceForParents: null,
  finalizedAt: "2026-12-01T00:00:00.000Z",
  author: { id: "f2222222-2222-4222-8222-222222222222", lastName: "Дорж", firstName: "Сараа" },
  observations: [
    {
      id: "c1111111-1111-4111-8111-111111111111",
      observedOn: "2026-09-15",
      activityName: "Өглөөний дасгал",
      situation: "2026-09-15 өдөр бичсэн ажиглалт",
      type: { id: DAILY, name: "Ажиглалт", code: "daily" },
    },
    {
      id: "c4444444-4444-4444-8444-444444444444",
      observedOn: "2026-09-20",
      activityName: null,
      situation: "2026-09-20 өдөр бичсэн ажиглалт",
      type: { id: CONVERSATION, name: "Ярилцлага", code: "conversation" },
    },
  ],
};

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
    // Before `/children/:id`, which `stubApi` would otherwise match first.
    { path: `/children/${CHILD_ID}/term-report`, body: TERM_REPORT },
    {
      path: `/children/${CHILD_ID}/artwork`,
      body: {
        artwork: [
          {
            id: "d1111111-1111-4111-8111-111111111111",
            caption: "9 сарын наамал",
            takenAt: "2026-09-22",
            uploadedAt: "2026-09-22T09:00:00.000Z",
            originalName: "naamal-9.jpg",
            observationId: "c6666666-6666-4666-8666-666666666666",
            observation: {
              activityName: "Наамал",
              observedOn: "2026-09-22",
              type: { code: "artwork" },
            },
          },
          {
            id: "d2222222-2222-4222-8222-222222222222",
            caption: "10 сарын наамал",
            takenAt: "2026-10-22",
            uploadedAt: "2026-10-22T09:00:00.000Z",
            originalName: "naamal-10.jpg",
            observationId: "c7777777-7777-4777-8777-777777777777",
            observation: {
              activityName: "Наамал",
              observedOn: "2026-10-22",
              type: { code: "artwork" },
            },
          },
        ],
        comparisons: [],
      },
    },
    { path: `/children/${CHILD_ID}`, body: CHILD },
    { path: `/kindergartens/${KINDERGARTEN_ID}/terms`, body: TERMS },
    {
      path: `/kindergartens/${KINDERGARTEN_ID}/assessment-config`,
      body: {
        domains: [
          { id: "a1111111-1111-4111-8111-111111111111", name: "Хэл яриа", order: 1 },
          { id: "a2222222-2222-4222-8222-222222222222", name: "Математик", order: 2 },
          { id: CREATIVE, name: "Зураг, урлал", code: "creative", order: 6 },
        ],
        levels: [],
      },
    },
    {
      path: `/kindergartens/${KINDERGARTEN_ID}/curriculum-indicators`,
      body: [
        {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          code: "ХЯ3а",
          domainId: "a1111111-1111-4111-8111-111111111111",
          levels: [{ level: 3, text: "Шинэ үг хэрэглэнэ" }],
        },
      ],
    },
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
   * ★ The three kinds are on the child's own screen — the client, 2026-09-17:
   * "хүүхэд дээр дарахаар ... ажиглалт, ярилцлага, бүтээл гэсэн 3 товчоо
   * нэмээд өг."
   *
   * Switching kinds used to mean going back to the group, pressing another
   * door and picking the same child again. Links rather than buttons, so Back
   * steps between them.
   */
  it("switches between the three kinds without leaving the child", async () => {
    openHub("daily");

    const switcher = await screen.findByRole("navigation", { name: "Тэмдэглэлийн төрөл" });
    expect(within(switcher).getByRole("link", { name: "Ажиглалт" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(switcher).getByRole("link", { name: "Ярилцлага" })).toHaveAttribute(
      "href",
      expect.stringContaining("observations?type=conversation"),
    );
    expect(within(switcher).getByRole("link", { name: "Бүтээл" })).toHaveAttribute(
      "href",
      expect.stringContaining("observations?type=artwork"),
    );
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
  /**
   * ★ One screen for all three kinds — the client, 2026-09-14: "ярилцлага,
   * бүтээл, ажиглалтыг ижил загвартай болго."
   *
   * Ярилцлага and Бүтээл used to draw four tiles and nothing else: no search,
   * no strand chart, and the create button one press deeper than Ажиглалт's.
   * What still differs is the wording, which is written out per kind because
   * "Шинээр ярилцлагын тэмдэглэл үүсгэх" is not "Шинээр {name} үүсгэх".
   */
  it("gives every kind the same screen, in its own words", async () => {
    openHub("conversation");

    expect(
      await screen.findByRole("link", { name: /Шинээр ярилцлагын тэмдэглэл үүсгэх/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Ярилцлагын тэмдэглэлээс хайх" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Шүүлтүүр" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  /**
   * ★ Ногоон · цэнхэр · улбар шар — one accent per kind, the client's own, and
   * the soft step of each: "зөөлөн сонгосон хэв маягийн ... гүн огт биш."
   */
  it("colours the conversation screen blue", async () => {
    openHub("conversation");

    expect(
      await screen.findByRole("link", { name: /Шинээр ярилцлагын тэмдэглэл үүсгэх/ }),
    ).toHaveClass("bg-sky-bright");
    const card = await screen.findByRole("article");
    expect(within(card).getByText("Ярилцлага")).toHaveClass("bg-sky-solid");
  });

  it("colours the observation screen green", async () => {
    openHub("daily");

    expect(await screen.findByRole("link", { name: /Шинээр ажиглалт үүсгэх/ })).toHaveClass(
      "bg-mint-bright",
    );
    const firstCard = (await screen.findAllByRole("article"))[0]!;
    expect(within(firstCard).getByText("Ажиглалт")).toHaveClass("bg-mint-solid");
  });

  it("colours the kind label below Багш green, blue or orange", async () => {
    openHub("artwork");

    const list = await screen.findByRole("region", { name: "Бичсэн бүтээл ба ахицын цуваа" });
    const card = within(list).getByRole("article");
    expect(within(card).getByText("Багш")).toBeInTheDocument();
    expect(within(card).getByText("Бүтээл")).toHaveClass("bg-peach-solid");
  });

  /**
   * ★ Дүгнэлт and Эцэг эх stopped being doors — the client's 2026-09-14 note:
   * "энэ явцын үнэлгээний дүгнэлт доор орсон тул дээрээ байх хэрэггүй".
   *
   * Both are panels at the foot of the screen, so a tile for each was a second
   * way to the same place — and two tiles of a phone's first viewport spent on
   * that is a viewport not spent on the records.
   */
  it("draws no summary doors on Ажиглалт, since both are panels below", async () => {
    openHub("daily");

    await screen.findByRole("tab", { name: "Дүгнэлт" });
    expect(screen.queryByRole("button", { name: "Дүгнэлт" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Эцэг эх" })).not.toBeInTheDocument();
    // The one door that still leads somewhere else.
    expect(screen.getByRole("link", { name: /Шинээр ажиглалт үүсгэх/ })).toBeInTheDocument();
  });

  /** Three tabs across the row, because a phone is where this is read. */
  it("fills the row with the three panels", async () => {
    openHub("daily");

    const strip = await screen.findByRole("tablist", { name: "Тэмдэглэл, эцэг эх ба дүгнэлт" });
    expect(strip).toHaveClass("grid-cols-3");
    expect(within(strip).getAllByRole("tab")).toHaveLength(3);
    within(strip)
      .getAllByRole("tab")
      .forEach((tab) => expect(tab).toHaveClass("w-full"));
  });

  /**
   * ★ Эцэг эх is the same list split by who wrote it.
   *
   * The door it replaces navigated to `?source=parent`, which this screen
   * never read — so it showed the unsplit list and looked broken.
   */
  it("keeps the family's notes in their own panel, and out of the teacher's", async () => {
    const user = userEvent.setup();
    openHub("daily");

    const list = await screen.findByRole("region", { name: "Бичсэн тэмдэглэл ба дүгнэлт" });
    expect(within(list).queryByText(/2026-09-18 өдөр/)).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Тэмдэглэлийн хугацаа")).toHaveTextContent("Нийт (3)");

    await user.click(within(list).getByRole("tab", { name: "Эцэг эх" }));

    const panel = await within(list).findByRole("tabpanel", { name: "Эцэг эх" });
    expect(within(panel).getByText(/2026-09-18 өдөр/)).toBeInTheDocument();
    expect(within(panel).queryByText(/2026-09-15 өдөр/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Тэмдэглэлийн хугацаа")).toHaveTextContent("Нийт (1)");
  });

  it("uses the artwork words, which are not parallel to the other two", async () => {
    openHub("artwork");

    const create = await screen.findByRole("link", { name: /Бүтээл нэмэх/ });
    expect(create).toHaveClass("bg-peach-bright");
    expect(screen.getByRole("searchbox", { name: "Бүтээлээс хайх" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Сургалтын чиглэл" })).not.toBeInTheDocument();
  });

  /**
   * ★ Бүтээл offers Зураг, урлал and nothing else — the client, 2026-09-14:
   * "бүтээл дээр зөвхөн зураг урлал чиглэл байх."
   *
   * The filter's half of the rule the compose form already applies when it
   * files an artwork note under `creative`. Matched on the strand's code: an
   * administrator may rename a strand (§2.3) and the code does not move.
   */
  it("offers Бүтээл only the Зураг, урлал strand", async () => {
    const user = userEvent.setup();
    openHub("artwork");

    await user.click(await screen.findByRole("button", { name: "Шүүлтүүр" }));
    const dialog = await screen.findByRole("dialog", { name: "Шүүлтүүр" });
    await user.click(within(dialog).getByLabelText("Сургалтын чиглэл"));

    expect(await screen.findByRole("option", { name: "Зураг, урлал" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Хэл яриа" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Математик" })).not.toBeInTheDocument();
  });

  it("filters artwork by the fixed artwork types instead of observation kinds", async () => {
    const user = userEvent.setup();
    openHub("artwork");

    await user.click(await screen.findByRole("button", { name: "Шүүлтүүр" }));
    const dialog = await screen.findByRole("dialog", { name: "Шүүлтүүр" });
    await user.click(within(dialog).getByLabelText("Төрөл"));

    for (const type of [
      "Зураг",
      "Наамал",
      "Баримал",
      "Зохион бүтээх",
      "Зохиомжлох",
      "Сэдэвчилсэн зураг",
      "Байгалийн материалаар бүтээх",
      "Дахивар материалаар бүтээх",
      "Холимог техникээр бүтээх",
      "Хамтын бүтээл хийх",
    ]) {
      expect(await screen.findByRole("option", { name: type })).toBeInTheDocument();
    }
    expect(screen.queryByRole("option", { name: "Ажиглалт" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Ярилцлага" })).not.toBeInTheDocument();
  });

  it("adds the next work with its type preselected and compares through a separate action", async () => {
    const user = userEvent.setup();
    openHub("artwork");

    await user.click(await screen.findByRole("tab", { name: "Ахицын цуваа" }));
    const panel = await screen.findByRole("tabpanel", { name: "Ахицын цуваа" });
    const add = await within(panel).findByRole("link", {
      name: "Наамал төрлийн шинэ бүтээл нэмэх",
    });
    const addUrl = new URL(add.getAttribute("href")!, "https://nomadkids.test");
    expect(addUrl.pathname).toBe(`/children/${CHILD_ID}/observations/new`);
    expect(addUrl.searchParams.get("type")).toBe("artwork");
    expect(addUrl.searchParams.get("activityName")).toBe("Наамал");
    expect(addUrl.searchParams.get("returnTo")).toBe("progress");

    expect(within(panel).queryByRole("button", { name: /харьцуулахад сонгох/ })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Харьцуулах" }));
    const choices = await within(panel).findAllByRole("button", {
      name: "Наамал бүтээлийг харьцуулахад сонгох",
    });

    await user.click(choices[0]!);
    expect(within(panel).getByText(/Наамал: дараагийн ижил төрлийн/)).toBeInTheDocument();
    await user.click(choices[1]!);

    expect(within(panel).getByText("Наамал — ахицын цуваа")).toBeInTheDocument();
    expect(within(panel).getByRole("textbox")).toBeInTheDocument();
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

    expect(await screen.findByLabelText("Тэмдэглэлийн хугацаа")).toHaveTextContent("Нийт (3)");
  });

  it("shows the learning domains as a compact chart for the selected month", async () => {
    const user = userEvent.setup();
    openHub("daily");

    expect(await screen.findByRole("searchbox", { name: "Ажиглалтаас хайх" })).toBeInTheDocument();
    await screen.findByLabelText("Сургалтын чиглэлийн сар");
    const dashboard = screen
      .getByRole("heading", { name: "Сургалтын чиглэл" })
      .closest('[data-ui="card"]') as HTMLElement;
    expect(
      within(dashboard).getByRole("img", { name: "Хэл яриа: 1 тэмдэглэл" }),
    ).toBeInTheDocument();

    await user.click(within(dashboard).getByLabelText("Сургалтын чиглэлийн сар"));
    await user.click(await screen.findByRole("option", { name: "12-р сар" }));
    expect(
      within(dashboard).getByRole("img", { name: "Математик: 1 тэмдэглэл" }),
    ).toBeInTheDocument();
    expect(within(dashboard).queryByText("Хэл яриа")).not.toBeInTheDocument();
  });

  it("counts the other kind separately", async () => {
    openHub("conversation");

    expect(await screen.findByLabelText("Тэмдэглэлийн хугацаа")).toHaveTextContent("Нийт (1)");
  });

  /**
   * ★ Улирлаар over the kindergarten's configured terms, not a fixed four.
   *
   * The design draws four; `Term` is administrator-editable (§2.3) and a
   * kindergarten may run three. Two are configured here, and two rows appear.
   */
  it("breaks the records down over the terms that exist", async () => {
    const user = userEvent.setup();
    openHub("daily");

    await user.click(await screen.findByLabelText("Тэмдэглэлийн хугацаа"));
    const options = await screen.findAllByRole("option");

    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("Нийт (3)");
    // September and October fall in the first term, December in the second.
    expect(options[1]).toHaveTextContent("1-р улирал (2)");
    expect(options[2]).toHaveTextContent("2-р улирал (1)");
  });

  it("opens the written observations from the total and then shows the full note", async () => {
    const user = userEvent.setup();
    openHub("daily");

    const list = await screen.findByRole("region", { name: "Бичсэн тэмдэглэл ба дүгнэлт" });
    expect(within(list).getByText(/2026-09-15 өдөр бичсэн ажиглалт/)).toBeInTheDocument();

    await user.click(within(list).getByRole("button", { name: /2026-09-15 өдөр/ }));
    const dialog = await screen.findByRole("dialog", { name: "Ажиглалт" });
    expect(dialog).toHaveTextContent("2026-09-15 өдөр бичсэн ажиглалт");
    expect(dialog).toHaveTextContent("Цаг09:30");
    expect(dialog).toHaveTextContent("Үйл ажиллагааны төрөлӨглөөний дасгал");
    expect(dialog).toHaveTextContent("Сургалтын чиглэлХэл яриа");
    expect(dialog).toHaveTextContent("ТүвшинIII түвшин");
    expect(dialog).toHaveTextContent("СҮД кодХЯ3а");
    expect(dialog).toHaveTextContent("Эцэг эх харна");
    expect(dialog).toHaveTextContent("PDF-д орно");
  });

  it("opens only the records from the pressed term", async () => {
    const user = userEvent.setup();
    openHub("daily");

    await user.click(await screen.findByLabelText("Тэмдэглэлийн хугацаа"));
    await user.click(await screen.findByRole("option", { name: "1-р улирал (2)" }));

    const list = screen.getByRole("region", { name: "Бичсэн тэмдэглэл ба дүгнэлт" });
    expect(within(list).queryByText(/2026-12-10 өдөр бичсэн/)).not.toBeInTheDocument();
  });

  it("shows staff metadata and no invented image on a text-only note card", async () => {
    openHub("daily");

    const list = await screen.findByRole("region", { name: "Бичсэн тэмдэглэл ба дүгнэлт" });
    expect(within(list).getAllByRole("article")).toHaveLength(3);
    const card = within(list).getAllByRole("article")[0]!;
    expect(within(card).getByText("Өглөөний дасгал")).toBeInTheDocument();
    expect(within(card).getByText("Хэл яриа")).toBeInTheDocument();
    expect(within(card).getByText("III түвшин")).toBeInTheDocument();
    expect(within(card).getByText("ХЯ3а")).toBeInTheDocument();
    expect(card.querySelector("dt")).not.toBeInTheDocument();

    // ★ An icon with a name, not a worded badge — the client's card drawing.
    expect(within(card).getByLabelText("Эцэг эх харна")).toBeInTheDocument();

    // A text-only note draws no photograph and invents no artwork here.
    expect(card.querySelector("img")).toBeNull();
  });

  it("offers edit and delete from the three-dot menu", async () => {
    const user = userEvent.setup();
    openHub("daily");

    const list = await screen.findByRole("region", { name: "Бичсэн тэмдэглэл ба дүгнэлт" });
    await user.click(within(list).getAllByRole("button", { name: "Тэмдэглэлийн үйлдэл" })[0]!);
    expect(screen.getByRole("menuitem", { name: "Засах" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Устгах" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Засах" }));
    expect(await screen.findByRole("dialog", { name: "Тэмдэглэл засах" })).toBeInTheDocument();
  });

  /**
   * ★ Засах shows every field the note was written with — the client,
   * 2026-09-14: "анх бичихэд байсан бүх талбарууд харагдаж."
   *
   * The editor used to offer a date, a term and one text box, and it **erased**
   * what it did not show: the kind, the strand, the level, the code and the two
   * visibility choices could not be corrected at all, and the narrative columns
   * of an older note were sent back as null on every save.
   */
  it("opens the editor with every field the note carries", async () => {
    const user = userEvent.setup();
    openHub("daily");

    const list = await screen.findByRole("region", { name: "Бичсэн тэмдэглэл ба дүгнэлт" });
    await user.click(within(list).getAllByRole("button", { name: "Тэмдэглэлийн үйлдэл" })[0]!);
    await user.click(screen.getByRole("menuitem", { name: "Засах" }));

    const dialog = await screen.findByRole("dialog", { name: "Тэмдэглэл засах" });
    expect(within(dialog).getByLabelText("Огноо")).toHaveValue("2026-09-15");
    expect(within(dialog).getByLabelText("Цаг")).toHaveValue("09:30");
    expect(within(dialog).getByLabelText("Тэмдэглэлийн төрөл")).toHaveTextContent("Ажиглалт");
    expect(within(dialog).getByLabelText("Үйл ажиллагааны төрөл")).toHaveTextContent(
      "Өглөөний дасгал",
    );
    expect(within(dialog).getByLabelText("Сургалтын чиглэл")).toHaveTextContent("Хэл яриа");
    expect(within(dialog).getByRole("radio", { name: "III түвшин" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(dialog).getByLabelText("Тэмдэглэл")).toHaveValue(
      "2026-09-15 өдөр бичсэн ажиглалт",
    );
    expect(within(dialog).getByRole("checkbox", { name: "Эцэг эх харах боломжтой" })).toBeChecked();
  });

  /** And saves them: the strand and the kind go back with the text. */
  it("sends the whole note back, not just its text", async () => {
    const user = userEvent.setup();
    setSearchParams("type=daily");
    const { calls } = stubHub();
    renderWithProviders(<ChildObservationsPage />);

    const list = await screen.findByRole("region", { name: "Бичсэн тэмдэглэл ба дүгнэлт" });
    await user.click(within(list).getAllByRole("button", { name: "Тэмдэглэлийн үйлдэл" })[0]!);
    await user.click(screen.getByRole("menuitem", { name: "Засах" }));

    const dialog = await screen.findByRole("dialog", { name: "Тэмдэглэл засах" });
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")?.body as Record<string, unknown>;
    expect(patch.domainIds).toEqual(["a1111111-1111-4111-8111-111111111111"]);
    expect(patch.typeId).toBe(DAILY);
    expect(patch.indicatorLevel).toBe(3);
    expect(patch.visibleToParents).toBe(true);
    expect(patch.observedTime).toBe("09:30");
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

  /**
   * ★ Буцах, the kind and the school year on one row — the client's drawing.
   *
   * The three were stacked down the top of the screen, and the year picker was
   * a scroll away among the note filters. They are one thought — where am I,
   * whose year am I reading — and on a phone the stack cost a third of the
   * first viewport before a single record.
   */
  it("puts Буцах, the kind and the school year on one row", async () => {
    openHub("daily");

    const header = await screen.findByRole("banner");
    expect(within(header).getByRole("link", { name: "Буцах" })).toBeInTheDocument();
    expect(within(header).getByRole("heading", { level: 1, name: "Ажиглалт" })).toBeInTheDocument();
    // The picker waits on the terms request, which names the school years.
    expect(await within(header).findByLabelText("Хичээлийн жил")).toHaveTextContent("2026-2027");
  });

  /**
   * ★ Шүүлтүүр narrows the list by a strand; search cannot.
   *
   * "Ажиглалтаас хайх" matches what a teacher typed into a note. The question
   * "which movement notes did I write" is about the strand the note was filed
   * under, which appears nowhere in its text.
   */
  it("filters the notes by learning domain from the Шүүлтүүр button", async () => {
    const user = userEvent.setup();
    openHub("daily");

    await user.click(await screen.findByRole("button", { name: "Шүүлтүүр" }));
    const dialog = await screen.findByRole("dialog", { name: "Шүүлтүүр" });

    await user.click(within(dialog).getByLabelText("Сургалтын чиглэл"));
    await user.click(await screen.findByRole("option", { name: "Математик" }));
    await user.click(within(dialog).getByRole("button", { name: "Харах" }));

    const list = await screen.findByRole("region", { name: "Бичсэн тэмдэглэл ба дүгнэлт" });
    expect(within(list).getByText(/2026-12-10 өдөр/)).toBeInTheDocument();
    expect(within(list).queryByText(/2026-09-15 өдөр/)).not.toBeInTheDocument();

    // The count says the short list is short because it was narrowed.
    expect(screen.getByRole("button", { name: "Шүүлтүүр" })).toHaveTextContent("1");
  });

  it("filters the notes by date, and Цэвэрлэх puts them all back", async () => {
    const user = userEvent.setup();
    openHub("daily");

    await user.click(await screen.findByRole("button", { name: "Шүүлтүүр" }));
    const dialog = await screen.findByRole("dialog", { name: "Шүүлтүүр" });
    fireEvent.change(within(dialog).getByLabelText("Эхлэх огноо"), {
      target: { value: "2026-10-01" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Харах" }));

    const list = await screen.findByRole("region", { name: "Бичсэн тэмдэглэл ба дүгнэлт" });
    expect(within(list).queryByText(/2026-09-15 өдөр/)).not.toBeInTheDocument();
    expect(within(list).getByText(/2026-10-02 өдөр/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Шүүлтүүр" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Шүүлтүүр" })).getByRole("button", {
        name: "Цэвэрлэх",
      }),
    );
    expect(await within(list).findByText(/2026-09-15 өдөр/)).toBeInTheDocument();
  });

  /** Төрөл reaches past the kind this screen is about, and the total follows. */
  it("widens to every kind through Төрөл", async () => {
    const user = userEvent.setup();
    openHub("daily");

    await user.click(await screen.findByRole("button", { name: "Шүүлтүүр" }));
    const dialog = await screen.findByRole("dialog", { name: "Шүүлтүүр" });
    await user.click(within(dialog).getByLabelText("Төрөл"));
    await user.click(await screen.findByRole("option", { name: "Бүх төрөл" }));
    await user.click(within(dialog).getByRole("button", { name: "Харах" }));

    const list = await screen.findByRole("region", { name: "Бичсэн тэмдэглэл ба дүгнэлт" });
    expect(within(list).getByText(/2026-09-20 өдөр/)).toBeInTheDocument();
    // Three daily, one conversation, one artwork — the family's is on its own
    // tab, which is what keeps this five rather than six.
    expect(screen.getByLabelText("Тэмдэглэлийн хугацаа")).toHaveTextContent("Нийт (5)");
  });

  /**
   * ★ The card carries the numeric date, the note's own dialog the written one.
   *
   * The client's card drawing says `2025.09.10`: on a card the date is a label
   * being matched against a register rather than a sentence being read. §5's
   * Mongolian rule is about the words, and the dialog — where the date is read
   * — still writes it out.
   */
  it("dates the card numerically and the dialog in words", async () => {
    const user = userEvent.setup();
    openHub("daily");

    const list = await screen.findByRole("region", { name: "Бичсэн тэмдэглэл ба дүгнэлт" });
    expect(within(list).getByText("2026.09.15")).toBeInTheDocument();

    await user.click(within(list).getByRole("button", { name: /2026-09-15 өдөр/ }));
    const dialog = await screen.findByRole("dialog", { name: "Ажиглалт" });
    expect(dialog).toHaveTextContent("2026 оны 9-р сарын 15");
  });

  /**
   * ★ Дүгнэлт beside the notes — the client's 2026-09-14 ask.
   *
   * "Багш бичсэн ажиглалт, тэмдэглэл, ярилцлагаасаа сонгон дүгнэлт бичнэ." The
   * conclusion is written from these records, so this is where a teacher reads
   * it back, and the citation says which of the notes it was written from.
   */
  it("shows the conclusions written from these notes under Дүгнэлт", async () => {
    const user = userEvent.setup();
    openHub("daily");

    const list = await screen.findByRole("region", { name: "Бичсэн тэмдэглэл ба дүгнэлт" });
    await user.click(within(list).getByRole("tab", { name: "Дүгнэлт" }));

    expect(within(list).getByRole("heading", { name: "Бичсэн дүгнэлтүүд" })).toBeInTheDocument();
    const panel = await within(list).findByRole("tabpanel", { name: "Дүгнэлт" });
    expect(within(panel).getByRole("heading", { name: "1. 1-р улирал" })).toBeInTheDocument();
    expect(within(panel).getAllByText("Үг хэллэг нь өргөжсөн")).toHaveLength(2);

    // The citation, by note rather than by count.
    expect(within(panel).getAllByText("9-р сарын 15 · Ажиглалт · Өглөөний дасгал")).toHaveLength(2);
    expect(within(panel).getAllByText("9-р сарын 20 · Ярилцлага")).toHaveLength(2);

    expect(within(panel).getByRole("link", { name: /Дүгнэлт бичих/ })).toHaveAttribute(
      "href",
      `/children/${CHILD_ID}/term-report`,
    );
  });

  /**
   * ★ Дүгнэлт shows what was written and the way to write the next.
   *
   * Pressing it used to land on Улирлын тайлан's blank form — the same mistake
   * the hub was built to undo, since a teacher opening Дүгнэлт is usually
   * asking what has already been said.
   */
  it("carries both the written conclusions and the way to write one", async () => {
    const user = userEvent.setup();
    openHub("daily");

    await user.click(await screen.findByRole("tab", { name: "Дүгнэлт" }));

    const panel = await screen.findByRole("tabpanel", { name: "Дүгнэлт" });
    expect(within(panel).getByRole("link", { name: /Дүгнэлт бичих/ })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "2. 2-р улирал" })).toBeInTheDocument();
  });

  /**
   * The period select filters notes by the term they were written in, which is
   * not a question the conclusions list answers — every one of them is a term.
   */
  it("keeps the note period filter to the Тэмдэглэл tab", async () => {
    const user = userEvent.setup();
    openHub("daily");

    expect(await screen.findByLabelText("Тэмдэглэлийн хугацаа")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Дүгнэлт" }));
    expect(screen.queryByLabelText("Тэмдэглэлийн хугацаа")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Тэмдэглэл" }));
    expect(await screen.findByLabelText("Тэмдэглэлийн хугацаа")).toBeInTheDocument();
  });
});
