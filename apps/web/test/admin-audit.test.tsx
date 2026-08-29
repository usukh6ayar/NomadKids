import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import AuditPage from "@/app/(app)/admin/audit/page";

/**
 * The audit log's filters.
 *
 * ★ This screen had no test file at all, and the gap showed.
 *
 * Two things it renders were wrong for as long as it existed and nothing
 * failed: `objectType` was printed raw, so a Mongolian screen read "Үзсэн ·
 * Child", and the actor was not rendered at all — leaving "who did this"
 * unanswerable on the one screen that exists to answer it. Both are now
 * covered here rather than only in the API suite, because both are decisions
 * this component makes.
 *
 * ★★ Filtering by person is driven from the rows.
 *
 * `actorUserId` has been an accepted query parameter since the endpoint was
 * written; the alternative UI — a select of every account — cannot be built
 * correctly, because `MAX_PAGE_SIZE` is 100 and a kindergarten has more
 * guardians than that. These pin the interaction that replaced it.
 */

const TEACHER_ID = "55555555-5555-4555-8555-555555555555";

function entry(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    action: "VIEW",
    objectType: "Child",
    objectId: null,
    childId: null,
    actorUserId: TEACHER_ID,
    actorLabel: "Дорж Болд",
    createdAt: new Date().toISOString(),
    metadata: null,
    ...over,
  };
}

function stubAudit(items: unknown[] = [entry()]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    {
      path: "/audit?",
      body: { items, page: 1, pageSize: 50, total: items.length, totalPages: 1 },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("үйлдлийн түүх", () => {
  it("translates the record type rather than printing the model name", async () => {
    stubAudit();
    renderWithProviders(<AuditPage />);

    expect(await screen.findByText("Хүүхэд")).toBeInTheDocument();
    expect(screen.queryByText("Child")).toBeNull();
  });

  it("names who performed the action", async () => {
    stubAudit();
    renderWithProviders(<AuditPage />);

    expect(await screen.findByRole("button", { name: /Дорж Болд/ })).toBeInTheDocument();
  });
});

describe("хүнээр шүүх", () => {
  it("asks the API for that person's entries", async () => {
    const { calls } = stubAudit();
    const u = userEvent.setup();
    renderWithProviders(<AuditPage />);

    await u.click(await screen.findByRole("button", { name: /Дорж Болд/ }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes(`actorUserId=${TEACHER_ID}`))).toBe(true),
    );
  });

  it("says who the list is narrowed to", async () => {
    stubAudit();
    const u = userEvent.setup();
    renderWithProviders(<AuditPage />);

    await u.click(await screen.findByRole("button", { name: /Дорж Болд/ }));

    expect(await screen.findByText(/Хэн: Дорж Болд/)).toBeInTheDocument();
  });

  it("clears back to the whole log", async () => {
    const { calls } = stubAudit();
    const u = userEvent.setup();
    renderWithProviders(<AuditPage />);

    await u.click(await screen.findByRole("button", { name: /Дорж Болд/ }));
    await screen.findByText(/Хэн: Дорж Болд/);

    calls.length = 0;
    await u.click(screen.getByRole("button", { name: "Дорж Болд — шүүлтийг арилгах" }));

    await waitFor(() => {
      const listed = calls.filter((c) => c.url.includes("/audit?"));
      expect(listed.length).toBeGreaterThan(0);
      expect(listed.every((c) => !c.url.includes("actorUserId"))).toBe(true);
    });
  });

  /**
   * ★ An entry whose actor was hard-deleted keeps its stored label and loses
   * its id. Offering a filter that would narrow to nothing is the promise the
   * sidebar's own rule forbids, so the name stays plain text.
   */
  it("leaves a nameless-id entry unclickable", async () => {
    stubAudit([entry({ actorUserId: null, actorLabel: "Гарсан ажилтан" })]);
    renderWithProviders(<AuditPage />);

    expect(await screen.findByText("Гарсан ажилтан")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Гарсан ажилтан/ })).toBeNull();
  });

  it("renders an em dash when there was no actor at all", async () => {
    stubAudit([entry({ actorUserId: null, actorLabel: null })]);
    renderWithProviders(<AuditPage />);

    expect(await screen.findByText("—")).toBeInTheDocument();
  });
});
