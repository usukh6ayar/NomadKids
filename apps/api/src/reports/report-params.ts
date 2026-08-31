/**
 * What a report job was generated *for*.
 *
 * ★ This is the file that stops a generated PDF from leaking across audiences,
 * and it exists because a report is the one place where the visibility filter
 * is applied **once, at generation time**, and then baked into a file that
 * outlives the request.
 *
 * The failure it prevents:
 *
 *   1. A teacher generates a portfolio. It contains private teaching notes and
 *      unpublished assessments — correctly, because they may see them.
 *   2. The output is stored as a `MediaFile` hanging off the job.
 *   3. A guardian later opens the download route for that job id. They pass
 *      `canAccessChild` — it is their own child. They receive the teacher's
 *      copy.
 *
 * Every other read path in the system re-derives visibility on each request, so
 * this class of bug cannot arise there. Here it can, so the audience is
 * recorded on the job and enforced at download.
 */

export type ReportAudience = "STAFF" | "GUARDIAN";

export interface ReportJobParams {
  /** Whose visibility rules the content was filtered by. */
  audience: ReportAudience;
  /** The user the report was generated for. */
  audienceUserId: string;
  /** Required for `TERM_REPORT`, absent for `CHILD_PORTFOLIO`. */
  termId?: string;
  /** Required for `ANNUAL_REPORT` — RFP §6.5. */
  schoolYearId?: string;

  /**
   * `нэмэлт.md` §16 — which report, over what period.
   *
   * ★ Only set for `FINANCE_REPORT`, which carries no `childId`. The pair is
   * enough to rebuild the report at render time; the *rows* are deliberately
   * not stored on the job. A queued PDF that carried its own copy of the data
   * would print figures from the moment the button was pressed, and an
   * attendance correction landing in the thirty seconds before the worker ran
   * would leave the PDF and the screen disagreeing with no way to tell which
   * was right.
   */
  financeReport?: string;
  financePeriod?: string;
}

/**
 * The viewer the content was filtered for.
 *
 * Read back from the job rather than re-derived from the caller: the file was
 * already built, and re-deriving would silently describe it wrongly.
 */
export function reportAudience(params: ReportJobParams): {
  isGuardian: boolean;
  userId: string;
} {
  return {
    isGuardian: params.audience === "GUARDIAN",
    userId: params.audienceUserId,
  };
}

/**
 * Whether this actor may download this job's output.
 *
 * ★ Requester-only, plus a live child-access check by the caller.
 *
 * Not "can you access this child" alone — that is exactly the leak described
 * above. Not audience-matching alone either: two guardians of the same child
 * see identical content, but a report is still a personal artefact and there is
 * no requirement that one parent can fetch the other's download.
 *
 * The live access check is separate and still necessary: a teacher who has left
 * the group must not be able to download a portfolio they generated last term.
 * Both conditions, every time.
 */
export function mayDownloadReport(
  job: { requestedById: string | null },
  actorUserId: string,
): boolean {
  return job.requestedById !== null && job.requestedById === actorUserId;
}
