import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { TeacherSetupGuide } from "@/components/dashboard/teacher-setup-guide";

/**
 * The teacher's first steps — 2026-10-18, the client: "багш … анх нэвтрэхэд
 * хэрхэн бүлэг үүсгэж оруулах, яаж хүн урих боломжтойг харуулах".
 */

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Бага бүлэг",
  kindergartenId: KG,
  schoolYearId: "55555555-5555-4555-8555-555555555555",
};

const dashboard = (children: number) => ({
  currentTerm: null,
  counts: { children, groups: 1, pendingReviews: 0 },
  needsAttention: { pendingReviews: 0, childrenMissingAssessment: [] },
});

const child = (guardianContact: boolean) => ({
  id: "66666666-6666-4666-8666-666666666666",
  lastName: "Ганболд",
  firstName: "Батбаяр",
  dateOfBirth: "2021-04-12",
  enrollments: [],
  profile: { photo: false, health: false, guardianContact },
});

function stub({
  solo = false,
  groups = [GROUP],
  children = 0,
  families = false,
}: {
  solo?: boolean;
  groups?: unknown[];
  children?: number;
  families?: boolean;
}) {
  stubApi([
    {
      path: "/auth/me",
      body: { ...sessionFor(["TEACHER"]), soloKindergartenIds: solo ? [KG] : [] },
    },
    {
      path: "/groups",
      body: { items: groups, page: 1, pageSize: 20, total: groups.length, totalPages: 1 },
    },
    { path: "/dashboard/teacher", body: dashboard(children) },
    {
      path: "/children",
      body: {
        items: children ? [child(families)] : [],
        page: 1,
        pageSize: 100,
        total: children,
        totalPages: 1,
      },
    },
  ]);
}

const step = (title: string) => within(screen.getByRole("dialog")).getByText(title).closest("li")!;

describe("багшийн эхлэх алхам", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("walks a solo teacher from their own group to inviting the families", async () => {
    stub({ solo: true, groups: [] });
    renderWithProviders(<TeacherSetupGuide />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const group = step("Хичээлийн жил, бүлэг үүсгэх");
    expect(within(group).getByRole("link", { name: /Бүлэг үүсгэх/ })).toHaveAttribute(
      "href",
      "/my-group",
    );
    expect(step("Хүүхэд бүртгэх")).toBeInTheDocument();
    expect(step("Эцэг эх урих").textContent).toMatch(/Бүлгээр урих/);
    expect(screen.getByText(/3 алхам үлдсэн/)).toBeInTheDocument();
  });

  it("tells a kindergarten's teacher the director assigns their group", async () => {
    stub({ groups: [] });
    renderWithProviders(<TeacherSetupGuide />);

    await screen.findByRole("dialog");
    expect(step("Таны бүлэг").textContent).toMatch(/эрхлэгч/);
    expect(screen.queryByText("Хичээлийн жил, бүлэг үүсгэх")).toBeNull();
  });

  it("ticks what is done — the group and the children — and leaves the families", async () => {
    stub({ children: 12, families: false });
    renderWithProviders(<TeacherSetupGuide />);

    await screen.findByRole("dialog");
    expect(step("Таны бүлэг").textContent).toContain("(хийгдсэн)");
    expect(step("Хүүхэд бүртгэх").textContent).toContain("(хийгдсэн)");
    expect(step("Эцэг эх урих").textContent).not.toContain("(хийгдсэн)");
  });

  it("stays shut once every step is done, leaving a button to reopen it", async () => {
    stub({ children: 12, families: true });
    renderWithProviders(<TeacherSetupGuide />);

    expect(await screen.findByRole("button", { name: /Эхлэх заавар/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
