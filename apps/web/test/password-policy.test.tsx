import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import AcceptInvitationPage from "@/app/invitation/[token]/page";
import ResetPasswordPage from "@/app/reset-password/[token]/page";
import SettingsPage from "@/app/(app)/settings/page";

/**
 * The password policy, as the two forms that set a first password present it.
 *
 * ★ These are the only screens where somebody types a password they have not
 * typed before, and both are used by people who are not staff — a parent, on a
 * phone, from a QR code handed over at pick-up.
 *
 * The server enforces four rules (`validatePasswordStrength` in
 * `password.service.ts`): length, an upper case letter, a lower case letter and
 * a digit. A form that announces one of them and relays a 401 about the other
 * three fails the person using it — they learn what was wrong only after a
 * round trip, and only in an error banner. Same rules, same messages, checked
 * before anything is sent.
 *
 * ★★ The Cyrillic case matters as much as the rejection. `Нууцүг123` is a
 * legitimate password in the language this product is written in, and a form
 * that quietly demanded Latin letters would be unusable for the people it is
 * for.
 */

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ token: "invitation-token-value" });
  setSearchParams("");
});

/** Long enough to pass the length rule, and failing every other one. */
const WEAK = "нууцүгмаань";
const STRONG = "Нууцүг123";

describe("invitation — first password", () => {
  it("lists every rule the server enforces, not only the length", () => {
    renderWithProviders(<AcceptInvitationPage />);

    const rules = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");

    expect(rules).toHaveLength(3);
    expect(rules.join(" ")).toMatch(/8/);
    expect(rules.join(" ")).toMatch(/үсэг/);
    expect(rules.join(" ")).toMatch(/тоо/);
  });

  it("refuses a password with no upper case or digit without calling the API", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([{ path: "/auth/invitation/accept", status: 204 }]);

    renderWithProviders(<AcceptInvitationPage />);

    await user.type(screen.getByLabelText(/^Таны нэр/), "Оюун");
    await user.type(screen.getByLabelText(/^Утасны дугаар/), "99112233");
    await user.type(screen.getByLabelText(/^Нууц үг \*/), WEAK);
    await user.type(screen.getByLabelText(/давтан/), WEAK);
    await user.click(screen.getByRole("button", { name: "Бүртгэл идэвхжүүлэх" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/том үсэг/));
    expect(calls.filter((c) => c.url.startsWith("/auth/invitation/accept"))).toHaveLength(0);
  });

  it("accepts a Cyrillic password that satisfies the rules", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([{ path: "/auth/invitation/accept", status: 204 }]);

    renderWithProviders(<AcceptInvitationPage />);

    await user.type(screen.getByLabelText(/^Таны нэр/), "Оюун");
    await user.type(screen.getByLabelText(/^Утасны дугаар/), "99112233");
    await user.type(screen.getByLabelText(/^Нууц үг \*/), STRONG);
    await user.type(screen.getByLabelText(/давтан/), STRONG);
    await user.click(screen.getByRole("button", { name: "Бүртгэл идэвхжүүлэх" }));

    await waitFor(() =>
      expect(calls.filter((c) => c.url.startsWith("/auth/invitation/accept"))).toHaveLength(1),
    );
  });
});

/** The profile the settings screen loads before either form can render. */
const PROFILE = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "bagsh",
  email: null,
  phone: null,
  lastName: "Ганбат",
  firstName: "Болд",
  specialization: null,
  education: null,
  bio: null,
  photoMediaFileId: null,
};

/**
 * ★ One press, and it has been three arrangements — the last on 2026-09-08.
 *
 * The client asked for each in turn: that the form stop being permanently on
 * screen ("нууц үг солих гээд тогтмол харагдаад байхгүйгээр"); that a modal
 * from a second header button was the wrong answer ("шал сонин байна") and it
 * belonged inside the profile's own edit; and then that the profile stop being
 * editable at all, which took that edit form with it. So the section sits on
 * the page, folded shut, and one press opens it.
 *
 * What is under test has survived all three — the rules are listed, the fields
 * reveal, and a weak password never reaches the API.
 */
async function openPasswordForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Нууц үг солих" }));
}

