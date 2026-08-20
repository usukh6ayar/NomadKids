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
import type { Actor } from "../authz/actor";
import { paginate, type PageParams } from "../common/pagination";
import { UsersService } from "../users/users.service";
import { ChildrenRepository } from "./children.repository";
import type {
  AddGuardianDto,
  CreateChildDto,
  EndEnrollmentDto,
  EnrollDto,
  InviteGuardianDto,
  ListChildrenQuery,
  UpdateChildDto,
  UpdateGuardianshipDto,
} from "./children.dto";

@Injectable()
export class ChildrenService {
  constructor(
    private readonly repo: ChildrenRepository,
    private readonly childAccess: ChildAccessService,
    private readonly tenants: TenantAccessService,
    private readonly authz: AuthzRepository,
    private readonly users: UsersService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * The children this actor may see.
   *
   * The visibility filter is built by `AuthzRepository` — the same definition
   * the detail path uses, kept identical by `test/authz-consistency.test.ts`.
   * Building it separately here is how a list and a detail page come to
   * disagree about who exists.
   */
  async list(actor: Actor, query: ListChildrenQuery) {
    const visible = await this.authz.visibleChildrenWhere(actor);
    const page: PageParams = { page: query.page, pageSize: query.pageSize };

    const { items, total } = await this.repo.listChildren(
      visible,
      {
        q: query.q,
        status: query.status,
        groupId: query.groupId,
        schoolYearId: query.schoolYearId,
      },
      page,
    );

    return paginate(items, total, page);
  }

  async get(actor: Actor, childId: string) {
    // Throws 404 when absent or unauthorized — indistinguishable, by design.
    await this.childAccess.assertCanAccess(actor, childId);

    const child = await this.repo.findChild(childId);
    if (!child) throw new NotFoundException();

    // Opening a child's record is auditable: RFP §971 asks who viewed what.
    await this.audit.append({
      action: "VIEW",
      kindergartenId: child.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Child",
      objectId: childId,
      childId,
    });

    return child;
  }

  /**
   * Registers a child.
   *
   * Enrolling immediately is optional: a child may be registered before their
   * group is decided. Until an enrollment exists, `Child.kindergartenId` is the
   * only thing granting the registering staff access — the documented D8
   * fallback, and the reason it exists.
   */
  async create(actor: Actor, kindergartenId: string, dto: CreateChildDto) {
    this.tenants.assertStaff(actor, kindergartenId);

    if (dto.nationalId) {
      const clash = await this.repo.findByNationalId(kindergartenId, dto.nationalId);
      if (clash) throw new ConflictException("Энэ регистрийн дугаартай хүүхэд бүртгэлтэй байна");
    }

    const child = await this.repo.createChild({
      kindergartenId,
      lastName: dto.lastName,
      firstName: dto.firstName,
      nationalId: dto.nationalId ?? null,
      sex: dto.sex,
      dateOfBirth: dto.dateOfBirth,
      healthNotes: dto.healthNotes ?? null,
    });

    if (dto.groupId) {
      await this.enrollInternal(kindergartenId, child.id, dto.groupId, new Date());
    }

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Child",
      objectId: child.id,
      childId: child.id,
    });

