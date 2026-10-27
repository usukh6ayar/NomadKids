import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTER, renderWithProviders, sessionFor, stubApi } from "./support/render";
import RootPage from "@/app/page";
import NoAccessPage from "@/app/(app)/no-access/page";

/*
 * ★ A kindergarten whose paid service has lapsed — the user, 2026-10-27:
 * «эрх дуусвал зөвхөн төлбөрийн хуудас нээгдэж, бусад ажил хаагдана». The
 * API leaves the membership out and names it in `lapsed`.
 */
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.clearAllMocks());

const KG = "33333333-3333-4333-8333-333333333333";

function lapsedSession(role: "ADMIN" | "TEACHER") {
  return { ...sessionFor([]), lapsed: [{ kindergartenId: KG, role, name: "Нархан цэцэрлэг" }] };
}

describe("a lapsed service", () => {
  it("sends a director to «Үйлчилгээний эрх»", async () => {
    stubApi([{ path: "/auth/me", body: lapsedSession("ADMIN") }]);
    renderWithProviders(<RootPage />);
    await waitFor(() => expect(ROUTER.replace).toHaveBeenCalledWith("/admin/service-access"));
  });

  it("tells anyone else the kindergarten's service has ended, not that their account has", async () => {
    stubApi([{ path: "/auth/me", body: lapsedSession("TEACHER") }]);
    renderWithProviders(<RootPage />);
    await waitFor(() => expect(ROUTER.replace).toHaveBeenCalledWith("/no-access"));

    renderWithProviders(<NoAccessPage />);
    expect(
      await screen.findByRole("heading", { name: "Цэцэрлэгийн үйлчилгээний эрх дууссан байна" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Нархан цэцэрлэг-ийн NomadKids-ийн төлбөрийн хугацаа дууссан/),
    ).toBeInTheDocument();
  });
});
