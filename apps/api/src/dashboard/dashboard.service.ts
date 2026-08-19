import { Injectable } from "@nestjs/common";
import { AuthzRepository } from "../authz/authz.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import { Role } from "../domain/enums";
import type { Actor } from "../authz/actor";
import { DashboardRepository } from "./dashboard.repository";

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

    const [pendingReviews, recentObservations, childCount, missingAssessment] = await Promise.all([
      this.repo.pendingReviewCount(groupIds),
      this.repo.recentObservations(groupIds),
      this.repo.activeChildCount(groupIds),
      // No current term means no assessment gap to report — an honest empty
      // list rather than a query against a term that does not exist.
      term ? this.repo.childrenMissingAssessment(groupIds, term.id) : Promise.resolve([]),
    ]);

    return {
      currentTerm: term
        ? { id: term.id, number: term.number, name: term.name, schoolYear: term.schoolYear }
        : null,
      counts: { children: childCount, groups: groupIds.length, pendingReviews },
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
      recentObservations,
    };
  }

  async admin(actor: Actor) {
    const kindergartenIds = this.tenants.adminKindergartenIds(actor);
    const term = await this.repo.currentTerm(kindergartenIds, new Date());

    const [counts, coverage, recentActivity] = await Promise.all([
      this.repo.kindergartenCounts(kindergartenIds),
      term ? this.repo.assessmentCoverage(kindergartenIds, term.id) : Promise.resolve([]),
      this.repo.recentAuditEntries(kindergartenIds),
    ]);

    return {
      currentTerm: term ? { id: term.id, number: term.number, name: term.name } : null,
      counts,
      assessmentCoverage: coverage,
      recentActivity,
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
   */
  primaryDashboard(actor: Actor): "admin" | "teacher" | "parent" | null {
    const roles = new Set(actor.memberships.map((m) => m.role));
    if (roles.has(Role.ADMIN)) return "admin";
    if (roles.has(Role.TEACHER)) return "teacher";
    if (roles.has(Role.PARENT)) return "parent";
    return null;
  }
}
