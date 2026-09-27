import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROUTER,
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import SurveysHubPage from "@/app/(app)/surveys/parents/page";
import { GroupSurveyBoard } from "@/components/survey/survey-board";

/**
 * Судалгаа, асуулга — the hub, 2026-09-10.
 *
 * ★ A screen whose whole job is a choice, so what is asserted is the choice.
 *
 * The two kinds shared one page behind a tab strip until this drawing arrived
 * and the client wrote "Энэ 2 тусдаа байх ёстой". The two links below are the
 * whole of that request; if they ever point at the same route, or one of them
 * disappears, the separation is gone and every other survey test still passes.
 *
 * ★★ The recent list is why this is not merely a menu. A hub of two links
 * costs a tap and answers nothing; "Сүүлийн үүсгэсэн" makes the landing worth
 * arriving at, and it links straight at the survey rather than routing through
 * whichever list it belongs to.
 */

const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";
const DELBEE_ID = "44444444-4444-4444-8444-444444444444";
const SOLONGO_ID = "55555555-5555-4555-8555-555555555555";

const GROUPS = [
  { id: DELBEE_ID, name: "Дэлбээ", _count: { enrollments: 24 } },
  { id: SOLONGO_ID, name: "Солонго", _count: { enrollments: 25 } },
];

const GROUP_PAGE = {
  items: GROUPS,
  page: 1,
  pageSize: 100,
  total: GROUPS.length,
  totalPages: 1,
};

const FORM = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Намрын эцэг эхийн уулзалт",
  description: null,
  category: "SATISFACTION",
  scope: "CHILD",
  kind: "FORM",
  status: "PUBLISHED",
  questions: [],
  group: null,
  createdById: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-09-01T00:00:00.000Z",
  publishedAt: "2026-09-02T00:00:00.000Z",
  closedAt: null,
};

const POLL = {
  ...FORM,
  id: "33333333-3333-4333-8333-333333333333",
  title: "Зугаалгын санал",
  kind: "POLL",
  status: "DRAFT",
};

