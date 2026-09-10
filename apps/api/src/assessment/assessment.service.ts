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
    const [domains, levels, monthlyNoteGoal] = await Promise.all([
      this.repo.listDomains(kindergartenId),
      this.repo.listLevels(kindergartenId),
      this.repo.monthlyNoteGoal(kindergartenId),
    ]);
    /*
      ★ The monthly goal rides with the domains and levels because it is the
      same kind of thing: configuration this screen needs before it can draw
      anything, read by everybody who can see the screen.

      It used to live in `localStorage`, which meant the two teachers of one
      group could hold different targets, a director saw neither, and clearing
      site data lost it. A shared commitment stored per browser is not a shared
      commitment.
    */
    return { domains, levels, monthlyNoteGoal };
  }

  /**
   * Sets the kindergarten's monthly note goal — administrator only.
   *
   * ★ Narrower than who reads it, deliberately.
   *
   * Every member of staff needs to see the target; deciding it is the
   * director's, and it was previously whatever each teacher had typed into
   * their own browser. Null clears it, and the screen then draws no goal card
   * rather than falling back to a number nobody chose.
   */
  async setMonthlyNoteGoal(actor: Actor, kindergartenId: string, goal: number | null) {
    this.tenants.assertAdmin(actor, kindergartenId);

    await this.repo.setMonthlyNoteGoal(kindergartenId, goal);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Kindergarten",
      objectId: kindergartenId,
      metadata: { monthlyNoteGoal: goal },
    });

    return { monthlyNoteGoal: goal };
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

  /**
   * The radar — one child against their group, across the five domains.
   *
   * ★ Every domain is an axis, assessed or not.
   *
   * The axes come from the kindergarten's domain table rather than from the
   * child's assessments, so an unassessed domain is a point at the origin
   * instead of a missing side. A radar whose outline changes shape between two
   * children is not a comparison; shape is the entire signal.
   *
   * ★★ Who may see the cohort line is decided here, once.
   *
   * An average over a small group is an individual score: a parent who knows
   * their own child's mark and the mean of a group of two computes the other
   * child's exactly. Guardians therefore get no cohort line until the group is
   * large enough for the mean to describe a group rather than a person. Staff
   * are never suppressed — a teacher opens every child in their group
   * individually on the assessment grid, so hiding the aggregate from them
   * protects nobody.
   *
   * ★★★ Three queries, and none of them per-domain: the child's own
   * assessments, the domain table, and the cohort's assessments in one `IN`.
   */
  async radarForChild(actor: Actor, childId: string, termId: string) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);
    const isGuardian = isGuardianOf(actor, facts);
    const term = await this.requireTerm(actor, termId, facts.childKindergartenId);

    const [own, domains, enrollment] = await Promise.all([
      this.repo.listForChild(childId, isGuardian, termId),
      this.repo.listDomains(facts.childKindergartenId),
      this.repo.groupForChildInYear(childId, term.schoolYearId),
    ]);

    const byDomainId = new Map(own.map((a) => [a.domain?.id, a]));
    const axes = domains.map((domain) => {
      const assessment = byDomainId.get(domain.id);
      return {
        domain,
        score: assessment?.level?.value ?? null,
        level: assessment?.level ?? null,
      };
    });

    const group = enrollment?.group ?? null;
    const cohort = group
      ? await this.buildCohort(group, term.schoolYearId, termId, isGuardian)
      : null;

    return { term: { id: term.id, number: term.number, name: term.name }, axes, cohort };
  }

  /**
   * ★ The minimum cohort a mean may be published over.
   *
   * Five leaves four other children behind the average, so a family reading
   * their own score learns the mean of four strangers rather than one
   * classmate's mark. Below it the comparison is withheld entirely rather than
   * blurred — a rounded or noised average still narrows the range, and a number
   * that is *approximately* somebody's score is not a meaningful improvement on
   * their score.
   */
  private static readonly MIN_DISCLOSED_COHORT = 5;

  private async buildCohort(
    group: { id: string; name: string },
    schoolYearId: string,
    termId: string,
    isGuardian: boolean,
  ) {
    const rows = await this.repo.loadCohortAssessments(group.id, schoolYearId, termId);
    const sampleSize = new Set(rows.map((r) => r.childId)).size;

    if (sampleSize === 0) return null;
    if (isGuardian && sampleSize < AssessmentService.MIN_DISCLOSED_COHORT) return null;

    const totals = new Map<string, { sum: number; n: number }>();
    for (const row of rows) {
      const value = row.level?.value;
      if (value === undefined || value === null) continue;
      const acc = totals.get(row.domainId) ?? { sum: 0, n: 0 };
      acc.sum += value;
      acc.n += 1;
      totals.set(row.domainId, acc);
    }

    const averageByDomain: Record<string, number> = {};
    for (const [domainId, { sum, n }] of totals) {
      // One decimal: the underlying scale is 1–4 with four steps, and a mean
      // printed to three places claims a precision the instrument does not have.
      averageByDomain[domainId] = Math.round((sum / n) * 10) / 10;
    }

    return { group: { id: group.id, name: group.name }, sampleSize, averageByDomain };
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

    /*
     * ★ RFP §6.3 — "өмнөх үнэлгээтэй харьцуулах".
     *
     * Sequential rather than inside the `Promise.all` above, because it needs
     * the roster to know which children to ask about. That is one extra round
     * trip on a screen that already does two, and none at all in the first
     * term — where there is no previous term to compare with, and asking would
     * be a query guaranteed to return nothing.
     */
    const previousByChild = new Map<string, { id: string; value: number; label: string }>();
    if (term.number > 1) {
      const rows = await this.repo.loadPreviousLevels(
        enrollments.map((e) => e.child.id),
        term.schoolYearId,
        term.number - 1,
        query.domainId,
      );
      for (const row of rows) {
        if (row.level) {
          previousByChild.set(row.childId, {
            id: row.level.id,
            value: row.level.value,
            label: row.level.label,
          });
        }
      }
    }

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
        /*
         * `null` for a child who was not assessed last term, which is not the
         * same as one who has no previous term at all — the screen says "—"
         * either way, and the difference is not one a teacher can act on.
         */
        previous: previousByChild.get(e.child.id) ?? null,
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
      await this.requireLevel(levelId, group.kindergartenId);
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

    // ★ FINAL means final.
    //
    // Once finalised, a family is reading this text. Accepting a later write
    // would change it underneath them with no trace and no notification: the
    // teacher would believe they had corrected a draft and the parent would
    // have read something else. The upsert used to allow it.
    const existing = await this.repo.findTermReport(childId, dto.termId, false);
    if (existing?.status === "FINAL") {
      throw new ConflictException("Баталгаажсан тайланг засах боломжгүй");
    }

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

    // Finalising twice is a double-click, not an error — the postcondition
    // already holds. Returning early rather than re-finalising is what keeps
    // `finalizedAt` at the moment the family were actually told it was ready,
    // and keeps one audit row per finalisation.
    if (existing.status === "FINAL") return existing;

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

  /**
   * A domain that may be **written** to.
   *
   * ★ Refuse new, permit existing.
   *
   * An administrator may retire a criterion mid-year (`isActive: false`, via
   * DELETE /development-domains/:id). From that moment it cannot be assessed
   * against — but every assessment already recorded under it keeps rendering,
   * because `groupColumn` and the child views look the row up without this
   * check. The consequence, stated rather than discovered: an existing
   * assessment on a retired domain becomes read-only, since `upsertAssessment`
   * comes through here too.
   */
  private async requireDomain(domainId: string, kindergartenId: string) {
    const domain = await this.repo.findDomain(domainId, kindergartenId);
    if (!domain) throw new BadRequestException("Хөгжлийн чиглэл олдсонгүй");
    if (!domain.isActive) {
      throw new BadRequestException("Энэ хөгжлийн чиглэл идэвхгүй болсон байна");
    }
    return domain;
  }

  /** As `requireDomain`, for a level. Same refuse-new-permit-existing rule. */
  private async requireLevel(levelId: string, kindergartenId: string) {
    const level = await this.repo.findLevel(levelId, kindergartenId);
    if (!level) throw new BadRequestException("Үнэлгээний түвшин олдсонгүй");
    if (!level.isActive) {
      throw new BadRequestException("Энэ үнэлгээний түвшин идэвхгүй болсон байна");
    }
    return level;
  }

  private async requireDomainAndLevel(domainId: string, levelId: string, kindergartenId: string) {
    await this.requireDomain(domainId, kindergartenId);
    await this.requireLevel(levelId, kindergartenId);
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