describe("settings — changing a password", () => {
  it("keeps sign-out inside the profile card", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/me/profile", body: PROFILE },
    ]);

    renderWithProviders(<SettingsPage />);

    const signOut = await screen.findByRole("button", { name: "Гарах" });
    const profileCard = signOut.closest('[data-ui="card"]');
    expect(profileCard).toHaveTextContent("Ганбат Болд");
    expect(profileCard).toHaveTextContent("Системээс гарах");
  });

  /**
   * ★ The third screen that sets a password, and the one that did not say how.
   *
   * `/invitation/:token` and `/reset-password/:token` have listed the rules
   * since they were written; this form only ever *checked* them. So the one way
   * to learn the policy here was to fail it — type, submit, read a red line,
   * try again — which is exactly the report that prompted this
   * ("алдаа байнга гараад байна", 2026-09-04).
   */
  it("lists the rules before anything is typed, like the other two forms", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/me/profile", body: PROFILE },
    ]);

    renderWithProviders(<SettingsPage />);
    await openPasswordForm(user);

    await screen.findByLabelText(/^Одоогийн нууц үг/);
    const rules = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");

    expect(rules.join(" ")).toMatch(/8/);
    expect(rules.join(" ")).toMatch(/үсэг/);
    expect(rules.join(" ")).toMatch(/тоо/);
  });

  /**
   * ★ Reading back what you typed.
   *
   * The passwords in this product are Mongolian Cyrillic, typed on a phone
   * keyboard that switches layouts. A typo you cannot see is a lockout nobody
   * can explain, so every password field carries a toggle — and the assertion
   * is on the input's `type`, which is the thing that actually reveals the
   * characters.
   */
  it("reveals and re-hides the password", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/me/profile", body: PROFILE },
    ]);

    renderWithProviders(<SettingsPage />);
    await openPasswordForm(user);

    const field = await screen.findByLabelText(/^Одоогийн нууц үг/);
    expect(field).toHaveAttribute("type", "password");

    // Each password field has its own toggle; the first belongs to this one.
    const [toggle] = screen.getAllByRole("button", { name: "Нууц үг харуулах" });
    await user.click(toggle!);
    expect(field).toHaveAttribute("type", "text");

    await user.click(screen.getAllByRole("button", { name: "Нууц үг нуух" })[0]!);
    expect(field).toHaveAttribute("type", "password");
  });

  it("refuses a weak new password without calling the API", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/me/profile",
        body: {
          id: "11111111-1111-4111-8111-111111111111",
          username: "bagsh",
          email: null,
          phone: null,
          lastName: "Ганбат",
          firstName: "Оюун",
          specialization: null,
          education: null,
          bio: null,
          photoMediaFileId: null,
        },
      },
      { path: "/auth/password", status: 204 },
    ]);

    renderWithProviders(<SettingsPage />);
    await openPasswordForm(user);

    await user.type(await screen.findByLabelText(/^Одоогийн нууц үг/), "Whatever123");
    await user.type(screen.getByLabelText(/^Шинэ нууц үг \*/), WEAK);
    await user.type(screen.getByLabelText(/^Шинэ нууц үг давтах/), WEAK);
    await user.click(screen.getByRole("button", { name: "Нууц үг шинэчлэх" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/том үсэг|тоо байх ёстой/),
    );
    expect(calls.filter((c) => c.url.startsWith("/auth/password"))).toHaveLength(0);
  });
  /*
   * ★ "Одоогийн нууц үгээ мэдэхгүй ч байж болишд" — the client, 2026-09-08.
   *
   * `POST /auth/password` needs the current password, so somebody who has
   * forgotten it could do nothing here and had to sign out to reach the
   * recovery they were already signed in beside. This sends the reset for the
   * account that is open, without asking them to name it.
   */
  it("asks for a reset link without asking who is asking", async () => {
    const user = userEvent.setup();
    const email = "bagsh@nomadkids.mn";
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/auth/password-reset", method: "POST", status: 204 },
      { path: "/me/profile", body: { ...PROFILE, email } },
    ]);
    renderWithProviders(<SettingsPage />);

    await openPasswordForm(user);
    await user.click(await screen.findByRole("button", { name: /мартсан уу/ }));

    await waitFor(() =>
      expect(calls.some((call) => call.url === "/auth/password-reset")).toBe(true),
    );
    // Its own identifier, not one typed into a field that is not there.
    const request = calls.find((call) => call.url === "/auth/password-reset")!;
    expect(request.body).toEqual({ identifier: email });
    expect(await screen.findByRole("status")).toHaveTextContent(email);
  });

  /*
   * ★★ An account with no e-mail cannot be sent a link, and this says so.
   *
   * Not an enumeration leak — `/forgot-password` is neutral because it serves
   * a stranger; here the caller is signed in and it is their own account. The
   * neutral wording would be evasive rather than careful, and would leave
   * somebody waiting for a mail that was never going to arrive.
   */
  it("says a reset cannot be sent when the account has no e-mail", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/me/profile", body: PROFILE },
    ]);
    renderWithProviders(<SettingsPage />);

    await openPasswordForm(user);

    expect(screen.queryByRole("button", { name: /мартсан уу/ })).toBeNull();
    expect(screen.getByText(/эрхлэгчид хандана уу/)).toBeInTheDocument();
    expect(calls.some((call) => call.url === "/auth/password-reset")).toBe(false);
  });
});

