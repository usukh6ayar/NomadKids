import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROUTER, renderWithProviders, stubApi } from "./support/render";
import {
  TeacherApplyDialog,
  looksLikeSameKindergarten,
} from "@/components/public/teacher-apply-dialog";

/*
 * ★ «Багш, ажилтан» — 2026-10-12. Two tabs: «Цэцэрлэгээр» for staff of a
 * kindergarten on NomadKids (picked by district and name, no ESIS code), and
 * «Дангаараа» for a teacher whose kindergarten is not. The routes are the
 * contract the backend is asked for; until they exist the window says so.
 */
afterEach(() => vi.unstubAllGlobals());

/** The visible panel — the other tab's panel is mounted but hidden. */
const panel = () => within(screen.getByRole("tabpanel"));

async function chooseDistrict(user: ReturnType<typeof userEvent.setup>) {
  await user.click(panel().getByLabelText(/Аймаг \/ дүүрэг/));
  await user.click(screen.getByRole("option", { name: "Баянзүрх" }));
}

async function chooseKindergarten(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await panel().findByLabelText(/^Цэцэрлэг/));
  await user.click(screen.getByRole("option", { name }));
}

describe("«Цэцэрлэгээр» — staff of a kindergarten on NomadKids", () => {
  it("picks the kindergarten by name and goes on to set a password", async () => {
    const user = userEvent.setup();
    ROUTER.replace.mockClear();
    const api = stubApi([
      { path: "/public/kindergartens", body: [{ id: "kg-1", name: "Нарлаг" }] },
      {
        path: "/staff-registration",
        method: "POST",
        status: 201,
        body: { invitationToken: "tok-1" },
      },
    ]);
    renderWithProviders(<TeacherApplyDialog onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: /Цэцэрлэгээр/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await chooseDistrict(user);
    await chooseKindergarten(user, "Нарлаг");
    await user.type(panel().getByLabelText(/Регистрийн дугаар/), "УБ90010101");
    await user.click(panel().getByRole("button", { name: "Бүртгүүлэх" }));

    await waitFor(() => expect(ROUTER.replace).toHaveBeenCalledWith("/invitation/tok-1"));
    expect(api.calls.find((call) => call.url === "/staff-registration")?.body).toEqual({
      kindergartenId: "kg-1",
      registerNumber: "УБ90010101",
    });
  });

  it("shows the server's refusal and always points at the director", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/public/kindergartens", body: [{ id: "kg-1", name: "Нарлаг" }] },
      {
        path: "/staff-registration",
        method: "POST",
        status: 401,
        body: {
          type: "about:blank",
          title: "Бүртгэл олдсонгүй",
          status: 401,
          detail: "Мэдээлэл таарсангүй.",
          requestId: "test",
        },
      },
    ]);
    renderWithProviders(<TeacherApplyDialog onClose={() => {}} />);
    await chooseDistrict(user);
    await chooseKindergarten(user, "Нарлаг");
    await user.type(panel().getByLabelText(/Регистрийн дугаар/), "УБ90010101");
    await user.click(panel().getByRole("button", { name: "Бүртгүүлэх" }));

    expect(await screen.findByText("Мэдээлэл таарсангүй.")).toBeInTheDocument();
    expect(
      panel().getByText("Бүртгүүлж чадахгүй бол эрхлэгчдээ хандаж урилга авна уу."),
    ).toBeInTheDocument();
  });

  it("«Миний цэцэрлэг энд алга» moves to «Дангаараа» with the district kept", async () => {
    const user = userEvent.setup();
    stubApi([{ path: "/public/kindergartens", body: [{ id: "kg-1", name: "Нарлаг" }] }]);
    renderWithProviders(<TeacherApplyDialog onClose={() => {}} />);
    await chooseDistrict(user);
    await chooseKindergarten(user, "➕ Миний цэцэрлэг энд алга");

    expect(screen.getByRole("tab", { name: /Дангаараа/ })).toHaveAttribute("aria-selected", "true");
    expect(panel().getByLabelText(/Аймаг \/ дүүрэг/)).toHaveTextContent("Баянзүрх");
    expect(panel().getByLabelText(/Цэцэрлэгийн нэр/)).toBeInTheDocument();
  });

  it("offers the ESIS-code page while the list is not served yet", async () => {
    const user = userEvent.setup();
    stubApi([]);
    renderWithProviders(<TeacherApplyDialog onClose={() => {}} />);
    await chooseDistrict(user);

    expect(await panel().findByRole("link", { name: /кодоор бүртгүүлнэ үү/ })).toHaveAttribute(
      "href",
      "/staff-register",
    );
  });
});

/*
 * Eight fields are typed key by key; under a full run's load that alone can
 * pass the default 5 s, so these tests get more room.
 */
