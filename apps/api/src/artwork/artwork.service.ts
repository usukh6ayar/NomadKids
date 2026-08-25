import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import type { Actor } from "../authz/actor";
import { ArtworkRepository } from "./artwork.repository";
import type { CreateComparisonDto, UpdateComparisonDto } from "./artwork.dto";

@Injectable()
export class ArtworkService {
  constructor(
    private readonly repo: ArtworkRepository,
    private readonly childAccess: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /** The child's artwork in time order, and the comparisons drawn from it. */
  async timeline(actor: Actor, childId: string) {
    await this.childAccess.assertCanAccess(actor, childId);

    const [artwork, comparisons] = await Promise.all([
      this.repo.listArtwork(childId),
      this.repo.listComparisons(childId),
    ]);

    return { artwork, comparisons };
  }

  /**
   * Pairs two works and records what changed — RFP §5.3.
   *
   * ★ Staff only. The conclusion is a professional reading of a child's
   * development, in the same class as an observation or an assessment comment,
   * and it appears in the term report under a teacher's name.
   *
   * ★★ The order is decided here, from when each work was made.
   *
   * The caller sends two ids and no labels. A teacher who picked them in the
   * wrong order would otherwise store a comparison that reads as development
   * running backwards — and the sentence they wrote ("хожим нь илүү нарийн")
   * would then sit under the earlier drawing.
   */
  async compare(actor: Actor, childId: string, dto: CreateComparisonDto) {
    const facts = await this.childAccess.assertCanRecord(actor, childId);

    const media = await this.repo.findMediaForComparison(childId, [dto.mediaIdA, dto.mediaIdB]);
    if (media.length !== 2) {
      // Includes the case where one id belongs to another child: a valid id
      // from elsewhere must not pair into this child's record.
      throw new BadRequestException("Бүтээл олдсонгүй");
    }

    const [first, second] = media as [(typeof media)[number], (typeof media)[number]];
    const [earlier, later] = madeAt(first) <= madeAt(second) ? [first, second] : [second, first];

    const saved = await this.repo.create({
      childId,
      kindergartenId: facts.childKindergartenId,
      earlierMediaId: earlier.id,
      laterMediaId: later.id,
      conclusion: dto.conclusion,
      authorId: actor.userId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "ArtworkComparison",
      objectId: saved.id,
      childId,
      metadata: { earlierMediaId: earlier.id, laterMediaId: later.id },
    });

    return saved;
  }

  async update(actor: Actor, id: string, dto: UpdateComparisonDto) {
    const comparison = await this.repo.findById(id);
    if (!comparison) throw new NotFoundException();
    await this.childAccess.assertCanRecord(actor, comparison.childId);

    const saved = await this.repo.update(id, { conclusion: dto.conclusion });

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: comparison.kindergartenId,
      actorUserId: actor.userId,
      objectType: "ArtworkComparison",
      objectId: id,
      childId: comparison.childId,
    });

    return saved;
  }

  async remove(actor: Actor, id: string) {
    const comparison = await this.repo.findById(id);
    if (!comparison) throw new NotFoundException();
    await this.childAccess.assertCanRecord(actor, comparison.childId);

    await this.repo.softDelete(id);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: comparison.kindergartenId,
      actorUserId: actor.userId,
      objectType: "ArtworkComparison",
      objectId: id,
      childId: comparison.childId,
    });

    return { id };
  }
}

/**
 * When the work was made, falling back to when it arrived.
 *
 * `takenAt` only exists on photographs uploaded since the field did, so an
 * older album has nulls throughout — and two nulls compare equal, which leaves
 * the pair in the order the caller sent them. That is the best available answer
 * when the system genuinely does not know which came first.
 */
function madeAt(media: { takenAt: Date | null; uploadedAt: Date }): number {
  return (media.takenAt ?? media.uploadedAt).getTime();
}
