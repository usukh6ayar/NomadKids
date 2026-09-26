import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import SettingsPage from "@/app/(app)/settings/page";

/**
 * "Хүвийн тохиргоо" → Хүүхдийн зураг — client, 2026-09-24: the place a
 * parent looks when they want to change the face on their child's card.
 *
 * ★ The picture only. The name and the group are the kindergarten's record,
 * and the card says so rather than offering fields that would be refused.
 */

const CHILD_ID = "44444444-4444-4444-8444-444444444444";
/** The kindergarten `sessionFor` puts on every membership. */
const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";

const PROFILE = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "parent",
  lastName: "Дорж",
  firstName: "Сараа",
  email: null,
  phone: null,
  specialization: null,
  qualification: null,
  education: null,
};

const CHILDREN = {
  children: [
    {
      id: CHILD_ID,
      lastName: "Дорж",
      firstName: "Намуун",
      sex: "FEMALE",
      dateOfBirth: "2021-04-12",
      photoMediaFileId: null,
      group: { id: "55555555-5555-4555-8555-555555555555", name: "Дэлбээ бүлэг" },
      assessments: [],
    },
  ],
  currentTerm: null,
  recent: [],
};

function stubSettings(roles: Parameters<typeof sessionFor>[0]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    { path: "/me/profile", body: PROFILE },
    { path: "/dashboard/parent", body: CHILDREN },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
});

describe("the child photo card in settings", () => {
  it("lets a guardian change each child's picture, and nothing else about them", async () => {
    stubSettings(["PARENT"]);
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Хүүхдийн зураг");
    const row = (await screen.findByText("Дорж Намуун")).closest("li")!;

    expect(within(row).getByText("Дэлбээ бүлэг")).toBeInTheDocument();
    expect(within(row).getByLabelText("Дорж Намуун — профайл зураг солих")).toBeInTheDocument();
    // No name field: the record stays the kindergarten's.
    expect(within(row).queryByRole("textbox")).toBeNull();
  });

  /** Client, 2026-09-24: no "Ажлын мэдээлэл түр татагдсангүй / Not Found". */
  it("says nothing when the ESIS panel has nothing to say", async () => {
    stubSettings(["PARENT"]);
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Хүүхдийн зураг");
    expect(screen.queryByText("Ажлын мэдээлэл түр татагдсангүй.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Not Found/)).not.toBeInTheDocument();
  });

  // An administrator's copy is "Мэдээлэл", without the families line — 2026-09-25.
  it("titles an administrator's card Мэдээлэл, with no line about families", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: "/me/profile", body: PROFILE },
    ]);
    renderWithProviders(<SettingsPage />);

    const card = (await screen.findByText("Мэдээлэл")).closest("section")!;
    expect(within(card).getByLabelText("Мэргэжил")).toBeInTheDocument();
    expect(screen.queryByText("Багшийн мэдээлэл")).toBeNull();
    expect(screen.queryByText("Эцэг эхчүүд таны бүлгийн хуудсан дээр эдгээрийг харна.")).toBeNull();
  });

  /**
   * "Багшийн мэдээлэл" — client, 2026-09-24. The four lines the family's
   * kindergarten screen reads off a teacher, typed by the teacher themselves.
   */
  it("lets a teacher fill in their profession, grade, school and phone", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/me/profile",
        method: "PATCH",
        body: { ...PROFILE, specialization: "СӨБ-ийн багш" },
      },
      { path: "/me/profile", body: PROFILE },
    ]);
    renderWithProviders(<SettingsPage />);

    const card = (await screen.findByText("Багшийн мэдээлэл")).closest("section")!;
    await user.type(within(card).getByLabelText("Мэргэжил"), "СӨБ-ийн багш");
    await user.type(within(card).getByLabelText("Мэргэшлийн зэрэг"), "Заах аргач");
    await user.type(within(card).getByLabelText("Төгссөн сургууль"), "МУБИС");
    await user.type(within(card).getByLabelText("Утас"), "99001234");
    await user.click(within(card).getByRole("button", { name: "Хадгалах" }));

    const patch = await vi.waitFor(() => {
      const call = api.calls.find((c) => c.method === "PATCH" && c.url === "/me/profile");
      expect(call).toBeDefined();
      return call!;
    });
    expect(patch.body).toEqual({
      specialization: "СӨБ-ийн багш",
      qualification: "Заах аргач",
      education: "МУБИС",
      phone: "99001234",
    });
  });

  /**
   * "ЭСИС-ээс татах" — client, 2026-09-24. It fills the form and waits: the
   * ministry answers the appointment, not the profession, so a person reads
   * the suggestion before it is saved.
   */
  it("fills the empty fields from ESIS without saving, and leaves typed words alone", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/kindergartens/${KINDERGARTEN_ID}/esis/my-profile`,
        body: {
          mode: "DEMO",
          resource: "teachers",
          apiId: 1,
          slug: "api-41",
          endpoint: "/svc/api/hub/v2/teacher/list",
          syncedAt: "2026-09-24T00:00:00.000Z",
          institutionId: "40305",
          fields: [],
          row: {
            subjectDepartmentName: "Сургуулийн өмнөх боловсрол",
            instructorTypeName: "Үндсэн багш",
          },
        },
      },
      { path: "/me/profile", body: { ...PROFILE, education: "МУБИС" } },
    ]);
    renderWithProviders(<SettingsPage />);

    const card = (await screen.findByText("Багшийн мэдээлэл")).closest("section")!;
    await user.click(await within(card).findByRole("button", { name: /ЭСИС-ээс татах/ }));

    expect(within(card).getByLabelText("Мэргэжил")).toHaveValue("Сургуулийн өмнөх боловсрол");
    expect(within(card).getByLabelText("Мэргэшлийн зэрэг")).toHaveValue("Үндсэн багш");
    // Already written by the teacher — the ministry does not overwrite it.
    expect(within(card).getByLabelText("Төгссөн сургууль")).toHaveValue("МУБИС");
    // Nothing is saved until Хадгалах.
    expect(api.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("does not offer it to a guardian, who has no teaching profile", async () => {
    stubSettings(["PARENT"]);
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Хүүхдийн зураг");
    expect(screen.queryByText("Багшийн мэдээлэл")).not.toBeInTheDocument();
  });

  it("shows nothing for a teacher, who has no children of their own here", async () => {
    stubSettings(["TEACHER"]);
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Хувийн тохиргоо");
    expect(screen.queryByText("Хүүхдийн зураг")).not.toBeInTheDocument();
  });
});

/*
  ★ A family's own card is the password alone — 2026-09-25, the client: the
  guardian's name, "И-мэйл оруулаагүй" and the photo control are not needed.
  A teacher's card keeps all three.
*/
describe("the profile card", () => {
  it("shows a guardian no name, no e-mail line and no photo control", async () => {
    stubSettings(["PARENT"]);
    renderWithProviders(<SettingsPage />);

    await screen.findByRole("button", { name: "Нууц үг солих" });
    // Re-queried: the card re-renders once the profile settles.
    expect(screen.getByRole("button", { name: "Нууц үг солих" })).toBeInTheDocument();
    expect(screen.queryByText("Дорж Сараа")).toBeNull();
    expect(screen.queryByText("И-мэйл оруулаагүй")).toBeNull();
    expect(screen.queryByLabelText("Профайл зураг солих")).toBeNull();
  });

  it("keeps the whole card for a teacher", async () => {
    stubSettings(["TEACHER"]);
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Дорж Сараа")).toBeInTheDocument();
    expect(screen.getByText("И-мэйл оруулаагүй")).toBeInTheDocument();
  });
});
