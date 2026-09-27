import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import type { AdminDashboard } from "@kinder/contracts";
import { qk } from "@/lib/api/keys";
import { EsisConnectionSummary } from "@/components/esis/esis-connection-summary";

/**
 * ЭСИС холболт — the summary at the head of `/admin/esis-sync`.
 *
 * ★ The case worth having here is not the layout, it is **the cache key**.
 * `GET /kindergartens/:id` is parsed by three different schemas on three
 * screens and `get()` strips what a schema does not name, so a shared key let
 * whichever query ran first decide what the others saw. The profile form's
 * parse drops `esisInstitutionId`; this card needs it. Nothing had broken yet
 * only because the two screens are rarely opened in one session.
 */

const KG = "33333333-3333-4333-8333-333333333333";

/**
 * `/dashboard/admin`, shaped as `adminDashboardSchema` actually requires it.
 *
 * ★ Worth spelling out: `get()` parses every response, and a payload short of
 * a required field throws — after which the card renders "—" rather than
 * erroring. So a fixture that is *nearly* right produces a screen that looks
 * like a broken connection. `counts.guardians` and `currentTerm` are the two
 * that are easy to miss; the staff directory's old fixture missed both and its
 * count tile had been quietly reading "—" for it.
 */
const overview: AdminDashboard = {
  currentTerm: null,
  counts: { children: 93, groups: 4, staff: 12, guardians: 70 },
  childrenAMonthAgo: 90,
  attendanceToday: { expected: 93, recorded: 93, present: 88 },
  attendanceByGroup: [],
  domainAveragesByGroup: [],
  assessmentCoverage: [],
  recentActivity: [],
};

const catalog = { mode: "LIVE" as const, canRead: true, endpoints: [] };

function stubScreen({ canRead = true, institutionId = "42778" } = {}) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: `/kindergartens/${KG}/esis/catalog`, body: { ...catalog, canRead } },
    { path: "/dashboard/admin", body: overview },
    // Must come last: the two routes above are prefixed by this one.
    { path: `/kindergartens/${KG}`, body: { id: KG, esisInstitutionId: institutionId } },
  ]);
}

beforeEach(() => vi.clearAllMocks());

describe("ЭСИС холболт", () => {
  it("reports the connection, the institution number and what came across", async () => {
    stubScreen();
    renderWithProviders(<EsisConnectionSummary kindergartenId={KG} />);

    expect(await screen.findByText("Холбогдсон")).toBeInTheDocument();
    expect(await screen.findByText("42778")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("93")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("says what to do for a kindergarten with no ESIS number", async () => {
    stubScreen({ canRead: false, institutionId: null as unknown as string });
    renderWithProviders(<EsisConnectionSummary kindergartenId={KG} />);

    expect(await screen.findByText("Холбогдоогүй")).toBeInTheDocument();
    expect(screen.getByText(/Платформын оператор байгууллагын кодыг холбоно/)).toBeInTheDocument();
  });

  /*
   * ★ **The key carries the shape.** If this card read
   * `qk.adminKindergarten(id)` — the profile form's key, whose schema has no
   * `esisInstitutionId` — a cached profile fetch would satisfy it and the
   * number would render as "—" on a kindergarten that has one.
   *
   * Asserted on the keys rather than by simulating the navigation, because
   * that is the actual invariant: two parses of one URL must not share a key.
   */
  it("does not share the profile form's cache key", () => {
    expect(qk.adminKindergartenInstitution(KG)).not.toEqual(qk.adminKindergarten(KG));
  });

  /*
   * ★★ …but it stays a *prefix* match, so the logo upload's
   * `invalidateKeys={[qk.adminKindergarten(id)]}` still clears both. They are
   * one database row; a change to it should refresh every read of it.
   */
  it("is still invalidated by the kindergarten prefix", () => {
    const prefix = qk.adminKindergarten(KG);
    const own = qk.adminKindergartenInstitution(KG);
    expect(own.slice(0, prefix.length)).toEqual([...prefix]);
  });
});
