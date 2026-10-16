import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROUTER,
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import NewObservationPage from "@/app/(app)/children/[childId]/observations/new/page";
import GroupResultsPage from "@/app/(app)/groups/[groupId]/results/page";
import ChildResultPage from "@/app/(app)/groups/[groupId]/results/[childId]/page";
import { a79Band, a79Csv, a79LevelForAge, a79Score } from "@/lib/a79-progress";
import { suggestA79 } from "@/lib/a79-suggest";

/*
 * ★ А/79 in the progress record — 2026-10-08, the client's design: a note
 * links to А/79 criteria with how the skill showed, and «Үр дүнгийн үнэлгээ»
 * reads a child's criteria back. Ready for the API in `lib/a79-progress.ts`.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const CHILD = "66666666-6666-4666-8666-666666666666";
const TYPE = "77777777-7777-4777-8777-777777777777";
const OBSERVATION = "dddddddd-dddd-4ddd-8ddd-000000000009";
const NOTE = "dddddddd-dddd-4ddd-8ddd-000000000002";

const CHILD_DETAIL = {
  id: CHILD,
  firstName: "Батбаяр",
  lastName: "Ганболд",
  sex: "MALE",
  // Two years old on any date this suite runs in 2026–2027 → level I.
  dateOfBirth: "2024-01-15",
  status: "ACTIVE",
  photoMediaFileId: null,
  enrollments: [],
  guardianships: [],
};

beforeEach(() => {
  window.localStorage.clear();
  ROUTER.replace.mockClear();
  setSearchParams("");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("А/79 scoring", () => {
  it("counts a criterion only when its latest evidence is «Бие даан»", () => {
    const score = a79Score({
      level: "I",
      criteria: [
        { number: 1, status: "INDEPENDENT", evidence: [] },
        { number: 2, status: "SUPPORTED", evidence: [] },
        { number: 12, status: "INDEPENDENT", evidence: [] },
      ],
    });
    expect(score.achieved).toBe(2);
    expect(score.total).toBe(37);
    expect(score.percent).toBe(5);
    const knowledge = score.byDomain.find((row) => row.domain === "Мэдлэг")!;
    expect(knowledge).toMatchObject({ achieved: 1, total: 11, percent: 9 });
  });

  it("bands at 80 and 50, and levels by age", () => {
    expect([a79Band(80), a79Band(79), a79Band(50), a79Band(49)]).toEqual([
      "MASTERED",
      "PROGRESSING",
      "PROGRESSING",
      "DEVELOPING",
    ]);
    expect([1, 2, 3, 4, 5, 6, null].map(a79LevelForAge)).toEqual([
      "I",
      "I",
      "II",
      "III",
      "IV",
      "IV",
      "I",
    ]);
  });
});

/*
 * ★ Word matching, not AI — the client's choice, 2026-10-08. What it finds and
 * what it deliberately does not.
 */
