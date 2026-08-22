import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { AuthzRepository } from "../authz/authz.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import { isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { AssessmentRepository } from "./assessment.repository";
import type {
  CreateTermDto,
  GroupColumnQuery,
  PublishTermDto,
  SaveAssessmentDto,
  SaveGroupColumnDto,
  SaveTermReportDto,
  UpdateTermDto,
} from "./assessment.dto";

@Injectable()
export class AssessmentService {
  constructor(
    private readonly repo: AssessmentRepository,
    private readonly childAccess: ChildAccessService,
    private readonly tenants: TenantAccessService,
    private readonly authz: AuthzRepository,
    private readonly audit: AuditRepository,
  ) {}

  // ── Configuration ─────────────────────────────────────────────────────────

  /**
   * Domains and levels for a kindergarten.
   *
   * Readable by every role: the UI cannot render a level name or a domain
   * colour without them, and a parent's own screen shows both.
   */
  async listConfig(actor: Actor, kindergartenId: string) {
    this.tenants.assertMember(actor, kindergartenId);
    const [domains, levels] = await Promise.all([
      this.repo.listDomains(kindergartenId),
      this.repo.listLevels(kindergartenId),
    ]);
    return { domains, levels };
  }

  // ── Terms ─────────────────────────────────────────────────────────────────

  async listTerms(actor: Actor, kindergartenId: string, schoolYearId?: string) {
    this.tenants.assertMember(actor, kindergartenId);
    return this.repo.listTerms(kindergartenId, schoolYearId);
  }

