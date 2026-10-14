import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
  type RouteStub,
} from "./support/render";
import { SharedMaterial } from "@/components/materials/shared-material";
import DocumentsPage from "@/app/(app)/documents/page";

/*
 * ★ A shared link to one teaching material — 2026-10-14, the user: anyone
 * opens it and sees the sample pages; only a teacher buys, signing in or up
 * first and coming back to it.
 */
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  setParams({ id: "m1" });
  setSearchParams("");
});

const MATERIAL = {
  id: "m1",
  title: "Тоо 1–5: тоолж, харьцуулъя",
  description: "Тоолох, харьцуулах дасгал.",
  area: "Математик",
  level: "II",
  fileType: "PDF",
  price: 12000,
  previewUrl: null,
  previewUrls: ["/public/materials/m1/previews/0"],
  contents: ["Тоолох", "Харьцуулах"],
  pages: 12,
};

function renderShared(me: RouteStub, extra: RouteStub[] = []) {
  stubApi([...extra, me, { path: "/public/materials/m1", body: MATERIAL }]);
  renderWithProviders(<SharedMaterial />);
}

describe("a teaching material's shared page", () => {
  it("shows the material and its A4 sample to anyone, without signing in", async () => {
    renderShared({ path: "/auth/me", status: 401 });

    const page = await screen.findByRole("article", { name: "Тоо 1–5: тоолж, харьцуулъя" });
    expect(page).toHaveTextContent("PDF · Математик · II түвшин · 12 хуудас");
    expect(page.querySelector('[data-paper="a4-portrait"]')).not.toBeNull();
    expect(within(page).getByText("12,000₮")).toBeInTheDocument();
    expect(within(page).getByText("Харьцуулах")).toBeInTheDocument();
  });

  it("asks someone signed out to sign in, and brings them back to buy", async () => {
    renderShared({ path: "/auth/me", status: 401 });

    const buy = await screen.findByLabelText("Авах");
    expect(within(buy).getByRole("link", { name: "Нэвтэрч авах" })).toHaveAttribute(
      "href",
      `/login?from=${encodeURIComponent("/documents?material=m1")}`,
    );
    expect(within(buy).getByRole("button", { name: "Багшаар бүртгүүлэх" })).toBeInTheDocument();
  });

  it("sends a signed-in teacher to the shop on this material", async () => {
    renderShared({ path: "/auth/me", body: sessionFor(["TEACHER"]) });

    const buy = await screen.findByLabelText("Авах");
    expect(await within(buy).findByRole("link", { name: "Авах" })).toHaveAttribute(
      "href",
      "/documents?material=m1",
    );
  });

  it("tells anyone else it is for teachers", async () => {
    renderShared({ path: "/auth/me", body: sessionFor(["PARENT"]) });

    expect(
      await screen.findByText("Сургалтын хэрэглэгдэхүүнийг зөвхөн багш худалдаж авна."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Авах" })).toBeNull();
  });

  it("says so when the link leads nowhere", async () => {
    stubApi([{ path: "/auth/me", status: 401 }]);
    renderWithProviders(<SharedMaterial />);

    expect(await screen.findByText("Хэрэглэгдэхүүн олдсонгүй")).toBeInTheDocument();
  });

  it("opens the teacher's shop on the shared material", async () => {
    setSearchParams("material=m1");
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/me/materials", body: [] },
      {
        path: "/materials",
        body: {
          items: [{ ...MATERIAL, previewUrls: [], owned: false }],
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1,
        },
      },
    ]);
    renderWithProviders(<DocumentsPage />);

    const dialog = await screen.findByRole("dialog", { name: "Тоо 1–5: тоолж, харьцуулъя" });
    expect(within(dialog).getByRole("button", { name: "Авах" })).toBeEnabled();
  });
});

describe("copying a material's link", () => {
  it("copies the shared page's address from the catalog's «⋯»", async () => {
    const user = userEvent.setup();
    const { default: PlatformMaterialsPage } = await import("@/app/(app)/platform/materials/page");
    const base = sessionFor([]);
    stubApi([
      {
        path: "/auth/me",
        body: { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } },
      },
      {
        path: "/platform/materials",
        body: [
          {
            ...MATERIAL,
            published: true,
            sales: 0,
            fileName: "too.pdf",
            previewStatus: "MANUAL",
          },
        ],
      },
    ]);
    renderWithProviders(<PlatformMaterialsPage />);

    await user.click(
      await screen.findByRole("button", { name: /Тоо 1–5: тоолж, харьцуулъя — үйлдэл/ }),
    );
    await user.click(screen.getByRole("menuitem", { name: /Холбоос хуулах/ }));

    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/m/m1`);
    expect(await screen.findByText("Холбоос хуулагдлаа.")).toBeInTheDocument();
  });
});
