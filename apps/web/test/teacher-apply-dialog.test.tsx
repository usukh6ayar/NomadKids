import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, stubApi } from "./support/render";
import { TeacherApplyDialog } from "@/components/public/teacher-apply-dialog";

/*
 * ★ «Багшийн гэрээ» — 2026-10-08, the client. `POST /teacher-applications`
 * is the contract the backend is asked for; until it exists the window says
 * so and gives the phone and e-mail.
 */
afterEach(() => vi.unstubAllGlobals());

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Овог нэр/), "Д.Сувдаа");
  await user.type(screen.getByLabelText(/^Утас/), "99112233");
  await user.type(screen.getByLabelText(/^И-мэйл/), "suvdaa@example.mn");
  await user.click(screen.getByRole("button", { name: "Гэрээний хүсэлт илгээх" }));
}

describe("the teacher's contract window", () => {
  it("sends the teacher's details, leaving out an empty kindergarten", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      {
        path: "/teacher-applications",
        method: "POST",
        status: 201,
        body: { id: "t1", status: "PENDING" },
      },
    ]);
    renderWithProviders(<TeacherApplyDialog onClose={() => {}} />);
    await fill(user);

    await waitFor(() =>
      expect(api.calls.find((call) => call.url === "/teacher-applications")?.body).toEqual({
        fullName: "Д.Сувдаа",
        phone: "99112233",
        email: "suvdaa@example.mn",
      }),
    );
    expect(await screen.findByText("Хүсэлт хүлээн авлаа")).toBeInTheDocument();
  });

  it("gives the phone and e-mail while the endpoint is missing", async () => {
    const user = userEvent.setup();
    stubApi([]);
    renderWithProviders(<TeacherApplyDialog onClose={() => {}} />);
    await fill(user);

    expect(
      await screen.findByText(/Багшийн бүртгэл удахгүй нээгдэнэ\. Одоохондоо 7213 4888/),
    ).toBeInTheDocument();
  });
});
