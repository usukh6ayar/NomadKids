import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, setParams, setSearchParams, stubApi } from "./support/render";
import ForgotPasswordPage from "@/app/forgot-password/page";
import AcceptInvitationPage from "@/app/invitation/[token]/page";

/**
 * verify.mn phone verification on the two public screens — 2026-10-01.
 *
 * What is pinned is the handoff: the handle the SMS step earns is the one the
 * consuming request carries, and nothing is submitted without it. Whether the
 * proof is *valid* is the server's rule, tested in
 * `apps/api/test/phone-verification.test.ts`.
 */

const STRONG = "Нууцүг123";
const HANDLE = "handle-from-the-server-0123456789";

const START = {
  handle: HANDLE,
  shortcode: "144773",
  code: "482916",
  smsUri: "sms:144773?body=482916",
  displayInstruction: 'Та өөрийн 99112233 дугаараас 144773 дугаарт "482916" гэж SMS илгээнэ үү.',
  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ token: "invitation-token-value" });
  setSearchParams("");
});

describe("forgot password — by phone", () => {
  it("sets the new password with the handle the SMS earned", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/phone-verifications/availability", body: { enabled: true } },
      { path: "/auth/password-reset/phone/confirm", method: "POST", status: 204 },
      { path: "/auth/password-reset/phone", method: "POST", body: START },
      {
        path: "/phone-verifications/check",
        method: "POST",
        body: { status: "VERIFIED", expiresAt: START.expiresAt, accountFound: true },
      },
    ]);

    renderWithProviders(<ForgotPasswordPage />);

    // Phone only since 2026-10-04 — the e-mail path is gone from this screen.
    expect(await screen.findByRole("textbox", { name: /^Утасны дугаар/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/и-мэйл/i)).not.toBeInTheDocument();

    // Spaces from a pasted contact card are dropped as typed.
    await user.type(screen.getByRole("textbox", { name: /^Утасны дугаар/ }), "9911 2233");
    await user.click(screen.getByRole("button", { name: "Код авах" }));

    await user.type(await screen.findByLabelText(/^Шинэ нууц үг/, { selector: "input" }), STRONG);
    await user.type(screen.getByLabelText(/давтан/), STRONG);
    await user.click(screen.getByRole("button", { name: "Нууц үг шинэчлэх" }));

    await waitFor(() =>
      expect(calls.find((c) => c.url === "/auth/password-reset/phone/confirm")?.body).toEqual({
        handle: HANDLE,
        password: STRONG,
      }),
    );
  });

  it("says no account was found only after the SMS proved the number", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/phone-verifications/availability", body: { enabled: true } },
      { path: "/auth/password-reset/phone", method: "POST", body: START },
      {
        path: "/phone-verifications/check",
        method: "POST",
        body: { status: "VERIFIED", expiresAt: START.expiresAt, accountFound: false },
      },
    ]);

    renderWithProviders(<ForgotPasswordPage />);

    await user.type(await screen.findByRole("textbox", { name: /^Утасны дугаар/ }), "99112233");
    await user.click(screen.getByRole("button", { name: "Код авах" }));

    expect(await screen.findByText(/бүртгэл олдсонгүй/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Шинэ нууц үг/, { selector: "input" })).not.toBeInTheDocument();
  });
});

describe("the SMS step", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /*
   * ★ A failed poll is not an answer. The first check fires the moment the
   * code is shown, which is exactly when a phone is switching to its SMS app
   * and a request is most likely to drop — and stopping there would leave a
   * person who has paid for the SMS watching a countdown that cannot succeed.
   */
  it("keeps polling after a failed check", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const check = {
      path: "/phone-verifications/check",
      method: "POST",
      status: 503,
      body: {
        type: "about:blank",
        title: "Түр ажиллахгүй",
        status: 503,
        requestId: "t",
      } as unknown,
    };
    const { calls } = stubApi([
      { path: "/phone-verifications/availability", body: { enabled: true } },
      { path: "/auth/password-reset/phone", method: "POST", body: START },
      check,
    ]);

    renderWithProviders(<ForgotPasswordPage />);
    await user.type(await screen.findByRole("textbox", { name: /^Утасны дугаар/ }), "99112233");
    await user.click(screen.getByRole("button", { name: "Код авах" }));

    await waitFor(() =>
      expect(calls.filter((c) => c.url === "/phone-verifications/check")).toHaveLength(1),
    );

    check.status = 200;
    check.body = { status: "VERIFIED", expiresAt: START.expiresAt, accountFound: true };
    await vi.advanceTimersByTimeAsync(3_000);

    expect(
      await screen.findByLabelText(/^Шинэ нууц үг/, { selector: "input" }),
    ).toBeInTheDocument();
  });
});

describe("invitation — the guardian's phone", () => {
  async function fillForm(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/^Таны нэр/), "Оюун");
    await user.type(screen.getByRole("textbox", { name: /^Утасны дугаар/ }), "99112233");
    await user.type(screen.getByLabelText(/^Нууц үг \*/), STRONG);
    await user.type(screen.getByLabelText(/давтан/), STRONG);
  }

  it("is not submitted until the SMS proved it, and then carries the proof", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/phone-verifications/availability", body: { enabled: true } },
      { path: "/auth/invitation/accept", method: "POST", status: 204 },
      { path: "/auth/invitation/phone", method: "POST", body: START },
      {
        path: "/phone-verifications/check",
        method: "POST",
        body: { status: "VERIFIED", expiresAt: START.expiresAt },
      },
    ]);

    renderWithProviders(<AcceptInvitationPage />);
    await fillForm(user);

    await user.click(await screen.findByRole("button", { name: "SMS-ээр баталгаажуулах" }));
    // Before the proof lands the form refuses locally — wait for it instead.
    expect(await screen.findByText("Утасны дугаар баталгаажлаа")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Бүртгэл идэвхжүүлэх" }));

    await waitFor(() =>
      expect(calls.find((c) => c.url === "/auth/invitation/accept")?.body).toMatchObject({
        phone: "99112233",
        phoneVerification: HANDLE,
      }),
    );
    expect(calls.find((c) => c.url === "/auth/invitation/phone")?.body).toEqual({
      token: "invitation-token-value",
      phone: "99112233",
    });
  });

  it("refuses to submit an unproven phone without calling the API", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/phone-verifications/availability", body: { enabled: true } },
      { path: "/auth/invitation/accept", method: "POST", status: 204 },
    ]);

    renderWithProviders(<AcceptInvitationPage />);
    await fillForm(user);
    await screen.findByRole("button", { name: "SMS-ээр баталгаажуулах" });

    await user.click(screen.getByRole("button", { name: "Бүртгэл идэвхжүүлэх" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/SMS-ээр/));
    expect(calls.filter((c) => c.url === "/auth/invitation/accept")).toHaveLength(0);
  });
});
