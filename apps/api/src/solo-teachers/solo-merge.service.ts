import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  SoloMergeInput,
  SoloMergePreview,
  SoloMergeRefusal,
  SoloMergeResult,
  SoloWorkspace,
} from "@kinder/contracts";
import type { Actor } from "../authz/actor";
import { PlatformAccessService } from "../authz/platform-access.service";
import { AuditRepository } from "../audit/audit.repository";
import { paginate, toSkipTake, type PageParams } from "../common/pagination";
import { MergeRefused, SoloMergeRepository } from "./solo-merge.repository";

/**
 * D3 — the platform operator merges a solo teacher's workspace into the
 * contracted kindergarten they work at (the user, 2026-10-11: the operator
 * merges, nothing is lost, ESIS follows afterwards).
 *
 * The operator only: `PlatformAccessService`, 404 for everyone else.
 */
@Injectable()
export class SoloMergeService {
  constructor(
    private readonly repo: SoloMergeRepository,
    private readonly platform: PlatformAccessService,
    private readonly audit: AuditRepository,
  ) {}

  async list(actor: Actor, query: PageParams) {
    this.platform.assertSuperAdmin(actor);
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.repo.listWorkspaces(skip, take);
    const items: SoloWorkspace[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      location: row.location,
      workplace: row.soloWorkplaceName,
      childCount: row._count.children,
      createdAt: row.createdAt.toISOString(),
    }));
    return paginate(items, total, query);
  }

  /** The merge run and rolled back: its exact counts, or why it would stop. */
  async preview(actor: Actor, soloId: string, input: SoloMergeInput): Promise<SoloMergePreview> {
    this.platform.assertSuperAdmin(actor);
    const targetGroups = await this.repo.targetGroups(input.targetKindergartenId);
    try {
      const result = await this.repo.merge(soloId, input.targetKindergartenId, {
        preview: true,
        groupNameFor: groupName(input),
        targetGroupId: input.targetGroupId,
        keepSeparate: input.keepSeparate,
      });
      return { ok: true, result, targetGroups };
    } catch (error) {
      if (error instanceof MergeRefused) {
        return { ok: false, refusal: error.refusal, targetGroups };
      }
      throw error;
    }
  }

  async merge(actor: Actor, soloId: string, input: SoloMergeInput): Promise<SoloMergeResult> {
    this.platform.assertSuperAdmin(actor);
    let result: SoloMergeResult;
    try {
      result = await this.repo.merge(soloId, input.targetKindergartenId, {
        preview: false,
        groupNameFor: groupName(input),
        targetGroupId: input.targetGroupId,
        keepSeparate: input.keepSeparate,
      });
    } catch (error) {
      if (error instanceof MergeRefused) {
        if (error.refusal.kind === "notMergeable") throw new NotFoundException();
        throw new ConflictException(refusalSentence(error.refusal));
      }
      throw error;
    }

    // Both sides' logs, so either kindergarten's history shows what happened.
    for (const kindergartenId of [soloId, input.targetKindergartenId]) {
      await this.audit.append({
        action: "UPDATE",
        kindergartenId,
        actorUserId: actor.userId,
        objectType: "SoloWorkspaceMerge",
        objectId: soloId,
        metadata: { from: soloId, into: input.targetKindergartenId, ...result },
      });
    }
    return result;
  }
}

function groupName(input: SoloMergeInput) {
  return (name: string) => input.groupName ?? `${name} (бие даасан)`;
}

function refusalSentence(refusal: SoloMergeRefusal): string {
  switch (refusal.kind) {
    case "blocked":
      return `Багшийн орчинд нэгтгэх боломжгүй өгөгдөл байна: ${Object.keys(refusal.tables).join(", ")}.`;
    case "duplicates":
      return `Цэцэрлэгт ижил хүүхэд аль хэдийн бүртгэлтэй байна: ${refusal.children.map((c) => c.name).join(", ")}.`;
    case "conflict":
      return `Нэгтгэхэд давхардал гарлаа (${refusal.constraint}). Юу ч өөрчлөгдөөгүй.`;
    case "ambiguous":
      return `Нэг хүүхэд цэцэрлэгийн хэд хэдэн хүүхэдтэй таарч байна: ${refusal.children.map((c) => c.name).join(", ")}. Тусад нь үлдээх эсэхийг сонгоно уу.`;
    case "badGroup":
      return "Сонгосон бүлэг тухайн цэцэрлэгийн одоогийн хичээлийн жилд алга.";
    case "noSchoolYear":
      return "Цэцэрлэгт идэвхтэй хичээлийн жил алга.";
    default:
      return "Нэгтгэх боломжгүй.";
  }
}
