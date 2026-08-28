import { readFileSync } from "node:fs";
import { join } from "node:path";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import AdminSchoolYearsPage from "@/app/(app)/admin/school-years/page";

/**
 * Managing an existing school year — `PATCH /school-years/:id`.
 *
 * ★ The screen could create years and nothing else; the route had no caller.
 *
 * Two operations share that one route and the tests keep them apart, because
 * the payloads are what make them different:
 *
 *  - **Editing** sends `name`, `startsOn` and `endsOn` and deliberately omits
 *    `isCurrent`. `updateSchoolYearSchema` leaves the flag optional with no
 *    default, so omitting it is what stops a rename from clearing it.
 *  - **Promoting** sends `{ isCurrent: true }` and nothing else. The server
 *    demotes the previous holder in the same transaction — a change to a
 *    different row — so the screen re-reads the list rather than moving the
 *    badge itself.
 *
 * There is no delete or archive route for a school year, so this file asserts
 * no such control exists. `/admin/groups` has both and they are not the same
 * resource.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const CURRENT = "55555555-5555-4555-8555-555555555555";
const OLDER = "66666666-6666-4666-8666-666666666666";
const YEARS_PATH = `/kindergartens/${KG}/school-years`;

const current = {
  id: CURRENT,
  name: "2026-2027",
  isCurrent: true,
  startsOn: "2026-09-01T00:00:00.000Z",
  endsOn: "2027-06-01T00:00:00.000Z",
};

const older = {
  id: OLDER,
  name: "2025-2026",
  isCurrent: false,
  startsOn: "2025-09-01T00:00:00.000Z",
  endsOn: "2026-06-01T00:00:00.000Z",
};

function stubYears(years: unknown[] = [current, older], extra: Parameters<typeof stubApi>[0] = []) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    ...extra,
    { path: YEARS_PATH, body: years },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("хичээлийн жил засах", () => {
  it("renders an edit action for every year", async () => {
    stubYears();
    renderWithProviders(<AdminSchoolYearsPage />);

    expect(await screen.findByRole("button", { name: "2026-2027 — засах" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2025-2026 — засах" })).toBeInTheDocument();
  });

  /**
   * ★ The dates arrive as full ISO timestamps and `<input type="date">` accepts
   * only `YYYY-MM-DD` — seeded raw, both inputs would render blank and a save
   * would then post the empty string back.
   */
  it("prefills the name and both dates", async () => {
    stubYears();
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2026-2027 — засах" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText(/Нэр/)).toHaveValue("2026-2027");
    expect(within(dialog).getByLabelText(/Эхлэх/)).toHaveValue("2026-09-01");
    expect(within(dialog).getByLabelText(/Дуусах/)).toHaveValue("2027-06-01");
  });

  it("cancelling sends nothing", async () => {
    const { calls } = stubYears();
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2026-2027 — засах" }));
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Болих" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  /**
   * ★★ `isCurrent` is absent from the payload, and that absence is the test.
   *
   * The DTO would accept it. Sending `false` — or sending the checkbox state of
   * a form — would demote the year on every rename; sending `true` would move
   * the flag as a side effect of a typo fix. Omitted, the repository skips its
   * demotion and Prisma skips the column.
   */
  it("sends exactly the fields the DTO accepts, without the current-year flag", async () => {
    const { calls } = stubYears(undefined, [
      {
        path: `/school-years/${CURRENT}`,
        method: "PATCH",
        body: { ...current, name: "2026/2027" },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2026-2027 — засах" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText(/Нэр/);
    await u.clear(name);
    await u.type(name, "2026/2027");
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch).toBeDefined();
      expect(patch!.url).toBe(`/school-years/${CURRENT}`);
      expect(patch!.body).toEqual({
        name: "2026/2027",
        startsOn: "2026-09-01",
        endsOn: "2027-06-01",
      });
    });
  });

  it("submits changed dates as plain calendar dates", async () => {
    const { calls } = stubYears(undefined, [
      { path: `/school-years/${CURRENT}`, method: "PATCH", body: current },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2026-2027 — засах" }));
    const dialog = await screen.findByRole("dialog");
    await u.clear(within(dialog).getByLabelText(/Эхлэх/));
    await u.type(within(dialog).getByLabelText(/Эхлэх/), "2026-09-15");
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({
        startsOn: "2026-09-15",
      }),
    );
  });

  it("refetches the list and confirms with a toast", async () => {
    const { calls } = stubYears(undefined, [
      { path: `/school-years/${CURRENT}`, method: "PATCH", body: current },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2026-2027 — засах" }));
    await u.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Хадгалах" }),
    );

    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === "GET" && c.url.startsWith(YEARS_PATH)).length,
      ).toBeGreaterThan(1),
    );
    expect(await screen.findByText(/хадгалагдлаа/)).toBeInTheDocument();
  });

  it("closes only after a successful save", async () => {
    stubYears(undefined, [
      {
        path: `/school-years/${CURRENT}`,
        method: "PATCH",
        status: 500,
        body: { type: "about:blank", title: "Алдаа", status: 500, requestId: "test" },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2026-2027 — засах" }));
    const dialog = await screen.findByRole("dialog");
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    // The whole-form message, and the typed values still there to correct.
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Нэр/)).toHaveValue("2026-2027");
  });

  /** The server refines `endsOn > startsOn` at `path: ["endsOn"]`, so its
   *  Mongolian message lands under that input rather than at the top. */
  it("puts the date-order error under the end date and keeps the dialog open", async () => {
    stubYears(undefined, [
      {
        path: `/school-years/${CURRENT}`,
        method: "PATCH",
        status: 400,
        body: {
          type: "about:blank",
          title: "Мэдээлэл буруу байна",
          status: 400,
          requestId: "test",
          errors: { endsOn: ["Дуусах огноо эхлэх огнооноос хойш байх ёстой"] },
          detail: "Дуусах огноо эхлэх огнооноос хойш байх ёстой",
        },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2026-2027 — засах" }));
    const dialog = await screen.findByRole("dialog");
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    expect(
      await within(dialog).findByText("Дуусах огноо эхлэх огнооноос хойш байх ёстой"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  /**
   * ★ Empty fields are stopped here, and only because the server's message for
   * them is not Mongolian: `z.coerce.date()` rejects `""` with its own English
   * "Invalid date". The date *ordering* rule is left to the server, which has
   * proper copy for it — restating that one in the browser is how the two
   * drift.
   */
  it("refuses to send an empty name or an empty date", async () => {
    const { calls } = stubYears();
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2026-2027 — засах" }));
    const dialog = await screen.findByRole("dialog");
    await u.clear(within(dialog).getByLabelText(/Нэр/));
    await u.clear(within(dialog).getByLabelText(/Дуусах/));
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    expect(
      await within(dialog).findByText("Хичээлийн жилийн нэрийг оруулна уу"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Дуусах огноог сонгоно уу")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  /**
   * ★★ A server error does not outlive the request that produced it.
   *
   * The date-order 400 lands on `endsOn`. Emptying the name and submitting
   * again never reaches the server — and if the two error sources were merged
   * rather than chosen between, the form would show a stale complaint about a
   * date the user has not touched beside the real one about the name.
   */
  it("drops the previous server error when local validation stops the next submit", async () => {
    stubYears(undefined, [
      {
        path: `/school-years/${CURRENT}`,
        method: "PATCH",
        status: 400,
        body: {
          type: "about:blank",
          title: "Мэдээлэл буруу байна",
          status: 400,
          requestId: "test",
          errors: { endsOn: ["Дуусах огноо эхлэх огнооноос хойш байх ёстой"] },
          detail: "Дуусах огноо эхлэх огнооноос хойш байх ёстой",
        },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2026-2027 — засах" }));
    const dialog = await screen.findByRole("dialog");
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));
    await within(dialog).findByText("Дуусах огноо эхлэх огнооноос хойш байх ёстой");

    await u.clear(within(dialog).getByLabelText(/Нэр/));
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    expect(
      await within(dialog).findByText("Хичээлийн жилийн нэрийг оруулна уу"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("Дуусах огноо эхлэх огнооноос хойш байх ёстой")).toBeNull();
  });

  /** A duplicate name is a 409 with no field attached, so it reads as a
   *  whole-form message rather than disappearing in a toast. */
  it("shows a duplicate-name conflict inside the dialog", async () => {
    stubYears(undefined, [
      {
        path: `/school-years/${OLDER}`,
        method: "PATCH",
        status: 409,
        body: {
          type: "about:blank",
          title: "Зөрчил үүслээ",
          status: 409,
          requestId: "test",
          detail: "Энэ нэртэй хичээлийн жил аль хэдийн бүртгэгдсэн байна",
        },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2025-2026 — засах" }));
    const dialog = await screen.findByRole("dialog");
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    expect(await within(dialog).findByText(/аль хэдийн бүртгэгдсэн/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  /** The list refetches while the dialog is closed; a form still holding its
   *  mount-time values would write stale ones back. */
  it("re-seeds the form each time it opens", async () => {
    stubYears();
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2026-2027 — засах" }));
    const first = await screen.findByRole("dialog");
    await u.clear(within(first).getByLabelText(/Нэр/));
    await u.type(within(first).getByLabelText(/Нэр/), "Хаягдах утга");
    await u.click(within(first).getByRole("button", { name: "Болих" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await u.click(screen.getByRole("button", { name: "2026-2027 — засах" }));

    expect(within(await screen.findByRole("dialog")).getByLabelText(/Нэр/)).toHaveValue(
      "2026-2027",
    );
  });
});

describe("одоогийн хичээлийн жил", () => {
  it("marks the current year and offers to promote the others", async () => {
    stubYears();
    renderWithProviders(<AdminSchoolYearsPage />);

    expect(await screen.findByText("Одоогийн")).toBeInTheDocument();
    // Only the year that is not already current gets the control.
    expect(screen.getByRole("button", { name: "2025-2026 — одоогийн болгох" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "2026-2027 — одоогийн болгох" })).toBeNull();
  });

  /**
   * ★ One field, one press, no confirmation.
   *
   * `isCurrent: false` is never sent from this screen. The DTO accepts it and
   * it would leave the kindergarten with no current year at all — the way back
   * from a mistaken promotion is to promote the other year, which is why this
   * is treated as a reversible toggle rather than something to confirm.
   */
  it("promotes a year by sending isCurrent true and nothing else", async () => {
    const { calls } = stubYears(undefined, [
      { path: `/school-years/${OLDER}`, method: "PATCH", body: { ...older, isCurrent: true } },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2025-2026 — одоогийн болгох" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch!.url).toBe(`/school-years/${OLDER}`);
      expect(patch!.body).toEqual({ isCurrent: true });
    });
  });

  /**
   * ★★ The demotion of the other year happens on the server, inside the same
   * transaction. Nothing here moves the badge locally — the refetch is what
   * tells the screen which row stopped being current.
   */
  it("refetches the list and confirms with a toast", async () => {
    const { calls } = stubYears(undefined, [
      { path: `/school-years/${OLDER}`, method: "PATCH", body: { ...older, isCurrent: true } },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2025-2026 — одоогийн болгох" }));

    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === "GET" && c.url.startsWith(YEARS_PATH)).length,
      ).toBeGreaterThan(1),
    );
    expect(await screen.findByText(/одоогийн хичээлийн жил боллоо/)).toBeInTheDocument();
  });

  it("keeps a failed promotion visible on the row", async () => {
    stubYears(undefined, [
      {
        path: `/school-years/${OLDER}`,
        method: "PATCH",
        status: 500,
        body: { type: "about:blank", title: "Алдаа", status: 500, requestId: "test" },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminSchoolYearsPage />);

    await u.click(await screen.findByRole("button", { name: "2025-2026 — одоогийн болгох" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/боллоо/)).toBeNull();
  });
});

describe("устгах үйлдэл байхгүй", () => {
  /**
   * ★ There is no `DELETE /school-years/:id` and no archive flag on the model.
   *
   * A year is referenced by groups, enrolments, terms and age profiles with
   * `onDelete: Restrict`, and the API exposes no way to retire one. Offering a
   * control the server would refuse — or worse, one the frontend faked — is the
   * failure this asserts against.
   */
  it("offers no delete or archive control", async () => {
    stubYears();
    renderWithProviders(<AdminSchoolYearsPage />);

    await screen.findByRole("button", { name: "2026-2027 — засах" });
    expect(screen.queryByRole("button", { name: /устгах/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /архивлах/i })).toBeNull();
  });
});

describe("эрх", () => {
  /** `RequireRole roles={["ADMIN"]}` gates the whole screen. */
  it("keeps a teacher off the screen entirely", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: YEARS_PATH, body: [current, older] },
    ]);
    renderWithProviders(<AdminSchoolYearsPage />);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "2026-2027 — засах" })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: /одоогийн болгох/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Жил нэмэх/ })).toBeNull();
  });

  it("keeps a parent off the screen entirely", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: YEARS_PATH, body: [current, older] },
    ]);
    renderWithProviders(<AdminSchoolYearsPage />);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "2026-2027 — засах" })).toBeNull(),
    );
  });
});

/**
 * The row's sizing contract, asserted on source.
 *
 * jsdom has no layout engine, so a `getBoundingClientRect` check here would
 * pass at every viewport while asserting nothing — `responsive.test.tsx` says
 * so at length and checks the constraints instead. These pin the two that keep
 * a long year name and its action cluster on a 390px screen: the name may
 * shrink and truncate, and the actions drop to their own line rather than
 * pinning the row at max-content width.
 *
 * ★ It reads `data-list.tsx`, not this screen.
 *
 * Both constraints used to be inline classes on this page, and were asserted
 * against its source. They are now `DataRow`'s, which is what made them worth
 * asserting once rather than per screen — the four administrative lists that
 * each spelled their own version of this row are the reason the component
 * exists. Pointing the assertion at the page after that move would pin the
 * absence of a class the page is correct not to have.
 */
describe("нарийвчилсан байрлал", () => {
  const ROW = readFileSync(join(__dirname, "..", "components", "ui", "data-list.tsx"), "utf8");

  it("lets the row title shrink and truncate", () => {
    expect(ROW).toMatch(/block truncate text-lead font-semibold text-ink/);
    expect(ROW).toMatch(/flex min-h-\[64px\] flex-wrap items-center/);
  });

  it("wraps the action cluster onto its own line on a phone", () => {
    expect(ROW).toMatch(/flex basis-full items-center justify-end gap-1 md:basis-auto/);
  });
});
