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
    await user.type(within(dialog).getByLabelText(/Үнэ/), "6000");
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
    await user.type(within(dialog).getByLabelText(/Үнэ/), "0");
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
  it("asks the server to draw the sample pages by default, with no pictures sent", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/materials", method: "POST", status: 201, body: {} },
      { path: "/platform/materials", body: [] },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    await user.click(await screen.findByRole("button", { name: "Нэмэх" }));
    const dialog = screen.getByRole("dialog", { name: "Хэрэглэгдэхүүн нэмэх" });
    expect(within(dialog).getByRole("radio", { name: /Автоматаар үүсгэх/ })).toBeChecked();
    expect(within(dialog).queryByLabelText(/Урьдчилан харах хуудас/)).toBeNull();
    await user.type(within(dialog).getByLabelText(/^Нэр/), "Намар");
    await selectOption(user, /Сургалтын чиглэл/, "Байгаль, нийгмийн орчин");
    await user.type(within(dialog).getByLabelText(/Үнэ/), "15000");
    await user.upload(
      within(dialog).getByLabelText(/^Файл/),
      new File(["x"], "namar.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const form = api.calls.find((c) => c.method === "POST")?.body as FormData;
      expect(form.get("autoPreview")).toBe("true");
      expect(form.getAll("previews")).toEqual([]);
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
});
