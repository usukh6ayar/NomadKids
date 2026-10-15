import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import PlatformKindergartenPage from "@/app/(app)/platform/[id]/page";

/**
 * The operator's view of who can administer a kindergarten, and adding one.
 *
 * ★ `selectedChild: false` and a session with **no membership** — the platform
 * operator has neither. A session handing them an `ADMIN` membership would
 * pass here while the real operator got 404 from every tenant route.
 */
const KG_ID = "69b722f3-a190-4d43-a146-edb47a57fe18";

const operator = () => {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
};

const signedIn = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "usukhbayar",
  lastName: "Гантулга",
  firstName: "Өсөхбаяр",
  email: null,
  isActive: true,
  lastLoginAt: "2026-09-18T09:00:00.000Z",
};

const neverSignedIn = {
  id: "22222222-2222-4222-8222-222222222222",
  username: "shineerhlegch",
  lastName: "Дорж",
  firstName: "Сүрэн",
  email: null,
  isActive: true,
  lastLoginAt: null,
};

const INSTITUTION = {
  institutionId: "42778",
  name: "Дэгдээхий үрс цэцэрлэг",
  longName: "Улаанбаатар.Баянзүрх.Дэгдээхий үрс цэцэрлэг",
  address: null,
  classification: "Цэцэрлэг",
  propertyType: "Хувийн",
  isKindergarten: true,
  alreadyUsed: true,
  staff: [
    {
      personId: "1000048746697",
      registerNumber: "УБ12345678",
      lastName: "Батсайхан",
      firstName: "Оюунаа",
      positionName: "эрхлэгч",
      jobCode: "1341-11",
      suggestedRole: null,
    },
  ],
};

const detail = (admins: unknown[]) => ({
  id: KG_ID,
  name: "Дэгдээхий үрс цэцэрлэг",
  address: null,
  phone: null,
  email: null,
  isActive: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  description: null,
  esisInstitutionId: "42778",
  esisMappedAt: "2026-09-01T00:00:00.000Z",
  admins,
  counts: { children: 83, groups: 4, staff: 14, guardians: 60 },
  currentTerm: null,
  assessmentCoverage: [],
  recentActivity: [],
});

function render(admins: unknown[] = [signedIn]) {
  setParams({ id: KG_ID });
  stubApi([
    { path: "/auth/me", body: operator() },
    { path: `/platform/kindergartens/${KG_ID}`, body: detail(admins) },
  ]);
  return renderWithProviders(<PlatformKindergartenPage />, { selectedChild: false });
}

