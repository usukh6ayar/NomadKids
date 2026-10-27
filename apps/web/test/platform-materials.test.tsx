import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, selectOption, sessionFor, stubApi } from "./support/render";
import PlatformMaterialsPage from "@/app/(app)/platform/materials/page";

/*
 * ★ The operator's catalog of teaching materials — 2026-10-09. What the
 * teachers' shop sells; super-admin only. Contract: `lib/materials.ts`.
 */
afterEach(() => vi.unstubAllGlobals());

function operator() {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
}

const row = {
  id: "m1",
  title: "Тоо 1–5",
  area: "Математик",
  level: "II",
  fileType: "PPT",
  price: 12000,
  published: true,
  sales: 3,
  fileName: "too.pptx",
};

describe("the platform's teaching materials", () => {
  it("lists the catalog with price, sales and whether it is on sale", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials", body: [row] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    const table = await screen.findByRole("table", { name: "Сургалтын хэрэглэгдэхүүний каталог" });
    const line = within(table).getByText("Тоо 1–5").closest("tr")!;
    expect(within(line).getByText("12,000₮")).toBeInTheDocument();
    expect(within(line).getByText("3")).toBeInTheDocument();
    expect(within(line).getByText("Зарагдаж буй")).toBeInTheDocument();
  });

  it("shows what a material took only when the server says — never sales × price", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: "/platform/materials",
        body: [row, { ...row, id: "m2", title: "Өнгө", sales: 2, revenue: 18000 }],
      },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);
    const table = await screen.findByRole("table", { name: "Сургалтын хэрэглэгдэхүүний каталог" });
    // 3 × 12,000 would be 36,000₮ — not shown: the price may have changed since.
    expect(
      within(within(table).getByText("Тоо 1–5").closest("tr")!).getByText("—"),
    ).toBeInTheDocument();
    expect(
      within(within(table).getByText("Өнгө").closest("tr")!).getByText("18,000₮"),
    ).toBeInTheDocument();
  });

  it("finds a material by its name", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials", body: [row, { ...row, id: "m2", title: "Өнгө" }] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);
    await user.type(await screen.findByLabelText("Хэрэглэгдэхүүн хайх"), "өнг");
    const table = screen.getByRole("table", { name: "Сургалтын хэрэглэгдэхүүний каталог" });
    expect(within(table).getByText("Өнгө")).toBeInTheDocument();
    expect(within(table).queryByText("Тоо 1–5")).toBeNull();
  });

  it("uploads a PDF with its details as one multipart request", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials", method: "POST", status: 201, body: {} },
      { path: "/platform/materials", body: [] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    await user.click(await screen.findByRole("button", { name: "Нэмэх" }));
    const dialog = screen.getByRole("dialog", { name: "Хэрэглэгдэхүүн нэмэх" });
    await user.type(within(dialog).getByLabelText(/^Нэр/), "Хэмнэл мэдэрье");
    await selectOption(user, /Сургалтын чиглэл/, "Хөгжим");
    await user.type(within(dialog).getByLabelText(/^Үнэ \(₮\)/), "6000");
    await user.upload(
      within(dialog).getByLabelText(/^Файл/),
      new File(["%PDF-1.4"], "hemnel.pdf", { type: "application/pdf" }),
    );
    await user.click(within(dialog).getByRole("radio", { name: "Зургаа өөрөө оруулах" }));
    await user.upload(within(dialog).getByLabelText(/Урьдчилан харах хуудас/), [
      new File(["a"], "p1.png", { type: "image/png" }),
      new File(["b"], "p2.png", { type: "image/png" }),
    ]);
    await user.type(within(dialog).getByLabelText(/^Агуулга/), "Алга ташилт{enter}Хэмнэл");
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const body = api.calls.find((c) => c.method === "POST")?.body;
      expect(body).toBeInstanceOf(FormData);
      const form = body as FormData;
      expect(form.get("title")).toBe("Хэмнэл мэдэрье");
      expect(form.get("area")).toBe("Хөгжим");
      expect(form.get("price")).toBe("6000");
      expect((form.get("file") as File).name).toBe("hemnel.pdf");
      expect((form.getAll("previews") as File[]).map((f) => f.name)).toEqual(["p1.png", "p2.png"]);
      expect(form.getAll("contents")).toEqual(["Алга ташилт", "Хэмнэл"]);
      expect(form.get("autoPreview")).toBe("false");
    });
  });

  it("refuses a file that is neither PDF nor PowerPoint", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials", body: [] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    await user.click(await screen.findByRole("button", { name: "Нэмэх" }));
    const dialog = screen.getByRole("dialog", { name: "Хэрэглэгдэхүүн нэмэх" });
    await user.type(within(dialog).getByLabelText(/^Нэр/), "Зураг");
    await selectOption(user, /Сургалтын чиглэл/, "Зураг, урлал");
    await user.click(within(dialog).getByRole("radio", { name: "Үнэгүй" }));
    await user.upload(
      within(dialog).getByLabelText(/^Файл/),
      new File(["x"], "zurag.png", { type: "image/png" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    expect(within(dialog).getByText(/Зөвхөн PDF, PPT, PPTX/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  /*
    ★ Phase 2 — the server draws the sample pages from the file (2026-10-09).
  */
  /*
   * ★ 2026-10-11: the server cannot draw sample pages yet (Phase 2 — poppler
   * and LibreOffice are not in the image), so a new material asks for the
   * operator's own pictures by default and sends them.
   */
  it("asks for the operator's own sample pages by default, and sends them", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials", method: "POST", status: 201, body: {} },
      { path: "/platform/materials", body: [] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    await user.click(await screen.findByRole("button", { name: "Нэмэх" }));
    const dialog = screen.getByRole("dialog", { name: "Хэрэглэгдэхүүн нэмэх" });
    expect(within(dialog).getByRole("radio", { name: /Зургаа өөрөө оруулах/ })).toBeChecked();
    await user.type(within(dialog).getByLabelText(/^Нэр/), "Намар");
    await selectOption(user, /Сургалтын чиглэл/, "Байгаль, нийгмийн орчин");
    await user.type(within(dialog).getByLabelText(/^Үнэ \(₮\)/), "15000");
    await user.upload(
      within(dialog).getByLabelText(/^Файл/),
      new File(["x"], "namar.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
    );
    await user.upload(
      within(dialog).getByLabelText(/Урьдчилан харах хуудас/),
      new File(["p"], "page1.png", { type: "image/png" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const form = api.calls.find((c) => c.method === "POST")?.body as FormData;
      expect(form.get("autoPreview")).toBe("false");
      expect(form.getAll("previews")).toHaveLength(1);
    });
  });

  it("shows the sample pages' state and makes them again on request", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials/m1/previews/regenerate", method: "POST", status: 202, body: {} },
      { path: "/platform/materials", body: [{ ...row, previewStatus: "FAILED" }] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    const table = await screen.findByRole("table", { name: "Сургалтын хэрэглэгдэхүүний каталог" });
    expect(within(table).getByText("Амжилтгүй")).toBeInTheDocument();
    await user.click(within(table).getByRole("button", { name: "Тоо 1–5 — үйлдэл" }));
    await user.click(screen.getByRole("menuitem", { name: /Жишээ хуудас дахин үүсгэх/ }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.url === "/platform/materials/m1/previews/regenerate")).toBe(
        true,
      ),
    );
  });

  it("asks before taking a material off the shop, then removes it", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials/m1", method: "DELETE", status: 204 },
      { path: "/platform/materials", body: [row] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    await user.click(await screen.findByRole("button", { name: "Тоо 1–5 — үйлдэл" }));
    await user.click(screen.getByRole("menuitem", { name: "Устгах" }));
    // Nothing is sent before the confirmation (CLAUDE.md §5).
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);

    const confirm = screen.getByRole("dialog", { name: "Дэлгүүрээс хасах уу?" });
    // The three who bought it keep it — said with the count (2026-10-20).
    expect(confirm).toHaveTextContent("Худалдаж авсан 3 багш материалаа хадгалсаар байна");
    await user.click(within(confirm).getByRole("button", { name: "Устгах" }));

    await waitFor(() =>
      expect(api.calls.find((c) => c.method === "DELETE")?.url).toBe("/platform/materials/m1"),
    );
  });

  it("takes the price in whole tögrög only", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials", body: [] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    await user.click(await screen.findByRole("button", { name: "Нэмэх" }));
    const dialog = screen.getByRole("dialog", { name: "Хэрэглэгдэхүүн нэмэх" });
    await user.type(within(dialog).getByLabelText(/^Нэр/), "Тоо 1–5");
    await selectOption(user, /Сургалтын чиглэл/, "Зураг, урлал");
    await user.type(within(dialog).getByLabelText(/^Үнэ \(₮\)/), "12000.50");
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    expect(within(dialog).getByText("Үнийг бүхэл төгрөгөөр оруулна уу.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("says what to do when the catalog is empty", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials", body: [] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    expect(await screen.findByText("Хэрэглэгдэхүүн нэмээгүй байна")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  /*
   * ★ The learning area is optional — 2026-10-14, the user. The API still
   * needs one, so an unchosen area goes as «Бусад».
   */
  it("saves without a learning area, sending «Бусад»", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials", method: "POST", status: 201, body: {} },
      { path: "/platform/materials", body: [] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    await user.click(await screen.findByRole("button", { name: "Нэмэх" }));
    const dialog = screen.getByRole("dialog", { name: "Хэрэглэгдэхүүн нэмэх" });
    expect(within(dialog).getByText("Заавал биш", { selector: "*" })).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Нэр/), "Ерөнхий дасгал");
    await user.click(within(dialog).getByRole("radio", { name: "Үнэгүй" }));
    await user.upload(
      within(dialog).getByLabelText(/^Файл/),
      new File(["%PDF-1.4"], "dasgal.pdf", { type: "application/pdf" }),
    );
    await user.click(within(dialog).getByRole("radio", { name: "Зургаа өөрөө оруулах" }));
    await user.upload(within(dialog).getByLabelText(/Урьдчилан харах хуудас/), [
      new File(["a"], "p1.png", { type: "image/png" }),
    ]);
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const form = api.calls.find((c) => c.method === "POST")?.body as FormData;
      expect(form.get("title")).toBe("Ерөнхий дасгал");
      expect(form.get("area")).toBe("Бусад");
    });
  });

  /*
   * ★ «Дэлгүүр» beside «Нэмэх» — 2026-10-14, the user: the shop as the
   * teachers see it, from the platform's catalog: on-sale materials only,
   * nothing to buy.
   */
  it("shows the shop as teachers see it — on sale only, nothing to buy", async () => {
    const user = userEvent.setup();
    const hidden = { ...row, id: "m2", title: "Нуусан хичээл", published: false };
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials", body: [row, hidden] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    await screen.findByRole("table", { name: "Сургалтын хэрэглэгдэхүүний каталог" });
    const toggle = screen.getByRole("button", { name: "Дэлгүүр" });
    await user.click(toggle);

    const shop = await screen.findByRole("region", { name: "Дэлгүүрийн харагдац" });
    expect(within(shop).getByText("Тоо 1–5")).toBeInTheDocument();
    expect(within(shop).queryByText("Нуусан хичээл")).toBeNull();
    expect(within(shop).getByRole("button", { name: "Авах" })).toBeDisabled();

    // The sample pages open on an A4 sheet, and nothing reads as owned.
    await user.click(within(shop).getByRole("button", { name: "Харах" }));
    const preview = await screen.findByRole("dialog", { name: "Тоо 1–5" });
    expect(preview.querySelector('[data-paper="a4-landscape"]')).not.toBeNull();
    expect(within(preview).queryByText("Миний санд байгаа")).toBeNull();
    expect(within(preview).getByRole("button", { name: "Авах" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("table")).toBeNull();

    // And back to the catalog.
    await user.click(screen.getByRole("button", { name: "Каталог" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  /*
   * ★ «Үнэгүй» and «Хямдрал» in the add dialog — 2026-10-14, the user.
   */
  it("sends a free material as 0, and a discount below the price", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials", method: "POST", status: 201, body: {} },
      { path: "/platform/materials", body: [] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    await user.click(await screen.findByRole("button", { name: "Нэмэх" }));
    const dialog = screen.getByRole("dialog", { name: "Хэрэглэгдэхүүн нэмэх" });
    await user.type(within(dialog).getByLabelText(/^Нэр/), "Хэмнэл");
    await user.type(within(dialog).getByLabelText(/^Үнэ \(₮\)/), "10000");
    await user.click(within(dialog).getByRole("checkbox", { name: "Хямдрал зарлах" }));
    await user.type(within(dialog).getByLabelText(/Хямдралтай үнэ/), "12000");
    await user.upload(
      within(dialog).getByLabelText(/^Файл/),
      new File(["%PDF-1.4"], "h.pdf", { type: "application/pdf" }),
    );
    await user.click(within(dialog).getByRole("radio", { name: "Зургаа өөрөө оруулах" }));
    await user.upload(within(dialog).getByLabelText(/Урьдчилан харах хуудас/), [
      new File(["a"], "p1.png", { type: "image/png" }),
    ]);

    // A discount not below the price is refused.
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));
    expect(within(dialog).getByText(/Хямдралтай үнэ үндсэн үнээс бага/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);

    const cut = within(dialog).getByLabelText(/Хямдралтай үнэ/);
    await user.clear(cut);
    await user.type(cut, "7500");
    expect(dialog).toHaveTextContent("25% хямдрал");
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));
    await waitFor(() => {
      const form = api.calls.find((c) => c.method === "POST")?.body as FormData;
      expect(form.get("price")).toBe("10000");
      expect(form.get("discountPrice")).toBe("7500");
    });
  });

  /*
   * ★ 2026-10-26: the edit form opened with «Хямдрал зарлах» unticked, and a
   * save with no discount removes it — editing a title ended a running sale.
   */
  it("opens an edit on the running discount and saves it back", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials/m1", method: "PUT", body: {} },
      {
        path: "/platform/materials",
        body: [{ ...row, discountPrice: 9000, discountEndsOn: "2099-12-31" }],
      },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    const table = await screen.findByRole("table", { name: "Сургалтын хэрэглэгдэхүүний каталог" });
    await user.click(within(table).getByRole("button", { name: "Тоо 1–5 — үйлдэл" }));
    await user.click(screen.getByRole("menuitem", { name: /Засах/ }));
    const dialog = screen.getByRole("dialog", { name: "Хэрэглэгдэхүүн засах" });

    expect(within(dialog).getByRole("checkbox", { name: "Хямдрал зарлах" })).toBeChecked();
    expect(within(dialog).getByLabelText(/Хямдралтай үнэ/)).toHaveValue("9000");
    expect(within(dialog).getByLabelText(/Дуусах огноо/)).toHaveValue("2099-12-31");
    expect(dialog).toHaveTextContent("25% хямдрал");

    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));
    await waitFor(() => {
      const form = api.calls.find((c) => c.method === "PUT")?.body as FormData;
      expect(form.get("price")).toBe("12000");
      expect(form.get("discountPrice")).toBe("9000");
      expect(form.get("discountEndsOn")).toBe("2099-12-31");
    });
  });

  it("opens an edit unticked when the discount has already ended", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: "/platform/materials",
        body: [{ ...row, discountPrice: 9000, discountEndsOn: "2020-01-31" }],
      },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    const table = await screen.findByRole("table", { name: "Сургалтын хэрэглэгдэхүүний каталог" });
    await user.click(within(table).getByRole("button", { name: "Тоо 1–5 — үйлдэл" }));
    await user.click(screen.getByRole("menuitem", { name: /Засах/ }));
    const dialog = screen.getByRole("dialog", { name: "Хэрэглэгдэхүүн засах" });
    expect(within(dialog).getByRole("checkbox", { name: "Хямдрал зарлах" })).not.toBeChecked();
  });

  it("hides the price when the material is free", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials", body: [] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    await user.click(await screen.findByRole("button", { name: "Нэмэх" }));
    const dialog = screen.getByRole("dialog", { name: "Хэрэглэгдэхүүн нэмэх" });
    await user.click(within(dialog).getByRole("radio", { name: "Үнэгүй" }));
    expect(within(dialog).queryByLabelText(/^Үнэ \(₮\)/)).toBeNull();
    expect(within(dialog).queryByRole("checkbox", { name: "Хямдрал зарлах" })).toBeNull();
    expect(dialog).toHaveTextContent("Багш нар үнэгүй татаж авна.");
  });
});
