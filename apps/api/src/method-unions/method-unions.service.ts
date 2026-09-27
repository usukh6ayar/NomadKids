import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { paginate, type PageParams } from "../common/pagination";
import { MethodUnionsRepository } from "./method-unions.repository";
import type {
  CreateMethodUnionDto,
  ListMethodUnionsQuery,
  UpdateMethodUnionDto,
} from "./method-unions.dto";

type Person = { id: string; userId: string; user: { lastName: string; firstName: string } };

type UnionRow = {
  id: string;
  kindergartenId: string;
  name: string;
  schoolYear: { id: string; name: string };
  lead: Person | null;
  startsOn: Date;
  endsOn: Date | null;
  esisAcademicOrgId: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { members: number };
};

const day = (value: Date) => value.toISOString().slice(0, 10);
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const person = (row: Person) => ({
  membershipId: row.id,
  userId: row.userId,
  lastName: row.user.lastName,
  firstName: row.user.firstName,
});

function present(row: UnionRow) {
  return {
    id: row.id,
    kindergartenId: row.kindergartenId,
    name: row.name,
    schoolYear: row.schoolYear,
    lead: row.lead ? person(row.lead) : null,
    startsOn: day(row.startsOn),
    endsOn: row.endsOn ? day(row.endsOn) : null,
    esisAcademicOrgId: row.esisAcademicOrgId,
    memberCount: row._count.members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function presentSeat(seat: { id: string; createdAt: Date; membership: Person }) {
  return { id: seat.id, createdAt: seat.createdAt.toISOString(), ...person(seat.membership) };
}

/**
 * «Заах аргын нэгдэл» — administrator-only.
 *
 * ★ Every route is `assertAdmin` against the **row's** kindergarten, never the
 * path's alone: a union or seat id pasted from another kindergarten reads as
 * 404, which is CLAUDE.md §1.7's answer for a record the actor may not know
 * exists. Every write is audited; reads are not, as with every other staff
 * directory in this product.
 */
@Injectable()
export class MethodUnionsService {
  constructor(
    private readonly repo: MethodUnionsRepository,
    private readonly tenants: TenantAccessService,
    private readonly audit: AuditRepository,
  ) {}

  async list(actor: Actor, kindergartenId: string, query: ListMethodUnionsQuery, page: PageParams) {
    this.tenants.assertAdmin(actor, kindergartenId);
    const { items, total } = await this.repo.list(
      kindergartenId,
      { q: query.q, schoolYearId: query.schoolYearId },
      page,
    );
    return paginate(items.map(present), total, page);
  }

  async get(actor: Actor, id: string) {
    const union = await this.repo.findById(id);
    if (!union) throw new NotFoundException();
    this.tenants.assertAdmin(actor, union.kindergartenId);
    return { ...present(union), members: union.members.map(presentSeat) };
  }

  async create(actor: Actor, kindergartenId: string, dto: CreateMethodUnionDto) {
    this.tenants.assertAdmin(actor, kindergartenId);
    await this.requireSchoolYear(dto.schoolYearId, kindergartenId);
    if (dto.leadMembershipId) await this.requireTeacher(dto.leadMembershipId, kindergartenId);

    const created = await this.repo.create({
      kindergartenId,
      name: dto.name,
      schoolYearId: dto.schoolYearId,
      leadMembershipId: dto.leadMembershipId ?? null,
      startsOn: toDate(dto.startsOn),
      endsOn: dto.endsOn ? toDate(dto.endsOn) : null,
      esisAcademicOrgId: dto.esisAcademicOrgId ?? null,
    });
    const result = present(created);

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "MethodUnion",
      objectId: created.id,
      metadata: { after: auditable(result) },
    });

    return result;
  }

  async update(actor: Actor, id: string, dto: UpdateMethodUnionDto) {
    const current = await this.requireUnion(actor, id);
    const kindergartenId = current.kindergartenId;

    if (dto.schoolYearId) await this.requireSchoolYear(dto.schoolYearId, kindergartenId);
    if (dto.leadMembershipId) await this.requireTeacher(dto.leadMembershipId, kindergartenId);

    // One end of the range can change alone, so the order is checked against
    // whatever the other end will be once this edit lands.
    const startsOn = dto.startsOn ?? day(current.startsOn);
    const endsOn =
      dto.endsOn !== undefined ? dto.endsOn : current.endsOn ? day(current.endsOn) : null;
    if (endsOn && endsOn < startsOn) {
      throw new BadRequestException("Дуусах огноо эхлэх огнооноос өмнө байж болохгүй");
    }

    const data: Parameters<MethodUnionsRepository["update"]>[1] = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.schoolYearId !== undefined) data.schoolYearId = dto.schoolYearId;
    if (dto.leadMembershipId !== undefined) data.leadMembershipId = dto.leadMembershipId;
    if (dto.startsOn !== undefined) data.startsOn = toDate(dto.startsOn);
    if (dto.endsOn !== undefined) data.endsOn = dto.endsOn ? toDate(dto.endsOn) : null;
    if (dto.esisAcademicOrgId !== undefined) data.esisAcademicOrgId = dto.esisAcademicOrgId;

    const before = present(current);
    const saved = present(await this.repo.update(id, data));

    await this.audit.append({
      action: "UPDATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "MethodUnion",
      objectId: id,
      metadata: { before: auditable(before), after: auditable(saved) },
    });

    return saved;
  }

  async remove(actor: Actor, id: string) {
    const current = await this.requireUnion(actor, id);
    await this.repo.softDelete(id);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: current.kindergartenId,
      actorUserId: actor.userId,
      objectType: "MethodUnion",
      objectId: id,
      metadata: { before: auditable(present(current)) },
    });

    return { id };
  }

  async addMember(actor: Actor, unionId: string, membershipId: string) {
    const union = await this.requireUnion(actor, unionId);
    await this.requireTeacher(membershipId, union.kindergartenId);

    if (await this.repo.findLiveSeat(unionId, membershipId)) {
      throw new ConflictException("Энэ багш нэгдэлд аль хэдийн байна");
    }

    let seat;
    try {
      seat = await this.repo.addMember({
        kindergartenId: union.kindergartenId,
        unionId,
        membershipId,
      });
    } catch (error) {
      // Two admins adding the same teacher at once: the partial unique index
      // settles it, and the loser hears what the check above would have said.
      if (isUniqueViolation(error)) {
        throw new ConflictException("Энэ багш нэгдэлд аль хэдийн байна");
      }
      throw error;
    }

    await this.audit.append({
      action: "CREATE",
      kindergartenId: union.kindergartenId,
      actorUserId: actor.userId,
      objectType: "MethodUnionMember",
      objectId: seat.id,
      metadata: { unionId, membershipId },
    });

    return presentSeat(seat);
  }

  async removeMember(actor: Actor, id: string) {
    const seat = await this.repo.findMember(id);
    if (!seat) throw new NotFoundException();
    this.tenants.assertAdmin(actor, seat.kindergartenId);

    await this.repo.removeMember(id);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: seat.kindergartenId,
      actorUserId: actor.userId,
      objectType: "MethodUnionMember",
      objectId: id,
      metadata: { before: { unionId: seat.unionId, membershipId: seat.membershipId } },
    });

    return { id };
  }

  /**
   * Loads a union and proves the actor administers its kindergarten. The
   * tenant is read from the row, which is what makes a pasted id a 404.
   */
  private async requireUnion(actor: Actor, id: string) {
    const union = await this.repo.findById(id);
    if (!union) throw new NotFoundException();
    this.tenants.assertAdmin(actor, union.kindergartenId);
    return union;
  }

  private async requireSchoolYear(id: string, kindergartenId: string) {
    if (!(await this.repo.findSchoolYear(id, kindergartenId))) {
      throw new BadRequestException("Хичээлийн жил олдсонгүй");
    }
  }

  /**
   * 400, not 404: the actor has already proved they administer this
   * kindergarten, and what is wrong is the body they sent — a membership that
   * is not an active teacher here, whether it exists elsewhere or not.
   */
  private async requireTeacher(membershipId: string, kindergartenId: string) {
    if (!(await this.repo.findActiveTeacher(membershipId, kindergartenId))) {
      throw new BadRequestException("Энэ цэцэрлэгийн идэвхтэй багш биш байна");
    }
  }
}

/** What the audit row keeps — the fields an edit can change, not the counts. */
function auditable(union: ReturnType<typeof present>) {
  return {
    name: union.name,
    schoolYearId: union.schoolYear.id,
    leadMembershipId: union.lead?.membershipId ?? null,
    startsOn: union.startsOn,
    endsOn: union.endsOn,
    esisAcademicOrgId: union.esisAcademicOrgId,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
