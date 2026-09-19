import { describe, expect, it } from "vitest";
import { buildEsisCoverage } from "./esis-coverage";
import { ESIS_PORTAL_REQUESTS } from "./esis.requests";

const FROM = new Date("2026-09-01T00:00:00.000Z");
const TO = new Date("2026-09-30T23:59:59.000Z");

const empty = () => buildEsisCoverage({ from: FROM, to: TO, usage: [], syncRuns: [] });

describe("the 84/84 matrix", () => {
  it("carries one row per approved grant, and only approved ones", () => {
    const approved = ESIS_PORTAL_REQUESTS.filter((r) => r.status === "APPROVED");
    const matrix = empty();

    expect(matrix.rows).toHaveLength(approved.length);
    expect(matrix.totals.granted).toBe(approved.length);
    expect(new Set(matrix.rows.map((r) => r.apiId)).size).toBe(matrix.rows.length);
  });

  /*
   * ★★ **The assertion the whole report exists for.**
   *
   * The ministry granted 84 services and will ask two questions that pull
   * against each other: "did you use what we gave you?" and "did you call
   * anything without a reason?". A silent zero answers the first badly and the
   * second not at all. Every uncalled service must therefore be either wired to
   * a screen or carry a named reason — `UNDECIDED` is the state that means
   * somebody left a grant lying around, and it has to stay empty.
   *
   * ★ If this fails, the fix is a sentence in `ESIS_DISPOSITIONS` explaining
   * why the service is not called — not a line here excusing it.
   */
  it("leaves no grant without a reason", () => {
    const matrix = empty();
    const undecided = matrix.rows.filter((row) => row.state === "UNDECIDED");

    expect(undecided.map((row) => `${row.apiId} ${row.name}`)).toEqual([]);
    expect(matrix.totals.undecided).toBe(0);
  });

  it("gives every uncalled row either a wiring or a reason", () => {
    for (const row of empty().rows) {
      if (row.calls > 0) continue;
      expect({
        apiId: row.apiId,
        explained: row.serviceKey !== null || row.reason !== null,
      }).toEqual({ apiId: row.apiId, explained: true });
    }
  });

  /*
   * ★ A sync run's audit row names the run, not the thirteen services it swept.
   * Counting `AuditLog` alone would report the whole reference block as zero
   * calls — the largest part of the grant, reading as unused.
   */
  it("counts a sweep as a call to each resource it touched", () => {
    const matrix = buildEsisCoverage({
      from: FROM,
      to: TO,
      usage: [],
      syncRuns: [
        { resources: ["buildings", "rooms"], startedAt: new Date("2026-09-17T04:10:00.000Z") },
        { resources: ["buildings"], startedAt: new Date("2026-09-18T04:10:00.000Z") },
      ],
    });

    const buildings = matrix.rows.find((row) => row.serviceKey === "buildings");
    const rooms = matrix.rows.find((row) => row.serviceKey === "rooms");

    expect(buildings?.calls).toBe(2);
    expect(buildings?.state).toBe("IN_USE");
    expect(buildings?.lastCalledAt).toBe("2026-09-18T04:10:00.000Z");
    expect(rooms?.calls).toBe(1);
  });

  it("adds a screen's reads to the sweeps of the same service", () => {
    const matrix = buildEsisCoverage({
      from: FROM,
      to: TO,
      usage: [
        { objectId: "buildings", calls: 3, lastCalledAt: new Date("2026-09-20T09:00:00.000Z") },
      ],
      syncRuns: [{ resources: ["buildings"], startedAt: new Date("2026-09-17T04:10:00.000Z") }],
    });

    const buildings = matrix.rows.find((row) => row.serviceKey === "buildings");
    expect(buildings?.calls).toBe(4);
    // The later of the two, whichever kind of call it was.
    expect(buildings?.lastCalledAt).toBe("2026-09-20T09:00:00.000Z");
  });

  /*
   * ★ Attendance v1 and v2 read zero for a reason a reviewer has to see: v3 is
   * wired, and writing a day from three services would write it three ways.
   * `SUPERSEDED` is that reason, and it outranks "in use" — a superseded
   * service should not be called at all.
   */
  it("marks a superseded service as such, with its reason", () => {
    const row = empty().rows.find((r) => r.apiId === 105);
    expect(row?.state).toBe("SUPERSEDED");
    expect(row?.reason).toContain("171");
  });

  /*
   * ★★ A scheduled service and an on-demand one are the distinction a reviewer
   * looks for: `staff` read 31 times is a nightly sweep, not somebody walking
   * the roster. Every wired row must say which it is.
   */
  it("names a trigger for every wired service", () => {
    for (const row of empty().rows) {
      if (row.serviceKey === null) continue;
      expect({ key: row.serviceKey, hasTrigger: row.trigger.length > 0 }).toEqual({
        key: row.serviceKey,
        hasTrigger: true,
      });
    }
  });

  it("tells a scheduled sweep from a screen", () => {
    const rows = empty().rows;
    expect(rows.find((r) => r.serviceKey === "staff")?.trigger).toContain("03:40");
    expect(rows.find((r) => r.serviceKey === "groupCreate")?.trigger).toContain("батласны");
    expect(rows.find((r) => r.serviceKey === "studentInfo")?.trigger).toBe("Дэлгэц нээхэд");
  });

  it("reports the window it counted", () => {
    const matrix = empty();
    expect(matrix.from).toBe(FROM.toISOString());
    expect(matrix.to).toBe(TO.toISOString());
  });

  /*
   * ★ The totals are what a covering letter quotes, so they have to add up to
   * the row count rather than being counted twice or missed.
   */
  it("adds its own totals up to the number of rows", () => {
    const { totals, rows } = empty();
    const sum =
      totals.inUse +
      totals.wiredUnused +
      totals.dispositioned +
      totals.superseded +
      totals.undecided;
    expect(sum).toBe(rows.length);
  });
});
