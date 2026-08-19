/**
 * Who may file, read and edit which observation.
 *
 * Pure predicates, no database — same split as `authz/child-access.ts`, and for
 * the same reason: these rules are subtle enough to deserve exhaustive tests
 * that need no fixtures.
 *
 * Every rule here was verified against the reference implementation rather than
 * inferred. Several are counter-intuitive.
 */

import type { ObservationSource, ReviewStatus } from "../domain/enums";

export interface ObservationFacts {
  readonly authorId: string | null;
  readonly source: ObservationSource;
  readonly reviewStatus: ReviewStatus;
}

/**
 * May this actor file an observation of this kind?
 *
 * ★ The two sources have **different** access requirements:
 *
 * - `PARENT` needs only read access, so a guardian can submit — that is the
 *   whole §5.4 feature.
 * - `TEACHER` needs record access, so a guardian cannot file one. Letting them
 *   would put words in a teacher's mouth in the record the family later
 *   receives as a PDF.
 */
export function canCreateObservation(
  source: ObservationSource,
  access: { canAccess: boolean; canRecord: boolean },
): boolean {
  return source === "PARENT" ? access.canAccess : access.canRecord;
}

/**
 * The default visibility for a new observation.
 *
 * A parent's own submission is visible to them immediately; a teacher's note is
 * private until deliberately shared. Getting this backwards would publish every
 * private teaching note in the system.
 */
export function defaultVisibleToParents(source: ObservationSource): boolean {
  return source === "PARENT";
}

/**
 * The review state a new observation starts in.
 *
 * A teacher's own observation is APPROVED on save — there is nobody above them
 * to approve it. A parent's submission waits.
 */
export function initialReviewStatus(source: ObservationSource): ReviewStatus {
  return source === "PARENT" ? "PENDING" : "APPROVED";
}

/**
 * May a guardian edit this observation?
 *
 * Three conditions, all required: it is a parent submission, they wrote it, and
 * a teacher has not yet approved it. Once approved it is part of the record the
 * teacher has signed off on, and the message tells the parent to speak to the
 * teacher rather than leaving them guessing.
 */
export function guardianMayEdit(
  facts: ObservationFacts,
  actorUserId: string,
): { allowed: boolean; reason?: string } {
  if (facts.source !== "PARENT") return { allowed: false };
  if (facts.authorId !== actorUserId) return { allowed: false };
  if (facts.reviewStatus === "APPROVED") {
    return {
      allowed: false,
      reason: "Багш баталсан ажиглалтыг засах боломжгүй. Багштайгаа холбогдоно уу.",
    };
  }
  return { allowed: true };
}
