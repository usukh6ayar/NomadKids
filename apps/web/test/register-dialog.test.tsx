import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROUTER, renderWithProviders, sessionFor, stubApi } from "./support/render";
import RegisterPage from "@/app/register/page";
import { RegisterDialog } from "@/components/public/register-dialog";

/*
 * ★ Байгууллагын бүртгэл in a window over the home page — 2026-10-08, the
 * client. No note, no address, «Бүлгийн тоо» in place of «Хүүхдийн тоо»; the
 * API is to follow.
 */
afterEach(() => vi.unstubAllGlobals());

describe("the organisation registration window", () => {
  it("opens over the home page and goes home on ×", async () => {
    const user = userEvent.setup();
    ROUTER.push.mockClear();
    stubApi([{ path: "/auth/me", body: sessionFor([]) }]);
    renderWithProviders(<RegisterPage />);

    const dialog = screen.getByRole("dialog", { name: "Байгууллагын бүртгэл" });
    // The home page is behind it.
    expect(screen.getByTestId("login-hero")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Хаах" }));
    expect(ROUTER.push).toHaveBeenCalledWith("/");
  });

  it("sends the group count, and no address or note", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      {
        path: "/applications",
        method: "POST",
        status: 201,
        body: { id: "11111111-1111-4111-8111-111111111111", status: "PENDING" },
      },
    ]);
    renderWithProviders(<RegisterDialog onClose={() => {}} />);

    expect(screen.queryByLabelText(/Нэмэлт тэмдэглэл/)).toBeNull();
    expect(screen.queryByLabelText(/^Хаяг/)).toBeNull();
    expect(screen.queryByLabelText(/Хүүхдийн тоо/)).toBeNull();
    await user.type(screen.getByLabelText(/Цэцэрлэгийн нэр/), "Нарлаг");
    await user.type(screen.getByLabelText(/Регистрийн дугаар/), "1234567");
    await user.type(screen.getByLabelText(/Бүлгийн тоо/), "6");
    await user.type(screen.getByLabelText(/Эрхлэгчийн нэр/), "Сараа");
    await user.type(screen.getByLabelText(/^Утас/), "99112233");
    await user.type(screen.getByLabelText(/^И-мэйл/), "narlag@example.mn");
    await user.click(screen.getByRole("button", { name: "Гэрээний хүсэлт илгээх" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.url === "/applications")?.body).toEqual({
        kindergartenName: "Нарлаг",
        registrationNumber: "1234567",
        directorName: "Сараа",
        phone: "99112233",
        email: "narlag@example.mn",
        groupCount: 6,
      }),
    );
    expect(await screen.findByText("Хүсэлт хүлээн авлаа")).toBeInTheDocument();
  });

  it("says plainly that the server is being updated while it still asks for the old fields", async () => {
    const user = userEvent.setup();
    stubApi([
      {
        path: "/applications",
        method: "POST",
        status: 400,
        body: {
          type: "about:blank",
          title: "Validation failed",
          status: 400,
          requestId: "test",
          errors: { address: ["Required"], childCount: ["Required"] },
        },
      },
    ]);
    renderWithProviders(<RegisterDialog onClose={() => {}} />);

    await user.type(screen.getByLabelText(/Цэцэрлэгийн нэр/), "Нарлаг");
    await user.click(screen.getByRole("button", { name: "Гэрээний хүсэлт илгээх" }));

    expect(await screen.findByText(/Бүртгэлийн сервер шинэчлэгдэж байна/)).toBeInTheDocument();
  });
});
