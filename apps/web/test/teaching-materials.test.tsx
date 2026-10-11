import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, selectOption, sessionFor, stubApi } from "./support/render";
import DocumentsPage from "@/app/(app)/documents/page";
import { MATERIALS_NOT_READY } from "@/lib/materials";

/*
 * ★ Сургалтын хэрэглэгдэхүүн — 2026-10-09, the client: lessons NomadKids
 * sells to teachers one by one through QPay, teachers only. Contract:
 * `lib/materials.ts`.
 */
afterEach(() => vi.unstubAllGlobals());

const material = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: "Тоо 1–5: тоолж, харьцуулъя",
  area: "Математик",
  level: "II",
  fileType: "PPT",
  price: 12000,
  owned: false,
  ...overrides,
});

const page = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 50,
  total: items.length,
  totalPages: 1,
});

async function openMaterials(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("tab", { name: "Сургалтын хэрэглэгдэхүүн" }));
}

/** «Миний сан» opens first; the shop is the second tab. */
async function openStore(user: ReturnType<typeof userEvent.setup>) {
  await openMaterials(user);
  await user.click(screen.getByRole("tab", { name: "Дэлгүүр" }));
}

describe("the teaching materials tab", () => {
  it("is offered to a teacher and not to a director", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["ADMIN"]) }]);
    const director = renderWithProviders(<DocumentsPage />);
    expect(await screen.findByRole("heading", { name: "Баримт бичгийн сан" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Сургалтын хэрэглэгдэхүүн" })).toBeNull();
    director.unmount();
    vi.unstubAllGlobals();

    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"]) }]);
    renderWithProviders(<DocumentsPage />);
    expect(
      await screen.findByRole("tab", { name: "Сургалтын хэрэглэгдэхүүн" }),
    ).toBeInTheDocument();
  });

  it("shows a sample shop while the endpoint is missing, filters it, and sells nothing", async () => {
    const user = userEvent.setup();
    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"]) }]);
    renderWithProviders(<DocumentsPage />);
    await openStore(user);

    expect(await screen.findByText(/Жишээ хэрэглэгдэхүүн харагдаж байна/)).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(4);
    // Search, and ⚙ for сургалтын чиглэл and түвшин — 2026-10-09.
    await user.type(screen.getByRole("searchbox", { name: "Хэрэглэгдэхүүн хайх" }), "намар");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    await user.clear(screen.getByRole("searchbox", { name: "Хэрэглэгдэхүүн хайх" }));
    await user.click(screen.getByRole("button", { name: "Шүүлтүүр" }));
    await selectOption(user, "Сургалтын чиглэлээр шүүх", "Хөгжим");
    expect(screen.getAllByRole("article")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Худалдаж авах" }));
    expect(await screen.findByText(MATERIALS_NOT_READY)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("buys a material through QPay and says so once it is paid", async () => {
    const user = userEvent.setup();
    const attempt = {
      id: "11111111-1111-4111-8111-111111111111",
      amount: "12000.00",
      qrText: "qr",
      qrImage: "iVBORw0KGgo=",
      expiresAt: null,
      paidAt: null,
    };
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/materials/m1/qpay", method: "POST", body: { ...attempt, status: "PENDING" } },
      {
        path: "/materials/m1/qpay",
        body: { ...attempt, status: "PAID", paidAt: "2026-10-10T01:00:00.000Z" },
      },
      { path: "/materials", body: page([material("m1")]) },
    ]);
    renderWithProviders(<DocumentsPage />);
    await openStore(user);

    const card = await screen.findByRole("article", { name: "Тоо 1–5: тоолж, харьцуулъя" });
    expect(within(card).getByText("12,000₮")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Худалдаж авах" }));

    const dialog = await screen.findByRole("dialog", { name: "Тоо 1–5: тоолж, харьцуулъя" });
    expect(await within(dialog).findByText("Төлбөр амжилттай хийгдлээ")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST" && c.url === "/materials/m1/qpay")).toBe(true);
  });

  it("lists what the teacher owns, each downloaded through the checked route", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/me/materials", body: [material("m1", { owned: true })] },
    ]);
    renderWithProviders(<DocumentsPage />);
    await openMaterials(user);
    // «Миний сан» is first and open.
    expect(
      screen
        .getAllByRole("tab")
        .map((t) => t.textContent)
        .slice(-2),
    ).toEqual(["Миний сан", "Дэлгүүр"]);
    expect(screen.getByRole("tab", { name: "Миний сан" })).toHaveAttribute("aria-selected", "true");

    const link = await screen.findByRole("link", { name: /Татах/ });
    expect(link.getAttribute("href")).toMatch(/\/materials\/m1\/download$/);
    // Owned: no price on the shelf.
    expect(screen.queryByText("12,000₮")).toBeNull();
  });

  it("searches and filters the teacher's own shelf too", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/me/materials",
        body: [
          material("m1", { owned: true }),
          material("m2", {
            owned: true,
            title: "Миний гэр бүл",
            area: "Хэл яриа",
            level: "III",
            fileType: "PDF",
          }),
        ],
      },
    ]);
    renderWithProviders(<DocumentsPage />);
    await openMaterials(user);

    expect(await screen.findAllByRole("article")).toHaveLength(2);
    await user.type(screen.getByRole("searchbox", { name: "Хэрэглэгдэхүүн хайх" }), "гэр бүл");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    await user.clear(screen.getByRole("searchbox", { name: "Хэрэглэгдэхүүн хайх" }));

    await user.click(screen.getByRole("button", { name: "Шүүлтүүр" }));
    await selectOption(user, "Түвшнээр шүүх", "II түвшин");
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Тоо 1–5: тоолж, харьцуулъя",
    ]);
  });

  /*
    ★ «Урьдчилан харах» — sample pages, the contents and the price before
    buying, never the file (client, 2026-10-09).
  */
  it("pages through the sample pages and buys from the preview", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/materials/m1/qpay",
        method: "POST",
        body: {
          id: "11111111-1111-4111-8111-111111111111",
          status: "PENDING",
          amount: "12000.00",
          qrText: null,
          qrImage: null,
          expiresAt: null,
          paidAt: null,
        },
      },
      {
        path: "/materials",
        body: page([
          material("m1", {
            previewUrls: ["/media/p1", "/media/p2", "/media/p3"],
            contents: ["1–5 хүртэл тоолох", "Их, бага харьцуулах"],
            pages: 12,
          }),
        ]),
      },
    ]);
    renderWithProviders(<DocumentsPage />);
    await openStore(user);

    const card = await screen.findByRole("article", { name: "Тоо 1–5: тоолж, харьцуулъя" });
    await user.click(within(card).getByRole("button", { name: "Урьдчилан харах" }));
    const dialog = screen.getByRole("dialog", { name: "Тоо 1–5: тоолж, харьцуулъя" });

    expect(within(dialog).getByRole("img", { name: /жишээ хуудас 1$/ })).toHaveAttribute(
      "src",
      "/media/p1",
    );
    expect(within(dialog).getByText("1 / 3")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Дараагийн хуудас" }));
    expect(within(dialog).getByRole("img", { name: /жишээ хуудас 2$/ })).toHaveAttribute(
      "src",
      "/media/p2",
    );
    expect(within(dialog).getByText("Их, бага харьцуулах")).toBeInTheDocument();
    expect(within(dialog).getByText("12,000₮")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Худалдаж авах" }));
    await screen.findByText("QR кодыг банкны аппаараа уншуулж төлнө үү.");
    expect(api.calls.some((c) => c.method === "POST" && c.url === "/materials/m1/qpay")).toBe(true);
  });
});
