import { BadRequestException, Injectable } from "@nestjs/common";
import {
  CURRENT_AGREEMENT_VERSIONS,
  type AcceptAgreement,
  type ListAgreementAcceptancesQuery,
} from "@kinder/contracts";
import { AuditRepository } from "../audit/audit.repository";
import type { Actor } from "../authz/actor";
import { PlatformAccessService } from "../authz/platform-access.service";
import { paginate, toSkipTake } from "../common/pagination";
import { Role } from "../domain/enums";
import { AgreementsRepository } from "./agreements.repository";

/**
 * User agreements accepted on first sign-in (#211, the user 2026-10-12).
 *
 * ★ The server decides what may be accepted: the **current** version of a
 * kind (`CURRENT_AGREEMENT_VERSIONS`), and only a kind that is the person's —
 * TEACHER for someone who teaches, PARENT for a guardian. Otherwise the
 * record would say whatever a request typed, and prove nothing.
 */
@Injectable()
export class AgreementsService {
  constructor(
    private readonly repo: AgreementsRepository,
    private readonly platform: PlatformAccessService,
    private readonly audit: AuditRepository,
  ) {}

  async mine(actor: Actor) {
    const rows = await this.repo.forUser(actor.userId);
    return {
      accepted: rows.map((row) => ({
        kind: row.kind,
        version: row.version,
        acceptedAt: row.acceptedAt.toISOString(),
      })),
    };
  }

  async accept(
    actor: Actor,
    dto: AcceptAgreement,
    ctx: { ipAddress: string | null; userAgent: string | null },
  ) {
    const role = dto.kind === "TEACHER" ? Role.TEACHER : Role.PARENT;
    if (!actor.memberships.some((m) => m.role === role)) {
      throw new BadRequestException("Энэ гэрээ таны эрхэд хамаарахгүй");
    }
    if (dto.version !== CURRENT_AGREEMENT_VERSIONS[dto.kind]) {
      throw new BadRequestException(
        "Гэрээний хувилбар шинэчлэгдсэн байна. Хуудсаа дахин ачаална уу.",
      );
    }

    const { row, created } = await this.repo.append({
      userId: actor.userId,
      kind: dto.kind,
      version: dto.version,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    if (created) {
      await this.audit.append({
        action: "CREATE",
        actorUserId: actor.userId,
        objectType: "AgreementAcceptance",
        objectId: row.id,
        metadata: { kind: row.kind, version: row.version },
      });
    }
    return { kind: row.kind, version: row.version, acceptedAt: row.acceptedAt.toISOString() };
  }

  /** The operator's view: who accepted which version, and when. */
  async list(actor: Actor, query: ListAgreementAcceptancesQuery) {
    this.platform.assertSuperAdmin(actor);
    const page = { page: query.page, pageSize: query.pageSize };
    const [rows, total] = await this.repo.list(
      { kind: query.kind, version: query.version },
      toSkipTake(page),
    );
    return paginate(rows, total, page);
  }
}
