import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { AuthzRepository } from "../authz/authz.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import { canRecordForChild, isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { paginate, type PageParams } from "../common/pagination";
import { ObservationsRepository } from "./observations.repository";
import {
  canCreateObservation,
  defaultVisibleToParents,
  guardianMayEdit,
  initialReviewStatus,
} from "./observation-rules";
import type {
  CreateObservationDto,
  CreateParentObservationDto,
  ListObservationsQuery,
  ReviewObservationDto,
  UpdateObservationDto,
} from "./observations.dto";

@Injectable()
export class ObservationsService {
  constructor(
    private readonly repo: ObservationsRepository,
    private readonly childAccess: ChildAccessService,
    private readonly authz: AuthzRepository,
    private readonly audit: AuditRepository,
    private readonly tenants: TenantAccessService,
  ) {}

  /**
   * A group's note-keeping, summarised — the client's 2026-08-31 dashboard.
   *
   * ★ Authorised exactly as the assessment register is, and for the same
   * reason.
   *
   * Kindergarten membership is not enough: a teacher may only look at a group
   * they are assigned to, so this repeats `getGroupColumn`'s two-step check —
   * the group must be in a kindergarten this actor belongs to, and then, unless
   * they administer it, in their own assignment list. 404 for both, never 403
   * (§1.7): a teacher probing group ids learns nothing about which exist.
   *
   * ★★ The numbers are counts of notes, never the notes themselves. Nothing
   * here can leak a private observation's text, which is why this endpoint does
   * not need the visibility filter the reading endpoints carry.
   */
  async groupStats(actor: Actor, groupId: string, from: Date, to: Date) {
    const group = await this.repo.findGroupForStats(
      groupId,
      this.tenants.memberKindergartenIds(actor),
    );
    if (!group) throw new NotFoundException();

    if (!this.tenants.isAdmin(actor, group.kindergartenId)) {
      const assigned = await this.authz.loadActiveTeachingGroupIds(actor);
      if (!assigned.includes(groupId)) throw new NotFoundException();
    }

    const [stats, byMonth, types, domains] = await Promise.all([
      this.repo.groupObservationStats(groupId, from, to),
      this.repo.observationsByMonth(groupId, from, to),
      this.repo.listTypes(group.kindergartenId),
      this.repo.listDomainsForStats(group.kindergartenId),
    ]);

    /*
      The catalogue rows are joined here rather than in each `groupBy`: Prisma
      cannot include a relation on an aggregate, and two small lookups beat one
      query per bucket. Every configured type and domain appears even with a
      count of zero — "Ярилцлага 0" is the finding, and a row missing from the
      list looks like a row that was never configured.
    */
    const typeCount = new Map(stats.byType.map((row) => [row.typeId, row._count._all]));
    const domainCount = new Map(stats.byDomain.map((row) => [row.domainId, row._count._all]));

    return {
      total: stats.total,
      enrolled: stats.enrolled,
      childrenWithNotes: stats.childrenWithNotes,
      byChild: stats.byChild.map((row) => ({ childId: row.childId, count: row._count._all })),
      byChildType: stats.byChildType.map((row) => ({
        childId: row.childId,
        typeId: row.typeId,
        count: row._count._all,
      })),
      byType: types.map((type) => ({
        id: type.id,
        name: type.name,
        count: typeCount.get(type.id) ?? 0,
      })),
      byDomain: domains.map((domain) => ({
        id: domain.id,
        name: domain.name,
        count: domainCount.get(domain.id) ?? 0,
      })),
      byActivity: stats.byActivity
        .filter((row) => row.activityName)
        .map((row) => ({ name: row.activityName as string, count: row._count._all })),
      byMonth,
    };
  }

