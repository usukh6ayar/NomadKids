import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import MyGroupPage from "@/app/(app)/my-group/page";

/**
 * «Бүлэг, хичээлийн жил» — a solo teacher sets up their own year and group
 * (the user, 2026-10-14). What is pinned: the screen's two requests carry what
 * the API expects. Who may send them is the API's rule
 * (`apps/api/test/solo-teachers.test.ts`).
 */

const KG = "33333333-3333-4333-8333-333333333333";
const YEAR = "44444444-4444-4444-8444-444444444444";

function soloSession() {
  const session = sessionFor(["TEACHER"]);
  return { ...session, soloKindergartenIds: [KG] };
}

describe("a solo teacher's set-up", () => {
  it("creates the first school year with a suggested name and dates", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: soloSession() },
      { path: `/kindergartens/${KG}/school-years`, method: "POST", body: { id: YEAR } },
      { path: `/kindergartens/${KG}/school-years`, body: [] },
      { path: "/groups", body: { items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 } },
    ]);
    renderWithProviders(<MyGroupPage />);

    expect(await screen.findByText(/Хичээлийн жил алга байна/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Үүсгэх" }));

    await waitFor(() => {
      const body = calls.find((c) => c.method === "POST")?.body as Record<string, unknown>;
      expect(body).toMatchObject({ isCurrent: true });
      expect(body.name).toMatch(/^\d{4}-\d{4}$/);
      expect(body.startsOn).toMatch(/^\d{4}-09-01$/);
      expect(body.endsOn).toMatch(/^\d{4}-05-31$/);
    });
  });

  it("opens the group of the current year", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: soloSession() },
      {
        path: `/kindergartens/${KG}/school-years`,
        body: [
          {
            id: YEAR,
            name: "2026-2027",
            isCurrent: true,
            startsOn: "2026-09-01",
            endsOn: "2027-05-31",
          },
        ],
      },
      { path: `/kindergartens/${KG}/groups`, method: "POST", body: { id: "g" } },
      { path: "/groups", body: { items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 } },
    ]);
    renderWithProviders(<MyGroupPage />);

    await user.type(await screen.findByLabelText(/^Бүлгийн нэр/), "Нарлаг");
    await user.click(screen.getByRole("button", { name: "Бүлэг үүсгэх" }));

    await waitFor(() =>
      expect(calls.find((c) => c.url === `/kindergartens/${KG}/groups`)?.body).toEqual({
        schoolYearId: YEAR,
        name: "Нарлаг",
        ageBand: "MIDDLE",
      }),
    );
  });
});
