import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import AdminKindergartenPage from "@/app/(app)/admin/kindergarten/page";

/**
 * Байгууллага — the client's 2026-09-25 drawing.
 *
 * ★ Pinned: the ministry's fields stay empty until "ESIS татах" brings a LIVE
 * answer, a demo answer is never shown as the kindergarten's own, and Хадгалах
 * sends only what this record stores.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const DETAIL = {
  id: KG,
  name: "Нийслэлийн 115-р цэцэрлэг",
  address: "Улаанбаатар, Баянзүрх, 5-р хороо",
  phone: null,
  email: null,
  description: null,
  logoMediaFileId: null,
  capacity: 120,
};

function esis(source: "LIVE" | "MOCK") {
  const row = {
    shortName: "БЗД. 115-р цэцэрлэг",
    propertyTypeName: "Төрийн",
    institutionTypeName: "Цэцэрлэг",
    provinceName: "Улаанбаатар",
    districtName: "Баянзүрх",
  };
  return {
    resource: "organization",
    source,
    status: "SUCCEEDED",
    errorCode: null,
    count: 1,
    durationMs: 12,
    fields: [],
    rows: [row],
    response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: [row] },
  };
}

function stub(source: "LIVE" | "MOCK" = "LIVE") {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: `/kindergartens/${KG}/esis/resource?resource=organization`, body: esis(source) },
    { path: `/kindergartens/${KG}`, method: "PATCH", body: DETAIL },
    { path: `/kindergartens/${KG}`, body: DETAIL },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the kindergarten's details", () => {
  it("opens on the card, the two sections and Үндсэн мэдээлэл", async () => {
    stub();
    renderWithProviders(<AdminKindergartenPage />);

    expect(await screen.findByRole("heading", { name: "Үндсэн мэдээлэл" })).toBeInTheDocument();
    expect(screen.getByText("Нийслэлийн 115-р цэцэрлэг")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Байгууллагын мэдээлэл" });
    expect(within(nav).getByRole("button", { name: /Үндсэн мэдээлэл/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("button", { name: /Заах аргын нэгдэл/ })).toBeInTheDocument();
    // Two sections only, as drawn.
    expect(within(nav).getAllByRole("button")).toHaveLength(2);
    // "ESIS татах" is the one way to the ministry here; no panels repeat it.
    expect(screen.queryByText("Барилга байгууламж")).toBeNull();
    expect(screen.queryByText("Өрөө, танхим")).toBeNull();
    expect(screen.getByLabelText("Дэлгэрэнгүй хаяг")).toHaveValue(DETAIL.address);
  });

  it("fills the ministry's fields only from a live ESIS answer", async () => {
    const user = userEvent.setup();
    stub("LIVE");
    renderWithProviders(<AdminKindergartenPage />);

    const ownership = await screen.findByLabelText("Өмчийн хэлбэр");
    expect(ownership).toHaveValue("");
    await user.click(screen.getByRole("button", { name: /ESIS татах/ }));
    await waitFor(() => expect(ownership).toHaveValue("Төрийн"));
    expect(screen.getByLabelText("Товч нэр")).toHaveValue("БЗД. 115-р цэцэрлэг");
    expect(screen.getByLabelText("Дүүрэг")).toHaveValue("Баянзүрх");
    // No source for these at all.
    expect(screen.getByLabelText("Байршил")).toHaveValue("");
    expect(screen.getByLabelText("Хариуцалагч нэгж")).toHaveValue("");
  });

  it("saves only the address and capacity it stores", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<AdminKindergartenPage />);

    const address = await screen.findByLabelText("Дэлгэрэнгүй хаяг");
    await user.clear(address);
    await user.type(address, "Гудамж-14");
    await user.click(screen.getByRole("button", { name: /Хадгалах/ }));

    const patch = await vi.waitFor(() => {
      const call = api.calls.find((c) => c.method === "PATCH");
      expect(call).toBeDefined();
      return call!;
    });
    expect(patch.body).toEqual({ address: "Гудамж-14", capacity: 120, phone: null, email: null });
  });

  it("keeps contact in the same form, the unstored fields empty", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<AdminKindergartenPage />);

    expect(
      await screen.findByRole("heading", { name: "Холбоо барих мэдээлэл" }),
    ).toBeInTheDocument();
    for (const label of ["Вэб сайт", "Facebook", "Удирдлагын нэр", "Удирдлагын утас"]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
      expect(screen.getByLabelText(label)).toBeDisabled();
    }

    await user.type(screen.getByLabelText("Утас"), "77112233");
    await user.click(screen.getByRole("button", { name: /Хадгалах/ }));
    const patch = await vi.waitFor(() => {
      const call = api.calls.find((c) => c.method === "PATCH");
      expect(call).toBeDefined();
      return call!;
    });
    expect(patch.body).toMatchObject({ phone: "77112233" });
  });

  /*
    ★ Заах аргын нэгдэл as an empty shell — 2026-09-25. Nothing stores a union
    yet, so the list is empty, says why, and "Нэгдэл нэмэх" is disabled.
  */
  it("shows the method unions as an empty, honest list", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<AdminKindergartenPage />);

    await user.click(await screen.findByRole("button", { name: /Заах аргын нэгдэл/ }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Заах аргын нэгдэл" }),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Заах аргын нэгдлийн жагсаалт" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([
      "№",
      "Заах аргын нэгдлийн нэр",
      "Ахлагч багш",
      "Багшийн тоо",
      "Хичээлийн жил",
      "Үйлдэл",
    ]);
    expect(screen.getByText("Нэгдэл бүртгэгдээгүй байна")).toBeInTheDocument();
    expect(screen.getByText("Нийт: 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Нэгдэл нэмэх/ })).toBeDisabled();
    expect(screen.getByRole("link", { name: /ESIS татах/ })).toHaveAttribute(
      "href",
      "/admin/integrations/esis",
    );
  });
});
