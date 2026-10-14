import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

const tick = (dialog: HTMLElement) => within(dialog).getByRole("checkbox");

/** A teacher on their own — the only teacher who signs an agreement (2026-10-14). */
const soloSession = () => {
  const session = sessionFor(["ADMIN", "TEACHER"], USER_ID);
  return {
    ...session,
    soloKindergartenIds: session.memberships.map(
      (m: { kindergartenId: string }) => m.kindergartenId,
    ),
  };
};

/*
 * ★ Ticked, then accepted — 2026-10-14, the user, after the agreement's own
 * §2.1: «Гэрээг уншиж, зөвшөөрч байна» is ticked and «ЗӨВШӨӨРӨХ» pressed.
 * Shown once per version; «Татгалзах» opens nothing (§2.4).
 */
describe("the agreement window", () => {
  it("asks a teacher to tick the consent, then welcomes them", async () => {
    const user = userEvent.setup();
    stubApi([{ path: "/auth/me", body: soloSession() }]);
    renderWithProviders(<AgreementGate />);

    const dialog = await screen.findByRole("dialog", {
      name: "Багшийн цахим үйлчилгээ ашиглах гэрээ",
    });
    const accept = within(dialog).getByRole("button", { name: "Зөвшөөрөх" });
    expect(accept).toBeDisabled();
    await user.click(tick(dialog));
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
    await user.click(tick(dialog));
    await user.click(within(dialog).getByRole("button", { name: "Зөвшөөрөх" }));

    await waitFor(() =>
      expect(
        api.calls.find((call) => call.method === "POST" && call.url === "/me/agreements")?.body,
      ).toEqual({ kind: "PARENT", version: AGREEMENTS.PARENT.version }),
    );
  });

  it("opens nothing on «Татгалзах», and goes back to the agreement or signs out", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: soloSession() },
      { path: "/auth/logout", method: "POST", status: 204 },
    ]);
    renderWithProviders(<AgreementGate />);

    const dialog = await screen.findByRole("dialog", {
      name: "Багшийн цахим үйлчилгээ ашиглах гэрээ",
    });
    await user.click(within(dialog).getByRole("button", { name: "Татгалзах" }));
    const refused = await screen.findByRole("dialog", { name: "Гэрээг зөвшөөрөөгүй" });
    expect(refused).toHaveTextContent("үйлчилгээ нээгдэхгүй");

    await user.click(within(refused).getByRole("button", { name: "Гэрээ рүү буцах" }));
    expect(
      await screen.findByRole("dialog", { name: "Багшийн цахим үйлчилгээ ашиглах гэрээ" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Татгалзах" }));
    await user.click(await screen.findByRole("button", { name: "Системээс гарах" }));
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === "POST" && call.url === "/auth/logout")).toBe(
        true,
      ),
    );
  });

  it("shows nothing to a director, or to someone who already accepted", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["ADMIN", "TEACHER"], USER_ID) }]);
    const { unmount } = renderWithProviders(<AgreementGate />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    stubApi([
      { path: "/auth/me", body: soloSession() },
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
 * ★ The solo teacher's own agreement, version 2.0 — 2026-10-14, the user: the
 * lawyer-reviewed text, «Гол зүйлс» on top, the sections folded, a PDF.
 */
describe("a solo teacher", () => {
  it("signs the solo teacher's agreement, version 2.0, and records that version", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: soloSession() },
      { path: "/me/agreements", method: "GET", body: { accepted: [] } },
      { path: "/me/agreements", method: "POST", status: 201, body: {} },
    ]);
    renderWithProviders(<AgreementGate />);

    const dialog = await screen.findByRole("dialog", {
      name: "Багшийн цахим үйлчилгээ ашиглах гэрээ",
    });
    // Laid out as the paper: the whole text open, nothing folded away.
    expect(dialog).toHaveTextContent("NOMADKIDS.MN • ЦАХИМ ҮЙЛЧИЛГЭЭНИЙ ГЭРЭЭ");
    expect(dialog).toHaveTextContent("Гэрээний хувилбар: 2.0 | Цахим хэлбэрээр байгуулах гэрээ");
    expect(
      within(dialog).getByRole("rowheader", { name: "Үйлчилгээ үзүүлэгч" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Хүүхдийг доромжилсон, ичгүүртэй байдалд/)).toBeVisible();
    expect(within(dialog).getAllByRole("region", { name: /^\d+\. / })).toHaveLength(10);
    expect(dialog).toHaveTextContent("Хууль зүйн үндэслэл: Монгол Улсын Иргэний хууль");
    expect(dialog.querySelector("details")).toBeNull();
    // §4 follows the rule the system keeps, not «no child invited in 30 days».
    expect(dialog).toHaveTextContent("4.3. Төлбөр нь хүчинтэй хүүхэдтэй багшийн бүртгэлийг");
    expect(
      within(dialog).getByRole("button", { name: "Гэрээг хэвлэх, PDF болгох" }),
    ).toBeInTheDocument();

    await user.click(tick(dialog));
    await user.click(within(dialog).getByRole("button", { name: "Зөвшөөрөх" }));
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.method === "POST" && call.url === "/me/agreements")?.body,
      ).toEqual({ kind: "TEACHER", version: "solo-2.0" }),
    );
  });

  it("asks again when they had only accepted the trial text", async () => {
    stubApi([
      { path: "/auth/me", body: soloSession() },
      {
        path: "/me/agreements",
        body: {
          accepted: [{ kind: "TEACHER", version: "trial-2026-10-12", acceptedAt: "2026-10-12" }],
        },
      },
    ]);
    renderWithProviders(<AgreementGate />);

    expect(
      await screen.findByRole("dialog", { name: "Багшийн цахим үйлчилгээ ашиглах гэрээ" }),
    ).toBeInTheDocument();
  });
});

