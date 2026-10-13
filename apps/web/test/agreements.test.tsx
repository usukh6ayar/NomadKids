import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { AgreementButton, AgreementGate } from "@/components/agreements/agreement-gate";
import { AGREEMENTS } from "@/lib/agreements";

/*
 * ★ The first-sign-in agreement — 2026-10-12, the user: a teacher and a
 * guardian read it to the end, press «Зөвшөөрөх», are welcomed; a director
 * signs the kindergarten's contract by e-mail and sees nothing here.
 */
const USER_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("the agreement window", () => {
  beforeEach(() => {
    // A text taller than its box, so it has to be scrolled to the end.
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  });

  it("asks a teacher to read to the end, then welcomes them", async () => {
    const user = userEvent.setup();
    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"], USER_ID) }]);
    renderWithProviders(<AgreementGate />);

    const dialog = await screen.findByRole("dialog", { name: "Багш хэрэглэгчийн гэрээ" });
    const accept = within(dialog).getByRole("button", { name: "Зөвшөөрөх" });
    expect(accept).toBeDisabled();

    const text = within(dialog).getByLabelText("Гэрээний эх бичвэр");
    text.scrollTop = 800;
    fireEvent.scroll(text);
    expect(accept).toBeEnabled();
    await user.click(accept);

    const welcome = await screen.findByRole("dialog", { name: "Системд тавтай морил" });
    await user.click(within(welcome).getByRole("button", { name: "Эхлэх" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Kept in this browser until `/me/agreements` exists.
    expect(window.localStorage.getItem(`nomadkids.agreements.${USER_ID}`)).toContain(
      AGREEMENTS.TEACHER.version,
    );
  });

  it("sends the acceptance to the server once the server answers", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"], USER_ID) },
      { path: "/me/agreements", method: "GET", body: { accepted: [] } },
      { path: "/me/agreements", method: "POST", status: 201, body: {} },
    ]);
    renderWithProviders(<AgreementGate />);

    const dialog = await screen.findByRole("dialog", { name: "Эцэг эх хэрэглэгчийн гэрээ" });
    const text = within(dialog).getByLabelText("Гэрээний эх бичвэр");
    text.scrollTop = 800;
    fireEvent.scroll(text);
    await user.click(within(dialog).getByRole("button", { name: "Зөвшөөрөх" }));

    await waitFor(() =>
      expect(
        api.calls.find((call) => call.method === "POST" && call.url === "/me/agreements")?.body,
      ).toEqual({ kind: "PARENT", version: AGREEMENTS.PARENT.version }),
    );
  });

  it("shows nothing to a director, or to someone who already accepted", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["ADMIN", "TEACHER"], USER_ID) }]);
    const { unmount } = renderWithProviders(<AgreementGate />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"], USER_ID) },
      {
        path: "/me/agreements",
        body: {
          accepted: [
            { kind: "TEACHER", version: AGREEMENTS.TEACHER.version, acceptedAt: "2026-10-12" },
          ],
        },
      },
    ]);
    renderWithProviders(<AgreementGate />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

/*
 * ★ The defect the user found on 2026-10-12: a text short enough to need no
 * scrolling left «Зөвшөөрөх» disabled for ever.
 */
describe("a short agreement", () => {
  it("can be accepted without scrolling", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(150);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"], USER_ID) }]);
    renderWithProviders(<AgreementGate />);

    const dialog = await screen.findByRole("dialog", { name: "Багш хэрэглэгчийн гэрээ" });
    expect(within(dialog).getByRole("button", { name: "Зөвшөөрөх" })).toBeEnabled();
  });
});

describe("a solo teacher (#202)", () => {
  it("signs the teacher's agreement although they hold ADMIN in their own workspace", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(150);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    const session = sessionFor(["ADMIN", "TEACHER"], USER_ID);
    const solo = {
      ...session,
      soloKindergartenIds: session.memberships.map(
        (m: { kindergartenId: string }) => m.kindergartenId,
      ),
    };
    stubApi([{ path: "/auth/me", body: solo }]);
    renderWithProviders(<AgreementGate />);

    expect(
      await screen.findByRole("dialog", { name: "Багш хэрэглэгчийн гэрээ" }),
    ).toBeInTheDocument();
  });
});

describe("«Гэрээ» in the personal settings", () => {
  it("opens the accepted agreement with the day it was accepted", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"], USER_ID) },
      {
        path: "/me/agreements",
        body: {
          accepted: [
            {
              kind: "TEACHER",
              version: AGREEMENTS.TEACHER.version,
              acceptedAt: "2026-10-12T05:00:00Z",
            },
          ],
        },
      },
    ]);
    renderWithProviders(<AgreementButton />);

    await user.click(await screen.findByRole("button", { name: "Гэрээ" }));
    const dialog = screen.getByRole("dialog", { name: "Гэрээ" });
    expect(within(dialog).getByText("Багш хэрэглэгчийн гэрээ")).toBeInTheDocument();
    expect(await within(dialog).findByText(/Зөвшөөрсөн:/)).toBeInTheDocument();
  });

  it("is not there for a director", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["ADMIN"], USER_ID) }]);
    renderWithProviders(<AgreementButton />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("button", { name: "Гэрээ" })).toBeNull();
  });
});
