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

  it("creates one through the platform route, with no password anywhere", async () => {
    setParams({ id: KG_ID });
    const { calls } = stubApi([
      { path: "/auth/me", body: operator() },
      /*
       * ★ The POST stub is listed **before** the detail one, and the detail
       * one names its verb.
       *
       * `stubApi` matches with `startsWith` and treats a stub with no `method`
       * as matching every verb — so `/platform/kindergartens/:id` swallows
       * `/platform/kindergartens/:id/admins`, the mutation gets a
       * kindergarten back where it expected an invitation, and the schema
       * parse fails a long way from the cause.
       */
      {
        path: `/platform/kindergartens/${KG_ID}/admins`,
        method: "POST",
        body: { user: neverSignedIn, invitationToken: "tok-1" },
      },
      { path: `/platform/kindergartens/${KG_ID}`, method: "GET", body: detail([signedIn]) },
    ]);
    renderWithProviders(<PlatformKindergartenPage />, { selectedChild: false });

    await userEvent.click(await screen.findByRole("button", { name: "Удирдлага нэмэх" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Удирдлага нэмэх" }));
    await userEvent.type(dialog.getByLabelText(/^Овог/), "Дорж");
    await userEvent.type(dialog.getByLabelText(/^Нэр \*/), "Сүрэн");
    await userEvent.type(dialog.getByLabelText(/^Нэвтрэх нэр/), "shineerhlegch");
    await userEvent.click(dialog.getByRole("button", { name: "Урилга үүсгэх" }));

    await waitFor(() => {
      const post = calls.find((call) => call.method === "POST");
      expect(post).toBeDefined();
      // The platform prefix, not `/kindergartens/:id/users` — that route is
      // `@Roles("ADMIN")` and answers an operator 404.
      expect(post!.url).toContain(`/platform/kindergartens/${KG_ID}/admins`);
      const body = post!.body as Record<string, unknown>;
      expect(body.username).toBe("shineerhlegch");
      // An operator who typed a password for somebody else would know it.
      expect(body).not.toHaveProperty("password");
    });
  });

  it("hands the invitation over once, and never asks for a password", async () => {
    setParams({ id: KG_ID });
    stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: `/platform/kindergartens/${KG_ID}/admins`,
        method: "POST",
        body: { user: neverSignedIn, invitationToken: "tok-1" },
      },
      { path: `/platform/kindergartens/${KG_ID}`, method: "GET", body: detail([signedIn]) },
    ]);
    renderWithProviders(<PlatformKindergartenPage />, { selectedChild: false });

    await userEvent.click(await screen.findByRole("button", { name: "Удирдлага нэмэх" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Удирдлага нэмэх" }));

    expect(dialog.queryByLabelText(/Нууц үг/)).not.toBeInTheDocument();

    await userEvent.type(dialog.getByLabelText(/^Овог/), "Дорж");
    await userEvent.type(dialog.getByLabelText(/^Нэр \*/), "Сүрэн");
    await userEvent.type(dialog.getByLabelText(/^Нэвтрэх нэр/), "shineerhlegch");
    await userEvent.click(dialog.getByRole("button", { name: "Урилга үүсгэх" }));

    expect(await screen.findByRole("dialog", { name: /Урилга бэлэн/ })).toBeInTheDocument();
  });
});
