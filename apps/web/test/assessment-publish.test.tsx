import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { ChildAssessments } from "@/components/child/child-assessments";

/**
 * Publishing a term's assessments to the family — RFP §2.3.
 *
 * ★ Why this file exists.
 *
 * `Assessment.visibleToParents` defaults to `false` and the guardian branch of
 * `listForChild` filters on it, so an assessment is invisible to the family
 * until someone calls `POST /children/:id/assessments/publish`. That endpoint
 * shipped with the assessment module and **nothing in the product ever called
 * it** — every assessment a teacher recorded was permanently invisible to every
 * parent, and no test anywhere noticed, because the API's own suite proves the
 * endpoint works and the web suite never asked whether anything reached it.
 *
 * So these assert the wiring rather than the endpoint: that the control exists,
 * that it sends the body the DTO requires, that it is staff-only, and that the
 * screen tells a teacher which state the term is in.
 */

const CHILD = "11111111-1111-4111-8111-111111111111";
const TERM = "22222222-2222-4222-8222-222222222222";

function assessment(n: number, visibleToParents: boolean) {
  return {
    id: `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`,
    comment: null,
    visibleToParents,
    domain: { id: `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`, name: `Домэйн ${n}` },
    level: {
      id: `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`,
      value: 3,
      label: "Хангалттай",
    },
    term: { id: TERM, number: 1, name: "I улирал" },
  };
}

/** The radar is a second query; unstubbed it 404s and the component hides it. */
function stubFor(rows: unknown[]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: `/children/${CHILD}/assessments/publish`,
      method: "POST",
      body: { updated: 2, visible: true },
    },
    { path: `/children/${CHILD}/assessments`, body: rows },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("нийтлэх үйлдэл", () => {
  it("tells a teacher the term is not published, and offers to publish it", async () => {
    stubFor([assessment(1, false), assessment(2, false)]);

    renderWithProviders(<ChildAssessments childId={CHILD} isStaff />);

    expect(await screen.findByText("Нийтлээгүй")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Эцэг эхэд нийтлэх" })).toBeInTheDocument();
  });

  /**
   * ★ The body is the contract. `publishTermSchema` is `.strict()` — an extra
   * key is a 400 — and `visible` is what flips the guardian's filter. Sending
   * the wrong term id would publish a different quarter silently.
   */
  it("posts the term and visible:true to the publish endpoint", async () => {
    const { calls } = stubFor([assessment(1, false), assessment(2, false)]);
    const user = userEvent.setup();

    renderWithProviders(<ChildAssessments childId={CHILD} isStaff />);
    await user.click(await screen.findByRole("button", { name: "Эцэг эхэд нийтлэх" }));

    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith("/assessments/publish"));
      expect(post).toBeDefined();
      expect(post!.method).toBe("POST");
      expect(post!.body).toEqual({ termId: TERM, visible: true });
    });
  });

  it("confirms in words that the family can now see it", async () => {
    stubFor([assessment(1, false), assessment(2, false)]);
    const user = userEvent.setup();

    renderWithProviders(<ChildAssessments childId={CHILD} isStaff />);
    await user.click(await screen.findByRole("button", { name: "Эцэг эхэд нийтлэх" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Эцэг эх одоо харна");
  });

  it("shows a published term as open to parents, and offers to reverse it", async () => {
    stubFor([assessment(1, true), assessment(2, true)]);

    renderWithProviders(<ChildAssessments childId={CHILD} isStaff />);

    expect(await screen.findByText("Эцэг эхэд нээлттэй")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Нийтлэлийг буцаах" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Эцэг эхэд нийтлэх" })).toBeNull();
  });

  /**
   * ★★ A term can hold rows saved before a publish and rows added after it.
   * Reporting that as "нийтэлсэн" would tell a teacher the family can see rows
   * they cannot.
   */
  it("reports a partly published term as partial, not as published", async () => {
    stubFor([assessment(1, true), assessment(2, false)]);

    renderWithProviders(<ChildAssessments childId={CHILD} isStaff />);

    expect(await screen.findByText("1/2 нийтэлсэн")).toBeInTheDocument();
    // Still offers to publish — the unpublished row is the one that matters.
    expect(screen.getByRole("button", { name: "Эцэг эхэд нийтлэх" })).toBeInTheDocument();
  });

  /**
   * ★★★ A guardian's list is already filtered to what was published, so a badge
   * would describe data they are looking at, and the control is not theirs —
   * `@Roles("TEACHER", "ADMIN")` would refuse it anyway.
   */
  it("shows a guardian no publish control at all", async () => {
    stubFor([assessment(1, true)]);

    renderWithProviders(<ChildAssessments childId={CHILD} isStaff={false} />);

    expect(await screen.findByText("Домэйн 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /нийтлэх/i })).toBeNull();
    expect(screen.queryByText("Эцэг эхэд нээлттэй")).toBeNull();
  });

  /**
   * ★ Held open on purpose.
   *
   * A stub that answers instantly leaves no in-flight window to observe, so the
   * obvious version of this test asserts nothing and passes whatever the button
   * does. This one keeps the publish request pending until the assertions are
   * made, which is the only way the disabled state is real.
   */
  it("disables the button while the request is in flight, so it cannot double-fire", async () => {
    const { fetchMock } = stubFor([assessment(1, false)]);
    const passthrough = fetchMock.getMockImplementation()!;

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/assessments/publish")) await held;
      return passthrough(input, init);
    });

    const user = userEvent.setup();
    renderWithProviders(<ChildAssessments childId={CHILD} isStaff />);
    await user.click(await screen.findByRole("button", { name: "Эцэг эхэд нийтлэх" }));

    const pending = await screen.findByRole("button", { name: "Нийтэлж байна…" });
    expect(pending).toBeDisabled();

    // A second click on a disabled button must not reach the network.
    await user.click(pending).catch(() => {});
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/publish"))).toHaveLength(1);

    release();
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  });

  it("surfaces a failure instead of claiming the family can see it", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD}/assessments/publish`,
        method: "POST",
        status: 500,
        body: { type: "about:blank", title: "Алдаа гарлаа", status: 500, requestId: "test" },
      },
      { path: `/children/${CHILD}/assessments`, body: [assessment(1, false)] },
    ]);
    const user = userEvent.setup();

    renderWithProviders(<ChildAssessments childId={CHILD} isStaff />);
    await user.click(await screen.findByRole("button", { name: "Эцэг эхэд нийтлэх" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
