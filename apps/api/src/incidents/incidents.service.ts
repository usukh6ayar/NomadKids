import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { NotificationsService } from "../notifications/notifications.service";
import { paginate, toSkipTake, type PageParams } from "../common/pagination";
import { IncidentsRepository } from "./incidents.repository";
import type {
  CreateIncidentDto,
  ListIncidentsQuery,
  ReportIncidentDto,
  UpdateIncidentDto,
} from "./incidents.dto";

@Injectable()
export class IncidentsService {
  constructor(
    private readonly repo: IncidentsRepository,
    private readonly childAccess: ChildAccessService,
    private readonly tenants: TenantAccessService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * One child's incidents. Staff and the family alike.
   *
   * ★ A family sees an incident before it is formally reported.
   *
   * `reportedAt` tracks whether a notice was *sent*, not whether the record is
   * visible: a parent who opens the app before the teacher writes the message
   * must not find their child's injury hidden from them. RFP Module 2.1 is
   * about telling families quickly, not about staging what they may know.
   */
  async listForChild(actor: Actor, childId: string) {
    await this.childAccess.assertCanAccess(actor, childId);
    return this.repo.listForChild(childId);
  }

  /** The kindergarten's log, and the queue of incidents nobody has reported. */
  async listForKindergarten(
    actor: Actor,
    kindergartenId: string,
    query: ListIncidentsQuery,
    page: PageParams,
  ) {
    this.tenants.assertStaff(actor, kindergartenId);

    const { skip, take } = toSkipTake(page);
    const { items, total } = await this.repo.listForKindergarten(
      kindergartenId,
      { unreportedOnly: query.unreportedOnly, highPriorityOnly: query.highPriorityOnly },
      { skip, take },
    );

    return paginate(items, total, page);
  }

  /** Staff only — this is the kindergarten's account of what happened. */
  async create(actor: Actor, childId: string, dto: CreateIncidentDto) {
    const facts = await this.childAccess.assertCanRecord(actor, childId);

    const saved = await this.repo.create({
      childId,
      kindergartenId: facts.childKindergartenId,
      kind: dto.kind,
      occurredAt: dto.occurredAt,
      location: dto.location ?? null,
      bodyPart: dto.bodyPart ?? null,
      description: dto.description,
      firstAid: dto.firstAid ?? null,
      followUp: dto.followUp ?? null,
      isHighPriority: dto.isHighPriority,
      recordedById: actor.userId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "SafetyIncident",
      objectId: saved.id,
      childId,
      metadata: { kind: dto.kind, isHighPriority: dto.isHighPriority },
    });

    return saved;
  }

  async update(actor: Actor, id: string, dto: UpdateIncidentDto) {
    const incident = await this.repo.findForAuthorization(id);
    if (!incident) throw new NotFoundException();
    await this.childAccess.assertCanRecord(actor, incident.childId);

    const data: Record<string, unknown> = {};
    for (const key of [
      "kind",
      "occurredAt",
      "location",
      "bodyPart",
      "description",
      "firstAid",
      "followUp",
      "isHighPriority",
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }

    const saved = await this.repo.update(id, data);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: incident.kindergartenId,
      actorUserId: actor.userId,
      objectType: "SafetyIncident",
      objectId: id,
      childId: incident.childId,
      metadata: { fields: Object.keys(data) },
    });

    return saved;
  }

  /**
   * Tell the family — RFP Module 2.1's "эцэг эхэд шуурхай мэдээлэх".
   *
   * ★ Creates a notice targeted at this child and publishes it in one step.
   *
   * The existing notification machinery already handles delivery, read
   * receipts and the parent's unread badge, and Module 2.1 also asks for
   * "Илгээлтийн бүртгэл … эцэг эх хэзээ уншсан". Building a second delivery
   * path beside it would mean two places that decide who sees what — and only
   * one of them would get the read receipt.
   *
   * ★★ Published immediately rather than left as a draft. A safety notice
   * sitting unpublished is the failure this feature exists to prevent, and a
   * draft is indistinguishable from having told nobody.
   *
   * ★★★ Reporting twice is refused. `reportedAt` is the record that the family
   * was told and by which notice; overwriting it would orphan the first notice
   * and lose the time that matters. A correction is a new notice on the class
   * board, which is a deliberate act rather than a silent overwrite.
   */
  async report(actor: Actor, id: string, dto: ReportIncidentDto) {
    const incident = await this.repo.findForAuthorization(id);
    if (!incident) throw new NotFoundException();
    await this.childAccess.assertCanRecord(actor, incident.childId);

    if (incident.reportedAt) {
      throw new BadRequestException("Энэ тохиолдлыг аль хэдийн эцэг эхэд мэдэгдсэн байна");
    }

    const notification = await this.notifications.create(actor, incident.kindergartenId, {
      title: dto.title,
      body: dto.body,
      /*
       * ★ ANNOUNCEMENT, not OTHER.
       *
       * A safety incident told to a family is an announcement in the client's
       * own taxonomy: something happened and you are being informed. Leaving it
       * to the DTO's `OTHER` default would file the most consequential notice
       * this product sends under "none of the above", and a parent filtering
       * their board to Зарлал would not see it.
       */
      category: "ANNOUNCEMENT" as const,
      // An incident notice is important by definition — that is what
      // distinguishes it from the class board.
      isImportant: true,
      startsOn: null,
      endsOn: null,
      // Addressed to this child's family alone. A safety incident is not class
      // news, and naming the child to the whole group would be the leak this
      // system spends most of its rules preventing.
      targets: [{ childId: incident.childId }],
    });

    await this.notifications.publish(actor, notification.id);
    const saved = await this.repo.markReported(id, notification.id, new Date());

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: incident.kindergartenId,
      actorUserId: actor.userId,
      objectType: "SafetyIncident",
      objectId: id,
      childId: incident.childId,
      metadata: { reported: true, notificationId: notification.id },
    });

    return saved;
  }

  async remove(actor: Actor, id: string) {
    const incident = await this.repo.findForAuthorization(id);
    if (!incident) throw new NotFoundException();
    await this.childAccess.assertCanRecord(actor, incident.childId);

    await this.repo.softDelete(id);
    await this.audit.append({
      action: "DELETE",
      kindergartenId: incident.kindergartenId,
      actorUserId: actor.userId,
      objectType: "SafetyIncident",
      objectId: id,
      childId: incident.childId,
    });

    return { id };
  }
}
