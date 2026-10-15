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
  AssignSpecialistDto,
  AssignTeacherDto,
  CreateGroupDto,
  CreateSchoolYearDto,
  ListGroupsQuery,
  PromoteGroupDto,
  UpdateGroupDto,
  UpdateKindergartenDto,
  UpdateSchoolYearDto,
} from "./tenants.dto";
import { SoloRulesService } from "../solo-teachers/solo-rules.service";

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
    private readonly solo: SoloRulesService,
  ) {}

  /** The actor's full membership scope — what any read may see. */
  private memberScope(actor: Actor): TenantScope {
    return { kindergartenIds: this.tenants.memberKindergartenIds(actor) };
  }

  /** Admin-only scope, for writes. */
  private adminScope(actor: Actor): TenantScope {
    return { kindergartenIds: this.tenants.adminKindergartenIds(actor) };
  }

  /**
   * Setting up school years and groups: the administrator's kindergartens and
   * a solo teacher's own workspace (the user, 2026-10-14) —
   * `TenantAccessService.workspaceKindergartenIds`.
   */
  private async workspaceScope(actor: Actor): Promise<TenantScope> {
    return { kindergartenIds: await this.tenants.workspaceKindergartenIds(actor) };
  }

  // ── Kindergartens ─────────────────────────────────────────────────────────

  async listKindergartens(actor: Actor) {
    return this.repo.listKindergartens(this.memberScope(actor));
  }

  /**
   * ★ A director sees one field more — `esisInstitutionId`, which is what
   * their staff now type into the public registration form.
   *
   * The scope is still the **member** scope, so authorization is unchanged and
   * a stranger still gets 404; being an admin only widens the `select`. Doing
   * it the other way round — reading through `adminScope` first and falling
   * back — would cost a second query and, worse, put a second authorization
   * decision in a method that already has a correct one.
   */
  async getKindergarten(actor: Actor, id: string) {
    const asAdmin = this.tenants.adminKindergartenIds(actor).includes(id);
    const kindergarten = await this.repo.findKindergarten(this.memberScope(actor), id, asAdmin);
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
    await this.tenants.assertCanSetUpWorkspace(actor, kindergartenId);

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
    const existing = await this.repo.findSchoolYear(await this.workspaceScope(actor), id);
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
  /**
   * ★ An accountant reads the whole roster too — 2026-09-13.
   *
   * This narrowed anybody who is not an *admin* of the requested kindergarten
   * to the groups they teach. A teacher is exactly who that is for; an
   * accountant teaches none, so they got an empty page — which is why the
   * "Бүлэг" select on Ирцийн дэлгэрэнгүй showed nothing for the one role that
   * screen is gated to (`@Roles("ADMIN", "ACCOUNTANT")` on the register).
   *
   * It grants nothing new: `/attendance/register` already answers an
   * accountant with a `groups` array carrying every class's name and counts,
   * and `/funding` with a row each. They could read the names and not pick
   * one. `wholeRosterKindergartenIds` is the authz module's own predicate
   * rather than a role test re-derived here (§1.1).
   */
  async listGroups(actor: Actor, query: ListGroupsQuery) {
    const wholeRoster = this.tenants.wholeRosterKindergartenIds(actor);
    const readsWholeRoster = query.kindergartenId
      ? wholeRoster.includes(query.kindergartenId)
      : wholeRoster.length > 0;

    const groupIds = readsWholeRoster
      ? undefined
      : await this.authz.loadActiveTeachingGroupIds(actor);

    const page: PageParams = { page: query.page, pageSize: query.pageSize };
    const { items, total } = await this.repo.listGroups(
      this.memberScope(actor),
      {
        kindergartenId: query.kindergartenId,
        schoolYearId: query.schoolYearId,
        status: query.status,
        programKind: query.programKind,
        groupIds,
      },
      page,
    );

    return paginate(items, total, page);
  }

  async getGroup(actor: Actor, id: string) {
    const group = await this.repo.findGroup(this.memberScope(actor), id);
    if (!group) throw new NotFoundException();

    /*
      Membership in the kindergarten is not enough: a teacher may only open a
      group they are assigned to. An accountant is not a teacher — they read
      every class on the register and the funding sheet — so they pass here for
      the same reason `listGroups` no longer narrows them.
    */
    if (!this.tenants.wholeRosterKindergartenIds(actor).includes(group.kindergartenId)) {
      const assigned = await this.authz.loadActiveTeachingGroupIds(actor);
      if (!assigned.includes(group.id)) throw new NotFoundException();
    }

    return group;
  }

  async createGroup(actor: Actor, kindergartenId: string, dto: CreateGroupDto) {
    await this.tenants.assertCanSetUpWorkspace(actor, kindergartenId);

    // The school year must belong to the same kindergarten. Without this check
    // an admin could attach a group to another kindergarten's year by id.
    const year = await this.repo.findSchoolYear(await this.workspaceScope(actor), dto.schoolYearId);
    if (!year || year.kindergartenId !== kindergartenId) {
      throw new BadRequestException("Хичээлийн жил олдсонгүй");
    }
    // A solo teacher works with one group a school year (the user, 2026-10-11, 10-14).
    await this.solo.assertCanAddGroup(kindergartenId, dto.schoolYearId);

    /*
      ★ A solo teacher who opens their group teaches it at once — there is no
      director to assign them, and a teacher reaches a group only through an
      assignment. Created with the group, so neither exists without the other.
    */
    const teacherMembershipId = this.tenants.isAdmin(actor, kindergartenId)
      ? null
      : (actor.memberships.find((m) => m.kindergartenId === kindergartenId && m.role === "TEACHER")
          ?.id ?? null);

    const created = await this.repo.createGroup(
      {
        kindergartenId,
        schoolYearId: dto.schoolYearId,
        name: dto.name,
        ageBand: dto.ageBand,
        programKind: dto.programKind,
        attendanceForm: dto.attendanceForm,
      },
      teacherMembershipId,
    );

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
    const existing = await this.repo.findGroup(await this.workspaceScope(actor), id);
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
    const existing = await this.repo.findGroup(await this.workspaceScope(actor), id);
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

  /**
   * Moves a group's children into another group — Order А/261, Annex 2 §1
   * item 9, "анги дэвших болон давтан суралцах".
   *
   * ★ Which of the two it was is derived, not asked for.
   *
   * The order distinguishes moving up from repeating a year, and a request
   * field for it would be a second source of the same fact: a director could
   * send `PROMOTED` while choosing a target group in the same age band, and the
   * register would then disagree with itself. The age bands already say which
   * happened, so they decide.
   *
   * ★★ Both groups are loaded through the workspace scope (an administrator's
   * kindergartens, a solo teacher's own workspace), so promoting into a
   * kindergarten one does not set up is a 404 from the load rather than a
   * partially applied move.
   */
  async promoteGroup(actor: Actor, fromGroupId: string, dto: PromoteGroupDto) {
    const scope = await this.workspaceScope(actor);
    const from = await this.repo.findGroup(scope, fromGroupId);
    if (!from) throw new NotFoundException();

    const to = await this.repo.findGroup(scope, dto.toGroupId);
    // 400 rather than 404: the *source* group is the addressed resource and the
    // caller may reach it. The target is a value in the body, and a bad value
    // in a body is a bad request — the same shape `createGroup` uses when the
    // school year does not belong to the kindergarten.
    if (!to || to.kindergartenId !== from.kindergartenId) {
      throw new BadRequestException("Хүлээн авах бүлэг олдсонгүй");
    }
    if (to.id === from.id) {
      throw new BadRequestException("Хүүхдийг байгаа бүлэгт нь дэвшүүлэх боломжгүй");
    }

    const enrollments = await this.repo.listActiveEnrollmentsInGroup(fromGroupId, dto.childIds);
    if (enrollments.length === 0) {
      throw new BadRequestException("Дэвшүүлэх хүүхэд олдсонгүй");
    }

    // Same band means the child stayed where they were another year.
    const outcome = from.ageBand === to.ageBand ? "REPEATED" : "PROMOTED";
    const on = dto.startedOn ?? new Date();

    const created = await this.repo.promoteEnrollments({
      enrollmentIds: enrollments.map((e) => e.id),
      childIds: enrollments.map((e) => e.childId),
      kindergartenId: from.kindergartenId,
      toGroupId: to.id,
      toSchoolYearId: to.schoolYearId,
      outcome,
      on,
    });

    // One row per child, not one for the batch. `AuditLog.objectId` names a
    // single record, and "who moved this child, and when" is the question the
    // log is read with — a single row naming a group cannot answer it.
    for (const enrollment of created) {
      await this.audit.append({
        action: "UPDATE",
        kindergartenId: from.kindergartenId,
        actorUserId: actor.userId,
        objectType: "Enrollment",
        objectId: enrollment.id,
        childId: enrollment.childId,
        metadata: { change: "promoted", outcome, fromGroupId, toGroupId: to.id },
      });
    }

    return { outcome, movedCount: created.length, groupId: to.id };
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

  // ── PE/music teacher assignments ──────────────────────────────────────────

  /**
   * Assigns a Биеийн тамирын / Хөгжмийн багш to a group (2026-10-15).
   *
   * ★ `GroupSpecialist`, never `GroupTeacher` — see the schema. The membership
   * must be PE_TEACHER or MUSIC_TEACHER in the group's own kindergarten; a
   * class teacher is assigned through `assignTeacher`. Admins only.
   */
  async assignSpecialist(actor: Actor, groupId: string, dto: AssignSpecialistDto) {
    const group = await this.repo.findGroup(this.adminScope(actor), groupId);
    if (!group) throw new NotFoundException();

    const membership = await this.repo.findSpecialistMembership(
      dto.membershipId,
      group.kindergartenId,
    );
    if (!membership) throw new BadRequestException("Биеийн тамирын эсвэл хөгжмийн багш олдсонгүй");

    if (await this.repo.findActiveSpecialistAssignment(groupId, dto.membershipId)) {
      throw new ConflictException("Энэ багш аль хэдийн энэ бүлэгт хуваарилагдсан байна");
    }

    const assignment = await this.repo.assignSpecialist({
      kindergartenId: group.kindergartenId,
      groupId,
      membershipId: dto.membershipId,
    });

    await this.audit.append({
      action: "PERMISSION_CHANGE",
      kindergartenId: group.kindergartenId,
      actorUserId: actor.userId,
      objectType: "GroupSpecialist",
      objectId: assignment.id,
      metadata: { groupId, membershipId: dto.membershipId, change: "assigned" },
    });
    return assignment;
  }

  async listSpecialists(actor: Actor, groupId: string) {
    const group = await this.repo.findGroup(this.adminScope(actor), groupId);
    if (!group) throw new NotFoundException();

    const rows = await this.repo.listGroupSpecialists(groupId);
    return rows.map((row) => ({
      id: row.id,
      membershipId: row.membershipId,
      role: row.membership.role,
      user: row.membership.user,
      startedOn: row.startedOn?.toISOString().slice(0, 10) ?? null,
    }));
  }

  /** Ends a PE/music teacher's group — access stops on their next request. */
  async endSpecialistAssignment(actor: Actor, assignmentId: string) {
    const assignment = await this.repo.findSpecialistAssignment(
      this.adminScope(actor),
      assignmentId,
    );
    if (!assignment) throw new NotFoundException();

    const ended = await this.repo.endSpecialistAssignment(assignmentId);
    await this.audit.append({
      action: "PERMISSION_CHANGE",
      kindergartenId: assignment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "GroupSpecialist",
      objectId: assignmentId,
      metadata: { change: "revoked", before: { endedOn: null } },
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
