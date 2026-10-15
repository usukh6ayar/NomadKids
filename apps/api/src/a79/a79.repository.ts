import { Injectable } from "@nestjs/common";
import type { A79Link, A79LevelKey } from "@kinder/contracts";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The bound on one child's evidence at one level. A level has at most 49
 * criteria and a teacher links a handful of notes to each in a year; the cap
 * is there so a record kept for years cannot become an unbounded answer
 * (CLAUDE.md §3.4), not because anyone expects to reach it.
 */
const MAX_EVIDENCE = 2000;

/**
 * А/79 links — an observation tied to criteria, and the result read back.
 *
 * ★ Every read carries `deletedAt: null` on the link **and** on its
 * observation: archiving a note takes its evidence out of the result with it.
 */
@Injectable()
export class A79Repository {
  constructor(private readonly prisma: PrismaService) {}

  /** The note the links belong to — what the authorization check needs. */
  findObservation(id: string) {
    return this.prisma.observation.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, childId: true, kindergartenId: true, authorId: true, source: true },
    });
  }

  /**
   * Replaces a note's links in one transaction: the live rows are
   * soft-deleted, the new set inserted (§3.2 — a link is never overwritten).
   * Returns the live set and how many rows it replaced.
   */
  replaceLinks(
    observation: { id: string; childId: string; kindergartenId: string },
    links: A79Link[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const replaced = await tx.observationA79Link.updateMany({
        where: { observationId: observation.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (links.length > 0) {
        await tx.observationA79Link.createMany({
          data: links.map((link) => ({
            kindergartenId: observation.kindergartenId,
            observationId: observation.id,
            childId: observation.childId,
            level: link.level,
            number: link.number,
            status: link.status,
            note: link.note || null,
          })),
        });
      }
      const live = await tx.observationA79Link.findMany({
        where: { observationId: observation.id, deletedAt: null },
        select: { level: true, number: true, status: true, note: true },
        orderBy: [{ level: "asc" }, { number: "asc" }],
      });
      return { live, replaced: replaced.count };
    });
  }

  /** One child's evidence at one level, newest note first. */
  evidenceForChild(childId: string, level: A79LevelKey) {
    return this.prisma.observationA79Link.findMany({
      where: { childId, level, deletedAt: null, observation: { deletedAt: null } },
      orderBy: [{ observation: { observedOn: "desc" } }, { createdAt: "desc" }],
      take: MAX_EVIDENCE,
      select: {
        number: true,
        status: true,
        note: true,
        observation: {
          select: {
            id: true,
            observedOn: true,
            situation: true,
            childDid: true,
            type: { select: { name: true } },
          },
        },
      },
    });
  }

  /** The group and the span of its school year — the summary's default range. */
  findGroupYear(groupId: string) {
    return this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null },
      select: { schoolYear: { select: { startsOn: true, endsOn: true } } },
    });
  }

  /**
   * The children enrolled in the group on any day of the span — the same
   * rule as the attendance sheet (`enrolledOn`, №19): started by `to`, not
   * ended before `from`, the end exclusive.
   */
  async rosterBetween(groupId: string, from: Date, to: Date) {
    const rows = await this.prisma.enrollment.findMany({
      where: {
        groupId,
        deletedAt: null,
        child: { deletedAt: null },
        startedOn: { lte: to },
        OR: [{ endedOn: null, status: "ACTIVE" }, { endedOn: { gt: from } }],
      },
      select: {
        child: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
      },
      orderBy: [{ child: { lastName: "asc" } }, { child: { firstName: "asc" } }],
    });
    const seen = new Set<string>();
    return rows
      .map((row) => row.child)
      .filter((child) => (seen.has(child.id) ? false : (seen.add(child.id), true)));
  }

  /** Every live link of these children on notes observed within the span. One query. */
  linksForChildren(childIds: string[], from: Date, to: Date) {
    if (childIds.length === 0) return Promise.resolve([]);
    return this.prisma.observationA79Link.findMany({
      where: {
        childId: { in: childIds },
        deletedAt: null,
        observation: { deletedAt: null, observedOn: { gte: from, lte: to } },
      },
      select: {
        childId: true,
        level: true,
        number: true,
        status: true,
        createdAt: true,
        observation: { select: { observedOn: true } },
      },
    });
  }
}