function stubHub(items: Record<string, unknown>[] = [FORM, POLL]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/kindergartens/${KINDERGARTEN_ID}/surveys`, body: items },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
  setSearchParams("");
});

describe("the survey hub", () => {
  it("sends each kind to its own screen", async () => {
    stubHub();
    renderWithProviders(<SurveysHubPage />);

    // Anchored: the recent rows below name their kind too, since 2026-09-25.
    const form = await screen.findByRole("link", { name: /^Судалгаа/ });
    const poll = screen.getByRole("link", { name: /^Асуулга/ });

    expect(form).toHaveAttribute("href", "/surveys/forms");
    expect(poll).toHaveAttribute("href", "/surveys/polls");
  });

  /** A drawing and a name — the client's 2026-09-25 drawing drops the hint. */
  it("carries no hint line on the two cards", async () => {
    stubHub();
    renderWithProviders(<SurveysHubPage />);

    await screen.findByRole("link", { name: /^Судалгаа/ });
    expect(screen.queryByText("Олон асуулт, дэлгэрэнгүй хариулт")).toBeNull();
    expect(screen.queryByText("Нэг асуулт, шууд дүн")).toBeNull();
  });

  /*
    ★ REDESIGN 2026-09-12, to the client's own design: each choice card is built
    around its drawing, not around a tinted chip with a 20px glyph in it.

    Asserted as the drawing being *there and decorative* rather than by file
    name: `Art` owns which file a name resolves to, and a test that spelled the
    path would fail on an artwork swap that is not a regression. `alt=""` is the
    part that matters — the name beside it is the accessible one, and a drawing
    that announced itself would read the card's title twice.
  */
  it("★ builds each choice card around its drawing", async () => {
    stubHub();
    renderWithProviders(<SurveysHubPage />);

    for (const [label, href, artwork] of [
      ["Судалгаа", "/surveys/forms", "icon-teacher-survey-3d.png"],
      ["Асуулга", "/surveys/polls", "icon-teacher-poll-3d.png"],
    ] as const) {
      const card = await screen.findByRole("link", { name: new RegExp(`^${label}`) });
      expect(card).toHaveAttribute("href", href);

      const art = card.querySelector("img");
      expect(art).not.toBeNull();
      expect(art).toHaveAttribute("alt", "");
      expect(art?.getAttribute("src")).toContain(artwork);
    }
  });

  it("links the recent surveys straight at themselves", async () => {
    stubHub();
    renderWithProviders(<SurveysHubPage />);

    const recent = await screen.findByRole("link", { name: new RegExp(FORM.title) });
    expect(recent).toHaveAttribute("href", `/surveys/${FORM.id}`);
  });

  /**
   * ★ Both kinds appear in the recent list.
   *
   * It is the one place on the product where the two sit together, and that is
   * the point: what a teacher comes back for is usually what they made last,
   * whichever kind it was. Filtering it by kind would put the newest thing one
   * guess away.
   */
  it("mixes both kinds in what was made last", async () => {
    stubHub();
    renderWithProviders(<SurveysHubPage />);

    expect(await screen.findByText(FORM.title)).toBeInTheDocument();
    expect(screen.getByText(POLL.title)).toBeInTheDocument();
  });

  it("shows the school-year picker beside the title and filters survey rows", async () => {
    const user = userEvent.setup();
    const older = {
      ...FORM,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Өмнөх жилийн судалгаа",
      createdAt: "2025-10-01T00:00:00.000Z",
    };
    stubHub([FORM, older]);
    renderWithProviders(<SurveysHubPage />);

    const title = await screen.findByRole("heading", { name: "Эцэг эхээс авах судалгаа" });
    const header = title.closest("header")!;
    const year = within(header).getByRole("combobox", { name: "Хичээлийн жил" });
    expect(year).toHaveTextContent("2026–2027 он");
    expect(year).toHaveClass("text-compact", "sm:text-body");
    expect(within(header).getByRole("link", { name: "Буцах" })).toBeInTheDocument();
    expect(screen.queryByText("Эцэг эхийн санал, оролцоог хялбархан аваарай.")).toBeNull();
    expect(await screen.findByText(FORM.title)).toBeInTheDocument();
    expect(screen.queryByText(older.title)).toBeNull();

    await user.click(year);
    await user.click(await screen.findByRole("option", { name: "2025–2026 он" }));
    expect(await screen.findByText(older.title)).toBeInTheDocument();
    expect(screen.queryByText(FORM.title)).toBeNull();
  });

  /** The kind, in its own colour, under each recent row — 2026-09-25. */
  it("names each recent survey's kind", async () => {
    stubHub();
    renderWithProviders(<SurveysHubPage />);

    const poll = (await screen.findByText(POLL.title)).closest("a")!;
    expect(within(poll).getByText("Асуулга")).toHaveClass("italic", "text-mint-ink");
    const form = screen.getByText(FORM.title).closest("a")!;
    expect(within(form).getByText("Судалгаа")).toHaveClass("italic", "text-primary");
  });

  /** §5 — an empty state says what to do next. */
  it("tells a new kindergarten where to start", async () => {
    stubHub([]);
    renderWithProviders(<SurveysHubPage />);

    expect(await screen.findByText("Хараахан юу ч үүсгээгүй байна")).toBeInTheDocument();
  });

  it("shows management a searchable group launcher", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: `/kindergartens/${KINDERGARTEN_ID}/surveys`, body: [] },
      { path: "/groups", body: GROUP_PAGE },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<SurveysHubPage />);

    const delbee = await screen.findByRole("link", { name: /Дэлбээ 24 хүүхэд/ });
    expect(delbee).toHaveAttribute("href", `/surveys/groups/${DELBEE_ID}`);
    // Plain white rows since 2026-09-25 — no drawing in a tinted square.
    expect(delbee.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: /Солонго 25 хүүхэд/ })).toHaveAttribute(
      "href",
      `/surveys/groups/${SOLONGO_ID}`,
    );

    await user.type(screen.getByRole("searchbox", { name: "Бүлгийн нэрээр хайх" }), "Дэл");
    expect(screen.getByRole("link", { name: /Дэлбээ 24 хүүхэд/ })).toBeVisible();
    expect(screen.queryByRole("link", { name: /Солонго 25 хүүхэд/ })).toBeNull();
  });

  it("shows only surveys addressed to the selected group", async () => {
    const delbeeForm = {
      ...FORM,
      title: "Дэлбээний багшийн судалгаа",
      groupId: DELBEE_ID,
      createdById: "99999999-9999-4999-8999-999999999998",
    };
    const delbeePoll = {
      ...POLL,
      title: "Дэлбээний асуулга",
      groupId: DELBEE_ID,
    };
    const solongoForm = {
      ...FORM,
      id: "66666666-6666-4666-8666-666666666666",
      title: "Солонгын судалгаа",
      groupId: SOLONGO_ID,
    };
    const kindergartenWide = {
      ...FORM,
      id: "77777777-7777-4777-8777-777777777777",
      title: "Бүх бүлгийн судалгаа",
      groupId: null,
    };

    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: "/groups", body: GROUP_PAGE },
      {
        path: `/kindergartens/${KINDERGARTEN_ID}/surveys`,
        body: [delbeeForm, delbeePoll, solongoForm, kindergartenWide],
      },
    ]);
    renderWithProviders(<GroupSurveyBoard groupId={DELBEE_ID} />);

    expect(await screen.findByText("Дэлбээний багшийн судалгаа")).toBeInTheDocument();
    expect(screen.getByText("Дэлбээний асуулга")).toBeInTheDocument();
    expect(screen.queryByText("Солонгын судалгаа")).toBeNull();
    expect(screen.queryByText("Бүх бүлгийн судалгаа")).toBeNull();
  });
});

/**
 * Гарааны · Явцын · Үр дүнгийн үнэлгээ — client, 2026-09-18: three buttons
 * under the two "create" cards that sort surveys by wave.
 */
describe("the wave buttons", () => {
  const BASELINE_FORM = { ...FORM, period: "BASELINE" };
  const ENDLINE_POLL = { ...POLL, period: "ENDLINE" };

  it("offers Бүгд and the three waves under the create cards", async () => {
    stubHub([BASELINE_FORM, ENDLINE_POLL]);
    renderWithProviders(<SurveysHubPage />);

    const group = await screen.findByRole("group", { name: "Үнэлгээний төрлөөр ангилах" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Бүгд", "Гарааны үнэлгээ", "Явцын үнэлгээ", "Үр дүнгийн үнэлгээ"]);
    expect(within(group).getByRole("button", { name: "Үр дүнгийн үнэлгээ" })).toHaveClass(
      "text-compact",
      "sm:text-body",
    );
  });

  it("starts on Бүгд, and Бүгд takes the filter off", async () => {
    const user = userEvent.setup();
    stubHub([BASELINE_FORM, ENDLINE_POLL]);
    renderWithProviders(<SurveysHubPage />);

    expect(await screen.findByRole("button", { name: "Бүгд" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Бүгд" }));
    expect(ROUTER.replace).toHaveBeenCalledWith("/surveys/parents", { scroll: false });
  });

  it("puts the choice in the URL", async () => {
    const user = userEvent.setup();
    stubHub([BASELINE_FORM, ENDLINE_POLL]);
    renderWithProviders(<SurveysHubPage />);

    await user.click(await screen.findByRole("button", { name: "Гарааны үнэлгээ" }));
    expect(ROUTER.replace).toHaveBeenCalledWith("/surveys/parents?period=BASELINE", {
      scroll: false,
    });
  });

  it("lists only that wave's surveys, of both kinds, and presses its button", async () => {
    setSearchParams("period=ENDLINE");
    stubHub([BASELINE_FORM, ENDLINE_POLL]);
    renderWithProviders(<SurveysHubPage />);

    const section = (await screen.findByRole("heading", { name: "Үр дүнгийн үнэлгээ" })).closest(
      "section",
    )!;
    expect(await within(section).findByText("Зугаалгын санал")).toBeInTheDocument();
    expect(within(section).queryByText("Намрын эцэг эхийн уулзалт")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Үр дүнгийн үнэлгээ" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("says so when a wave has nothing yet", async () => {
    setSearchParams("period=MIDLINE");
    stubHub([BASELINE_FORM, ENDLINE_POLL]);
    renderWithProviders(<SurveysHubPage />);

    expect(await screen.findByText("Явцын үнэлгээ алга")).toBeInTheDocument();
  });
});
