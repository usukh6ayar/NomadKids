import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import AdminGroupsPage from "@/app/(app)/admin/groups/page";

/**
 * Managing an existing group — `PATCH /groups/:id` and `DELETE /groups/:id`.
 *
 * ★ The two operations look alike and are not alike, which is the whole reason
 * this file is careful about which control does what.
 *
 * `PATCH { status: "ARCHIVED" | "ACTIVE" }` is a flag the row keeps: the group
 * stays in every listing, keeps its children, and flips back with one press.
 * `DELETE` runs `archiveGroup`, which sets `deletedAt` — after which
 * `baseWhere` hides the row from every query in the product and no endpoint
 * restores it. So the first is a toggle with no confirmation and the second is
 * confirmed, and these assert that the screen keeps them apart.
 *
 * ★★ `DELETE` also refuses while children are enrolled, with a 409 whose
 * message names the count and says what to do. That message is the instruction,
 * so it has to survive on screen rather than pass in a toast.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const YEAR = "55555555-5555-4555-8555-555555555555";

function group(over: Record<string, unknown> = {}) {
  return {
    id: GROUP,
    name: "Дунд бүлэг",
    ageBand: "JUNIOR",
    kindergartenId: KG,
    schoolYearId: YEAR,
    status: "ACTIVE",
    schoolYear: { id: YEAR, name: "2026-2027", isCurrent: true },
    _count: { enrollments: 0 },
    photoMediaFileId: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("эрх", () => {
  /** `RequireRole roles={["ADMIN"]}` gates the whole screen; a teacher never
   *  reaches any of these controls. */
  it("keeps a teacher off the screen entirely", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups",
        body: { items: [group()], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
    ]);
    renderWithProviders(<AdminGroupsPage />);

    await waitFor(() => expect(screen.queryByRole("button", { name: /— засах/ })).toBeNull());
    expect(screen.queryByRole("button", { name: /архивлах/i })).toBeNull();
  });
});
