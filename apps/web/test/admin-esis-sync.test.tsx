import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import AdminEsisSyncPage from "@/app/(app)/admin/esis-sync/page";

/**
 * The director's manual ESIS pull, moved here from `/platform/[id]/esis` on
 * 2026-09-17 — see that page's and this one's doc comments for the
 * authorization mismatch that moved it: the buttons call `POST
 * /kindergartens/:id/esis/sync`, tenant-`ADMIN`-scoped
 * (`KindergartenEsisController`), which a platform operator's `isSuperAdmin`
 * flag does not satisfy. `sessionFor(["ADMIN"])` holds a real membership at
 * `KG`, so — unlike `esis-fields.test.tsx`'s `operator()` — every stub below
 * is what this actor can actually reach; there is no 404-mismatch case to
 * cover here the way there was on the platform screen.
 *
 * ★ No `/platform/kindergartens/:id/esis` stub anywhere in this file: this
 * page never calls the platform overview route, so there is nothing to stub
 * beyond session, `sync-runs` and `sync`.
 */
const KG = "33333333-3333-4333-8333-333333333333";
const SYNC_RUNS_PATH = `/kindergartens/${KG}/esis/sync-runs`;
const SYNC_ACTION_PATH = `/kindergartens/${KG}/esis/sync`;

function run(
  overrides: Partial<{
    id: string;
    status: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
    resources: string[];
    summary: unknown;
    errorCode: string | null;
    startedAt: string;
    finishedAt: string | null;
    initiatedBy: string | null;
  }> = {},
) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "SUCCEEDED" as const,
    resources: [],
    summary: null,
    errorCode: null,
    startedAt: "2026-09-17T03:10:00.000Z",
    finishedAt: "2026-09-17T03:10:05.000Z",
    initiatedBy: null,
    ...overrides,
  };
}

function runsPage(
  items: ReturnType<typeof run>[],
  overrides: Partial<{ page: number; totalPages: number; total: number }> = {},
) {
  return {
    items,
    page: overrides.page ?? 1,
    pageSize: 10,
    total: overrides.total ?? items.length,
    totalPages: overrides.totalPages ?? 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("ESIS синкийн самбар", () => {
  /*
   * ★ The known gap this task exists to close (originally `929fd0b`'s
   * `esis-fields.test.tsx`, moved here with the panel): `run.initiatedBy ??
   * "хуваарь"` was typechecked and unexercised. `EsisSyncRun.initiatedById`
   * is nullable and the scheduler passes `null` for exactly this case — a
   * run nobody at a keyboard started.
   */
  it("shows a scheduled run as having no initiator", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: SYNC_RUNS_PATH,
        method: "GET",
        body: runsPage([
          run({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            resources: ["staff", "teachers", "studentMovements"],
            summary: {
              kind: "ROSTER",
              roster: { stored: 13, skipped: 0 },
              movements: { beginDate: "2026-09-10", count: 2, errorCode: null },
            },
            initiatedBy: null,
          }),
        ]),
      },
    ]);
    renderWithProviders(<AdminEsisSyncPage />);

    expect(await screen.findByText("хуваарь")).toBeInTheDocument();
  });

  /*
   * ★ The per-tier cards read `sync-runs` page 1 — the only history feed
   * this page has, unlike the platform screen's `recentRuns`. Proves both
   * halves at once: the REFERENCE card finds its own run among a mixed list
   * that also has a ROSTER run, and reads the stored/skipped counts out of
   * `runReferenceSync`'s summary shape.
   */
  it("shows what each tier last did", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: SYNC_RUNS_PATH,
        method: "GET",
        body: runsPage([
          run({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            resources: ["foodProducts", "buildings"],
            startedAt: "2026-09-17T04:10:00.000Z",
            initiatedBy: "Бат Дорж",
            summary: {
              kind: "REFERENCE",
              resources: [
                {
                  resource: "foodProducts",
                  status: "SUCCEEDED",
                  stored: 1000,
                  skipped: 0,
                  errorCode: null,
                },
                {
                  resource: "buildings",
                  status: "SUCCEEDED",
                  stored: 3,
                  skipped: 1,
                  errorCode: null,
                },
              ],
            },
          }),
          run({
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            resources: ["staff", "teachers", "studentMovements"],
            startedAt: "2026-09-17T03:40:00.000Z",
            initiatedBy: null,
            summary: {
              kind: "ROSTER",
              roster: { stored: 13, skipped: 0 },
              movements: { beginDate: "2026-09-10", count: 2, errorCode: null },
            },
          }),
        ]),
      },
    ]);
    renderWithProviders(<AdminEsisSyncPage />);

    expect(await screen.findByText(/1003 мөр хадгалав/)).toBeInTheDocument();
    expect(screen.getByText(/13 бүртгэгдэв/)).toBeInTheDocument();
  });

  it("pulls the reference tier through the Татах button", async () => {
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: SYNC_RUNS_PATH, method: "GET", body: runsPage([]) },
      {
        path: SYNC_ACTION_PATH,
        method: "POST",
        body: {
          runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          status: "SUCCEEDED",
          results: [
            {
              resource: "foodProducts",
              status: "SUCCEEDED",
              stored: 1000,
              skipped: 0,
              errorCode: null,
            },
          ],
        },
      },
    ]);
    renderWithProviders(<AdminEsisSyncPage />);

    await userEvent.click((await screen.findAllByRole("button", { name: /Татах/ }))[0]!);

    expect(await screen.findByText(/Лавлах мэдээллийг татлаа/)).toBeInTheDocument();
    const posted = calls.find(
      (call) => call.url.startsWith(SYNC_ACTION_PATH) && call.method === "POST",
    );
    expect(posted?.body).toEqual({ tier: "REFERENCE" });
  });

  it("asks for the next page of sync history", async () => {
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: SYNC_RUNS_PATH,
        method: "GET",
        body: runsPage([run({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })], {
          total: 12,
          totalPages: 2,
        }),
      },
    ]);
    renderWithProviders(<AdminEsisSyncPage />);

    await screen.findByRole("navigation", { name: "Хуудаслалт" });
    await userEvent.click(screen.getByRole("button", { name: "Дараах" }));

    await waitFor(() =>
      expect(
        calls.some((call) => call.url.startsWith(SYNC_RUNS_PATH) && call.url.includes("page=2")),
      ).toBe(true),
    );
  });
});
