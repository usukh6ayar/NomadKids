import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, setParams, setSearchParams, stubApi } from "./support/render";
import AcceptInvitationPage from "@/app/invitation/[token]/page";

vi.mock("@/components/public/landing", () => ({ PublicLanding: () => null }));

/*
 * ★ 2026-10-27: a parent scanned another child's card and became that child's
 * guardian. A family's invitation names the child and asks their birth date.
 */
beforeEach(() => {
  vi.clearAllMocks();
  setParams({ token: "invitation-token-value" });
  setSearchParams("");
});

function stub() {
  return stubApi([
    { path: "/phone-verifications/availability", body: { enabled: false } },
    { path: "/auth/invitation/accept", method: "POST", status: 204 },
    {
      path: "/auth/invitation/invitation-token-value",
      body: {
        valid: true,
        kind: "guardian",
        knows: { name: false, phone: false },
        children: ["Б. Сараа"],
      },
    },
  ]);
}

describe("a family's invitation", () => {
  it("names the child and sends the birth date the parent gives", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<AcceptInvitationPage />);

    expect(await screen.findByText("Б. Сараа")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Таны нэр/), "Болормаа");
    await user.type(screen.getByLabelText(/Утасны дугаар/), "99112233");
    await user.click(screen.getByRole("button", { name: "Бүртгэл идэвхжүүлэх" }));
    expect(screen.getByText("Хүүхдийн төрсөн огноог оруулна уу.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.url === "/auth/invitation/accept")).toBe(false);

    const date = screen.getByLabelText(/Хүүхдийн төрсөн огноо/);
    await user.type(date, "2021-04-12");
    for (const field of screen.getAllByLabelText(/Нууц үг/)) await user.type(field, "Нууцүг123");
    await user.click(screen.getByRole("button", { name: "Бүртгэл идэвхжүүлэх" }));

    await waitFor(() => {
      const accepted = api.calls.find((c) => c.url === "/auth/invitation/accept");
      expect((accepted?.body as { childBirthDate?: string })?.childBirthDate).toBe("2021-04-12");
    });
  });
});
