import { Injectable, NotFoundException } from "@nestjs/common";
import { AuthzRepository } from "./authz.repository";
import { TenantAccessService } from "./tenant-access.service";
import type { Actor } from "./actor";

export interface AccessibleGroup {
  id: string;
  kindergartenId: string;
  name: string;
}

/**
 * Who may reach one group — its register, its routine, its clubs.
 *
 * ★ Lived privately in `AttendanceService` until the routine needed the same
 * answer (2026-10-11). Two copies of "a teacher reaches only the groups they
 * are assigned to" is how the second one ends up more generous than the
 * first — CLAUDE.md §1.1. 404 throughout, never 403 (§1.7).
 */
@Injectable()
export class GroupAccessService {
  constructor(
    private readonly repo: AuthzRepository,
    private readonly tenants: TenantAccessService,
  ) {}

  /**
   * An administrator of the group's kindergarten, or a teacher currently
   * assigned to this group. Membership in the kindergarten alone is not enough.
   */
  async assertCanReadGroup(actor: Actor, groupId: string): Promise<AccessibleGroup> {
    const group = await this.findForMember(actor, groupId);
    if (this.tenants.isAdmin(actor, group.kindergartenId)) return group;
    if (await this.teaches(actor, groupId)) return group;
    throw new NotFoundException();
  }

  /**
   * A teacher currently assigned to this group — and nobody else.
   *
   * ★ Not "admin or teacher". The things this guards (the daily routine, the
   * clubs, a family's club request) are the group teacher's to keep; the
   * director reads them through `assertCanReadGroup`. A person who is ADMIN
   * here and TEACHER of this group passes, as the teacher.
   */
  async assertTeachesGroup(actor: Actor, groupId: string): Promise<AccessibleGroup> {
    const group = await this.findForMember(actor, groupId);
    if (await this.teaches(actor, groupId)) return group;
    throw new NotFoundException();
  }

  /**
   * The group's lead teacher — not its assistant, not the director.
   *
   * ★ «Сарын тэмдэглэл» (2026-10-28, the client): a month of the group's notes
   * in full, to print, is the lead teacher's alone.
   */
  async assertLeadsGroup(actor: Actor, groupId: string): Promise<AccessibleGroup> {
    const group = await this.findForMember(actor, groupId);
    if (await this.repo.isActiveLeadTeacherOf(actor, groupId)) return group;
    throw new NotFoundException();
  }

  /**
   * What a group shares with its families — the staff who may read the group,
   * or a guardian of a child in it now. Used for things addressed to the whole
   * group (the songs-and-poems library), never for one child's record.
   *
   * ★ No fee gate here: the portal fee is per child, and the routes that list
   * a group's content for a family go through `ChildAccessService` first.
   */
  async assertCanReadGroupContent(actor: Actor, groupId: string): Promise<AccessibleGroup> {
    const group = await this.findForMember(actor, groupId);
    if (this.tenants.isAdmin(actor, group.kindergartenId)) return group;
    if (await this.teaches(actor, groupId)) return group;
    if (await this.repo.isGuardianOfChildInGroup(actor.userId, groupId)) return group;
    throw new NotFoundException();
  }

  private async findForMember(actor: Actor, groupId: string): Promise<AccessibleGroup> {
    const group = await this.repo.findGroupInKindergartens(
      groupId,
      this.tenants.memberKindergartenIds(actor),
    );
    if (!group) throw new NotFoundException();
    return group;
  }

  private async teaches(actor: Actor, groupId: string): Promise<boolean> {
    return (await this.repo.loadActiveTeachingGroupIds(actor)).includes(groupId);
  }
}
