import { describe, expect, it } from "vitest";
import { selectEsisSyncTargets, type EsisSchedulableKindergarten } from "./esis-sync.scheduler";

/*
 * ★ The scheduler needs Redis and a Nest module to exercise, so it is not what
 * gets a unit test — `MaintenanceScheduler` (the file this one copies) has
 * none either. `selectEsisSyncTargets` is the part of the scheduler that has
 * an actual decision in it: which kindergartens a nightly or monthly sweep
 * runs against. That decision is worth pinning down without Postgres or
 * Redis, so it is pulled out as a pure function and tested here.
 */
describe("selectEsisSyncTargets", () => {
  it("does not select a kindergarten with no esisInstitutionId", () => {
    const rows: EsisSchedulableKindergarten[] = [
      { id: "unmapped", esisInstitutionId: null, deletedAt: null },
      { id: "mapped", esisInstitutionId: "42778", deletedAt: null },
    ];

    expect(selectEsisSyncTargets(rows)).toEqual([{ id: "mapped" }]);
  });

  it("does not select a soft-deleted kindergarten, even if it is mapped", () => {
    const rows: EsisSchedulableKindergarten[] = [
      { id: "left", esisInstitutionId: "42778", deletedAt: new Date("2026-01-01") },
      { id: "current", esisInstitutionId: "55555", deletedAt: null },
    ];

    expect(selectEsisSyncTargets(rows)).toEqual([{ id: "current" }]);
  });

  /*
   * ★ "Stable" here means: the result does not depend on the order rows came
   * back in, and the function takes no actor at all — there isn't one to give
   * it. A scheduled sweep runs unattended; a selection that quietly needed
   * something request-scoped would only fail once, in production, at 03:40.
   */
  it("is stable regardless of input order, and takes no actor", () => {
    const rows: EsisSchedulableKindergarten[] = [
      { id: "c", esisInstitutionId: "3", deletedAt: null },
      { id: "a", esisInstitutionId: "1", deletedAt: null },
      { id: "b", esisInstitutionId: "2", deletedAt: null },
    ];
    const reversed = [...rows].reverse();

    const expected = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(selectEsisSyncTargets(rows)).toEqual(expected);
    expect(selectEsisSyncTargets(reversed)).toEqual(expected);
  });

  it("returns nothing when no kindergarten qualifies", () => {
    const rows: EsisSchedulableKindergarten[] = [
      { id: "unmapped", esisInstitutionId: null, deletedAt: null },
      { id: "left", esisInstitutionId: "1", deletedAt: new Date() },
    ];

    expect(selectEsisSyncTargets(rows)).toEqual([]);
  });
});
