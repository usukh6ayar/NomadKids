import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { AuthzRepository } from "../authz/authz.repository";
import { ChildAccessService } from "../authz/child-access.service";
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
  ) {}

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

    const type = await this.parentObservationType(enrollment.kindergartenId);
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
   * submission, and only until a teacher approves it — after that it is part of
   * a record the teacher has signed off on.
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
      if (row.reviewStatus === "RETURNED") data.reviewStatus = "PENDING";
    }

    if (domainIds) await this.assertDomainsValid(domainIds, row.kindergartenId);
    delete data.domainIds;

    const updated = await this.repo.update(observationId, definedOnly(data), domainIds);

    await this.auditObservation(actor, observationId, row.childId, row.kindergartenId, "UPDATE", {
      fields: Object.keys(definedOnly(data)),
    });
    return updated;
  }

  /** Soft-deletes. Staff only — a guardian cannot retract an approved note. */
  async archive(actor: Actor, observationId: string) {
    const row = await this.repo.findForAuthorization(observationId);
    if (!row) throw new NotFoundException();

    await this.childAccess.assertCanRecord(actor, row.childId);

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

  private async parentObservationType(kindergartenId: string) {
    const types = await this.repo.listTypes(kindergartenId);
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