  async listTypes(actor: Actor, childId: string) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);
    return this.repo.listTypes(facts.childKindergartenId);
  }

  /**
   * Observations about one child.
   *
   * The visibility filter lives in the repository and is shared with the detail
   * endpoint — a list and a detail that build their own filters is how a
   * private teaching note reaches a family.
   */
  async list(actor: Actor, childId: string, query: ListObservationsQuery) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);
    const viewer = { isGuardian: isGuardianOf(actor, facts), userId: actor.userId };
    const page: PageParams = { page: query.page, pageSize: query.pageSize };

    const { items, total } = await this.repo.list(
      childId,
      viewer,
      {
        typeId: query.typeId,
        source: query.source,
        reviewStatus: query.reviewStatus,
        domainId: query.domainId,
        q: query.q,
        from: query.from,
        to: query.to,
      },
      page,
    );

    return paginate(items, total, page);
  }

  async get(actor: Actor, childId: string, observationId: string) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);
    const viewer = { isGuardian: isGuardianOf(actor, facts), userId: actor.userId };

    const observation = await this.repo.findReadable(observationId, childId, viewer);
    // 404 rather than 403: a guardian must not learn that a private teaching
    // note about their child exists.
    if (!observation) throw new NotFoundException();

    return observation;
  }

  /**
   * A teacher files an observation.
   *
   * Requires **record** access, so a guardian cannot use this route — they have
   * their own. Letting them would put words in a teacher's mouth in the record
   * the family later receives as a PDF.
   */
  async createTeacherObservation(actor: Actor, childId: string, dto: CreateObservationDto) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);

    if (
      !canCreateObservation("TEACHER", {
        canAccess: true,
        canRecord: canRecordForChild(actor, facts),
      })
    ) {
      throw new NotFoundException();
    }

    const enrollment = await this.resolveEnrollment(childId);
    const type = await this.repo.findType(dto.typeId, enrollment.kindergartenId);
    if (!type) throw new BadRequestException("Ажиглалтын төрөл олдсонгүй");
    // ★ Refuse new, permit existing. An administrator who retires a type
    // (`isActive: false`, via DELETE /observation-types/:id) stops it being
    // chosen from here on; observations already filed against it keep rendering,
    // because the read paths join the row without filtering on `isActive`.
    // Enforced here rather than in `findType`, which is also the lookup a read
    // uses — filtering there would make old observations unreadable.
    if (!type.isActive) throw new BadRequestException("Энэ ажиглалтын төрөл идэвхгүй болсон байна");

    const domainIds = dto.domainIds ?? [];
    await this.assertDomainsValid(domainIds, enrollment.kindergartenId);

    const observation = await this.repo.create(
      {
        kindergartenId: enrollment.kindergartenId,
        childId,
        enrollmentId: enrollment.id,
        typeId: dto.typeId,
        authorId: actor.userId,
        source: "TEACHER",
        observedOn: dto.observedOn,
        visibleToParents: dto.visibleToParents ?? defaultVisibleToParents("TEACHER"),
        includeInReport: dto.includeInReport ?? true,
        reviewStatus: initialReviewStatus("TEACHER"),
        activityName: dto.activityName ?? null,
        situation: dto.situation ?? null,
        childDid: dto.childDid ?? null,
        childSaid: dto.childSaid ?? null,
        teacherComment: dto.teacherComment ?? null,
        nextSteps: dto.nextSteps ?? null,
      },
      domainIds,
    );

    await this.auditObservation(
      actor,
      observation.id,
      childId,
      enrollment.kindergartenId,
      "CREATE",
      {
        source: "TEACHER",
      },
    );
    return observation;
  }

  /**
   * A guardian shares something from home — RFP §5.4.
   *
   * Read access is enough, which is the whole point of the feature. The note
   * starts PENDING and visible to its author, so they can see that it saved.
   */
  async createParentObservation(actor: Actor, childId: string, dto: CreateParentObservationDto) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);

    // Only an actual guardian may use the parent route. A teacher filing under
    // `source=PARENT` would misattribute the note in the family's report.
    if (!isGuardianOf(actor, facts)) throw new NotFoundException();

    const enrollment = await this.resolveEnrollment(childId);

    const type = await this.parentObservationType(enrollment.kindergartenId, dto.categoryCode);
    if (!type) throw new BadRequestException("Эцэг эхийн ажиглалтын төрөл тохируулагдаагүй байна");

    const observation = await this.repo.create(
      {
        kindergartenId: enrollment.kindergartenId,
        childId,
        enrollmentId: enrollment.id,
        typeId: type.id,
        authorId: actor.userId,
        source: "PARENT",
        observedOn: dto.observedOn,
        visibleToParents: defaultVisibleToParents("PARENT"),
        // The teacher decides whether a family's note belongs in the report.
        includeInReport: false,
        reviewStatus: initialReviewStatus("PARENT"),
        situation: dto.situation ?? null,
        childDid: dto.childDid ?? null,
        childSaid: dto.childSaid ?? null,
      },
      [],
    );

    await this.auditObservation(
      actor,
      observation.id,
      childId,
      enrollment.kindergartenId,
      "CREATE",
      {
        source: "PARENT",
      },
    );
    return observation;
  }

  /**
   * Edits an observation.
   *
   * Staff may change anything. A guardian may edit **their own** parent
   * submission. Editing a reviewed note returns it to the teacher queue.
   *
   * ★ The three teacher decisions of RFP §5.4 — visibility, report inclusion
   * and development domains — are stripped from a guardian's payload even if
   * they post them directly.
   */
  async update(actor: Actor, observationId: string, dto: UpdateObservationDto) {
    const row = await this.repo.findForAuthorization(observationId);
    if (!row) throw new NotFoundException();

    const facts = await this.childAccess.assertCanAccess(actor, row.childId);
    const staff = canRecordForChild(actor, facts);

    const data: Record<string, unknown> = { ...dto };
    let domainIds = dto.domainIds;

    if (!staff) {
      const verdict = guardianMayEdit(row, actor.userId);
      if (!verdict.allowed) {
        // A reason means "you may normally edit this, but not now" — worth
        // saying. Its absence means this is not your record at all: 404.
        if (verdict.reason) throw new ForbiddenException(verdict.reason);
        throw new NotFoundException();
      }

      delete data.visibleToParents;
      delete data.includeInReport;
      delete data.domainIds;
      domainIds = undefined;

      // An edited submission returns to the queue: the teacher approved the
      // text they read, not the text it became.
      if (row.reviewStatus !== "PENDING") {
        data.reviewStatus = "PENDING";
        data.reviewedById = null;
        data.reviewedAt = null;
        data.reviewNote = null;
      }
    }

    if (domainIds) await this.assertDomainsValid(domainIds, row.kindergartenId);
    delete data.domainIds;

    const updated = await this.repo.update(observationId, definedOnly(data), domainIds);

    await this.auditObservation(actor, observationId, row.childId, row.kindergartenId, "UPDATE", {
      fields: Object.keys(definedOnly(data)),
    });
    return updated;
  }

  /**
   * Soft-deletes. Staff may archive any reachable note; a guardian may remove
   * only their own still-editable parent submission.
   */
  async archive(actor: Actor, observationId: string) {
    const row = await this.repo.findForAuthorization(observationId);
    if (!row) throw new NotFoundException();

    const facts = await this.childAccess.assertCanAccess(actor, row.childId);
    if (!canRecordForChild(actor, facts)) {
      const verdict = guardianMayEdit(row, actor.userId);
      if (!verdict.allowed) {
        if (verdict.reason) throw new ForbiddenException(verdict.reason);
        throw new NotFoundException();
      }
    }

    const archived = await this.repo.softDelete(observationId);
    await this.auditObservation(
      actor,
      observationId,
      row.childId,
      row.kindergartenId,
      "DELETE",
      {},
    );
    return archived;
  }

  /** Parent submissions awaiting review, across the teacher's own groups. */
  async reviewQueue(actor: Actor, page: PageParams) {
    const groupIds = await this.authz.loadActiveTeachingGroupIds(actor);
    const { items, total } = await this.repo.listPendingForGroups(groupIds, page);
    return paginate(items, total, page);
  }

  /**
   * A teacher approves or returns a parent submission.
   *
   * Approving may publish it to the family in the same call — the review screen
   * does both, and splitting them means a second request teachers forget.
   */
  async review(actor: Actor, observationId: string, dto: ReviewObservationDto) {
    const row = await this.repo.findForAuthorization(observationId);
    if (!row) throw new NotFoundException();

    await this.childAccess.assertCanRecord(actor, row.childId);

    if (row.source !== "PARENT") {
      throw new BadRequestException("Зөвхөн эцэг эхийн ажиглалтыг хянана");
    }

    if (dto.domainIds) await this.assertDomainsValid(dto.domainIds, row.kindergartenId);

    const updated = await this.repo.update(
      observationId,
      definedOnly({
        reviewStatus: dto.decision,
        reviewedById: actor.userId,
        reviewedAt: new Date(),
        reviewNote: dto.reviewNote,
        visibleToParents: dto.visibleToParents,
      }),
      dto.domainIds,
    );

    await this.auditObservation(actor, observationId, row.childId, row.kindergartenId, "UPDATE", {
      review: dto.decision,
    });
    return updated;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * The enrollment an observation is pinned to.
   *
   * Prefers the active one; falls back to the most recent so a note can still
   * be filed about an archived child. A child with no enrollment at all cannot
   * have observations — there is no group or school year to attach them to.
   */
  private async resolveEnrollment(childId: string) {
    const enrollment =
      (await this.repo.activeEnrollment(childId)) ?? (await this.repo.latestEnrollment(childId));
    if (!enrollment) {
      throw new BadRequestException("Хүүхэд бүлэгт бүртгэгдээгүй байна");
    }
    return enrollment;
  }

  private async parentObservationType(
    kindergartenId: string,
    categoryCode?: "daily" | "conversation" | "artwork",
  ) {
    const types = await this.repo.listTypes(kindergartenId);
    if (categoryCode) return types.find((t) => t.code === categoryCode) ?? null;
    return types.find((t) => t.code === "parent") ?? types[0] ?? null;
  }

  /** Rejects a domain id from another kindergarten. */
  private async assertDomainsValid(domainIds: string[], kindergartenId: string) {
    if (domainIds.length === 0) return;
    const found = await this.repo.countValidDomains(domainIds, kindergartenId);
    if (found !== new Set(domainIds).size) {
      throw new BadRequestException("Хөгжлийн чиглэл олдсонгүй");
    }
  }

  private async auditObservation(
    actor: Actor,
    observationId: string,
    childId: string,
    kindergartenId: string,
    action: "CREATE" | "UPDATE" | "DELETE",
    metadata: Record<string, unknown>,
  ) {
    await this.audit.append({
      action,
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Observation",
      objectId: observationId,
      childId,
      metadata,
    });
  }
}

/** Drops keys the caller did not send, so a PATCH cannot null out the rest. */
function definedOnly(dto: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
}
