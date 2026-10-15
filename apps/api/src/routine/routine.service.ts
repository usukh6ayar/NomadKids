import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CLUBS_PER_GROUP_MAX,
  type AreaPlan,
  type ClubInput,
  type NewClubRequest,
  type Routine,
  type RoutineItem,
} from "@kinder/contracts";
import type { Actor } from "../authz/actor";
import { ChildAccessService } from "../authz/child-access.service";
import { GroupAccessService } from "../authz/group-access.service";
import { AuditRepository } from "../audit/audit.repository";
import { MediaService } from "../media/media.service";
import { RoutineRepository, type ClubData } from "./routine.repository";
import { clubView, requestView, routineView } from "./routine.view";

/**
 * Өдрийн дэглэм · судлагдахуун · дугуйлан (client, 2026-10-09).
 *
 * Who does what, decided in `authz/` and only called from here:
 *   - the group's own teacher keeps the routine and the clubs and decides
 *     requests — `assertTeachesGroup`;
 *   - the director reads — `assertCanReadGroup`;
 *   - a family reads their child's group and asks to join — the child's
 *     access checks, the fee gate included.
 */
@Injectable()
export class RoutineService {
  constructor(
    private readonly repo: RoutineRepository,
    private readonly groups: GroupAccessService,
    private readonly childAccess: ChildAccessService,
    private readonly audit: AuditRepository,
    private readonly media: MediaService,
  ) {}

  /**
   * ★ Every photograph a routine row or a club names must be this
   * kindergarten's own upload through the menu's photo route (`MENU_DISH`) —
   * the check `MealsService.saveDay` makes for a dish. Otherwise a guessed id
   * (a child's private photo, another kindergarten's file) would be shown to
   * every family of the group (№21).
   */
  private async assertKindergartenPhotos(
    kindergartenId: string,
    ids: (string | null | undefined)[],
  ) {
    for (const id of new Set(ids.filter((value): value is string => Boolean(value)))) {
      if (!(await this.media.isMenuDishPhoto(kindergartenId, id))) {
        throw new BadRequestException("Зураг олдсонгүй. Дахин оруулна уу.");
      }
    }
  }

  async forGroup(actor: Actor, groupId: string): Promise<Routine> {
    const group = await this.groups.assertCanReadGroup(actor, groupId);
    return this.build(group, await this.repo.listGroupRequests(group.id));
  }

  /**
   * The routine of the child's group **now** — the active enrollment, never
   * `Child.kindergartenId` (CLAUDE.md §1.2). A child in no group: 404.
   */
  async forChild(actor: Actor, childId: string): Promise<Routine> {
    await this.childAccess.assertCanAccess(actor, childId);
    const group = await this.repo.currentGroup(childId);
    if (!group) throw new NotFoundException();
    return this.build(group, await this.repo.listChildRequests(childId, group.id));
  }

  async saveItems(actor: Actor, groupId: string, items: RoutineItem[]): Promise<Routine> {
    const group = await this.groups.assertTeachesGroup(actor, groupId);
    await this.assertKnownAreas(
      group.kindergartenId,
      items.flatMap((i) => i.areas),
    );
    await this.assertKindergartenPhotos(
      group.kindergartenId,
      items.map((i) => i.photoMediaFileId),
    );
    const sorted = [...items].sort((x, y) => x.start.localeCompare(y.start));
    const row = await this.repo.saveRoutine(group.kindergartenId, group.id, { items: sorted });
    await this.record(actor, group.kindergartenId, "UPDATE", "GroupRoutine", row.id, {
      part: "items",
      count: sorted.length,
    });
    return this.forGroup(actor, groupId);
  }

  async savePlan(actor: Actor, groupId: string, plan: AreaPlan[]): Promise<Routine> {
    const group = await this.groups.assertTeachesGroup(actor, groupId);
    await this.assertKnownAreas(
      group.kindergartenId,
      plan.map((p) => p.area),
    );
    if (new Set(plan.map((p) => p.area)).size !== plan.length) {
      throw new BadRequestException("Нэг судлагдахуун хоёр удаа орсон байна.");
    }
    const row = await this.repo.saveRoutine(group.kindergartenId, group.id, { plan });
    await this.record(actor, group.kindergartenId, "UPDATE", "GroupRoutine", row.id, {
      part: "plan",
    });
    return this.forGroup(actor, groupId);
  }

  async createClub(actor: Actor, groupId: string, input: ClubInput) {
    const group = await this.groups.assertTeachesGroup(actor, groupId);
    await this.assertKnownAreas(group.kindergartenId, input.areas);
    await this.assertKindergartenPhotos(group.kindergartenId, [input.photoMediaFileId]);
    if ((await this.repo.countClubs(group.id)) >= CLUBS_PER_GROUP_MAX) {
      throw new BadRequestException(
        `Нэг бүлэг ${CLUBS_PER_GROUP_MAX}-аас олон дугуйлантай байж болохгүй.`,
      );
    }
    const club = await this.repo.createClub(group.kindergartenId, group.id, clubData(input));
    await this.record(actor, group.kindergartenId, "CREATE", "Club", club.id);
    return clubView(club);
  }

