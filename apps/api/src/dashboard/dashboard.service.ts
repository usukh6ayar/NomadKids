import { Injectable } from "@nestjs/common";
import { AuthzRepository } from "../authz/authz.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import { Role } from "../domain/enums";
import type { Actor } from "../authz/actor";
import { DashboardRepository } from "./dashboard.repository";
import { withActorLabel } from "./audit-actor";

/**
 * Dashboards.
 *
 * ★ A dashboard answers **"what needs my attention today"** — UI_UX_MAP.md §3.
 * It is not a wall of statistics, and the brief rules that out explicitly. So
 * the teacher screen returns three actionable lists and the counts that give
 * them context, and nothing else.
 *
 * The parent home is a feed of what happened, not a dashboard at all.
 */
/**
 * Midnight UTC for the given instant.
 *
 * ★ UTC, because `Attendance.date` is stored as a bare calendar day.
 *
 * The register writes a date with no time, so matching it against a local
 * midnight would miss by the timezone offset — in Ulaanbaatar (UTC+8) a local
 * midnight is 16:00 the previous day in UTC, and today's register would be
 * looked up under yesterday. `growth.service.ts` carries the same helper for
 * the same reason.
 */
function startOfDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0),
  );
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly authz: AuthzRepository,
    private readonly tenants: TenantAccessService,
  ) {}

  /**
   * "What needs attention today."
   *
   * Three lists, each an action: submissions to review, children not yet
   * assessed this term, and recent observations so the teacher can resume.
   */
  async teacher(actor: Actor) {
    const groupIds = await this.authz.loadActiveTeachingGroupIds(actor);
    const kindergartenIds = this.tenants.memberKindergartenIds(actor);
    const term = await this.repo.currentTerm(kindergartenIds, new Date());

    const today = new Date();

    const [
      pendingReviews,
      recentObservations,
      childCount,
      missingAssessment,
      birthdays,
      progress,
      observationTypes,
      observationCounts,
      birthdaysThisMonth,
      boardNotice,
    ] = await Promise.all([
      this.repo.pendingReviewCount(groupIds),
      this.repo.recentObservations(groupIds),
      this.repo.activeChildCount(groupIds),
      // No current term means no assessment gap to report — an honest empty
      // list rather than a query against a term that does not exist.
      term ? this.repo.childrenMissingAssessment(groupIds, term.id) : Promise.resolve([]),
      this.repo.birthdaysToday(groupIds, today),
      term ? this.repo.termAssessmentProgress(groupIds, term.id) : Promise.resolve({ assessed: 0 }),
      this.repo.listObservationTypes(kindergartenIds),
      // Scoped to the term, so the mix describes the period the rest of this
      // screen is about rather than all of history.
      term && term.startsOn && term.endsOn
        ? this.repo.observationCountsByType(groupIds, term.startsOn, term.endsOn)
        : Promise.resolve([]),
      this.repo.birthdaysThisMonth(groupIds, today),
      this.repo.latestBoardNotice(kindergartenIds),
    ]);

    return {
      currentTerm: term
        ? { id: term.id, number: term.number, name: term.name, schoolYear: term.schoolYear }
        : null,
      counts: { children: childCount, groups: groupIds.length, pendingReviews },
      /*
       * ★ Every configured type, including the ones nobody used.
       *
       * `groupBy` returns only types that have rows, so a type at zero would
       * simply be missing — and a bar chart that silently drops its empty
       * categories reads as "we do not do that here" rather than "none yet".
       */
      observationsByType: observationTypes.map((type) => ({
        type: { id: type.id, name: type.name },
        count: observationCounts.find((c) => c.typeId === type.id)?._count._all ?? 0,
      })),
      needsAttention: {
        pendingReviews,
        childrenMissingAssessment: missingAssessment.map((c) => ({
          id: c.id,
          lastName: c.lastName,
          firstName: c.firstName,
          photoMediaFileId: c.photoMediaFileId,
          group: c.enrollments[0]?.group ?? null,
        })),
      },
      /**
       * ★ This month's birthdays, alongside today's.
       *
       * Two lists rather than one filtered on the client: `birthdaysToday` is
       * what the alert block reacts to, and a card that only ever lights up on
       * the day itself is invisible for twenty-nine days a month. This one is
       * what a teacher plans against.
       */
      birthdaysThisMonth: birthdaysThisMonth.map((c) => ({
        id: c.id,
        lastName: c.lastName,
        firstName: c.firstName,
        dateOfBirth: c.dateOfBirth.toISOString(),
        photoMediaFileId: c.photoMediaFileId,
      })),
      /**
       * The class board's most recent notice, with its read count.
       *
       * Null when nothing has been published — the widget then renders nothing
       * rather than an empty frame, the same rule `ObservationMix` follows.
       */
      boardNotice: boardNotice
        ? {
            id: boardNotice.id,
            title: boardNotice.title,
            body: boardNotice.body,
            publishedAt: boardNotice.publishedAt?.toISOString() ?? null,
            isImportant: boardNotice.isImportant,
            readCount: boardNotice._count.reads,
          }
        : null,
      /** RFP §12.1 — "тухайн өдөр төрсөн өдөртэй хүүхэд". */
      birthdaysToday: birthdays.map((c) => ({
        id: c.id,
        lastName: c.lastName,
        firstName: c.firstName,
        dateOfBirth: c.dateOfBirth,
        photoMediaFileId: c.photoMediaFileId,
      })),
      /**
       * RFP §12.1 — "улирлын үнэлгээний явц".
       *
       * `total` is the roster, not the number of assessments: the question a
       * teacher is asking is "how many of my children have I got to", and a
       * percentage of domain-rows would answer a different one.
       */
      termProgress: { assessed: progress.assessed, total: childCount },
      recentObservations,
    };
  }

  async admin(actor: Actor) {
    const kindergartenIds = this.tenants.adminKindergartenIds(actor);
    const term = await this.repo.currentTerm(kindergartenIds, new Date());

    /*
     * ★ The attendance window is the last 30 days, not the term.
     *
     * A term runs four months, and a register summarised over that long stops
     * describing anything actionable — one bad fortnight in September is
     * invisible against December. Thirty days is short enough to move when
     * something changes and long enough that a single holiday does not swing
     * it. It is also independent of whether a term is configured, which the
     * coverage figures beside it are not.
     */
    const today = startOfDay(new Date());
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 29);

    const [
      counts,
      coverage,
      recentActivity,
      storage,
      attendanceToday,
      childrenAMonthAgo,
      attendanceByGroup,
      domains,
    ] = await Promise.all([
      this.repo.kindergartenCounts(kindergartenIds),
      term ? this.repo.assessmentCoverage(kindergartenIds, term.id) : Promise.resolve([]),
      this.repo.recentAuditEntries(kindergartenIds),
      // RFP §12.2 — "Хадгалалтын хэмжээ" and "Тайлангийн статистик".
      this.repo.storageAndReportStats(kindergartenIds),
      this.repo.attendanceToday(kindergartenIds, today),
      this.repo.childrenEnrolledOn(kindergartenIds, monthAgo),
      this.repo.attendanceByGroup(kindergartenIds, monthAgo, today),
      term ? this.repo.domainAveragesByGroup(kindergartenIds, term.id) : Promise.resolve([]),
    ]);

    return {
      currentTerm: term ? { id: term.id, number: term.number, name: term.name } : null,
      counts,
      assessmentCoverage: coverage,
      recentActivity: recentActivity.map(withActorLabel),
      storage,
      attendanceToday,
      /**
       * Children enrolled 30 days ago, so the card can show the change.
       *
       * Only this count has a trend, and `childrenEnrolledOn` explains why:
       * enrolment history makes it exact, while the other three would be a
       * guess dressed as a figure.
       */
      childrenAMonthAgo,
      attendanceByGroup,
      /** Empty without a current term — an assessment belongs to one. */
      domainAveragesByGroup: domains,
    };
  }

  /**
   * The parent home — "what happened recently".
   *
   * A single reverse-chronological feed, not a dashboard. The observation
   * filter is the family's, so a private teaching note cannot appear here.
   */
  async parent(actor: Actor) {
    const visible = await this.authz.visibleChildrenWhere(actor);
    const children = await this.repo.guardianChildren(visible);
    const childIds = children.map((c) => c.id);

    const kindergartenIds = this.tenants.memberKindergartenIds(actor);
    const term = await this.repo.currentTerm(kindergartenIds, new Date());

    const [recent, assessments] = await Promise.all([
      this.repo.recentForGuardian(childIds, actor.userId),
      term ? this.repo.publishedAssessments(childIds, term.id) : Promise.resolve([]),
    ]);

    // Grouped per child so the UI can render one card each without a second
    // pass over the list.
    const assessmentsByChild = new Map<string, typeof assessments>();
    for (const assessment of assessments) {
      const list = assessmentsByChild.get(assessment.childId) ?? [];
      list.push(assessment);
      assessmentsByChild.set(assessment.childId, list);
    }

    return {
      children: children.map((c) => ({
        id: c.id,
        lastName: c.lastName,
        firstName: c.firstName,
        dateOfBirth: c.dateOfBirth,
        photoMediaFileId: c.photoMediaFileId,
        group: c.enrollments[0]?.group ?? null,
        assessments: (assessmentsByChild.get(c.id) ?? []).map((a) => ({
          domain: a.domain,
          level: a.level,
        })),
      })),
      currentTerm: term ? { id: term.id, number: term.number, name: term.name } : null,
      recent,
    };
  }

  /**
   * Which dashboard this actor should be sent to.
   *
   * The UI needs this on login, and deciding it server-side means one rule
   * rather than one per client. A user with several roles gets the most
   * capable — an admin who is also a parent lands on the admin screen and can
   * navigate to their child.
   *
   * ★ The platform operator is checked first and does not fall through to
   * `actor.memberships` at all — a superadmin holds none by design (CLAUDE.md
   * §1.1), so without this branch they read exactly like a revoked user and
   * land on the no-access screen instead of the platform console.
   */
  primaryDashboard(
    actor: Actor,
  ): "platform" | "admin" | "teacher" | "cook" | "accountant" | "parent" | null {
    if (actor.isSuperAdmin) return "platform";

    const roles = new Set(actor.memberships.map((m) => m.role));
    if (roles.has(Role.ADMIN)) return "admin";
    if (roles.has(Role.TEACHER)) return "teacher";
    /*
      ★ Above PARENT, below TEACHER — 2026-08-30.

      Order is "most capable first", and these two sit where they do for a
      reason rather than by seniority. Below TEACHER because someone who both
      teaches and cooks should land on the teaching screen, which is the larger
      job. Above PARENT because the same person may also be a parent here, and
      landing an employee on their own child's page instead of their work is
      the wrong default at 8am.

      Without these lines they fall past every branch to `null`, which the
      login page reads as "no membership at all" and sends to `/no-access` — a
      revoked account's screen, shown to someone who was just hired.
    */
    if (roles.has(Role.COOK)) return "cook";
    if (roles.has(Role.ACCOUNTANT)) return "accountant";
    if (roles.has(Role.PARENT)) return "parent";
    return null;
  }
}
