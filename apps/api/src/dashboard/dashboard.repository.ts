import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { VisibleChildrenFilter } from "../authz/authz.repository";
import type { AuditAction } from "../domain/enums";
import { AUDIT_ACTOR_SELECT } from "./audit-actor";

/**
 * Dashboard reads.
 *
 * ★ Every query here is bounded — `take` on every list, `count` rather than
 * fetching to measure. A dashboard is the first screen of every session, so an
 * unbounded query here is felt on every login rather than occasionally.
 */
@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Teacher ───────────────────────────────────────────────────────────────

  /** Parent submissions awaiting this teacher — the only true queue. */
  async pendingReviewCount(groupIds: string[]): Promise<number> {
    if (groupIds.length === 0) return 0;
    return this.prisma.observation.count({
      where: {
        deletedAt: null,
        source: "PARENT",
        reviewStatus: "PENDING",
        enrollment: { groupId: { in: groupIds }, deletedAt: null },
      },
    });
  }

  /**
   * Children in this teacher's groups with no assessment in the current term.
   *
   * The gap, not the coverage: a dashboard answers "what needs attention", and
   * a list of children already assessed needs no action.
   */
  async childrenMissingAssessment(groupIds: string[], termId: string, take = 10) {
    if (groupIds.length === 0) return [];
    return this.prisma.child.findMany({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        enrollments: { some: { groupId: { in: groupIds }, status: "ACTIVE", deletedAt: null } },
        assessments: { none: { termId, deletedAt: null } },
      },
      select: {
        id: true,
        lastName: true,
        firstName: true,
        photoMediaFileId: true,
        enrollments: {
          where: { status: "ACTIVE", deletedAt: null },
          select: { group: { select: { id: true, name: true } } },
          take: 1,
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take,
    });
  }

  /** Recent observations, so a teacher can resume where they left off. */
  async recentObservations(groupIds: string[], take = 5) {
    if (groupIds.length === 0) return [];
    return this.prisma.observation.findMany({
      where: {
        deletedAt: null,
        enrollment: { groupId: { in: groupIds }, deletedAt: null },
      },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        observedOn: true,
        situation: true,
        source: true,
        visibleToParents: true,
        child: { select: { id: true, lastName: true, firstName: true } },
        type: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Children in these groups whose birthday is today — RFP §12.1.
   *
   * ★ Matched on month and day in SQL, not in JavaScript.
   *
   * Loading the roster and filtering it in the service works at 35 children and
   * quietly becomes a transfer of every child's record at 3,000. Prisma has no
   * month/day helper, so the match is a raw query — scoped to this teacher's
   * own groups inside the SQL, never widened to the kindergarten and then
   * narrowed afterwards.
   *
   * A child born on 29 February simply has no birthday in a common year, which
   * is the same answer a person would give.
   */
  async birthdaysToday(groupIds: string[], on: Date) {
    if (groupIds.length === 0) return [];

    return this.prisma.$queryRaw<
      {
        id: string;
        lastName: string;
        firstName: string;
        dateOfBirth: Date;
        photoMediaFileId: string | null;
      }[]
    >`
      SELECT DISTINCT c.id, c."lastName", c."firstName", c."dateOfBirth", c."photoMediaFileId"
      FROM children c
      JOIN enrollments e ON e."childId" = c.id
      WHERE c."deletedAt" IS NULL
        AND c.status = 'ACTIVE'
        AND e."deletedAt" IS NULL
        AND e.status = 'ACTIVE'
        AND e."groupId" = ANY(${groupIds}::uuid[])
        AND EXTRACT(MONTH FROM c."dateOfBirth") = ${on.getMonth() + 1}
        AND EXTRACT(DAY FROM c."dateOfBirth") = ${on.getDate()}
      ORDER BY c."lastName", c."firstName"
      LIMIT 10
    `;
  }

  /**
   * Whose birthday falls anywhere in the current month — RFP §12.1's list, at
   * the granularity a teacher plans around.
   *
   * ★ Month only, so the day is the sort key rather than a filter. `birthdaysToday`
   * answers "who do we sing to this morning"; this answers "what is coming", and
   * a teacher ordering a cake needs the second one. Both exist because a card
   * that only ever lights up on the day itself is invisible for 29 days a month.
   *
   * Raw SQL for the same reason `birthdaysToday` uses it: Prisma cannot express
   * `EXTRACT(MONTH FROM …)` in a `where`. The group filter is the authorization
   * scope and is parameterised — never interpolated.
   */
  async birthdaysThisMonth(groupIds: string[], on: Date) {
    if (groupIds.length === 0) return [];

    /*
     * ★ The day is selected, not only ordered by.
     *
     * Under `SELECT DISTINCT` Postgres requires every `ORDER BY` expression to
     * appear in the select list (42P10) — it cannot order rows by something it
     * did not project. Ordering by `dateOfBirth` instead would be wrong rather
     * than merely different: children in one group span three birth years, so a
     * full-date sort groups them by age and scatters the days.
     */
    return this.prisma.$queryRaw<
      {
        id: string;
        lastName: string;
        firstName: string;
        dateOfBirth: Date;
        photoMediaFileId: string | null;
        birthDay: number;
      }[]
    >`
      SELECT DISTINCT
        c.id, c."lastName", c."firstName", c."dateOfBirth", c."photoMediaFileId",
        EXTRACT(DAY FROM c."dateOfBirth")::int AS "birthDay"
      FROM children c
      JOIN enrollments e ON e."childId" = c.id
      WHERE c."deletedAt" IS NULL
        AND c.status = 'ACTIVE'
        AND e."deletedAt" IS NULL
        AND e.status = 'ACTIVE'
        AND e."groupId" = ANY(${groupIds}::uuid[])
        AND EXTRACT(MONTH FROM c."dateOfBirth") = ${on.getMonth() + 1}
      ORDER BY "birthDay", c."lastName"
      LIMIT 20
    `;
  }

  /**
   * The most recent published notice, with how many people have opened it.
   *
   * ★ A count, never the list of who read it.
   *
   * `notifications.repository.ts` already draws this line for reactions — "never
   * the list of who liked it. A parent should not learn which other families are
   * reading the board" — and the same reasoning governs reads. The teacher who
   * wrote the notice has a legitimate interest in whether it landed; nobody has
   * one in which named family opened it.
   *
   * Worth being straight about the edge: when the count reaches the number of
   * recipients, "everyone" is by definition every individual. That is inherent
   * to publishing a delivery statistic at all, it is identical to the reaction
   * count already shipped, and it is the author's own announcement.
   */
  async latestBoardNotice(kindergartenIds: string[]) {
    if (kindergartenIds.length === 0) return null;

    return this.prisma.notification.findFirst({
      where: { deletedAt: null, status: "PUBLISHED", kindergartenId: { in: kindergartenIds } },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        body: true,
        publishedAt: true,
        isImportant: true,
        _count: { select: { reads: true } },
      },
    });
  }

  /**
   * How far this term's assessment has got — RFP §12.1 "улирлын үнэлгээний явц".
   *
   * Two counts, not a per-child list: the roster size and how many of them have
   * at least one assessment this term. The list of who is missing is already
   * returned separately by `childrenMissingAssessment`, and returning both
   * shapes of the same fact would let them disagree.
   */
  async termAssessmentProgress(groupIds: string[], termId: string) {
    if (groupIds.length === 0) return { assessed: 0 };

    const assessed = await this.prisma.child.count({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        enrollments: { some: { groupId: { in: groupIds }, status: "ACTIVE", deletedAt: null } },
        assessments: { some: { termId, deletedAt: null } },
      },
    });

    return { assessed };
  }

  /**
   * How many of the roster have been assessed in each development domain.
   *
   * ★ A count of *children*, not of assessment rows — and the distinction is
   * the same one `termProgress` makes for the term as a whole.
   *
   * A child may hold several rows in one domain across a term. Counting rows
   * would let one thoroughly-assessed child make a domain look covered while
   * eighteen others have nothing, which is precisely the question this chart
   * exists to answer. Deduplicated by child id, per domain.
   *
   * One query for every domain at once — §3.4. The alternative, a count per
   * domain, is nine round trips to draw one chart.
   */
  async assessmentByDomain(groupIds: string[], kindergartenIds: string[], termId: string) {
    if (groupIds.length === 0 || kindergartenIds.length === 0) return [];

    const [domains, rows] = await Promise.all([
      /*
        ★ `own OR system`, not `kindergartenId IN (...)`.

        `kindergartenId = NULL` marks a **system default** shared by every
        kindergarten, and `CatalogRepository.readWhere` documents the asymmetry
        at length: reads must include those rows because a teacher's screen
        renders "Хэл яриа" from one; writes must exclude them.

        The first version of this query used `IN` alone and returned an empty
        array on real data — all five configured domains in this system are
        system defaults, so the chart drew nothing while the ring beside it
        correctly read 5 of 5 assessed.
      */
      this.prisma.developmentDomain.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          OR: [{ kindergartenId: { in: kindergartenIds } }, { kindergartenId: null }],
        },
        select: { id: true, name: true },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      }),
      this.prisma.assessment.findMany({
        where: {
          termId,
          deletedAt: null,
          enrollment: { groupId: { in: groupIds }, status: "ACTIVE", deletedAt: null },
        },
        select: { domainId: true, childId: true },
      }),
    ]);

    const childrenPerDomain = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = childrenPerDomain.get(row.domainId) ?? new Set<string>();
      set.add(row.childId);
      childrenPerDomain.set(row.domainId, set);
    }

    /*
      Every configured domain, including the ones with nothing in them — a
      domain that vanishes from the chart because no one has been assessed in
      it hides exactly the gap a teacher is looking for. `ObservationMix` makes
      the same argument about empty categories.
    */
    return domains.map((domain) => ({
      domain: { id: domain.id, name: domain.name },
      assessed: childrenPerDomain.get(domain.id)?.size ?? 0,
    }));
  }

  /**
   * Observations written per month, oldest first — the note-taking rhythm.
   *
   * ★ Grouped in TypeScript rather than by SQL `date_trunc`.
   *
   * Prisma's `groupBy` cannot group a `DateTime` by month, and the alternative
   * is `$queryRaw` — which no other method in this file uses and which nothing
   * would typecheck. The row count here is one term's observations for one
   * teacher's groups, a few hundred at most, so the grouping is cheaper than
   * the machinery to avoid it.
   *
   * Bounded by `since`, never the whole history — §3.4.
   */
  async observationsByMonth(groupIds: string[], since: Date) {
    if (groupIds.length === 0) return [];

    const rows = await this.prisma.observation.findMany({
      where: {
        deletedAt: null,
        observedOn: { gte: since },
        child: {
          enrollments: { some: { groupId: { in: groupIds }, status: "ACTIVE", deletedAt: null } },
        },
      },
      select: { observedOn: true },
    });

    const counts = new Map<string, number>();
    for (const row of rows) {
      const month = row.observedOn.toISOString().slice(0, 7);
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  /**
   * How this term's observations are distributed across the configured types.
   *
   * ★ Counts, and deliberately not a completion percentage.
   *
   * The wireframe asked for "биелэлт" — a fulfilment rate — and there is no
   * target anywhere in the schema to divide by. A percentage would need a
   * denominator somebody invented, which is the shape of number that makes a
   * dashboard lie. What exists is how many of each kind were written, so that
   * is what this returns; the UI shows each type's share of the total, which is
   * a fact rather than a score.
   *
   * ★★ Driven by `ObservationType`, which is a table an administrator edits
   * (CLAUDE.md §2.3), so this reports whatever a kindergarten has configured
   * rather than three names hard-coded from a drawing. Types with no
   * observations are absent here and filled in by the service, so a
   * newly-configured type reads as "0" rather than vanishing.
   *
   * One `groupBy`, not one query per type.
   */
  async observationCountsByType(groupIds: string[], from: Date, to: Date) {
    if (groupIds.length === 0) return [];

    return this.prisma.observation.groupBy({
      by: ["typeId"],
      where: {
        deletedAt: null,
        observedOn: { gte: from, lte: to },
        child: { enrollments: { some: { groupId: { in: groupIds }, deletedAt: null } } },
      },
      _count: { _all: true },
    });
  }

  /** The kindergarten's observation types, in configured order. */
  async listObservationTypes(kindergartenIds: string[]) {
    return this.prisma.observationType.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ kindergartenId: null }, { kindergartenId: { in: kindergartenIds } }],
      },
      select: { id: true, name: true, order: true },
      orderBy: { order: "asc" },
    });
  }

  async activeChildCount(groupIds: string[]): Promise<number> {
    if (groupIds.length === 0) return 0;
    return this.prisma.child.count({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        enrollments: { some: { groupId: { in: groupIds }, status: "ACTIVE", deletedAt: null } },
      },
    });
  }

  /** The current term, so the dashboard knows what "this term" means. */
  async currentTerm(kindergartenIds: string[], on: Date) {
    if (kindergartenIds.length === 0) return null;
    return this.prisma.term.findFirst({
      where: {
        kindergartenId: { in: kindergartenIds },
        deletedAt: null,
        startsOn: { lte: on },
        endsOn: { gte: on },
      },
      orderBy: { startsOn: "desc" },
      include: { schoolYear: { select: { id: true, name: true } } },
    });
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  /**
   * Stored bytes and report activity — RFP §12.2's "Хадгалалтын хэмжээ" and
   * "Тайлангийн статистик".
   *
   * ★ `sizeBytes` is summed from `MediaFile`, which is what this system knows.
   *
   * It is the size of the rows it has, not the size of the bucket: an object
   * orphaned by a crash between `put` and `create` is invisible here, and so is
   * anything another system put in R2. Reporting it as "storage used" would be
   * a number that quietly disagrees with the invoice, so the UI labels it as
   * the size of stored files.
   *
   * Soft-deleted rows are excluded. They still occupy bytes until the retention
   * sweep runs, and counting them would make the figure jump around as
   * deletions land — but a director reading "how much are we storing" means the
   * live album, and the sweep's backlog is not their question.
   */
  async storageAndReportStats(kindergartenIds: string[]) {
    if (kindergartenIds.length === 0) {
      return { totalBytes: 0, fileCount: 0, reports: { total: 0, done: 0, failed: 0 } };
    }

    const where = { kindergartenId: { in: kindergartenIds }, deletedAt: null };

    const [media, reportsByStatus] = await Promise.all([
      this.prisma.mediaFile.aggregate({
        where,
        _sum: { sizeBytes: true },
        _count: { _all: true },
      }),
      this.prisma.reportJob.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
    ]);

    const byStatus = new Map(reportsByStatus.map((r) => [r.status, r._count._all]));

    return {
      totalBytes: media._sum.sizeBytes ?? 0,
      fileCount: media._count._all,
      reports: {
        total: reportsByStatus.reduce((sum, r) => sum + r._count._all, 0),
        done: byStatus.get("DONE") ?? 0,
        failed: byStatus.get("FAILED") ?? 0,
      },
    };
  }

  async kindergartenCounts(kindergartenIds: string[]) {
    if (kindergartenIds.length === 0) {
      return { children: 0, groups: 0, staff: 0, guardians: 0 };
    }

    const [children, groups, staff, guardians] = await Promise.all([
      this.prisma.child.count({
        where: { kindergartenId: { in: kindergartenIds }, deletedAt: null, status: "ACTIVE" },
      }),
      this.prisma.group.count({
        where: { kindergartenId: { in: kindergartenIds }, deletedAt: null, status: "ACTIVE" },
      }),
      this.prisma.membership.count({
        where: {
          kindergartenId: { in: kindergartenIds },
          deletedAt: null,
          isActive: true,
          role: { in: ["TEACHER", "ADMIN"] },
        },
      }),
      this.prisma.membership.count({
        where: {
          kindergartenId: { in: kindergartenIds },
          deletedAt: null,
          isActive: true,
          role: "PARENT",
        },
      }),
    ]);

    return { children, groups, staff, guardians };
  }

  /** Assessment coverage for the current term, per group. */
  async assessmentCoverage(kindergartenIds: string[], termId: string) {
    if (kindergartenIds.length === 0) return [];

    const groups = await this.prisma.group.findMany({
      where: { kindergartenId: { in: kindergartenIds }, deletedAt: null, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        _count: { select: { enrollments: { where: { status: "ACTIVE", deletedAt: null } } } },
      },
      orderBy: { name: "asc" },
      take: 20,
    });

    if (groups.length === 0) return [];

    // One grouped query for every group, rather than one per group.
    const assessed = await this.prisma.assessment.groupBy({
      by: ["enrollmentId"],
      where: {
        termId,
        deletedAt: null,
        enrollment: { groupId: { in: groups.map((g) => g.id) }, status: "ACTIVE", deletedAt: null },
      },
    });

    const enrollments = await this.prisma.enrollment.findMany({
      where: { id: { in: assessed.map((a) => a.enrollmentId) } },
      select: { id: true, groupId: true },
    });

    const perGroup = new Map<string, number>();
    for (const e of enrollments) {
      perGroup.set(e.groupId, (perGroup.get(e.groupId) ?? 0) + 1);
    }

    return groups.map((g) => ({
      groupId: g.id,
      name: g.name,
      children: g._count.enrollments,
      assessed: perGroup.get(g.id) ?? 0,
    }));
  }

  async recentAuditEntries(kindergartenIds: string[], take = 10) {
    if (kindergartenIds.length === 0) return [];
    return this.prisma.auditLog.findMany({
      where: { kindergartenId: { in: kindergartenIds } },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        action: true,
        actorLabel: true,
        objectType: true,
        createdAt: true,
        actor: AUDIT_ACTOR_SELECT,
      },
    });
  }

  // ── Parent ────────────────────────────────────────────────────────────────

  /**
   * The parent home feed.
   *
   * Only observations the family may see — the same filter the observations
   * module uses, restated here because a dashboard that builds its own is
   * exactly how a private note reaches a family.
   */
  async recentForGuardian(childIds: string[], guardianUserId: string, take = 10) {
    if (childIds.length === 0) return [];
    return this.prisma.observation.findMany({
      where: {
        childId: { in: childIds },
        deletedAt: null,
        OR: [
          { visibleToParents: true, reviewStatus: "APPROVED" },
          { source: "PARENT", authorId: guardianUserId },
        ],
      },
      orderBy: { observedOn: "desc" },
      take,
      select: {
        id: true,
        observedOn: true,
        situation: true,
        source: true,
        reviewStatus: true,
        child: { select: { id: true, lastName: true, firstName: true } },
        type: { select: { id: true, name: true } },
      },
    });
  }

  /** Published assessments for a child in the current term. */
  async publishedAssessments(childIds: string[], termId: string) {
    if (childIds.length === 0) return [];
    return this.prisma.assessment.findMany({
      where: { childId: { in: childIds }, termId, visibleToParents: true, deletedAt: null },
      select: {
        childId: true,
        domain: { select: { id: true, name: true, color: true } },
        level: { select: { id: true, value: true, label: true, color: true } },
      },
      orderBy: { domain: { order: "asc" } },
    });
  }

  /** Children a guardian may see, for the home screen. */
  async guardianChildren(visible: VisibleChildrenFilter) {
    return this.prisma.child.findMany({
      where: visible,
      select: {
        id: true,
        lastName: true,
        firstName: true,
        dateOfBirth: true,
        photoMediaFileId: true,
        enrollments: {
          where: { status: "ACTIVE", deletedAt: null },
          select: { group: { select: { id: true, name: true } } },
          take: 1,
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 20,
    });
  }

  // ── Kindergarten-wide, for the administrator's dashboard ──────────────────

  /**
   * How many children were enrolled on a given past date.
   *
   * ★ Exact, because `Enrollment` records when each one started and ended.
   *
   * A child was here on a date if their enrolment had begun by then and had not
   * yet ended — which is a fact the table holds, not an estimate. That is why
   * this comparison exists for children and for nothing else on the dashboard:
   * `Group` and `Membership` carry a `createdAt` but no end date in the same
   * shape, so "how many groups existed a month ago" would count a group
   * archived last week and quietly report a number nobody could reproduce.
   *
   * A statistic that cannot be checked is worse on a dashboard than an absent
   * one, so the other three cards carry no trend rather than a plausible guess.
   */
  async childrenEnrolledOn(kindergartenIds: string[], date: Date): Promise<number> {
    if (kindergartenIds.length === 0) return 0;

    const rows = await this.prisma.enrollment.findMany({
      where: {
        kindergartenId: { in: kindergartenIds },
        deletedAt: null,
        startedOn: { lte: date },
        OR: [{ endedOn: null }, { endedOn: { gt: date } }],
      },
      // One row per child: a child who moved between groups has two enrolments
      // and is still one child.
      select: { childId: true },
      distinct: ["childId"],
    });

    return rows.length;
  }

  /**
   * Today's register across every group — "Өнөөдрийн ирц", RFP §12.2.
   *
   * ★ Two numbers, and the denominator is the roster rather than the rows.
   *
   * `recorded / expected`, where `expected` counts active enrolments and
   * `recorded` counts the rows written for the day. A register that has not
   * been taken has no rows at all, so a ratio computed from rows alone would
   * read 0/0 — "nothing to do" — on precisely the morning somebody needs to be
   * reminded. The roster is what makes an untaken register visible.
   *
   * ★★ `PRESENT` and `HALF_DAY` both count as attending.
   *
   * A half day is a child who came. Collapsing it into "absent" would report a
   * kindergarten as emptier than it was, and the funding module cares about the
   * distinction separately — this figure is the head count, not a claim.
   */
  async attendanceToday(kindergartenIds: string[], date: Date) {
    if (kindergartenIds.length === 0) {
      return { expected: 0, recorded: 0, present: 0 };
    }

    const [expected, byStatus] = await Promise.all([
      this.prisma.enrollment.count({
        where: {
          status: "ACTIVE",
          deletedAt: null,
          group: { kindergartenId: { in: kindergartenIds }, deletedAt: null, status: "ACTIVE" },
        },
      }),
      this.prisma.attendance.groupBy({
        by: ["status"],
        where: {
          date,
          deletedAt: null,
          enrollment: {
            status: "ACTIVE",
            deletedAt: null,
            group: { kindergartenId: { in: kindergartenIds }, deletedAt: null, status: "ACTIVE" },
          },
        },
        _count: { _all: true },
      }),
    ]);

    let recorded = 0;
    let present = 0;
    for (const row of byStatus) {
      recorded += row._count._all;
      if (row.status === "PRESENT" || row.status === "HALF_DAY") present += row._count._all;
    }

    return { expected, recorded, present };
  }

  /**
   * Attendance per group over a date range — the sketch's "Ирцийн нэгтгэл".
   *
   * ★ Every live status, never a single percentage.
   *
   * `AttendanceStatus` has six members and they are not interchangeable:
   * `SICK` and `EXCUSED` are accounted for, `ABSENT` is not, and the funding
   * rules treat them differently again. Returning one "attendance rate" would
   * bake a policy decision — which statuses count — into a dashboard query,
   * where nobody would find it. The caller decides what to draw.
   *
   * ★★ Bounded at 20 groups, like `assessmentCoverage` beside it. A dashboard
   * is the first screen of a session; an unbounded query here is felt on every
   * login (§3.4).
   */
  async attendanceByGroup(kindergartenIds: string[], from: Date, to: Date) {
    if (kindergartenIds.length === 0) return [];

    const groups = await this.prisma.group.findMany({
      where: { kindergartenId: { in: kindergartenIds }, deletedAt: null, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 20,
    });
    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g.id);

    /*
     * One grouped query for every group and status, rather than one per group.
     * `enrollmentId` is carried so the rows can be attributed back — Prisma's
     * `groupBy` cannot group by a relation's column, so the mapping is done in
     * memory over a set bounded by the same 20 groups.
     */
    const rows = await this.prisma.attendance.groupBy({
      by: ["enrollmentId", "status"],
      where: {
        deletedAt: null,
        date: { gte: from, lte: to },
        enrollment: { groupId: { in: groupIds }, deletedAt: null },
      },
      _count: { _all: true },
    });

    const enrollments = await this.prisma.enrollment.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.enrollmentId))] } },
      select: { id: true, groupId: true },
    });
    const groupOf = new Map(enrollments.map((e) => [e.id, e.groupId]));

    const perGroup = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const groupId = groupOf.get(row.enrollmentId);
      if (!groupId) continue;
      const acc = perGroup.get(groupId) ?? {};
      acc[row.status] = (acc[row.status] ?? 0) + row._count._all;
      perGroup.set(groupId, acc);
    }

    return groups.map((g) => ({
      groupId: g.id,
      name: g.name,
      counts: perGroup.get(g.id) ?? {},
    }));
  }

  /**
   * Every group's mean level per development domain, for the term — the
   * sketch's "Бүлгүүдийн явцын үнэлгээ" radar.
   *
   * ★ The same computation `AssessmentService.groupAverages` already performs
   * for one group, done once for all of them.
   *
   * That method exists and is correct; calling it in a loop would be one query
   * per group on the first screen of every administrator's session, which is
   * the N+1 §3.4 forbids. The arithmetic is deliberately identical — mean of
   * `AssessmentLevel.value`, rounded to one decimal, because "the underlying
   * scale is 1–4 with four steps and a mean printed to three places claims a
   * precision the instrument does not have".
   *
   * ★★ A domain nobody assessed is absent from the map rather than zero. Zero
   * is a real score on a 1–4 scale's floor; "not assessed" is not a score.
   */
  async domainAveragesByGroup(kindergartenIds: string[], termId: string) {
    if (kindergartenIds.length === 0) return [];

    const groups = await this.prisma.group.findMany({
      where: { kindergartenId: { in: kindergartenIds }, deletedAt: null, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 20,
    });
    if (groups.length === 0) return [];

    const rows = await this.prisma.assessment.findMany({
      where: {
        termId,
        deletedAt: null,
        enrollment: {
          groupId: { in: groups.map((g) => g.id) },
          status: "ACTIVE",
          deletedAt: null,
        },
      },
      select: {
        domainId: true,
        enrollment: { select: { groupId: true } },
        level: { select: { value: true } },
      },
    });

    const totals = new Map<string, { sum: number; n: number }>();
    for (const row of rows) {
      const value = row.level?.value;
      if (value === undefined || value === null) continue;
      const key = `${row.enrollment.groupId}:${row.domainId}`;
      const acc = totals.get(key) ?? { sum: 0, n: 0 };
      acc.sum += value;
      acc.n += 1;
      totals.set(key, acc);
    }

    return groups.map((g) => {
      const averageByDomain: Record<string, number> = {};
      let sampleSize = 0;
      for (const [key, { sum, n }] of totals) {
        const [groupId, domainId] = key.split(":");
        if (groupId !== g.id) continue;
        averageByDomain[domainId!] = Math.round((sum / n) * 10) / 10;
        sampleSize += n;
      }
      return { groupId: g.id, name: g.name, sampleSize, averageByDomain };
    });
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  async listAudit(
    kindergartenIds: string[],
    filters: {
      childId?: string;
      actorUserId?: string;
      action?: AuditAction;
      from?: Date;
      to?: Date;
    },
    page: { skip: number; take: number },
  ) {
    const where = {
      kindergartenId: { in: kindergartenIds },
      ...(filters.childId ? { childId: filters.childId } : {}),
      ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        // Resolves "who did this" in the same round trip — see `audit-actor.ts`
        // for why the name is read from the relation rather than stored.
        include: { actor: AUDIT_ACTOR_SELECT },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total };
  }
}
