import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { AuthzRepository } from "../authz/authz.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { paginate, type PageParams } from "../common/pagination";
import type { TenantScope } from "../common/repository/tenant-scope";
import { TenantsRepository } from "./tenants.repository";
import type {
  AssignTeacherDto,
  CreateGroupDto,
  CreateSchoolYearDto,
  ListGroupsQuery,
  UpdateGroupDto,
  UpdateKindergartenDto,
  UpdateSchoolYearDto,
} from "./tenants.dto";

/**
 * Business rules for kindergartens, school years, groups and assignments.
 *
 * The service authorizes; the repository queries. Every method here starts by
 * establishing what the actor may reach, and the scope it passes down is built
 * from memberships — never from a request parameter.
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly repo: TenantsRepository,
    private readonly tenants: TenantAccessService,
    private readonly authz: AuthzRepository,
    private readonly audit: AuditRepository,
  ) {}

  /** The actor's full membership scope — what any read may see. */
  private memberScope(actor: Actor): TenantScope {
    return { kindergartenIds: this.tenants.memberKindergartenIds(actor) };
  }

  /** Admin-only scope, for writes. */
  private adminScope(actor: Actor): TenantScope {
    return { kindergartenIds: this.tenants.adminKindergartenIds(actor) };
  }

  // ── Kindergartens ─────────────────────────────────────────────────────────

  async listKindergartens(actor: Actor) {
    return this.repo.listKindergartens(this.memberScope(actor));
  }

  async getKindergarten(actor: Actor, id: string) {
    const kindergarten = await this.repo.findKindergarten(this.memberScope(actor), id);
    if (!kindergarten) throw new NotFoundException();
    return kindergarten;
  }

  async updateKindergarten(actor: Actor, id: string, dto: UpdateKindergartenDto) {
    // Load through the admin scope, so a director of another kindergarten gets
    // 404 rather than a successful write.
    const existing = await this.repo.findKindergarten(this.adminScope(actor), id);
    if (!existing) throw new NotFoundException();

    const updated = await this.repo.updateKindergarten(id, dto);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: id,
      actorUserId: actor.userId,
      objectType: "Kindergarten",
      objectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  // ── School years ──────────────────────────────────────────────────────────

  async listSchoolYears(actor: Actor, kindergartenId: string) {
    this.tenants.assertMember(actor, kindergartenId);
    return this.repo.listSchoolYears(this.memberScope(actor), kindergartenId);
  }

  async createSchoolYear(actor: Actor, kindergartenId: string, dto: CreateSchoolYearDto) {
    this.tenants.assertAdmin(actor, kindergartenId);

    // The repository demotes any existing current year inside the same
    // transaction — the partial unique index makes the ordering mandatory.
    const created = await this.guardDuplicateName(() =>
      this.repo.createSchoolYear({ ...dto, kindergartenId }),
    );

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "SchoolYear",
      objectId: created.id,
    });
    return created;
  }

  /**
   * Edits a school year — the name, the dates, or the current-year flag.
   *
   * ★ `isCurrent` is only ever *moved*, never cleared as a side effect.
   *
   * `updateSchoolYearSchema` leaves the field `optional()` with no default,
   * unlike the create schema's `.default(false)`. That difference is load
   * bearing: a rename arrives with `isCurrent: undefined`, the repository skips
   * its demotion and Prisma skips the column, so the flag stays where it was.
   * Giving this DTO the same `.default(false)` would silently un-current a
   * kindergarten every time somebody fixed a typo in a year's name.
   */
  async updateSchoolYear(actor: Actor, id: string, dto: UpdateSchoolYearDto) {
    const existing = await this.repo.findSchoolYear(this.adminScope(actor), id);
    if (!existing) throw new NotFoundException();

    const updated = await this.guardDuplicateName(() =>
      this.repo.updateSchoolYear(id, existing.kindergartenId, dto),
    );
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: existing.kindergartenId,
      actorUserId: actor.userId,
      objectType: "SchoolYear",
      objectId: id,
    });
    return updated;
  }

  /**
   * Turns a duplicate year name into a 409 with a sentence a person can act on.
   *
   * `@@unique([kindergartenId, name])` is the only unique constraint a single
   * school-year write can realistically hit — the partial current-year index
   * cannot fire, because the repository demotes the previous holder inside the
   * same transaction. Left alone, Prisma's P2002 arrives at the problem filter
   * as an unrecognised exception and becomes a bare 500, which tells an
   * administrator who typed "2026-2027" twice that the system is broken.
   * `catalog.service.ts` guards its own codes the same way.
   */
  private async guardDuplicateName<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Энэ нэртэй хичээлийн жил аль хэдийн бүртгэгдсэн байна");
      }
      throw error;
    }
  }

  // ── Groups ────────────────────────────────────────────────────────────────

  /**
   * Lists groups the actor may see.
   *
   * ★ A teacher sees only their assigned groups; an admin sees every group in
   * their kindergartens. The narrowing happens here rather than in the query
   * filters, so a teacher passing `?kindergartenId=…` for a kindergarten they
   * teach in still cannot see groups they are not assigned to.
   */
  async listGroups(actor: Actor, query: ListGroupsQuery) {
    const adminKindergartens = this.tenants.adminKindergartenIds(actor);
    const isAdminOfRequested = query.kindergartenId
      ? adminKindergartens.includes(query.kindergartenId)
      : adminKindergartens.length > 0;

    const groupIds = isAdminOfRequested
      ? undefined
      : await this.authz.loadActiveTeachingGroupIds(actor);

    const page: PageParams = { page: query.page, pageSize: query.pageSize };
    const { items, total } = await this.repo.listGroups(
      this.memberScope(actor),
      {
        kindergartenId: query.kindergartenId,
        schoolYearId: query.schoolYearId,
        status: query.status,
        groupIds,
      },
      page,
    );

    return paginate(items, total, page);
  }

  async getGroup(actor: Actor, id: string) {
    const group = await this.repo.findGroup(this.memberScope(actor), id);
    if (!group) throw new NotFoundException();

    // Membership in the kindergarten is not enough: a teacher may only open a
    // group they are assigned to.
    if (!this.tenants.isAdmin(actor, group.kindergartenId)) {
      const assigned = await this.authz.loadActiveTeachingGroupIds(actor);
      if (!assigned.includes(group.id)) throw new NotFoundException();
    }

    return group;
  }

  async createGroup(actor: Actor, kindergartenId: string, dto: CreateGroupDto) {
    this.tenants.assertAdmin(actor, kindergartenId);

    // The school year must belong to the same kindergarten. Without this check
    // an admin could attach a group to another kindergarten's year by id.
    const year = await this.repo.findSchoolYear(this.adminScope(actor), dto.schoolYearId);
    if (!year || year.kindergartenId !== kindergartenId) {
      throw new BadRequestException("Хичээлийн жил олдсонгүй");
    }

    const created = await this.repo.createGroup({
      kindergartenId,
      schoolYearId: dto.schoolYearId,
      name: dto.name,
      ageBand: dto.ageBand,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Group",
      objectId: created.id,
    });
    return created;
  }

  async updateGroup(actor: Actor, id: string, dto: UpdateGroupDto) {
    const existing = await this.repo.findGroup(this.adminScope(actor), id);
    if (!existing) throw new NotFoundException();

    const updated = await this.repo.updateGroup(id, dto);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: existing.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Group",
      objectId: id,
    });
    return updated;
  }

  /**
   * Archives a group.
   *
   * Refuses while children are still enrolled. Archiving a populated group
   * would leave those enrollments pointing at something the UI no longer shows,
   * and the children would quietly vanish from every roster.
   */
  async archiveGroup(actor: Actor, id: string) {
    const existing = await this.repo.findGroup(this.adminScope(actor), id);
    if (!existing) throw new NotFoundException();

    const active = await this.repo.countActiveEnrollments(id);
    if (active > 0) {
      throw new ConflictException(
        `Энэ бүлэгт ${active} хүүхэд бүртгэлтэй байна. Эхлээд тэднийг өөр бүлэгт шилжүүлнэ үү.`,
      );
    }

    const archived = await this.repo.softDeleteGroup(id);
    await this.audit.append({
      action: "DELETE",
      kindergartenId: existing.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Group",
      objectId: id,
    });
    return archived;
  }

  // ── Teacher assignments ───────────────────────────────────────────────────

  async assignTeacher(actor: Actor, groupId: string, dto: AssignTeacherDto) {
    const group = await this.repo.findGroup(this.adminScope(actor), groupId);
    if (!group) throw new NotFoundException();

    // The membership must be a TEACHER role in THIS kindergarten. Checking it
    // here is what makes it structurally impossible to assign someone to a
    // kindergarten they have no membership in.
    const membership = await this.repo.findTeacherMembership(
      dto.membershipId,
      group.kindergartenId,
    );
    if (!membership) throw new BadRequestException("Багшийн бүртгэл олдсонгүй");

    const existing = await this.repo.findActiveAssignment(groupId, dto.membershipId);
    if (existing)
      throw new ConflictException("Энэ багш аль хэдийн энэ бүлэгт хуваарилагдсан байна");

    const assignment = await this.repo.assignTeacher({
      kindergartenId: group.kindergartenId,
      groupId,
      membershipId: dto.membershipId,
      role: dto.role,
    });

    await this.audit.append({
      action: "PERMISSION_CHANGE",
      kindergartenId: group.kindergartenId,
      actorUserId: actor.userId,
      objectType: "GroupTeacher",
      objectId: assignment.id,
      metadata: { groupId, membershipId: dto.membershipId, change: "assigned" },
    });
    return assignment;
  }

  /**
   * Ends an assignment — the revocation path.
   *
   * Sets `endedOn` rather than deleting, so historical attribution survives
   * while access stops on the teacher's next request.
   */
  async endAssignment(actor: Actor, assignmentId: string) {
    const assignment = await this.repo.findAssignment(this.adminScope(actor), assignmentId);
    if (!assignment) throw new NotFoundException();

    const ended = await this.repo.endAssignment(assignmentId);
    await this.audit.append({
      action: "PERMISSION_CHANGE",
      kindergartenId: assignment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "GroupTeacher",
      objectId: assignmentId,
      metadata: { change: "revoked" },
    });
    return ended;
  }
}

/** Prisma's unique-constraint code. Narrowed without importing the client. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
