import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { ConsentRepository } from "./consent.repository";
import type { RecordConsentDto } from "./consent.dto";

@Injectable()
export class ConsentService {
  constructor(
    private readonly repo: ConsentRepository,
    private readonly childAccess: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * The current answers plus the history — RFP §16.
   *
   * Both are returned because they answer different questions: staff need to
   * know whether they may publish a photograph *today*, and a family is
   * entitled to see what they agreed to and when.
   */
  async get(actor: Actor, childId: string) {
    await this.childAccess.assertCanAccess(actor, childId);

    const [history, dataProcessing, photoPublishing] = await Promise.all([
      this.repo.listForChild(childId),
      this.repo.currentDecision(childId, "DATA_PROCESSING"),
      this.repo.currentDecision(childId, "PHOTO_PUBLISHING"),
    ]);

    return {
      current: {
        // ★ Absent is **not granted**. A family that has never been asked has
        // not agreed, and defaulting the other way would publish a child's
        // photograph on the strength of a missing row.
        dataProcessing: {
          granted: dataProcessing?.granted ?? false,
          decidedAt: dataProcessing?.decidedAt ?? null,
          asked: dataProcessing !== null,
        },
        photoPublishing: {
          granted: photoPublishing?.granted ?? false,
          decidedAt: photoPublishing?.decidedAt ?? null,
          asked: photoPublishing !== null,
        },
      },
      history,
    };
  }

  /**
   * Records a decision — RFP §16.
   *
   * ★ The guardian decides, and `decidedById` is the authenticated actor.
   *
   * Consent given on somebody's behalf is not consent. Staff may *read* it, so
   * they know whether they may publish, and may not write it — which is why
   * this uses the album's predicate and then narrows to guardians, rather than
   * `assertCanRecord`.
   *
   * A new row supersedes rather than updating the old one: the record of what
   * was agreed on a given day is the point of the table.
   */
  async record(actor: Actor, childId: string, dto: RecordConsentDto) {
    const facts = await this.childAccess.assertCanContributeMedia(actor, childId);

    // 404 rather than 403: a member of staff being told "you are not the
    // guardian" is not a distinction worth confirming through this endpoint.
    if (!isGuardianOf(actor, facts)) throw new NotFoundException();

    const saved = await this.repo.create({
      childId,
      kindergartenId: facts.childKindergartenId,
      kind: dto.kind,
      granted: dto.granted,
      decidedById: actor.userId,
      note: dto.note ?? null,
    });

    await this.audit.append({
      action: "PERMISSION_CHANGE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "ConsentRecord",
      objectId: saved.id,
      childId,
      metadata: { kind: dto.kind, granted: dto.granted },
    });

    return saved;
  }

  /** Children whose photographs may not be published — for staff screens. */
  async withheldPhotoConsent(actor: Actor, kindergartenId: string) {
    return this.repo.childrenWithoutPhotoConsent(kindergartenId);
  }
}
