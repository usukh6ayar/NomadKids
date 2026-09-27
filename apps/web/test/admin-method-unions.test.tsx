import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MethodUnion } from "@kinder/contracts";
import { renderWithProviders, selectOption, sessionFor, stubApi } from "./support/render";
import { MethodUnions } from "@/components/admin/method-unions";

/**
 * «Заах аргын нэгдэл» — the screen over #148's endpoints.
 *
 * What this pins: the list draws the union's lead and member count, a new
 * union is posted with the lead as a **membership** id, and the member picker
 * offers only this kindergarten's teachers who are not already in it.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const OTHER_KG = "99999999-9999-4999-8999-999999999999";
const YEAR = "44444444-4444-4444-8444-444444444444";
const UNION = "55555555-5555-4555-8555-555555555555";
const LEAD = "66666666-6666-4666-8666-666666666661";
const MEMBER = "66666666-6666-4666-8666-666666666662";
const ELSEWHERE = "66666666-6666-4666-8666-666666666663";

const union: MethodUnion = {
  id: UNION,
  kindergartenId: KG,
  name: "Хэл ярианы нэгдэл",
  schoolYear: { id: YEAR, name: "2026-2027" },
  lead: {
    membershipId: LEAD,
    userId: "77777777-7777-4777-8777-777777777771",
    lastName: "Бат",
    firstName: "Сараа",
  },
  startsOn: "2026-09-01",
  endsOn: null,
  esisAcademicOrgId: null,
  memberCount: 1,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const user = (id: string, lastName: string, firstName: string, membershipId: string, kg = KG) => ({
  id,
  username: id,
  lastName,
  firstName,
  memberships: [{ id: membershipId, kindergartenId: kg, role: "TEACHER", isActive: true }],
});

function stub() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: `/kindergartens/${KG}/method-unions`, method: "POST", status: 201, body: union },
    {
      path: `/kindergartens/${KG}/method-unions`,
      body: { items: [union], page: 1, pageSize: 20, total: 1, totalPages: 1 },
    },
    { path: `/method-unions/${UNION}/members`, method: "POST", status: 201, body: {} },
    {
      path: `/method-unions/${UNION}`,
      body: {
        ...union,
        members: [
          {
            id: "88888888-8888-4888-8888-888888888881",
            membershipId: MEMBER,
            userId: "77777777-7777-4777-8777-777777777772",
            lastName: "Дорж",
            firstName: "Оюун",
            createdAt: "2026-09-27T00:00:00.000Z",
          },
        ],
      },
    },
    {
      path: `/kindergartens/${KG}/school-years`,
      body: [{ id: YEAR, name: "2026-2027", isCurrent: true, kindergartenId: KG }],
    },
    {
      path: "/users",
      body: {
        items: [
          user("77777777-7777-4777-8777-777777777771", "Бат", "Сараа", LEAD),
          user("77777777-7777-4777-8777-777777777772", "Дорж", "Оюун", MEMBER),
          // A teacher of another kindergarten — never offered.
          user("77777777-7777-4777-8777-777777777773", "Гадны", "Багш", ELSEWHERE, OTHER_KG),
        ],
        page: 1,
        pageSize: 100,
        total: 3,
        totalPages: 1,
      },
    },
  ]);
}

beforeEach(() => vi.clearAllMocks());

describe("Байгууллага › Заах аргын нэгдэл", () => {
  it("lists a union with its year, lead and member count", async () => {
    stub();
    renderWithProviders(<MethodUnions kindergartenId={KG} />);

    const table = await screen.findByRole("table", { name: "Заах аргын нэгдлийн жагсаалт" });
    const row = within(table).getByText("Хэл ярианы нэгдэл").closest("tr")!;
    expect(row).toHaveTextContent("2026-2027");
    expect(row).toHaveTextContent("Бат Сараа");
    expect(row).toHaveTextContent("2026.09.01");
  });

  it("creates a union with the lead as a membership id, in the current year", async () => {
    const u = userEvent.setup();
    const api = stub();
    renderWithProviders(<MethodUnions kindergartenId={KG} />);

    await u.click(await screen.findByRole("button", { name: /Нэгдэл нэмэх/ }));
    await u.type(screen.getByLabelText(/^Нэр/), "Математикийн нэгдэл");
    await selectOption(u, /^Ахлагч/, "Бат Сараа");
    await u.type(screen.getByLabelText(/^Эхлэх/), "2026-09-01");
    await u.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const call = api.calls.find(
        (c) => c.method === "POST" && c.url === `/kindergartens/${KG}/method-unions`,
      );
      expect(call?.body).toEqual({
        name: "Математикийн нэгдэл",
        schoolYearId: YEAR,
        leadMembershipId: LEAD,
        startsOn: "2026-09-01",
        endsOn: null,
      });
    });
  });

  it("offers only this kindergarten's teachers who are not members yet", async () => {
    const u = userEvent.setup();
    const api = stub();
    renderWithProviders(<MethodUnions kindergartenId={KG} />);

    await u.click(await screen.findByRole("button", { name: "Хэл ярианы нэгдэл" }));
    const members = await screen.findByRole("list", { name: "Нэгдлийн гишүүд" });
    expect(members).toHaveTextContent("Дорж Оюун");

    await u.click(screen.getByLabelText("Багш нэмэх"));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Бат Сараа");
    expect(options).not.toContain("Дорж Оюун");
    expect(options).not.toContain("Гадны Багш");

    await u.click(screen.getByRole("option", { name: "Бат Сараа" }));
    await u.click(screen.getByRole("button", { name: /Нэмэх/ }));
    await waitFor(() => {
      const call = api.calls.find(
        (c) => c.method === "POST" && c.url === `/method-unions/${UNION}/members`,
      );
      expect(call?.body).toEqual({ membershipId: LEAD });
    });
  });
});
