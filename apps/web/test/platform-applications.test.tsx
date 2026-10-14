import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import ApplicationsPage from "@/app/(app)/platform/applications/page";

/*
 * ★ Since #195 (2026-10-11) a kindergarten is priced per group. The operator
 * approves with the groups, the period, the rate and the total — pre-filled
 * from the application and the price sheet — and an application from before
 * still shows its child count.
 */
afterEach(() => vi.unstubAllGlobals());

const operator = () => {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
};

const APPLICATION = {
  id: "33333333-3333-4333-8333-333333333333",
  kindergartenName: "Аз жаргал цэцэрлэг",
  registrationNumber: "9012345",
  address: null,
  directorName: "Дорж Сараа",
  phone: "99112233",
  email: "azjargal@example.mn",
  childCount: null,
  groupCount: 6,
  billingPeriod: "year",
  note: null,
  status: "PENDING",
  reviewedAt: null,
  reviewNote: null,
  kindergartenId: null,
  createdAt: "2026-10-11T09:00:00.000Z",
  contract: null,
};

const LEGACY = {
  ...APPLICATION,
  id: "44444444-4444-4444-8444-444444444444",
  kindergartenName: "Хуучин цэцэрлэг",
  registrationNumber: "9099999",
  address: "Дархан",
  childCount: 80,
  groupCount: null,
  billingPeriod: null,
};

const list = (items: unknown[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 50,
  totalPages: 1,
});