  async updateClub(actor: Actor, groupId: string, clubId: string, input: ClubInput) {
    const group = await this.groups.assertTeachesGroup(actor, groupId);
    const before = await this.repo.findClub(clubId, group.id);
    if (!before) throw new NotFoundException();
    await this.assertKnownAreas(group.kindergartenId, input.areas);
    await this.assertKindergartenPhotos(group.kindergartenId, [input.photoMediaFileId]);
    const club = await this.repo.updateClub(clubId, clubData(input));
    await this.record(actor, group.kindergartenId, "UPDATE", "Club", club.id);
    return clubView(club);
  }

  /** A soft delete; the club's requests stay, and leave every screen with it. */
  async deleteClub(actor: Actor, groupId: string, clubId: string): Promise<void> {
    const group = await this.groups.assertTeachesGroup(actor, groupId);
    const club = await this.repo.findClub(clubId, group.id);
    if (!club) throw new NotFoundException();
    await this.repo.softDeleteClub(clubId);
    await this.record(actor, group.kindergartenId, "DELETE", "Club", clubId);
  }

  /**
   * A family asks for their child. Only the child's own guardian, and only a
   * club of the group the child is in now — a club id from another group is
   * the same 404 as one that does not exist.
   */
  async requestClub(actor: Actor, childId: string, dto: NewClubRequest) {
    await this.childAccess.assertIsGuardian(actor, childId);
    const group = await this.repo.currentGroup(childId);
    if (!group) throw new NotFoundException();
    const club = await this.repo.findClub(dto.clubId, group.id);
    if (!club) throw new NotFoundException();

    const row = await this.repo.createRequest({
      kindergartenId: club.kindergartenId,
      clubId: club.id,
      childId,
      requestedByUserId: actor.userId,
    });
    if (!row) throw new ConflictException("Энэ дугуйланд хүсэлт аль хэдийн илгээсэн байна.");

    await this.record(actor, club.kindergartenId, "CREATE", "ClubRequest", row.id, {}, childId);
    return requestView(row);
  }

  async decide(actor: Actor, groupId: string, requestId: string, approve: boolean) {
    const group = await this.groups.assertTeachesGroup(actor, groupId);
    const req = await this.repo.findRequestInGroup(requestId, group.id);
    if (!req) throw new NotFoundException();

    const status = approve ? "APPROVED" : "REJECTED";
    if (req.status !== "PENDING" || !(await this.repo.decide(req.id, status, actor.userId))) {
      throw new ConflictException("Энэ хүсэлтийг аль хэдийн шийдвэрлэсэн байна.");
    }
    await this.record(
      actor,
      req.kindergartenId,
      "UPDATE",
      "ClubRequest",
      req.id,
      { before: "PENDING", after: status },
      req.childId,
    );
    return { id: req.id, status };
  }

  private async build(
    group: { id: string; name: string },
    requests: Parameters<typeof requestView>[0][],
  ): Promise<Routine> {
    const [routine, clubs] = await Promise.all([
      this.repo.findRoutine(group.id),
      this.repo.listClubs(group.id),
    ]);
    return routineView(group, routine, clubs, requests);
  }

  /** Every area must be a `DevelopmentDomain` this kindergarten has (§2.3). */
  private async assertKnownAreas(kindergartenId: string, areas: string[]): Promise<void> {
    if (areas.length === 0) return;
    const known = await this.repo.areaNames(kindergartenId);
    const unknown = [...new Set(areas)].filter((a) => !known.has(a));
    if (unknown.length > 0) {
      throw new BadRequestException(`Ийм судлагдахуун алга: ${unknown.join(", ")}`);
    }
  }

  private record(
    actor: Actor,
    kindergartenId: string,
    action: "CREATE" | "UPDATE" | "DELETE",
    objectType: string,
    objectId: string,
    metadata: Record<string, unknown> = {},
    childId: string | null = null,
  ) {
    return this.audit.append({
      action,
      kindergartenId,
      actorUserId: actor.userId,
      objectType,
      objectId,
      childId,
      metadata,
    });
  }
}

function clubData(input: ClubInput): ClubData {
  return {
    name: input.name,
    teacherName: input.teacherName,
    room: input.room || null,
    days: [...new Set(input.days)].sort((x, y) => x - y),
    startTime: input.start,
    endTime: input.end,
    areas: [...new Set(input.areas)],
    goal: input.goal || null,
    description: input.description || null,
    photoMediaFileId: input.photoMediaFileId ?? null,
  };
}