describe("password reset — new password", () => {
  it("refuses a password with no digit without calling the API", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([{ path: "/auth/password-reset/confirm", status: 204 }]);

    renderWithProviders(<ResetPasswordPage />);

    await user.type(screen.getByLabelText(/^Шинэ нууц үг/), WEAK);
    await user.type(screen.getByLabelText(/давтан/), WEAK);
    await user.click(screen.getByRole("button", { name: "Нууц үг хадгалах" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/тоо/));
    expect(calls.filter((c) => c.url.startsWith("/auth/password-reset/confirm"))).toHaveLength(0);
  });
});

/**
 * The two audiences an invitation can be for.
 *
 * ★ A guardian gives a given name, a phone and a relationship. A member of
 * staff gives a surname and an e-mail — a register names them in full, and the
 * e-mail is what they log in with, because an operator invited this way has a
 * generated handle they never see (`prisma/add-superadmin.ts`).
 *
 * The shape comes from `GET /auth/invitation/:token` rather than from the URL:
 * a query parameter would let whoever holds the link decide which questions
 * they are asked.
 */
describe("invitation — who is accepting", () => {
  it("asks a guardian for a phone and a relationship", async () => {
    stubApi([{ path: "/auth/invitation/", body: { valid: true, kind: "guardian" } }]);

    renderWithProviders(<AcceptInvitationPage />);

    expect(await screen.findByLabelText(/^Утасны дугаар/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Хүүхдийн юу нь болох/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Овог/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^И-мэйл хаяг/)).not.toBeInTheDocument();
  });

  it("asks a member of staff for a surname and an e-mail", async () => {
    stubApi([{ path: "/auth/invitation/", body: { valid: true, kind: "staff" } }]);

    renderWithProviders(<AcceptInvitationPage />);

    expect(await screen.findByLabelText(/^Овог/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^И-мэйл хаяг/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Утасны дугаар/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Хүүхдийн юу нь болох/)).not.toBeInTheDocument();
  });

  /**
   * ★ Only the fields this audience was asked for reach the API.
   *
   * The accept schema requires `.min(1)` on every optional it does receive, so
   * sending an empty `phone` for a staff member would fail validation — and
   * sending the other audience's fields would write facts nobody was asked to
   * give.
   */
  it("sends the staff fields and none of the guardian's", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/invitation/", body: { valid: true, kind: "staff" } },
      { path: "/auth/invitation/accept", method: "POST", status: 204 },
    ]);

    renderWithProviders(<AcceptInvitationPage />);

    await user.type(await screen.findByLabelText(/^Овог/), "Сосорбурам");
    await user.type(screen.getByLabelText(/^Таны нэр/), "Бямбарааш");
    await user.type(screen.getByLabelText(/^И-мэйл хаяг/), "b@example.mn");
    await user.type(screen.getByLabelText(/^Нууц үг \*/), STRONG);
    await user.type(screen.getByLabelText(/давтан/), STRONG);
    await user.click(screen.getByRole("button", { name: /Бүртгэл/ }));

    await waitFor(() =>
      expect(calls.filter((c) => c.method === "POST" && c.url.includes("accept"))).toHaveLength(1),
    );

    const sent = calls.find((c) => c.method === "POST" && c.url.includes("accept"))!.body as Record<
      string,
      unknown
    >;
    expect(sent.lastName).toBe("Сосорбурам");
    expect(sent.email).toBe("b@example.mn");
    expect(sent).not.toHaveProperty("phone");
    expect(sent).not.toHaveProperty("relation");
  });
});