describe("«Дангаараа» — a teacher on their own (#202)", { timeout: 15_000 }, () => {
  /** Everything but the password — one window since 2026-10-14. */
  async function fillSolo(user: ReturnType<typeof userEvent.setup>) {
    await chooseDistrict(user);
    await user.type(panel().getByLabelText(/Цэцэрлэгийн нэр/), "Нарлаг");
    await user.type(panel().getByLabelText(/^Овог/), "Батаа");
    await user.type(panel().getByLabelText(/^Нэр/), "Сувд");
    await user.type(panel().getByLabelText(/^Утас/), "99112233");
    await user.type(panel().getByLabelText(/^И-мэйл/), "suvdaa@example.mn");
  }

  async function choosePassword(user: ReturnType<typeof userEvent.setup>, confirm = PASSWORD) {
    await user.type(panel().getByLabelText(/^Нууц үг(?! давтах)/, { selector: "input" }), PASSWORD);
    await user.type(panel().getByLabelText(/^Нууц үг давтах/, { selector: "input" }), confirm);
  }

  const PASSWORD = "Shine-Nuuts99";

  it("keeps what was typed across tabs, signs up with the password, and goes to sign in", async () => {
    const user = userEvent.setup();
    ROUTER.replace.mockClear();
    const api = stubApi([
      { path: "/public/kindergartens", body: [] },
      { path: "/teacher-applications", method: "POST", status: 201, body: { created: true } },
    ]);
    renderWithProviders(<TeacherApplyDialog onClose={() => {}} />);
    await user.click(screen.getByRole("tab", { name: /Дангаараа/ }));
    expect(screen.getByText("Цэцэрлэг маань бүртгэлгүй — үнэгүй")).toBeInTheDocument();
    await user.type(panel().getByLabelText(/^Овог/), "Ба");
    await user.click(screen.getByRole("tab", { name: /Цэцэрлэгээр/ }));
    await user.click(screen.getByRole("tab", { name: /Дангаараа/ }));
    expect(panel().getByLabelText(/^Овог/)).toHaveValue("Ба");
    await user.clear(panel().getByLabelText(/^Овог/));
    await fillSolo(user);
    await choosePassword(user);
    await user.click(panel().getByRole("button", { name: "Бүртгүүлэх" }));

    expect(await screen.findByText("Бүртгэл үүслээ")).toBeInTheDocument();
    expect(api.calls.find((call) => call.url === "/teacher-applications")?.body).toEqual({
      lastName: "Батаа",
      firstName: "Сувд",
      phone: "99112233",
      email: "suvdaa@example.mn",
      password: PASSWORD,
      propertyType: "Төрийн бус",
      location: "Баянзүрх дүүрэг",
      kindergartenName: "Нарлаг",
    });
    await waitFor(() => expect(ROUTER.replace).toHaveBeenCalledWith("/login"), { timeout: 3000 });
  });

  it("says when the two passwords differ, and sends nothing", async () => {
    const user = userEvent.setup();
    const api = stubApi([{ path: "/public/kindergartens", body: [] }]);
    renderWithProviders(<TeacherApplyDialog onClose={() => {}} initialMode="solo" />);
    await fillSolo(user);
    await choosePassword(user, "Other-Nuuts99");
    await user.click(panel().getByRole("button", { name: "Бүртгүүлэх" }));

    expect(await panel().findByText("Хоёр нууц үг таарахгүй байна.")).toBeInTheDocument();
    expect(api.calls.some((call) => call.url === "/teacher-applications")).toBe(false);
  });

  it("proves the phone by SMS in the same window where verify.mn is on", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/public/kindergartens", body: [] },
      { path: "/phone-verifications/availability", body: { enabled: true } },
    ]);
    renderWithProviders(<TeacherApplyDialog onClose={() => {}} initialMode="solo" />);
    await fillSolo(user);
    await choosePassword(user);
    await user.click(panel().getByRole("button", { name: "Бүртгүүлэх" }));

    expect(
      await panel().findByText("Утасны дугаараа SMS-ээр баталгаажуулна уу."),
    ).toBeInTheDocument();
    expect(api.calls.some((call) => call.url === "/teacher-applications")).toBe(false);
  });
});

describe("a solo sign-up for a kindergarten that is already on NomadKids", () => {
  it("matches a name however it is typed, but not on two letters", () => {
    expect(looksLikeSameKindergarten("нарлаг цэцэрлэг", "Нарлаг")).toBe(true);
    expect(looksLikeSameKindergarten("Нарлаг-цэцэрлэг", "Нарлаг цэцэрлэг")).toBe(true);
    expect(looksLikeSameKindergarten("Нарл", "Нарлаг")).toBe(true);
    expect(looksLikeSameKindergarten("На", "Нарлаг")).toBe(false);
    expect(looksLikeSameKindergarten("Хүслэн", "Нарлаг")).toBe(false);
  });

  it("offers the listed kindergarten and opens «Цэцэрлэгээр» with it chosen", async () => {
    const user = userEvent.setup();
    stubApi([
      {
        path: "/public/kindergartens",
        body: [
          { id: "kg-1", name: "Нарлаг цэцэрлэг" },
          { id: "kg-2", name: "Хүслэн" },
        ],
      },
    ]);
    renderWithProviders(<TeacherApplyDialog initialMode="solo" onClose={() => {}} />);
    await chooseDistrict(user);
    await user.type(panel().getByLabelText(/Цэцэрлэгийн нэр/), "нарлаг");

    expect(await panel().findByText(/NomadKids ашигладаг/)).toHaveTextContent(
      "«Нарлаг цэцэрлэг» NomadKids ашигладаг",
    );
    expect(panel().queryByText(/«Хүслэн»/)).toBeNull();
    await user.click(panel().getByRole("button", { name: /Цэцэрлэгээр бүртгүүлэх/ }));

    expect(screen.getByRole("tab", { name: /Цэцэрлэгээр/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(panel().getByLabelText(/Аймаг \/ дүүрэг/)).toHaveTextContent("Баянзүрх");
    expect(panel().getByLabelText(/^Цэцэрлэг/)).toHaveTextContent("Нарлаг цэцэрлэг");
    expect(panel().getByLabelText(/Регистрийн дугаар/)).toBeInTheDocument();
  });
});