describe("«Гэрээ» in the personal settings", () => {
  it("opens the accepted agreement with the day it was accepted", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: soloSession() },
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

    await user.click(await screen.findByRole("button", { name: "Миний гэрээ" }));
    const dialog = screen.getByRole("dialog", { name: "Миний гэрээ" });
    expect(within(dialog).getByText("Багшийн цахим үйлчилгээ ашиглах гэрээ")).toBeInTheDocument();
    expect(await within(dialog).findByText(/Зөвшөөрсөн:/)).toBeInTheDocument();
  });

  it("is not there for a director", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["ADMIN"], USER_ID) }]);
    renderWithProviders(<AgreementButton />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("button", { name: "Миний гэрээ" })).toBeNull();
  });
});

/*
 * ★ «Миний гэрээ» — 2026-10-14, the user: a solo teacher finds their own
 * agreement, version 2.0, with the day it was accepted.
 */
describe("«Миний гэрээ» for a solo teacher", () => {
  it("shows the solo teacher's 2.0 agreement and the day it was accepted", async () => {
    const user = userEvent.setup();
    const session = sessionFor(["ADMIN", "TEACHER"], USER_ID);
    stubApi([
      {
        path: "/auth/me",
        body: {
          ...session,
          soloKindergartenIds: session.memberships.map(
            (m: { kindergartenId: string }) => m.kindergartenId,
          ),
        },
      },
      {
        path: "/me/agreements",
        body: {
          accepted: [
            { kind: "TEACHER", version: "solo-2.0", acceptedAt: "2026-10-14T05:30:00.000Z" },
          ],
        },
      },
    ]);
    renderWithProviders(<AgreementButton />);

    await user.click(await screen.findByRole("button", { name: "Миний гэрээ" }));
    const dialog = screen.getByRole("dialog", { name: "Миний гэрээ" });
    expect(dialog).toHaveTextContent("Багшийн цахим үйлчилгээ ашиглах гэрээ");
    expect(dialog).toHaveTextContent("Гэрээний хувилбар: 2.0");
    expect(dialog).toHaveTextContent("Зөвшөөрсөн: 2026.10.14");
  });
});

/*
 * ★ «Цэцэрлэг дагасан багшид гэрээ байхгүй» — 2026-10-14, the user: a
 * teacher of a contracted kindergarten signs nothing here.
 */
describe("a kindergarten's teacher", () => {
  it("is asked to sign nothing, and has no «Миний гэрээ»", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"], USER_ID) },
      { path: "/me/agreements", body: { accepted: [] } },
    ]);
    renderWithProviders(
      <>
        <AgreementGate />
        <AgreementButton />
      </>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Миний гэрээ" })).toBeNull();
  });
});
