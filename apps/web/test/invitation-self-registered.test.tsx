import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, setParams, setSearchParams, stubApi } from "./support/render";
import AcceptInvitationPage from "@/app/invitation/[token]/page";

vi.mock("@/components/public/landing", () => ({ PublicLanding: () => null }));

/**
 * A teacher who signed up alone typed «Овог нэр» and a phone on the sign-up
 * form; the invitation that follows asked for both again (the user,
 * 2026-10-14). What is pinned: what the server says it already knows is
 * neither shown nor sent, and a director's invitation still asks.
 */

const STRONG = "Нууцүг123";

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ token: "invitation-token-value" });
  setSearchParams("");
});

const HANDLE = "handle-from-the-server-0123456789";

function stub(knows: { name: boolean; phone: boolean }, sms = false) {
  return stubApi([
    { path: "/phone-verifications/availability", body: { enabled: sms } },
    { path: "/auth/invitation/accept", method: "POST", status: 204 },
    {
      path: "/auth/invitation/phone",
      method: "POST",
      body: {
        handle: HANDLE,
        shortcode: "144773",
        code: "482916",
        smsUri: "sms:144773?body=482916",
        displayInstruction: 'Та 144773 дугаарт "482916" гэж SMS илгээнэ үү.',
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
    },
    {
      path: "/phone-verifications/check",
      method: "POST",
      body: { status: "VERIFIED", expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() },
    },
    {
      path: "/auth/invitation/invitation-token-value",
      body: {
        valid: true,
        kind: "staff",
        knows,
        ...(knows.phone ? { phoneHint: "••••2233" } : {}),
      },
    },
  ]);
}

describe("accepting an invitation after signing up alone", () => {
  it("asks only for the password", async () => {
    const user = userEvent.setup();
    const { calls } = stub({ name: true, phone: true });
    renderWithProviders(<AcceptInvitationPage />);

    expect(
      await screen.findByText("Нууц үгээ сонгоод бүртгэлээ идэвхжүүлнэ үү."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Овог/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Таны нэр/)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^Утасны дугаар/ })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Нууц үг \*/), STRONG);
    await user.type(screen.getByLabelText(/давта[нх]/), STRONG);
    await user.click(screen.getByRole("button", { name: "Бүртгэл идэвхжүүлэх" }));

    await waitFor(() =>
      expect(calls.find((c) => c.url === "/auth/invitation/accept")?.body).toEqual({
        token: "invitation-token-value",
        password: STRONG,
      }),
    );
  });

  it("proves the number given at sign-up by SMS without its being retyped", async () => {
    const user = userEvent.setup();
    const { calls } = stub({ name: true, phone: true }, true);
    renderWithProviders(<AcceptInvitationPage />);

    expect(await screen.findByText("••••2233")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^Утасны дугаар/ })).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "SMS-ээр баталгаажуулах" }));
    expect(await screen.findByText("Утасны дугаар баталгаажлаа")).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/auth/invitation/phone")?.body).toEqual({
      token: "invitation-token-value",
    });

    await user.type(screen.getByLabelText(/^Нууц үг \*/), STRONG);
    await user.type(screen.getByLabelText(/давта[нх]/), STRONG);
    await user.click(screen.getByRole("button", { name: "Бүртгэл идэвхжүүлэх" }));

    await waitFor(() =>
      expect(calls.find((c) => c.url === "/auth/invitation/accept")?.body).toEqual({
        token: "invitation-token-value",
        password: STRONG,
        phoneVerification: HANDLE,
      }),
    );
  });

  it("still asks a member of staff a director invited", async () => {
    stub({ name: false, phone: false });
    renderWithProviders(<AcceptInvitationPage />);

    expect(await screen.findByLabelText(/^Овог/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Таны нэр/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Утасны дугаар/ })).toBeInTheDocument();
  });
});
