import type { Prisma } from "../../generated/prisma/client";

/**
 * Enrollments that held on at least one day of `from`..`to`: started by `to`,
 * and not ended before `from`. Of an archived child, none.
 *
 * `endedOn` is exclusive — the day a transfer is recorded is the new group's
 * (`ChildrenRepository.enrollChild` ends one row and starts the next the same
 * day), so the child is on one sheet that day, not two. A row that is not
 * ACTIVE yet carries no `endedOn` is an old ended row with its date lost; it
 * counts on no day rather than on every day.
 *
 * ★ Shared (2026-10-16): the attendance sheets and the А/79 group summary read
 * the same roster, and two copies of this rule would drift.
 */
export function enrolledOn(from: Date, to: Date): Prisma.EnrollmentWhereInput {
  return {
    deletedAt: null,
    child: { deletedAt: null },
    startedOn: { lte: to },
    OR: [{ endedOn: null, status: "ACTIVE" }, { endedOn: { gt: from } }],
  };
}
