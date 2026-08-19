import { describe, expect, it } from "vitest";
import { mayDownloadReport, reportAudience, type ReportJobParams } from "./report-params";

/**
 * The audience rules.
 *
 * A generated PDF is the one artefact in this system whose visibility filter is
 * applied once and then frozen into a file. These are the functions that stop
 * the frozen copy from reaching the wrong reader.
 */

const staff: ReportJobParams = { audience: "STAFF", audienceUserId: "teacher-1" };
const guardian: ReportJobParams = { audience: "GUARDIAN", audienceUserId: "parent-1" };

describe("reportAudience", () => {
  it("reads the viewer back off the job rather than re-deriving it", () => {
    expect(reportAudience(staff)).toEqual({ isGuardian: false, userId: "teacher-1" });
    expect(reportAudience(guardian)).toEqual({ isGuardian: true, userId: "parent-1" });
  });
});

describe("mayDownloadReport", () => {
  it("allows the person who requested it", () => {
    expect(mayDownloadReport({ requestedById: "teacher-1" }, "teacher-1")).toBe(true);
  });

  /**
   * ★ The leak this file exists for.
   *
   * A guardian passes `canAccessChild` for their own child. If that were the
   * only check, they would receive the teacher's copy — private teaching notes
   * and unpublished assessments included.
   */
  it("refuses a guardian the teacher's copy of their own child's report", () => {
    expect(mayDownloadReport({ requestedById: "teacher-1" }, "parent-1")).toBe(false);
  });

  it("refuses one guardian the other guardian's download", () => {
    expect(mayDownloadReport({ requestedById: "parent-1" }, "parent-2")).toBe(false);
  });

  it("refuses when the requester's account is gone", () => {
    // `requestedById` is `onDelete: SetNull`. A null must never match.
    expect(mayDownloadReport({ requestedById: null }, "parent-1")).toBe(false);
  });
});
