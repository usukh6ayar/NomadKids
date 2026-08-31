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

describe("settings — changing a password", () => {
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
