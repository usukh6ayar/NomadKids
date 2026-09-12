import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The teacher's report — every figure on it, over any range.
 *
 * ★ One repository rather than borrowing four, and one endpoint rather than
 * four requests.
 *
 * The screen shows a month, a term or a year and offers the same thing as a
 * file. A report whose numbers are composed on the client and whose file is
 * built on the server is two answers to one question, and they drift the first
 * time either side changes a filter. This is the single place the report's
 * arithmetic happens.
 *
 * ★★ Aggregates only — `groupBy` and `count`, never a list (§3.4). The one
 * unbounded-looking read is `distinct` on a child id, which is a set size and
 * is bounded by the roster.
 */
@Injectable()
export class GroupReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The group, with the tenant and school year the rest of the report needs. */
  async findGroup(groupId: string, kindergartenIds: string[]) {
    return this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null, kindergartenId: { in: kindergartenIds } },
      select: { id: true, name: true, kindergartenId: true, schoolYearId: true },
    });
  }

  /** Currently enrolled — the denominator every "n / total" on the report uses. */
  async rosterSize(groupId: string): Promise<number> {
    return this.prisma.enrollment.count({
      where: { groupId, status: "ACTIVE", deletedAt: null },
    });
  }

  /**
   * Attendance over the range: the whole-period split, and a percentage per day.
   *
   * ★ The same shape the register's own month panel is built from, so a figure
   * here cannot disagree with the one a teacher sees on the register.
   */
  async attendance(groupId: string, from: Date, to: Date) {
    const where = {
      deletedAt: null,
      date: { gte: from, lte: to },
      enrollment: { groupId, deletedAt: null },
    };

    const [byStatus, byDate] = await Promise.all([
      this.prisma.attendance.groupBy({ by: ["status"], where, _count: { _all: true } }),
      this.prisma.attendance.groupBy({
        by: ["date", "status"],
        where,
        _count: { _all: true },
        orderBy: { date: "asc" },
      }),
    ]);

    return { byStatus, byDate };
  }

  /**
   * Which terms the range touches.
   *
   * ★ An assessment is keyed to a *term*, not a date, so "how many children
   * were assessed in September" has no direct answer. The honest one is "in the
   * terms September falls inside", which is what a teacher means.
   */
  async termsInRange(kindergartenId: string, from: Date, to: Date) {
    return this.prisma.term.findMany({
      where: { kindergartenId, deletedAt: null, startsOn: { lte: to }, endsOn: { gte: from } },
      select: { id: true, name: true, number: true },
      orderBy: { number: "asc" },
    });
  }

  /**
   * Assessment coverage: how many of the group's children have one, and how
   * many assessments fell in each development domain.
   */
  async assessments(groupId: string, termIds: string[]) {
    if (termIds.length === 0) return { assessedChildIds: [], byDomain: [] };

    const where = {
      deletedAt: null,
      termId: { in: termIds },
      child: { enrollments: { some: { groupId, status: "ACTIVE" as const, deletedAt: null } } },
    };

    const [assessed, byDomain] = await Promise.all([
      this.prisma.assessment.findMany({
        where,
        select: { childId: true },
        distinct: ["childId"],
      }),
      this.prisma.assessment.groupBy({ by: ["domainId"], where, _count: { _all: true } }),
    ]);

    return { assessedChildIds: assessed.map((row) => row.childId), byDomain };
  }

  /**
   * Notes over the range, split by kind — Ажиглалт, Ярилцлага, Бүтээл — and by
   * how many different children were written about.
   */
  async observations(groupId: string, from: Date, to: Date) {
    const where = {
      deletedAt: null,
      enrollment: { groupId },
      observedOn: { gte: from, lte: to },
    };

    const [byType, total, children] = await Promise.all([
      this.prisma.observation.groupBy({ by: ["typeId"], where, _count: { _all: true } }),
      this.prisma.observation.count({ where }),
      this.prisma.observation.findMany({ where, select: { childId: true }, distinct: ["childId"] }),
    ]);

    return { byType, total, childCount: children.length };
  }

  /** Every note type the kindergarten uses, so a kind with none still appears. */
  async listTypes(kindergartenId: string) {
    return this.prisma.observationType.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ kindergartenId }, { kindergartenId: null }],
      },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true },
    });
  }

  async listDomains(kindergartenId: string) {
    return this.prisma.developmentDomain.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ kindergartenId }, { kindergartenId: null }],
      },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    });
  }

  /**
   * The surveys this group was asked, and how many families answered.
   *
   * ★ Published in the range, not created: a draft written in August and sent
   * in October belongs to October, which is when anyone was asked to answer it.
   *
   * ★★ A kindergarten-wide survey counts for the group too — its families were
   * asked. `groupId: null` is what "everybody" is stored as.
   */
  async surveys(kindergartenId: string, groupId: string, from: Date, to: Date) {
    const where = {
      kindergartenId,
      deletedAt: null,
      publishedAt: { gte: from, lte: to },
      OR: [{ groupId }, { groupId: null }],
    };

    const [byKind, ids] = await Promise.all([
      this.prisma.survey.groupBy({ by: ["kind"], where, _count: { _all: true } }),
      this.prisma.survey.findMany({ where, select: { id: true } }),
    ]);

    const surveyIds = ids.map((row) => row.id);
    if (surveyIds.length === 0) return { byKind, responded: 0, surveyCount: 0 };

    /*
      Distinct families, not rows: one parent answering three surveys is one
      family that took part, which is the figure "22 / 28 оролцсон" means.
    */
    const responders = await this.prisma.surveyResponse.findMany({
      where: { surveyId: { in: surveyIds }, deletedAt: null },
      select: { childId: true },
      distinct: ["childId"],
    });

    return { byKind, responded: responders.length, surveyCount: surveyIds.length };
  }
}