    return child;
  }

  /**
   * Edits a child.
   *
   * `assertCanRecord`, not `assertCanAccess` — a guardian may read their child's
   * record and may not edit it. The reference suite tests exactly this
   * (`test_a_guardian_cannot_edit_their_own_child`).
   */
  async update(actor: Actor, childId: string, dto: UpdateChildDto) {
    const facts = await this.childAccess.assertCanRecord(actor, childId);

    if (dto.nationalId) {
      const clash = await this.repo.findByNationalId(facts.childKindergartenId, dto.nationalId);
      if (clash && clash.id !== childId) {
        throw new ConflictException("Энэ регистрийн дугаартай хүүхэд бүртгэлтэй байна");
      }
    }

    const updated = await this.repo.updateChild(childId, dto);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "Child",
      objectId: childId,
      childId,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  /** Archives a child. Admins only — this is an administrative action. */
  async archive(actor: Actor, childId: string) {
    const facts = await this.childAccess.assertCanAdminister(actor, childId);

    const archived = await this.repo.softDeleteChild(childId);
    await this.audit.append({
      action: "DELETE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "Child",
      objectId: childId,
      childId,
    });
    return archived;
  }

  /** A parent's own children — the parent home screen's only query. */
  async listOwnChildren(actor: Actor) {
    return this.repo.listChildrenForGuardian(actor.userId);
  }

  // ── Guardianships ─────────────────────────────────────────────────────────

  async listGuardians(actor: Actor, childId: string) {
    await this.childAccess.assertCanAccess(actor, childId);
    const child = await this.repo.findChild(childId);
    return child?.guardianships ?? [];
  }

  async addGuardian(actor: Actor, childId: string, dto: AddGuardianDto) {
    const facts = await this.childAccess.assertCanAdminister(actor, childId);

    const existing = await this.repo.findGuardianshipFor(childId, dto.guardianUserId);
    if (existing) {
      // Restoring a revoked guardian is a normal operation — a custody change
      // reversing — and should not be an error.
      if (!existing.canView) {
        const restored = await this.repo.updateGuardianship(existing.id, { canView: true });
        await this.auditGuardianship(
          actor,
          facts.childKindergartenId,
          childId,
          existing.id,
          "restored",
        );
        return restored;
      }
      throw new ConflictException("Энэ асран хамгаалагч аль хэдийн холбогдсон байна");
    }

    const guardianship = await this.repo.createGuardianship({
      kindergartenId: facts.childKindergartenId,
      childId,
      guardianUserId: dto.guardianUserId,
      relation: dto.relation,
      isPrimary: dto.isPrimary,
    });

    await this.auditGuardianship(
      actor,
      facts.childKindergartenId,
      childId,
      guardianship.id,
      "granted",
    );
    return guardianship;
  }

  /**
   * Invites a guardian who has no account yet, for one child.
   *
   * ★ A teacher may do this; linking an *existing* account still may not.
   *
   * `addGuardian` needs `assertCanAdminister` because it hands an account that
   * already has an owner access to a child — a real authorization decision, and
   * an administrator's. This creates a new account that nobody can open until
   * the invitation is accepted, for a child the teacher already writes about.
   * `assertCanRecord` is the same bar as posting an observation about them.
   *
   * ★★ The guardianship is created **now**, not when the invitation is
   * accepted.
   *
   * The alternative is carrying a `childId` on the token and creating the link
   * on redemption. That would mean the authorization decision — "this person may
   * see this child" — is made by whoever holds the link rather than by the
   * teacher who issued it, and it would put a second guardianship-creating path
   * behind an unauthenticated endpoint. Creating it here keeps the decision, the
   * audit entry and the check in one place. The account it points at cannot be
   * opened by anyone, so an unaccepted invitation grants nothing.
   *
   * A duplicate username, email or phone is a 409 rather than a silent link to
   * the existing account: giving an account somebody already owns access to a
   * child is exactly the decision this endpoint is not allowed to make.
   */
  async inviteGuardian(actor: Actor, childId: string, dto: InviteGuardianDto) {
    const facts = await this.childAccess.assertCanRecord(actor, childId);

    const created = await this.users.createGuardianAccount(
      actor,
      facts.childKindergartenId,
      dto,
    );

    const guardianship = await this.repo.createGuardianship({
      kindergartenId: facts.childKindergartenId,
      childId,
      guardianUserId: created.user.id,
      relation: dto.relation,
      isPrimary: dto.isPrimary,
    });

    await this.auditGuardianship(
      actor,
      facts.childKindergartenId,
      childId,
      guardianship.id,
      "invited",
    );

    // The token is returned so the caller can deliver it — as a QR code on
    // screen, or read out. Never logged.
    return { user: created.user, guardianship, invitationToken: created.invitationToken };
  }

  /**
   * Updates a guardianship — including revoking it with `canView: false`.
   *
   * ★ Revocation is a field, never a deletion. Custody arrangements change back,
   * and the record of who was a guardian is part of the child's history.
   */
  async updateGuardianship(actor: Actor, guardianshipId: string, dto: UpdateGuardianshipDto) {
    const guardianship = await this.repo.findGuardianship(guardianshipId);
    if (!guardianship) throw new NotFoundException();

    await this.childAccess.assertCanAdminister(actor, guardianship.childId);

    const updated = await this.repo.updateGuardianship(guardianshipId, dto);
    await this.auditGuardianship(
      actor,
      guardianship.child.kindergartenId,
      guardianship.childId,
      guardianshipId,
      dto.canView === false ? "revoked" : "updated",
    );
    return updated;
  }

  // ── Enrollment ────────────────────────────────────────────────────────────

  async listEnrollments(actor: Actor, childId: string) {
    await this.childAccess.assertCanAccess(actor, childId);
    return this.repo.listEnrollments(childId);
  }

  /**
   * Enrols a child in a group, transferring them if they are already placed.
   *
   * The group determines the kindergarten and the school year, so neither is
   * taken from the request — a body-supplied kindergarten id would let an admin
   * move a child into a tenant they do not administer.
   */
  async enroll(actor: Actor, childId: string, dto: EnrollDto) {
    await this.childAccess.assertCanAdminister(actor, childId);

    // The target group must be in a kindergarten this actor administers.
    const adminKindergartens = this.tenants.adminKindergartenIds(actor);
    let group = null;
    for (const kindergartenId of adminKindergartens) {
      group = await this.repo.findGroupInKindergarten(dto.groupId, kindergartenId);
      if (group) break;
    }
    if (!group) throw new BadRequestException("Бүлэг олдсонгүй");

    const enrollment = await this.enrollInternal(
      group.kindergartenId,
      childId,
      group.id,
      dto.startedOn ?? new Date(),
    );

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: group.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Enrollment",
      objectId: enrollment.id,
      childId,
      metadata: { groupId: group.id, change: "enrolled" },
    });
    return enrollment;
  }

  async endEnrollment(actor: Actor, enrollmentId: string, dto: EndEnrollmentDto) {
    const enrollment = await this.repo.findEnrollment(enrollmentId);
    if (!enrollment) throw new NotFoundException();

    await this.childAccess.assertCanAdminister(actor, enrollment.childId);

    const ended = await this.repo.endEnrollment(enrollmentId, dto.status);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: enrollment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Enrollment",
      objectId: enrollmentId,
      childId: enrollment.childId,
      metadata: { change: "ended", status: dto.status },
    });
    return ended;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async enrollInternal(
    kindergartenId: string,
    childId: string,
    groupId: string,
    startedOn: Date,
  ) {
    const group = await this.repo.findGroupInKindergarten(groupId, kindergartenId);
    if (!group) throw new BadRequestException("Бүлэг олдсонгүй");

    return this.repo.enrollChild({
      kindergartenId,
      childId,
      groupId,
      schoolYearId: group.schoolYear.id,
      startedOn,
    });
  }

  private async auditGuardianship(
    actor: Actor,
    kindergartenId: string,
    childId: string,
    guardianshipId: string,
    change: string,
  ) {
    await this.audit.append({
      action: "PERMISSION_CHANGE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Guardianship",
      objectId: guardianshipId,
      childId,
      metadata: { change },
    });
  }
}
