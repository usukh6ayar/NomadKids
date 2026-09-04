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

describe("settings — changing a password", () => {
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
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/me/profile", body: PROFILE },
    ]);

    renderWithProviders(<SettingsPage />);

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

    await user.type(await screen.findByLabelText(/^Одоогийн нууц үг/), "Whatever123");
    await user.type(screen.getByLabelText(/^Шинэ нууц үг \*/), WEAK);
    await user.type(screen.getByLabelText(/^Шинэ нууц үг давтах/), WEAK);
    await user.click(screen.getByRole("button", { name: "Нууц үг солих" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/том үсэг|тоо байх ёстой/),
    );
    expect(calls.filter((c) => c.url.startsWith("/auth/password"))).toHaveLength(0);
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
