import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { StaffRepository } from "./staff.repository";
import type {
  CreateStaffRecordDto,
  ListStaffRecordsQuery,
  UpdateStaffRecordDto,
} from "./staff.dto";

/**
 * Хүний нөөц — a member of staff's experience, certificates and grades.
 * Order А/261, criterion 51.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly repo: StaffRepository,
    private readonly tenants: TenantAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * One person's file — the administrator's view of anybody, or a member of
   * staff's view of themselves.
   *
   * ★ 404, not 403, for someone else's file. §1.7's rule is written about
   * child data, and the reasoning transfers exactly: a teacher who gets a 403
   * asking for a colleague's records has learned that the colleague has some,
   * which is the fact the permission was protecting.
   */
  async list(
    actor: Actor,
    kindergartenId: string,
    userId: string,
    query: ListStaffRecordsQuery,
  ) {
    this.tenants.assertCanReadStaffRecords(actor, kindergartenId, userId);
    return this.repo.listForUser(kindergartenId, userId, query.kind);
  }

  /**
   * ★ Administrator only — see `assertCanManageStaffRecords`.
   *
   * ★★ The staff check is not redundant with it. The authorization gate
   * answers "may this actor write staff records **here**"; `isStaffMember`
   * answers "is this subject one of *our* staff". Without the second, an
   * administrator could file a certificate against any user id in the system —
   * a guardian's, or a teacher employed elsewhere — and that person would then
   * read it back under `canReadStaffRecords`'s own-file branch, from a
   * kindergarten they have nothing to do with.
   */
  async create(
    actor: Actor,
    kindergartenId: string,
    userId: string,
    dto: CreateStaffRecordDto,
  ) {
    this.tenants.assertCanManageStaffRecords(actor, kindergartenId);

    if (!(await this.repo.isStaffMember(kindergartenId, userId))) {
      throw new BadRequestException("Энэ хэрэглэгч тус цэцэрлэгийн ажилтан биш байна");
    }

    const saved = await this.repo.create({
      kindergartenId,
      userId,
      kind: dto.kind,
      title: dto.title,
      issuer: dto.issuer ?? null,
      documentNo: dto.documentNo ?? null,
      note: dto.note ?? null,
      startedOn: toDate(dto.startedOn),
      endedOn: dto.endedOn ? toDate(dto.endedOn) : null,
      createdById: actor.userId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "StaffRecord",
      objectId: saved.id,
      /*
       * The kind and the title, not the note. `нэмэлт.md` §14 asks the audit
       * trail to say what changed; it does not ask for a second permanent
       * copy of free text about a named person in a table nobody can correct.
       */
      metadata: { kind: dto.kind, title: dto.title, subjectUserId: userId },
    });

    return saved;
  }

  async update(actor: Actor, id: string, dto: UpdateStaffRecordDto) {
    const record = await this.repo.find(id);
    if (!record) throw new NotFoundException();
    this.tenants.assertCanManageStaffRecords(actor, record.kindergartenId);

    const data: Record<string, unknown> = {};
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.issuer !== undefined) data.issuer = dto.issuer;
    if (dto.documentNo !== undefined) data.documentNo = dto.documentNo;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.startedOn !== undefined) data.startedOn = toDate(dto.startedOn);
    // `null` reopens a post the person turned out not to have left.
    if (dto.endedOn !== undefined) data.endedOn = dto.endedOn ? toDate(dto.endedOn) : null;

    const saved = await this.repo.update(id, data);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: record.kindergartenId,
      actorUserId: actor.userId,
      objectType: "StaffRecord",
      objectId: id,
      metadata: { fields: Object.keys(data), subjectUserId: record.userId },
    });

    return saved;
  }

  async remove(actor: Actor, id: string) {
    const record = await this.repo.find(id);
    if (!record) throw new NotFoundException();
    this.tenants.assertCanManageStaffRecords(actor, record.kindergartenId);

    await this.repo.softDelete(id);
    await this.audit.append({
      action: "DELETE",
      kindergartenId: record.kindergartenId,
      actorUserId: actor.userId,
      objectType: "StaffRecord",
      objectId: id,
      metadata: { subjectUserId: record.userId },
    });

    return { id };
  }
}

/** `@db.Date` is UTC midnight — the same conversion every dated record uses. */
function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
