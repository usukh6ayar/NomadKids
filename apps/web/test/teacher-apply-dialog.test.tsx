import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROUTER, renderWithProviders, stubApi } from "./support/render";
import { TeacherApplyDialog } from "@/components/public/teacher-apply-dialog";

/*
 * ★ «Багшийн гэрээ» — 2026-10-08, the client. Since 2026-10-11 the sign-up
 * creates the teacher's own workspace at once and answers an invitation
 * token; the window goes to `/invitation/[token]` to set the password.
 */
afterEach(() => vi.unstubAllGlobals());

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Овог нэр/), "Д.Сувдаа");
  await user.type(screen.getByLabelText(/^Утас/), "99112233");
  await user.type(screen.getByLabelText(/^И-мэйл/), "suvdaa@example.mn");
  await user.click(screen.getByLabelText(/Аймаг \/ дүүрэг/));
  await user.click(screen.getByRole("option", { name: "Баянзүрх" }));
  await user.type(screen.getByLabelText(/Цэцэрлэгийн нэр/), "Нарлаг");
  await user.click(screen.getByRole("button", { name: "Гэрээний хүсэлт илгээх" }));
}

describe("the teacher's contract window", () => {
  it("sends the teacher's ownership, location and kindergarten, then sets the password", async () => {
    const user = userEvent.setup();
    ROUTER.replace.mockClear();
    const api = stubApi([
      {
        path: "/teacher-applications",
        method: "POST",
        status: 201,
        body: { invitationToken: "tok-123" },
      },
    ]);
    renderWithProviders(<TeacherApplyDialog onClose={() => {}} />);
    await fill(user);

    await waitFor(() =>
      expect(api.calls.find((call) => call.url === "/teacher-applications")?.body).toEqual({
        fullName: "Д.Сувдаа",
        phone: "99112233",
        email: "suvdaa@example.mn",
        propertyType: "Төрийн бус",
        location: "Баянзүрх дүүрэг",
        kindergartenName: "Нарлаг",
      }),
    );
    await waitFor(() => expect(ROUTER.replace).toHaveBeenCalledWith("/invitation/tok-123"));
  });

  it("defaults the ownership to private and provides the location picker", () => {
    renderWithProviders(<TeacherApplyDialog onClose={() => {}} />);

    expect(screen.getByLabelText(/Өмчийн хэлбэр/)).toHaveTextContent("Төрийн бус");
    expect(screen.getByLabelText(/Аймаг \/ дүүрэг/)).toHaveTextContent("Сонгоно уу");
    expect(screen.getByLabelText(/Цэцэрлэгийн нэр/)).toBeInTheDocument();
  });

  it("says plainly when the phone is already in use", async () => {
    const user = userEvent.setup();
    stubApi([
      {
        path: "/teacher-applications",
        method: "POST",
        status: 409,
        body: {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "Энэ утасны дугаар аль хэдийн бүртгэлтэй байна",
        },
      },
    ]);
    renderWithProviders(<TeacherApplyDialog onClose={() => {}} />);
    await fill(user);

    expect(await screen.findByText(/аль хэдийн бүртгэ/)).toBeInTheDocument();
  });
});