describe("А/79 result as Excel", () => {
  it("writes the summary, then a row per criterion with notes under their status", () => {
    const csv = a79Csv(
      { name: "Ганболд Батбаяр", age: 2 },
      {
        level: "I",
        criteria: [
          {
            number: 24,
            status: "INDEPENDENT",
            evidence: [
              {
                observationId: "a",
                observedOn: "2026-10-08",
                status: "INDEPENDENT",
                typeName: "Ажиглалт",
                note: "Том, жижиг алимийг ялгав.",
              },
              { observationId: "b", observedOn: "2026-09-22", status: "SUPPORTED" },
            ],
          },
        ],
      },
      (iso) => iso.replaceAll("-", "."),
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe('"Хүүхэд","Ганболд Батбаяр"');
    expect(lines[3]).toBe('"Бие даан илрүүлсэн","1 / 37 (3%)"');
    expect(csv).toContain(
      '"Хэсэг","№","Шалгуур","Одоогийн төлөв","Бие даан","Дэмжлэгтэй","Хөгжиж байна","Хараахан ажиглагдаагүй"',
    );
    expect(csv).toContain(
      '"Чадвар","24","Том, жижгийг ялгадаг.","Бие даан","2026.10.08 Ажиглалт — Том, жижиг алимийг ялгав.","2026.09.22","",""',
    );
    expect(csv).toContain(
      '"Мэдлэг","1","Чанаж болгоогүй хүнсийг идэж болохгүйг мэддэг.","Хараахан ажиглагдаагүй","","","",""',
    );
  });
});

describe("А/79 suggestions from a note's words", () => {
  const numbers = (text: string) => suggestA79(text, "I").map((row) => row.number);

  it("finds criteria through Mongolian suffixes, best first", () => {
    expect(
      numbers("Батбаяр 3 алимыг нэг нэгээр нь зааж зөв тоолов. Дараа нь том жижгийг нь ялгав."),
    ).toEqual([24, 23, 32]);
    expect(numbers("Бөмбөгийг урагш шидэв.")[0]).toBe(16);
  });

  /*
    ★ One word is enough when it names a skill — 2026-10-08, the client:
    "1 үг болон дөхүү язгуураас".
  */
  it("suggests on one specific word", () => {
    expect(numbers("Шидэв.")).toEqual([16]);
    expect(numbers("Тоолов.")).toEqual([23]);
    expect(suggestA79("Дүрсийг ялгав.", "III").map((row) => row.number)).toEqual([28, 29]);
  });

  it("matches a root that lost a vowel to its suffix", () => {
    // «үсрэв» ↔ «үсэрч», «жижгийг» ↔ «жижиг».
    expect(numbers("Хоёр хөлөөрөө үсрэв.")).toEqual([15]);
    expect(numbers("Жижгийг ялгав.")[0]).toBe(24);
  });

  it("does not match a different word that looks alike", () => {
    // халбага ≠ хэлбэр, барьж ≠ байршил.
    expect(numbers("Аяга халбагаа барьж хэрэглэв.")).not.toContain(29);
    expect(numbers("Аяга халбагаа барьж хэрэглэв.")).not.toContain(9);
    // хуваалцав ≠ хувцаслаж.
    expect(suggestA79("Тоглоомоо хуваалцав.", "III").map((row) => row.number)).toEqual([42]);
  });

  it("suggests nothing on one common word", () => {
    expect(numbers("Өнөөдөр сайхан тоглов.")).toEqual([]);
    expect(numbers("")).toEqual([]);
  });

  it("leaves out criteria already linked", () => {
    const left = suggestA79("том жижгийг ялгав, 3 хүртэл тоолов", "I", { exclude: [24] }).map(
      (row) => row.number,
    );
    expect(left).not.toContain(24);
    expect(left).toContain(23);
  });
});

describe("linking an observation to А/79", () => {
  function routes() {
    return [
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD}/observations/types`,
        body: [{ id: TYPE, name: "Өдөр тутмын ажиглалт", code: "daily" }],
      },
      {
        path: `/children/${CHILD}/observations`,
        method: "POST",
        status: 201,
        body: {
          id: OBSERVATION,
          childId: CHILD,
          observedOn: "2026-10-08",
          source: "TEACHER",
          reviewStatus: "APPROVED",
          visibleToParents: false,
          media: [],
        },
      },
      { path: `/children/${CHILD}`, body: CHILD_DETAIL },
      {
        path: `/kindergartens/${KG}/assessment-config`,
        body: { domains: [], levels: [] },
      },
    ];
  }

  it(
    "picks criteria, says how each showed, and sends them after the note",
    { timeout: 20_000 },
    async () => {
      const user = userEvent.setup();
      setParams({ childId: CHILD });
      const api = stubApi([
        {
          path: `/observations/${OBSERVATION}/a79-links`,
          method: "PUT",
          body: { links: [] },
        },
        ...routes(),
      ]);
      renderWithProviders(<NewObservationPage />);

      await user.click(await screen.findByRole("button", { name: "А/79 шалгуур нэмэх" }));
      const dialog = await screen.findByRole("dialog", { name: "А/79 шалгуур сонгох" });
      // The child is two, so the picker opens on level I.
      expect(within(dialog).getByText("3 хүртэлх тоглоом, юмсыг тоолдог.")).toBeInTheDocument();
      await user.type(within(dialog).getByRole("searchbox"), "тоол");
      await user.click(within(dialog).getByRole("checkbox", { name: "Ш23" }));
      await user.clear(within(dialog).getByRole("searchbox"));
      await user.click(within(dialog).getByRole("checkbox", { name: "Ш24" }));
      await user.click(within(dialog).getByRole("button", { name: "Сонгох (2)" }));

      const second = screen.getByRole("group", { name: "А/79 · I · Ш24" });
      expect(within(second).getByText("Том, жижгийг ялгадаг.")).toBeInTheDocument();
      await user.click(within(second).getByRole("radio", { name: /Дэмжлэгтэй/ }));
      await user.type(within(second).getByLabelText(/Тайлбар/), "2 алимийг ялгав.");

      await user.click(screen.getByRole("button", { name: "Хадгалах" }));

      await waitFor(() =>
        expect(
          api.calls.find((call) => call.method === "PUT" && call.url.endsWith("/a79-links"))?.body,
        ).toEqual({
          links: [
            { level: "I", number: 23, status: "INDEPENDENT", note: null },
            { level: "I", number: 24, status: "SUPPORTED", note: "2 алимийг ялгав." },
          ],
        }),
      );
    },
  );

  it(
    "offers criteria from what the teacher wrote, added with one press",
    { timeout: 20_000 },
    async () => {
      const user = userEvent.setup();
      setParams({ childId: CHILD });
      stubApi(routes());
      renderWithProviders(<NewObservationPage />);

      expect(screen.queryByRole("group", { name: "Тэмдэглэлд тохирох шалгуур" })).toBeNull();
      await user.type(await screen.findByLabelText("Тэмдэглэл"), "Том жижгийг нь зөв ялгав.");

      const suggested = screen.getByRole("group", { name: "Тэмдэглэлд тохирох шалгуур" });
      // Suggested, not ticked.
      expect(screen.queryByRole("group", { name: "А/79 · I · Ш24" })).toBeNull();
      await user.click(within(suggested).getByRole("button", { name: /^Ш24 нэмэх/ }));

      expect(screen.getByRole("group", { name: "А/79 · I · Ш24" })).toBeInTheDocument();
      // A linked criterion leaves the suggestions; the rest stay on offer.
      expect(within(suggested).queryByRole("button", { name: /^Ш24 нэмэх/ })).toBeNull();
      expect(within(suggested).getByRole("button", { name: /^Ш32 нэмэх/ })).toBeInTheDocument();
    },
  );

  it("removes a linked criterion from the note", { timeout: 20_000 }, async () => {
    const user = userEvent.setup();
    setParams({ childId: CHILD });
    stubApi(routes());
    renderWithProviders(<NewObservationPage />);

    await user.click(await screen.findByRole("button", { name: "А/79 шалгуур нэмэх" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: "Ш1" }));
    await user.click(within(dialog).getByRole("button", { name: "Сонгох (1)" }));
    expect(screen.getByRole("group", { name: "А/79 · I · Ш1" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "А/79 · I · Ш1 хасах" }));
    expect(screen.queryByRole("group", { name: "А/79 · I · Ш1" })).toBeNull();
  });
});

describe("«Үр дүнгийн үнэлгээ»", () => {
  it("lists the group's children by name, each opening their result", async () => {
    setParams({ groupId: GROUP });
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/groups/${GROUP}/a79-summary`,
        body: {
          children: [
            {
              childId: CHILD,
              firstName: "Батбаяр",
              lastName: "Ганболд",
              level: "I",
              achieved: 0,
              total: 37,
              byDomain: [],
            },
          ],
        },
      },
    ]);
    renderWithProviders(<GroupResultsPage />);

    const link = await screen.findByRole("link", { name: "Г.Батбаяр" });
    const row = link.closest("tr")!;
    expect(within(row).getByText("I")).toBeInTheDocument();
    expect(row.querySelector("img")).toBeNull();
    expect(link).toHaveAttribute("href", `/groups/${GROUP}/results/${CHILD}`);
    const nav = screen.getByRole("navigation", { name: "Үнэлгээний төрөл" });
    expect(within(nav).getByRole("link", { name: "Явцын үнэлгээ" })).toHaveAttribute(
      "href",
      `/groups/${GROUP}/assessment`,
    );
    expect(within(nav).getByRole("link", { name: "Үр дүнгийн үнэлгээ" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows each child's result by part, as on Тайлан", async () => {
    setParams({ groupId: GROUP });
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/groups/${GROUP}/a79-summary`,
        body: {
          children: [
            {
              childId: CHILD,
              firstName: "Ану",
              lastName: "Батжаргал",
              level: "III",
              achieved: 27,
              total: 46,
              byDomain: [
                { domain: "Мэдлэг", achieved: 4, total: 9 },
                { domain: "Чадвар", achieved: 16, total: 29 },
                { domain: "Төлөвшил", achieved: 8, total: 8 },
              ],
            },
          ],
        },
      },
    ]);
    renderWithProviders(<GroupResultsPage />);

    const table = await screen.findByRole("table", { name: "Хүүхэд бүрийн үр дүн" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["№", "Нэр", "Түвшин", "Мэдлэг", "Чадвар", "Төлөвшил", "Нийт", "Үр дүн"]);
    const row = within(table).getByRole("link", { name: "Б.Ану" }).closest("tr")!;
    expect(
      within(row)
        .getAllByRole("cell")
        .map((td) => td.textContent),
    ).toEqual(["1", "Б.Ану", "III", "44%", "55%", "100%", "59%", "Ахиж байна"]);
    expect(screen.queryByText(/Жишээ үр дүн/)).toBeNull();
  });

  it("shows the child's share of criteria met, by part and one by one", async () => {
    const user = userEvent.setup();
    setParams({ groupId: GROUP, childId: CHILD });
    const api = stubApi([
      {
        path: `/children/${CHILD}/observations/${NOTE}`,
        body: {
          id: NOTE,
          childId: CHILD,
          observedOn: "2026-10-08",
          source: "TEACHER",
          reviewStatus: "APPROVED",
          visibleToParents: false,
          situation: "Батбаяр 3 алимийг нэг нэгээр нь зааж зөв тоолов.",
          type: { id: TYPE, name: "Ажиглалт", code: "daily" },
          media: [],
        },
      },
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD}/a79-progress`,
        body: {
          level: "I",
          criteria: [
            {
              number: 23,
              status: "INDEPENDENT",
              evidence: [
                {
                  observationId: NOTE,
                  observedOn: "2026-10-08",
                  status: "INDEPENDENT",
                  typeName: "Ажиглалт",
                  note: "3 алимийг зөв тоолов.",
                },
                {
                  observationId: "dddddddd-dddd-4ddd-8ddd-000000000001",
                  observedOn: "2026-09-28",
                  status: "SUPPORTED",
                  typeName: "Ярилцлага",
                  note: "Сануулсны дараа тоолов.",
                },
              ],
            },
            { number: 24, status: "SUPPORTED", evidence: [] },
          ],
        },
      },
      { path: `/children/${CHILD}`, body: CHILD_DETAIL },
    ]);
    renderWithProviders(<ChildResultPage />);

    const summary = (await screen.findByText(/37 шалгуураас/)).closest("div")!;
    expect(summary).toHaveTextContent("37 шалгуураас 1-г бие даан илрүүлсэн.");
    expect(within(summary).getByText("Хөгжиж байна")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Чадвар: 5%" })).toBeInTheDocument();
    // A row per criterion; each note under the status it was given.
    const counted = screen.getByText("3 хүртэлх тоглоом, юмсыг тоолдог.").closest("tr")!;
    const cells = within(counted).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("2026.10.08Ажиглалт3 алимийг зөв тоолов.");
    expect(cells[2]).toHaveAccessibleName("Бие даан — одоогийн");
    expect(cells[3]).toHaveTextContent("2026.09.28Ярилцлага");
    expect(cells[4]).toBeEmptyDOMElement();
    // The column heads carry the part's share at each status.
    const skills = screen.getByRole("table", { name: /^Чадвар/ });
    const heads = within(skills).getAllByRole("columnheader");
    expect(heads[2]).toHaveTextContent("Бие даан5%");
    expect(heads[3]).toHaveTextContent("Дэмжлэгтэй5%");
    expect(heads[5]).toHaveTextContent("Хараахан ажиглагдаагүй91%");

    // Pressing a piece of evidence opens the note itself.
    await user.click(
      within(cells[2]!).getByRole("button", { name: /2026\.10\.08 Ажиглалт — нээх/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Ажиглалт" });
    expect(
      within(dialog).getByText("Батбаяр 3 алимийг нэг нэгээр нь зааж зөв тоолов."),
    ).toBeInTheDocument();
    expect(api.calls.some((call) => call.url === `/children/${CHILD}/observations/${NOTE}`)).toBe(
      true,
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const untouched = screen.getByText("Хоёр хөл дээрээ үсэрч буудаг.").closest("tr")!;
    expect(within(untouched).getByText("Ажиглалт холбогдоогүй")).toBeInTheDocument();
    expect(screen.queryByText(/Жишээ үр дүн/)).toBeNull();
  });

  /*
   * ★ No invented figures while the endpoint answers 404 — 2026-10-08. They
   * used to sit beside real children's names under a "sample" banner; with
   * the banner gone at the client's request, nothing would have said they
   * were made up.
   */
  it("says there is no result yet, and draws no figures, while the child's endpoint answers 404", async () => {
    setParams({ groupId: GROUP, childId: CHILD });
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD}/a79-progress`,
        status: 404,
        body: { title: "Not found", status: 404 },
      },
      { path: `/children/${CHILD}`, body: CHILD_DETAIL },
    ]);
    renderWithProviders(<ChildResultPage />);

    expect(await screen.findByText("Үр дүн хараахан гараагүй байна")).toBeInTheDocument();
    expect(screen.queryByText(/Жишээ/)).toBeNull();
    expect(screen.queryByText(/[Сс]ервер/)).toBeNull();
    expect(screen.queryByText(/шалгуураас/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says there is no result yet, and lists no child, while the group's endpoint answers 404", async () => {
    setParams({ groupId: GROUP });
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/groups/${GROUP}/a79-summary`,
        status: 404,
        body: { title: "Not found", status: 404 },
      },
      {
        path: "/children",
        body: {
          items: [{ ...CHILD_DETAIL, kindergartenId: KG }],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        },
      },
    ]);
    renderWithProviders(<GroupResultsPage />);

    expect(await screen.findByText("Үр дүн хараахан гараагүй байна")).toBeInTheDocument();
    expect(screen.queryByText(/Жишээ/)).toBeNull();
    expect(screen.queryByText(/[Сс]ервер/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Г.Батбаяр" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("narrows the tables to one part, and back to all", async () => {
    const user = userEvent.setup();
    setParams({ groupId: GROUP, childId: CHILD });
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/children/${CHILD}/a79-progress`, body: { level: "I", criteria: [] } },
      { path: `/children/${CHILD}`, body: CHILD_DETAIL },
    ]);
    renderWithProviders(<ChildResultPage />);

    const filter = await screen.findByRole("group", { name: "Хэсгээр шүүх" });
    expect(screen.getAllByRole("table")).toHaveLength(3);

    await user.click(within(filter).getByRole("button", { name: "Чадвар" }));
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByRole("table", { name: /^Чадвар/ })).toBeInTheDocument();

    await user.click(within(filter).getByRole("button", { name: "Бүгд" }));
    expect(screen.getAllByRole("table")).toHaveLength(3);
  });
});