  async createTerm(actor: Actor, kindergartenId: string, dto: CreateTermDto) {
    this.tenants.assertAdmin(actor, kindergartenId);

    // ★ The school year must belong to this kindergarten.
    //
    // `kindergartenId` is the authorized path parameter; `schoolYearId` comes
    // from the body. Without this an admin of one kindergarten could attach a
    // term to another's year by pasting its id, and the row would carry a
    // kindergartenId and a schoolYearId pointing at different tenants.
    // `TenantsService.createGroup` guards the same seam.
    const year = await this.repo.findSchoolYearInKindergarten(dto.schoolYearId, kindergartenId);
    if (!year) throw new BadRequestException("Хичээлийн жил олдсонгүй");

    // Checked explicitly so a second "2-р улирал" is a readable 409 rather
    // than a raw @@unique([schoolYearId, number]) violation surfacing as a 500
    // — which is what an admin adding a term that already exists used to get.
    const clash = await this.repo.findTermByNumber(dto.schoolYearId, dto.number);
    if (clash) {
      throw new ConflictException(`${dto.number}-р улирал энэ хичээлийн жилд бүртгэлтэй байна`);
    }

    let term;
    try {
      term = await this.repo.createTerm({ ...dto, kindergartenId });
    } catch (error) {
      // The pre-check above closes the common case; this closes the race
      // between it and the insert, which would otherwise be the 500 again.
      if (isUniqueViolation(error)) {
        throw new ConflictException(`${dto.number}-р улирал энэ хичээлийн жилд бүртгэлтэй байна`);
      }
      throw error;
    }

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Term",
      objectId: term.id,
    });
    return term;
  }

  async updateTerm(actor: Actor, termId: string, dto: UpdateTermDto) {
    const term = await this.repo.findTerm(termId, this.tenants.adminKindergartenIds(actor));
    if (!term) throw new NotFoundException();

    const updated = await this.repo.updateTerm(termId, dto);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: term.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Term",
      objectId: termId,
    });
    return updated;
  }

  // ── Child assessments ─────────────────────────────────────────────────────

  /**
   * A child's assessments.
   *
   * A guardian sees only those the teacher has published — RFP §2.3. There is
   * no approval workflow here, unlike observations: publishing is a single
   * per-term decision.
   */
  async listForChild(actor: Actor, childId: string, termId?: string) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);
    return this.repo.listForChild(childId, isGuardianOf(actor, facts), termId);
  }

  async saveForChild(actor: Actor, childId: string, dto: SaveAssessmentDto) {
    const facts = await this.childAccess.assertCanRecord(actor, childId);
    const term = await this.requireTerm(actor, dto.termId, facts.childKindergartenId);

    const enrollment = await this.repo.enrollmentForTerm(childId, term.schoolYearId);
    if (!enrollment) {
      throw new BadRequestException("Хүүхэд энэ хичээлийн жилд бүртгэлгүй байна");
    }

    await this.requireDomainAndLevel(dto.domainId, dto.levelId, enrollment.kindergartenId);

    const saved = await this.repo.upsertAssessment({
      kindergartenId: enrollment.kindergartenId,
      childId,
      enrollmentId: enrollment.id,
      domainId: dto.domainId,
      termId: dto.termId,
      levelId: dto.levelId,
      comment: dto.comment ?? null,
      assessedById: actor.userId,
    });

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: enrollment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Assessment",
      objectId: saved.id,
      childId,
      metadata: { termId: dto.termId, domainId: dto.domainId },
    });

    return saved;
  }

  /**
   * ★ One group, one term, ONE domain — the teacher's main assessment screen.
   *
   * Both `termId` and `domainId` are required, which is what keeps this from
   * drifting into the children × domains matrix the scope excludes.
   */
  async getGroupColumn(actor: Actor, groupId: string, query: GroupColumnQuery) {
    const group = await this.repo.findGroupForAssessment(
      groupId,
      this.tenants.memberKindergartenIds(actor),
    );
    if (!group) throw new NotFoundException();

    // Membership is not enough: a teacher may only assess a group they are
    // assigned to.
    if (!this.tenants.isAdmin(actor, group.kindergartenId)) {
      const assigned = await this.authz.loadActiveTeachingGroupIds(actor);
      if (!assigned.includes(groupId)) throw new NotFoundException();
    }

    const term = await this.requireTerm(actor, query.termId, group.kindergartenId);
    const domain = await this.repo.findDomain(query.domainId, group.kindergartenId);
    if (!domain) throw new BadRequestException("Хөгжлийн чиглэл олдсонгүй");

    const [{ enrollments, assessments }, levels] = await Promise.all([
      this.repo.loadGroupColumn(groupId, term.schoolYearId, query.termId, query.domainId),
      this.repo.listLevels(group.kindergartenId),
    ]);

    const byChild = new Map(assessments.map((a) => [a.childId, a]));

    return {
      group: { id: group.id, name: group.name },
      term: { id: term.id, number: term.number, name: term.name },
      domain: { id: domain.id, name: domain.name, color: domain.color },
      levels,
      children: enrollments.map((e) => ({
        childId: e.child.id,
        lastName: e.child.lastName,
        firstName: e.child.firstName,
        photoMediaFileId: e.child.photoMediaFileId,
        assessment: byChild.get(e.child.id)
          ? {
              levelId: byChild.get(e.child.id)!.levelId,
              comment: byChild.get(e.child.id)!.comment,
              visibleToParents: byChild.get(e.child.id)!.visibleToParents,
            }
          : null,
      })),
    };
  }

  /** Saves the whole column in one transaction. */
  async saveGroupColumn(actor: Actor, groupId: string, dto: SaveGroupColumnDto) {
    const group = await this.repo.findGroupForAssessment(
      groupId,
      this.tenants.memberKindergartenIds(actor),
    );
    if (!group) throw new NotFoundException();

    if (!this.tenants.isAdmin(actor, group.kindergartenId)) {
      const assigned = await this.authz.loadActiveTeachingGroupIds(actor);
      if (!assigned.includes(groupId)) throw new NotFoundException();
    }

    const term = await this.requireTerm(actor, dto.termId, group.kindergartenId);
    await this.requireDomain(dto.domainId, group.kindergartenId);

    // Every level must belong here too — one query for the distinct set rather
    // than one per row.
    for (const levelId of new Set(dto.entries.map((e) => e.levelId))) {
      const level = await this.repo.findLevel(levelId, group.kindergartenId);
      if (!level) throw new BadRequestException("Үнэлгээний түвшин олдсонгүй");
    }

    // ★ Every child must actually be enrolled in THIS group for THIS year.
    // Without it a valid child id from elsewhere would have an assessment
    // written against a group they do not attend.
    const { enrollments } = await this.repo.loadGroupColumn(
      groupId,
      term.schoolYearId,
      dto.termId,
      dto.domainId,
    );
    const enrolled = new Map(enrollments.map((e) => [e.child.id, e.id]));

    const rows = dto.entries.map((entry) => {
      const enrollmentId = enrolled.get(entry.childId);
      if (!enrollmentId) {
        throw new BadRequestException("Хүүхэд энэ бүлэгт бүртгэлгүй байна");
      }
      return {
        kindergartenId: group.kindergartenId,
        childId: entry.childId,
        enrollmentId,
        domainId: dto.domainId,
        termId: dto.termId,
        levelId: entry.levelId,
        comment: entry.comment ?? null,
        assessedById: actor.userId,
      };
    });

    const saved = await this.repo.upsertColumn(rows);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: group.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Assessment",
      objectId: groupId,
      metadata: { bulk: true, count: saved.length, termId: dto.termId, domainId: dto.domainId },
    });

    return { saved: saved.length };
  }

  /**
   * Publishes a child's term results to their family.
   *
   * Per term, not per assessment: a teacher decides "this term is ready to
   * share", not row by row.
   */
  async publishTerm(actor: Actor, childId: string, dto: PublishTermDto) {
    const facts = await this.childAccess.assertCanRecord(actor, childId);
    await this.requireTerm(actor, dto.termId, facts.childKindergartenId);

    const count = await this.repo.setTermVisibility(childId, dto.termId, dto.visible);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "Assessment",
      objectId: dto.termId,
      childId,
      metadata: { published: dto.visible, count },
    });

    return { updated: count, visible: dto.visible };
  }

  // ── Term reports ──────────────────────────────────────────────────────────

  /**
   * A guardian sees a term report only once it is FINAL.
   *
   * ★ Absent and not-yet-final return the **same** shape. Distinguishing them
   * would tell a parent that a draft about their child exists, which is its own
   * disclosure — and the teacher has not finished writing it.
   *
   * The empty case is an explicit object rather than `null`, for the reason
   * given in PortfolioService: a bare null sends an empty HTTP body, which a
   * form cannot bind to and a client cannot tell apart from a failure.
   */
  async getTermReport(actor: Actor, childId: string, termId: string) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);
    const report = await this.repo.findTermReport(childId, termId, isGuardianOf(actor, facts));

    return (
      report ?? {
        childId,
        termId,
        exists: false,
        status: null,
        strengths: null,
        needsSupport: null,
        nextGoals: null,
        adviceForParents: null,
      }
    );
  }

  async saveTermReport(actor: Actor, childId: string, dto: SaveTermReportDto) {
    const facts = await this.childAccess.assertCanRecord(actor, childId);
    const term = await this.requireTerm(actor, dto.termId, facts.childKindergartenId);

    const enrollment = await this.repo.enrollmentForTerm(childId, term.schoolYearId);
    if (!enrollment) {
      throw new BadRequestException("Хүүхэд энэ хичээлийн жилд бүртгэлгүй байна");
    }

    const saved = await this.repo.upsertTermReport({
      kindergartenId: enrollment.kindergartenId,
      childId,
      enrollmentId: enrollment.id,
      termId: dto.termId,
      authorId: actor.userId,
      strengths: dto.strengths ?? null,
      needsSupport: dto.needsSupport ?? null,
      nextGoals: dto.nextGoals ?? null,
      adviceForParents: dto.adviceForParents ?? null,
    });

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: enrollment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "TermReport",
      objectId: saved.id,
      childId,
      metadata: { termId: dto.termId, status: saved.status },
    });

    return saved;
  }

  /** Finalising is what makes the report visible to the family. */
  async finalizeTermReport(actor: Actor, childId: string, termId: string) {
    const facts = await this.childAccess.assertCanRecord(actor, childId);

    const existing = await this.repo.findTermReport(childId, termId, false);
    if (!existing) throw new BadRequestException("Эхлээд улирлын тайланг бичнэ үү");

    const finalized = await this.repo.finalizeTermReport(childId, termId);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "TermReport",
      objectId: finalized.id,
      childId,
      metadata: { status: "FINAL" },
    });

    return finalized;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async requireTerm(actor: Actor, termId: string, kindergartenId: string) {
    const term = await this.repo.findTerm(termId, this.tenants.memberKindergartenIds(actor));
    // The term must belong to the same kindergarten as the child or group, not
    // merely to one the actor is a member of.
    if (!term || term.kindergartenId !== kindergartenId) {
      throw new BadRequestException("Улирал олдсонгүй");
    }
    return term;
  }

  private async requireDomain(domainId: string, kindergartenId: string) {
    const domain = await this.repo.findDomain(domainId, kindergartenId);
    if (!domain) throw new BadRequestException("Хөгжлийн чиглэл олдсонгүй");
    return domain;
  }

  private async requireDomainAndLevel(domainId: string, levelId: string, kindergartenId: string) {
    await this.requireDomain(domainId, kindergartenId);
    const level = await this.repo.findLevel(levelId, kindergartenId);
    if (!level) throw new BadRequestException("Үнэлгээний түвшин олдсонгүй");
  }
}

/**
 * Prisma's unique-constraint code. Narrowed without importing the client,
 * which a service may not do — CLAUDE.md §2.2.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
