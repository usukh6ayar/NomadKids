import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { ConsentKind } from "../domain/enums";

/**
 * Consent records — RFP §16.
 *
 * ★ Append-only in practice: a decision is superseded by a newer row, never
 * updated. "We had permission on the day we published" is the question this
 * table exists to answer, and an UPDATE that flipped a boolean would destroy
 * exactly that.
 */
@Injectable()
export class ConsentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every decision for one child, newest first — the history. */
  async listForChild(childId: string) {
    return this.prisma.consentRecord.findMany({
      where: { childId, deletedAt: null },
      orderBy: { decidedAt: "desc" },
      include: { decidedBy: { select: { id: true, lastName: true, firstName: true } } },
    });
  }

  async create(data: {
    childId: string;
    kindergartenId: string;
    kind: ConsentKind;
    granted: boolean;
    decidedById: string;
    note: string | null;
  }) {
    return this.prisma.consentRecord.create({
      data,
      include: { decidedBy: { select: { id: true, lastName: true, firstName: true } } },
    });
  }

  /**
   * The current answer for one child and kind — the latest row.
   *
   * ★ Absent means **not granted**, and callers must treat it that way.
   *
   * A family that has never been asked has not agreed. Defaulting the other way
   * would publish a child's photograph on the strength of a missing row, which
   * is the failure §16 exists to prevent.
   */
  async currentDecision(childId: string, kind: ConsentKind) {
    return this.prisma.consentRecord.findFirst({
      where: { childId, kind, deletedAt: null },
      orderBy: { decidedAt: "desc" },
      select: { granted: true, decidedAt: true },
    });
  }

  /**
   * Children in a kindergarten whose photographs may **not** be published.
   *
   * One query for the whole roster rather than one per child: the caller is a
   * screen listing many children, and an N+1 over consent is the shape
   * CLAUDE.md §3.4 forbids.
   */
  async childrenWithoutPhotoConsent(kindergartenId: string) {
    const rows = await this.prisma.consentRecord.findMany({
      where: { kindergartenId, kind: "PHOTO_PUBLISHING", deletedAt: null },
      orderBy: { decidedAt: "desc" },
      select: { childId: true, granted: true },
    });

    // The first row per child is the latest, because the query is ordered.
    const latest = new Map<string, boolean>();
    for (const row of rows) {
      if (!latest.has(row.childId)) latest.set(row.childId, row.granted);
    }

    return [...latest.entries()].filter(([, granted]) => !granted).map(([childId]) => childId);
  }
}