describe("the operator's applications", () => {
  it("shows the groups of a new application and the children of an old one", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: list([APPLICATION, LEGACY]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    const table = await screen.findByRole("table");
    const row = (name: string) => within(table).getByText(name).closest("tr")!;
    expect(row("Аз жаргал цэцэрлэг")).toHaveTextContent("6");
    expect(row("Аз жаргал цэцэрлэг")).toHaveTextContent("Жилээр");
    expect(row("Хуучин цэцэрлэг")).toHaveTextContent("80 хүүхэд");
    expect(within(row("Хуучин цэцэрлэг")).getByText("Дархан")).toBeInTheDocument();
  });

  /*
   * ★ A minimal table with a search and a period filter — 2026-10-14, the user.
   */
  it("searches any column of the row and filters by the period, with a count", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: list([APPLICATION, LEGACY]) },
    ]);
    renderWithProviders(<ApplicationsPage />);
    const table = await screen.findByRole("table");
    const names = () =>
      [...table.querySelectorAll("tbody tr")].map(
        (tr) => tr.querySelectorAll("td")[1]!.textContent,
      );
    expect(screen.getByText("2 хүсэлт")).toBeInTheDocument();

    // The registration number, not the name.
    await user.type(screen.getByLabelText("Хүсэлт хайх"), "9099999");
    expect(names()).toEqual(["Хуучин цэцэрлэг"]);
    expect(screen.getByText("2-оос 1 хүсэлт")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Бүгдийг цэвэрлэх" }));
    expect(names()).toHaveLength(2);

    await user.click(screen.getByLabelText("Төлбөрийн хугацаагаар шүүх"));
    await user.click(screen.getByRole("option", { name: "Жилээр" }));
    expect(names()).toEqual(["Аз жаргал цэцэрлэг"]);
  });

  it("shows the contract once approved and the reason once refused", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: "/platform/applications?status=REJECTED",
        body: list([
          {
            ...APPLICATION,
            status: "REJECTED",
            reviewedAt: "2026-10-12T09:00:00.000Z",
            reviewNote: "Гэрчилгээ дутуу",
          },
        ]),
      },
      { path: "/platform/applications", body: list([APPLICATION]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByRole("button", { name: "Шалгах" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Татгалзсан" }));
    expect(await screen.findByText("Гэрчилгээ дутуу")).toBeInTheDocument();
    const refused = screen.getByRole("table");
    expect(within(refused).getByRole("columnheader", { name: /Шалтгаан/ })).toBeInTheDocument();
    expect(within(refused).getByRole("columnheader", { name: /Шийдвэрлэсэн/ })).toBeInTheDocument();
    expect(within(refused).queryByRole("button", { name: "Шалгах" })).toBeNull();
  });

  it("approves with the per-group terms, the total following the price sheet", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: `/platform/applications/${APPLICATION.id}/approve`,
        method: "POST",
        body: { ...APPLICATION, status: "APPROVED", invitationToken: "t", adminUsername: "az" },
      },
      { path: "/platform/applications", body: list([APPLICATION]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    await user.click(await screen.findByRole("button", { name: "Шалгах" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Бүлгийн тоо/)).toHaveValue("6");
    // 6 groups × 30,000₮ for the school year — the discounted price sheet.
    const breakdown = within(dialog).getByRole("region", { name: "Төлбөрийн задаргаа" });
    expect(breakdown).toHaveTextContent("Гэрээний нийт дүн180,000₮");

    await user.clear(within(dialog).getByLabelText(/Эрхлэгчийн нэвтрэх нэр/));
    await user.type(within(dialog).getByLabelText(/Эрхлэгчийн нэвтрэх нэр/), "azjargal");
    await user.click(within(dialog).getByRole("button", { name: "Гэрээ харах" }));
    await user.click(within(dialog).getByRole("button", { name: "Батлах" }));

    await waitFor(() => {
      const body = api.calls.find((call) => call.url.endsWith("/approve"))?.body;
      expect(body).toMatchObject({
        adminUsername: "azjargal",
        groupCount: 6,
        billingPeriod: "year",
        perGroupMonthlyFee: "4000",
        periodFee: "180000",
      });
    });
  });

  it("asks for the groups of an application made before the per-group price", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: list([LEGACY]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    await user.click(await screen.findByRole("button", { name: "Шалгах" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Бүлгийн тоо/)).toHaveValue("");
    const breakdown = within(dialog).getByRole("region", { name: "Төлбөрийн задаргаа" });
    expect(breakdown).toHaveTextContent("Бүлгийн тоо, гэрээний огноог оруулахад дүн бодогдоно.");

    await user.type(within(dialog).getByLabelText(/Бүлгийн тоо/), "3");
    // 3 groups × 30,000₮ for the year — the discounted price sheet.
    expect(breakdown).toHaveTextContent("Гэрээний нийт дүн90,000₮");
  });

  it("refuses only with a reason, and sends it", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: `/platform/applications/${APPLICATION.id}/reject`,
        method: "POST",
        body: { ...APPLICATION, status: "REJECTED", reviewNote: "Гэрчилгээ дутуу" },
      },
      { path: "/platform/applications", body: list([APPLICATION]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    await user.click(await screen.findByRole("button", { name: "Шалгах" }));
    const dialog = await screen.findByRole("dialog");
    const refuse = within(dialog).getByRole("button", { name: "Татгалзах" });
    expect(refuse).toBeDisabled();
    // Nor can it be approved without the director's login name.
    await user.clear(within(dialog).getByLabelText(/Эрхлэгчийн нэвтрэх нэр/));
    expect(within(dialog).getByRole("button", { name: "Батлах" })).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Тэмдэглэл/), "Гэрчилгээ дутуу");
    expect(refuse).toBeEnabled();
    await user.click(refuse);

    // Asked first: nothing is sent until it is confirmed.
    const confirm = await screen.findByRole("dialog", { name: /хүсэлтээс татгалзах уу/ });
    expect(confirm).toHaveTextContent("Шалтгаан: «Гэрчилгээ дутуу»");
    expect(api.calls.some((call) => call.url.endsWith("/reject"))).toBe(false);
    await user.click(within(confirm).getByRole("button", { name: "Татгалзах" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.url.endsWith("/reject"))?.body).toEqual({
        reviewNote: "Гэрчилгээ дутуу",
      }),
    );
    expect(api.calls.some((call) => call.url.endsWith("/approve"))).toBe(false);
  });

  it("reads each state from the API, and says what to wait for when none is there", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: list([]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    expect(await screen.findByText("Хүсэлт алга")).toBeInTheDocument();
    const states = screen.getByRole("group", { name: "Хүсэлтийн төлөв" });
    expect(within(states).getByRole("button", { name: "Хүлээгдэж буй" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(states).getByRole("button", { name: "Татгалзсан" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.url.includes("status=REJECTED"))).toBe(true),
    );
    expect(within(states).getByRole("button", { name: "Татгалзсан" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("filters by what the applicant is, «Цэцэрлэг» until the API says otherwise", async () => {
    const user = userEvent.setup();
    const SOLO = {
      ...APPLICATION,
      id: "55555555-5555-4555-8555-555555555555",
      kindergartenName: "Д.Сараа",
      kind: "solo",
    };
    const ESIS = {
      ...APPLICATION,
      id: "66666666-6666-4666-8666-666666666666",
      kindergartenName: "Нарлаг цэцэрлэг",
      kind: "esis",
    };
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: list([APPLICATION, SOLO, ESIS]) },
    ]);
    renderWithProviders(<ApplicationsPage />);
    const table = await screen.findByRole("table");
    const names = () =>
      [...table.querySelectorAll("tbody tr")].map(
        (tr) => tr.querySelectorAll("td")[1]!.textContent,
      );
    const row = (name: string) => within(table).getByText(name).closest("tr")!;
    expect(row("Аз жаргал цэцэрлэг")).toHaveTextContent("Цэцэрлэг"); // no `kind` sent
    expect(row("Д.Сараа")).toHaveTextContent("Багш дангаар");

    const pick = async (name: string) => {
      await user.click(screen.getByLabelText("Төрлөөр шүүх"));
      await user.click(screen.getByRole("option", { name }));
    };
    await pick("Багш дангаар");
    expect(names()).toEqual(["Д.Сараа"]);
    await pick("ЭСИС цэцэрлэг");
    expect(names()).toEqual(["Нарлаг цэцэрлэг"]);
    await pick("Цэцэрлэг");
    expect(names()).toEqual(["Аз жаргал цэцэрлэг"]);
    await pick("Бүгд");
    expect(names()).toHaveLength(3);
  });

  /*
   * ★ The price is worked out per term — 2026-10-14, the user: the discount on
   * the first term only (to 2026.11.30, 2,000₮ a group a month), the standard
   * 4,000₮ after, and the
   * contract's whole sum is what the PDF prints as «Нийт төлбөр».
   */
  it("breaks a termly contract into its terms and sends the contract's sum", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: `/platform/applications/${APPLICATION.id}/approve`,
        method: "POST",
        body: { ...APPLICATION, status: "APPROVED", invitationToken: "t", adminUsername: "az" },
      },
      {
        path: "/platform/applications",
        body: list([{ ...APPLICATION, groupCount: 3, billingPeriod: "term" }]),
      },
    ]);
    renderWithProviders(<ApplicationsPage />);

    await user.click(await screen.findByRole("button", { name: "Шалгах" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Эхлэх огноо/), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Дуусах огноо/), {
      target: { value: "2027-05-31" },
    });

    const breakdown = within(dialog).getByRole("region", { name: "Төлбөрийн задаргаа" });
    const lines = within(breakdown)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(lines).toEqual([
      "I улирал (9–11 сар)2,000₮ × 3 сар × 3 бүлэг18,000₮Хямдрал",
      "II улирал (12–2 сар)4,000₮ × 3 сар × 3 бүлэг36,000₮",
      "III улирал (3–5 сар)4,000₮ × 3 сар × 3 бүлэг36,000₮",
    ]);
    expect(breakdown).toHaveTextContent("Гэрээний нийт дүн90,000₮");
    expect(breakdown).toHaveTextContent("Суурь үнээр 108,000₮ — 18,000₮ хэмнэлт");

    await user.clear(within(dialog).getByLabelText(/Эрхлэгчийн нэвтрэх нэр/));
    await user.type(within(dialog).getByLabelText(/Эрхлэгчийн нэвтрэх нэр/), "azjargal");
    await user.click(within(dialog).getByRole("button", { name: "Гэрээ харах" }));
    await user.click(within(dialog).getByRole("button", { name: "Батлах" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.url.endsWith("/approve"))?.body).toMatchObject({
        groupCount: 3,
        billingPeriod: "term",
        perGroupMonthlyFee: "4000",
        periodFee: "90000",
      }),
    );
  });

  it("takes a negotiated sum only when asked to", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: `/platform/applications/${APPLICATION.id}/approve`,
        method: "POST",
        body: { ...APPLICATION, status: "APPROVED", invitationToken: "t", adminUsername: "az" },
      },
      { path: "/platform/applications", body: list([APPLICATION]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    await user.click(await screen.findByRole("button", { name: "Шалгах" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/Тохиролцсон нийт дүн/)).toBeNull();

    await user.click(within(dialog).getByRole("checkbox", { name: "Тохиролцсон үнээр өөрчлөх" }));
    await user.type(within(dialog).getByLabelText(/Тохиролцсон нийт дүн/), "150000");
    await user.clear(within(dialog).getByLabelText(/Эрхлэгчийн нэвтрэх нэр/));
    await user.type(within(dialog).getByLabelText(/Эрхлэгчийн нэвтрэх нэр/), "azjargal");
    await user.click(within(dialog).getByRole("button", { name: "Гэрээ харах" }));
    await user.click(within(dialog).getByRole("button", { name: "Батлах" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.url.endsWith("/approve"))?.body).toMatchObject({
        periodFee: "150000",
      }),
    );
  });

  it("says at once that the login name must be Latin", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: list([APPLICATION]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    await user.click(await screen.findByRole("button", { name: "Шалгах" }));
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText(/Эрхлэгчийн нэвтрэх нэр/));
    await user.type(within(dialog).getByLabelText(/Эрхлэгчийн нэвтрэх нэр/), "Сосорбурам");

    expect(
      within(dialog).getByText("Латин үсэг, тоо, . _ - тэмдэгтээр бичнэ үү"),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Батлах" })).toBeDisabled();
  });

  it("suggests the director's login name from the kindergarten's, in Latin", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: list([APPLICATION]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    await user.click(await screen.findByRole("button", { name: "Шалгах" }));
    const dialog = await screen.findByRole("dialog");
    // «Аз жаргал цэцэрлэг» — the organisation, not «Дорж Сараа».
    expect(within(dialog).getByLabelText(/Эрхлэгчийн нэвтрэх нэр/)).toHaveValue("az.jargal");
  });

  /*
   * ★ Read before it is signed — 2026-10-14, the user: what is approved cannot
   * be changed, so the contract is drawn first and can be printed.
   */
  it("shows the contract as it will print, and approves only after it was seen", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: list([APPLICATION]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    await user.click(await screen.findByRole("button", { name: "Шалгах" }));
    const dialog = await screen.findByRole("dialog");
    const approve = within(dialog).getByRole("button", { name: "Батлах" });
    expect(approve).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Гэрээ харах" }));
    const draft = within(dialog).getByTitle("Гэрээний төсөл");
    const html = draft.getAttribute("srcdoc") ?? "";
    expect(html).toContain("ТӨСӨЛ");
    expect(html).toContain("<th>Байгууллагын нэр</th><td>Аз жаргал цэцэрлэг</td>");
    expect(html).toContain("<th>Эрхлэгчийн нэр</th><td>Дорж Сараа</td>");
    expect(html).toContain("<th>Бүлгийн тоо</th><td>6</td>");
    expect(html).toContain("<th>Нийт төлбөр</th><td>180 000₮</td>");
    expect(within(dialog).getByRole("button", { name: "Хэвлэх" })).toBeInTheDocument();
    expect(approve).toBeEnabled();

    // Back to the form, which keeps what was typed.
    await user.click(within(dialog).getByRole("button", { name: "Засах руу буцах" }));
    expect(within(dialog).queryByTitle("Гэрээний төсөл")).toBeNull();
    expect(within(dialog).getByLabelText(/Эрхлэгчийн нэвтрэх нэр/)).toHaveValue("az.jargal");
  });

  it("asks for another look when a figure changes after the contract was seen", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: list([APPLICATION]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    await user.click(await screen.findByRole("button", { name: "Шалгах" }));
    const dialog = await screen.findByRole("dialog");
    const approve = within(dialog).getByRole("button", { name: "Батлах" });
    await user.click(within(dialog).getByRole("button", { name: "Гэрээ харах" }));
    await user.click(within(dialog).getByRole("button", { name: "Засах руу буцах" }));
    expect(approve).toBeEnabled();

    const groups = within(dialog).getByLabelText(/Бүлгийн тоо/);
    await user.clear(groups);
    await user.type(groups, "7");
    expect(approve).toBeDisabled();

    // Enter in a field does not get round it.
    await user.type(within(dialog).getByLabelText(/Эрхлэгчийн нэвтрэх нэр/), "{Enter}");
    expect(api.calls.some((call) => call.url.endsWith("/approve"))).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Гэрээ харах" }));
    expect(within(dialog).getByTitle("Гэрээний төсөл").getAttribute("srcdoc")).toContain(
      "<th>Бүлгийн тоо</th><td>7</td>",
    );
    expect(approve).toBeEnabled();
  });

  it("dates the contract by the school year running today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 1, 10)); // 2027-02-10, mid school year
    try {
      const user = userEvent.setup();
      stubApi([
        { path: "/auth/me", body: operator() },
        { path: "/platform/applications", body: list([APPLICATION]) },
      ]);
      renderWithProviders(<ApplicationsPage />);

      await user.click(await screen.findByRole("button", { name: "Шалгах" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByLabelText(/Эхлэх огноо/)).toHaveValue("2026-09-01");
      expect(within(dialog).getByLabelText(/Дуусах огноо/)).toHaveValue("2027-05-31");
    } finally {
      vi.useRealTimers();
    }
  });
});
