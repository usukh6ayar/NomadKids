import { readFileSync } from "node:fs";
import { join } from "node:path";
import { screen, waitFor } from "@testing-library/react";
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

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
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

/**
 * The years a kindergarten has created, on the screen that creates them —
 * 2026-09-20, the client: "он үүсгэж болж байна он нь дэлгэц дээр хүснэгтээр
 * харагддаг болгоод өгөөч".
 *
 * ★ They were fetched and thrown away. The query existed; its result fed
 * exactly one decision (whether a new year should default to current) and was
 * never rendered, so a director created a year, got a success toast, and saw
 * the ministry's panel with their own year nowhere in it.
 */
describe("the local years are visible", () => {
  it("lists every year this kindergarten has created", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: YEARS_PATH, body: [current, older] },
    ]);
    renderWithProviders(<AdminSchoolYearsPage />);

    expect(await screen.findByText("2026-2027")).toBeInTheDocument();
    expect(screen.getByText("2025-2026")).toBeInTheDocument();
  });

  it("shows each year's dates", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: YEARS_PATH, body: [current] },
    ]);
    renderWithProviders(<AdminSchoolYearsPage />);

    expect(await screen.findByText("2026.09.01 – 2027.06.01")).toBeInTheDocument();
  });

  /*
   * ★ Only the current year is badged. Marking the others "Идэвхгүй" would put
   * a constant chip down the column and hide the one row that differs.
   */
  it("badges the current year and only the current year", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: YEARS_PATH, body: [current, older] },
    ]);
    renderWithProviders(<AdminSchoolYearsPage />);

    expect(await screen.findAllByText("Одоогийн")).toHaveLength(1);
  });

  it("says so when no year has been created yet", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: YEARS_PATH, body: [] },
    ]);
    renderWithProviders(<AdminSchoolYearsPage />);

    expect(await screen.findByText("Хичээлийн жил үүсгээгүй байна")).toBeInTheDocument();
  });
});