describe("a kindergarten's administrators", () => {
  it("says in words when nobody has ever signed in", async () => {
    /*
     * ★ The whole reason this list exists. "Who administers this" the operator
     * can mostly guess; "can anybody actually get in" they cannot, and an
     * invited-but-never-accepted director is identical to a working one in
     * every other column. A blank date would hide exactly the tenant that
     * needs a second invitation.
     */
    render([signedIn, neverSignedIn]);

    const section = await screen.findByRole("region", { name: "Удирдлага" });
    expect(within(section).getByText("Нэвтэрч байгаагүй")).toBeInTheDocument();
    expect(within(section).getByText(/Сүүлд нэвтэрсэн/)).toBeInTheDocument();
  });

  it("treats a kindergarten with no administrator as a problem, not an empty table", async () => {
    render([]);

    const section = await screen.findByRole("region", { name: "Удирдлага" });
    expect(within(section).getByText("Удирдлагагүй байна")).toBeInTheDocument();
  });

  it("picks the person from the institution's own ESIS staff, never a typed name", async () => {
    /*
     * ★ The client's rule, 2026-09-19: "удирдлага нэмэх нь зөвхөн тэр тухайн
     * байгууллага дахь ажилчдаас сонгоно". The operator types one thing — the
     * login name, which ESIS does not have — and chooses the rest. The server
     * re-reads the list and refuses a `personId` that is not on it; this
     * asserts the browser sends the choice rather than a name somebody typed.
     */
    setParams({ id: KG_ID });
    const { calls } = stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: `/platform/kindergartens/${KG_ID}/admins`,
        method: "POST",
        body: { user: neverSignedIn, invitationToken: "tok-1" },
      },
      { path: `/platform/kindergartens/${KG_ID}`, method: "GET", body: detail([signedIn]) },
      { path: "/platform/esis/institutions/42778", body: INSTITUTION },
    ]);
    renderWithProviders(<PlatformKindergartenPage />, { selectedChild: false });

    await userEvent.click(await screen.findByRole("button", { name: "Удирдлага нэмэх" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Удирдлага нэмэх" }));

    // No password field, and no name to type — only the login handle.
    expect(dialog.queryByLabelText(/Нууц үг/)).not.toBeInTheDocument();
    expect(dialog.queryByLabelText(/^Овог/)).not.toBeInTheDocument();

    await userEvent.click(await dialog.findByRole("radio", { name: /Батсайхан Оюунаа/ }));
    await userEvent.type(dialog.getByLabelText(/^Нэвтрэх нэр/), "shineerhlegch");
    await userEvent.click(dialog.getByRole("button", { name: "Урилга үүсгэх" }));

    await waitFor(() => {
      const post = calls.find((call) => call.method === "POST");
      expect(post).toBeDefined();
      const body = post!.body as Record<string, unknown>;
      expect(body.esisPersonId).toBe("1000048746697");
      expect(body.username).toBe("shineerhlegch");
      expect(body).not.toHaveProperty("password");
    });

    expect(await screen.findByRole("dialog", { name: /Урилга бэлэн/ })).toBeInTheDocument();
  });

  /*
   * ★ A director who forgot the password and lost the phone — 2026-10-14, the
   * user: the operator issues a one-time link, after checking who is asking.
   */
  describe("resetting a director's password", () => {
    function renderReset(
      extra: { path: string; method?: string; status?: number; body?: unknown }[],
    ) {
      setParams({ id: KG_ID });
      const api = stubApi([
        ...extra,
        { path: "/auth/me", body: operator() },
        { path: `/platform/kindergartens/${KG_ID}/payments`, status: 404, body: {} },
        { path: `/platform/kindergartens/${KG_ID}`, body: detail([signedIn]) },
      ]);
      renderWithProviders(<PlatformKindergartenPage />);
      return api;
    }
    const RESET = `/platform/kindergartens/${KG_ID}/admins/${signedIn.id}/password-reset`;

    it("issues a one-time link only once the person was checked", async () => {
      const user = userEvent.setup();
      const api = renderReset([{ path: RESET, method: "POST", body: { resetToken: "tok-abc" } }]);

      await user.click(await screen.findByRole("button", { name: "Нууц үг сэргээх" }));
      const dialog = await screen.findByRole("dialog", { name: "Нууц үг сэргээх" });
      const issue = within(dialog).getByRole("button", { name: "Холбоос үүсгэх" });
      expect(issue).toBeDisabled();

      await user.click(within(dialog).getByRole("checkbox"));
      await user.click(issue);

      await waitFor(() =>
        expect(api.calls.find((call) => call.url === RESET)?.method).toBe("POST"),
      );
      const handover = await screen.findByRole("dialog", { name: "Нууц үг сэргээх холбоос" });
      expect(handover).toHaveTextContent("/reset-password/tok-abc");
      expect(handover).toHaveTextContent("Холбоос 1 цаг хүчинтэй");
    });

    it("says what to do instead while the API cannot issue one", async () => {
      const user = userEvent.setup();
      renderReset([{ path: RESET, method: "POST", status: 404, body: {} }]);

      await user.click(await screen.findByRole("button", { name: "Нууц үг сэргээх" }));
      const dialog = await screen.findByRole("dialog", { name: "Нууц үг сэргээх" });
      await user.click(within(dialog).getByRole("checkbox"));
      await user.click(within(dialog).getByRole("button", { name: "Холбоос үүсгэх" }));

      expect(
        await within(dialog).findByText(/хараахан бэлэн болоогүй. Одоохондоо «Удирдлага нэмэх»/),
      ).toBeInTheDocument();
    });
  });
});
