import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { EditObservationDialog } from "@/components/child/child-observations";

/**
 * «Тэмдэглэл засах» and the note's А/79 criteria — 2026-10-22, the user: a
 * note linked to А/79 lost its criteria from view when opened for editing.
 * The dialog reads them, shows them, and saves them back only when changed.
 */

const CHILD = "66666666-6666-4666-8666-666666666666";
const NOTE = "dddddddd-dddd-4ddd-8ddd-000000000001";

const observation = {
  id: NOTE,
  childId: CHILD,
  observedOn: "2026-10-15",
  source: "TEACHER",
  reviewStatus: "APPROVED",
  visibleToParents: true,
  activityName: "Тоглоом",
  situation: "Блокоор цамхаг барив.",
  childDid: null,
  childSaid: null,
  teacherComment: null,
  nextSteps: null,
  reviewNote: null,
  type: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Өдөр тутмын ажиглалт", code: null },
  author: null,
  media: [],
  domains: [],
  indicator: null,
  indicatorLevel: null,
  observedTime: null,
};

function render(links: { status?: number; body: unknown }) {
  const api = stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/observations/${NOTE}/a79-links`, method: "GET", ...links },
    { path: `/observations/${NOTE}/a79-links`, method: "PUT", body: { links: [] } },
    { path: `/observations/${NOTE}`, method: "PATCH", body: observation },
  ]);
  renderWithProviders(
    <EditObservationDialog
      childId={CHILD}
      observation={observation as never}
      onClose={() => {}}
    />,
  );
  return api;
}

beforeEach(() => vi.clearAllMocks());

describe("editing a note linked to А/79", () => {
  it("shows the note's criteria, and saves the note without touching them", async () => {
    const api = render({
      body: { links: [{ level: "IV", number: 12, status: "SUPPORTED", note: "Сануулгатай" }] },
    });

    const card = await screen.findByRole("group", { name: "А/79 · IV · Ш12" });
    expect(within(card).getByDisplayValue("Сануулгатай")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Хадгалах" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    // Unchanged links are not replaced.
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("saves the criteria back when the teacher removes one", async () => {
    const api = render({
      body: {
        links: [
          { level: "IV", number: 3, status: "INDEPENDENT", note: null },
          { level: "IV", number: 12, status: "SUPPORTED", note: null },
        ],
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "А/79 · IV · Ш3 хасах" }));
    await userEvent.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({
      links: [{ level: "IV", number: 12, status: "SUPPORTED", note: null }],
    });
  });

  it("offers no criteria when they could not be read — a save never empties them", async () => {
    const api = render({ status: 404, body: { status: 404, title: "Олдсонгүй" } });

    await screen.findByRole("button", { name: "Хадгалах" });
    await waitFor(() => expect(api.calls.some((c) => c.url.endsWith("/a79-links"))).toBe(true));
    expect(screen.queryByRole("button", { name: "А/79 шалгуур нэмэх" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Хадгалах" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
  });
});
