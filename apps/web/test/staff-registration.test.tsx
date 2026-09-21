import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, ROUTER, setParams, setSearchParams, stubApi } from "./support/render";
import StaffRegisterPage from "@/app/staff-register/page";

/*
 * ★ `StaffRegistrationService.register`'s `REFUSAL` constant, copied rather
 * than imported — it lives in `apps/api`, a different package the web tests
 * do not build against. The point of this suite is that whatever the server
 * sends as `problem.detail` reaches the screen unchanged, so the exact string
 * only has to match what `stubApi` is told to answer with, not the API's own
 * source.
 */
const REFUSAL = "Код эсвэл регистрийн дугаар буруу байна.";

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
  setSearchParams("");
});

describe("бүртгүүлэх маягт", () => {
  it("хоёр талбарыг харуулна", async () => {
    stubApi([{ path: "/auth/me", status: 401 }]);

    renderWithProviders(<StaffRegisterPage />);

    expect(screen.getByLabelText(/Цэцэрлэгийн ESIS дугаар/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Регистрийн дугаар/)).toBeInTheDocument();
  });

  /*
   * ★ The server answers every refusal identically. The screen must not
   * improve on that by guessing — a message like "Таны РД олдсонгүй" would
   * undo the uniform refusal `StaffRegistrationService.register` is built
   * around.
   */
  it("серверийн буцаасан мессежийг яг тэр хэвээр харуулна", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", status: 401 },
      {
        path: "/staff-registration",
        method: "POST",
        status: 401,
        body: {
          type: "about:blank",
          title: "Нэвтрэх шаардлагатай",
          status: 401,
          requestId: "t",
          detail: REFUSAL,
        },
      },
    ]);

    renderWithProviders(<StaffRegisterPage />);

    await user.type(screen.getByLabelText(/Цэцэрлэгийн ESIS дугаар/), "9999999");
    await user.type(screen.getByLabelText(/Регистрийн дугаар/), "УЛ24270406");
    await user.click(screen.getByRole("button", { name: "Бүртгүүлэх" }));

    expect(await screen.findByText(REFUSAL)).toBeInTheDocument();
  });

  /*
   * ★ The help text pointing a refused teacher at their director must be
   * static — present before any submission, not conjured only once the server
   * has refused. A sentence that only appears on failure would itself leak
   * information the uniform refusal is built to hide (see the test above).
   */
  it("тусламжийн мессежийг алдаанаас үл хамааран байнга харуулна", async () => {
    stubApi([{ path: "/auth/me", status: 401 }]);

    renderWithProviders(<StaffRegisterPage />);

    expect(screen.getByText(/захиралтай холбогдоно уу/)).toBeInTheDocument();
  });

  it("амжилттай бүртгүүлбэл урилгын хуудас руу шилжинэ", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", status: 401 },
      {
        path: "/staff-registration",
        method: "POST",
        status: 201,
        body: { invitationToken: "abc123token" },
      },
    ]);

    renderWithProviders(<StaffRegisterPage />);

    await user.type(screen.getByLabelText(/Цэцэрлэгийн ESIS дугаар/), "42778");
    await user.type(screen.getByLabelText(/Регистрийн дугаар/), "УЛ24270406");
    await user.click(screen.getByRole("button", { name: "Бүртгүүлэх" }));

    await waitFor(() => expect(ROUTER.replace).toHaveBeenCalledWith("/invitation/abc123token"));

    const post = calls.find((c) => c.method === "POST" && c.url.startsWith("/staff-registration"));
    expect(post?.body).toEqual({ institutionId: "42778", registerNumber: "УЛ24270406" });
  });
});
