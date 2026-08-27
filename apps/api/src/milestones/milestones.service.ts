import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { MilestonesRepository } from "./milestones.repository";
import type { CreateMilestoneDto, UpdateMilestoneDto } from "./milestones.dto";

/** A family accumulates a handful of firsts; this is a guard against a script. */
const MAX_MILESTONES_PER_CHILD = 200;

@Injectable()
export class MilestonesService {
  constructor(
    private readonly repo: MilestonesRepository,
    private readonly childAccess: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  async list(actor: Actor, childId: string) {
    await this.childAccess.assertCanAccess(actor, childId);
    return this.repo.listForChild(childId);
  }

  /**
   * ★ Guardians record, and that is the point of the feature.
   *
   * RFP §4.5 sits under §4, the child's portfolio, and §2.3 lists "Хүүхдийн
   * онцгой үйл явдал, milestone бүртгэх" among what a parent does. So this uses
   * the album's predicate rather than the staff-only `assertCanRecord`. Staff
   * may record one too — a teacher who watched the first steps at nursery is
   * exactly who would.
   */
  async create(actor: Actor, childId: string, dto: CreateMilestoneDto) {
    const facts = await this.childAccess.assertCanContributeMedia(actor, childId);

    const occurredOn = new Date(`${dto.occurredOn}T00:00:00.000Z`);
    if (occurredOn.getTime() > Date.now()) {
      throw new BadRequestException("Огноо ирээдүйд байж болохгүй");
    }

    if ((await this.repo.countForChild(childId)) >= MAX_MILESTONES_PER_CHILD) {
      throw new BadRequestException(
        `Нэг хүүхдэд дээд тал нь ${MAX_MILESTONES_PER_CHILD} онцгой үйл явдал бүртгэнэ`,
      );
    }

    const saved = await this.repo.create({
      childId,
      kindergartenId: facts.childKindergartenId,
      kind: dto.kind,
      title: dto.title?.trim() || null,
      occurredOn,
      description: dto.description ?? null,
      // From the authenticated actor, never the body: a milestone says who
      // remembered it, and a client-supplied author is one anyone could forge.
      recordedById: actor.userId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "Milestone",
      objectId: saved.id,
      childId,
      metadata: { kind: dto.kind, byGuardian: isGuardianOf(actor, facts) },
    });

    return saved;
  }

  /**
   * ★ Only the person who recorded it may edit it — unless they are staff.
   *
   * A guardian's memory is theirs to correct and not another family member's to
   * rewrite; a teacher correcting a date on the kindergarten's record is
   * ordinary administration. Without the author check, any guardian of the same
   * child could silently rewrite what the other one wrote, which is the sort of
   * thing that surfaces during a custody dispute.
   */
  async update(actor: Actor, id: string, dto: UpdateMilestoneDto) {
    const milestone = await this.repo.findForAuthorization(id);
    if (!milestone) throw new NotFoundException();

    const facts = await this.childAccess.assertCanContributeMedia(actor, milestone.childId);
    const isGuardian = isGuardianOf(actor, facts);

    if (isGuardian && milestone.recordedById !== actor.userId) {
      // 404, not 403: which milestones exist is not something to confirm.
      throw new NotFoundException();
    }

    const data: Record<string, unknown> = {};
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.title !== undefined) data.title = dto.title?.trim() || null;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.occurredOn !== undefined) {
      const occurredOn = new Date(`${dto.occurredOn}T00:00:00.000Z`);
      if (occurredOn.getTime() > Date.now()) {
        throw new BadRequestException("Огноо ирээдүйд байж болохгүй");
      }
      data.occurredOn = occurredOn;
    }

    const saved = await this.repo.update(id, data);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: milestone.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Milestone",
      objectId: id,
      childId: milestone.childId,
      metadata: { fields: Object.keys(data) },
    });

    return saved;
  }

  /** Same rule as editing: your own, or staff. Soft delete — CLAUDE.md §3.2. */
  async remove(actor: Actor, id: string) {
    const milestone = await this.repo.findForAuthorization(id);
    if (!milestone) throw new NotFoundException();

    const facts = await this.childAccess.assertCanContributeMedia(actor, milestone.childId);
    if (isGuardianOf(actor, facts) && milestone.recordedById !== actor.userId) {
      throw new NotFoundException();
    }

    await this.repo.softDelete(id);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: milestone.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Milestone",
      objectId: id,
      childId: milestone.childId,
    });

    return { id };
  }
}
