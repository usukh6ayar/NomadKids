import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import type { Actor } from "../authz/actor";
import { PlatformAccessService } from "../authz/platform-access.service";
import { StorageService } from "../storage/storage.service";
import { SoloDeleteRepository } from "./solo-delete.repository";

/**
 * The operator deletes a solo teacher's workspace — the user, 2026-10-18:
 * the client's trial opened many made-up accounts. «Устгах» is a soft delete
 * (CLAUDE.md §3.2) at any time; «Бүр мөсөн устгах» removes the rows, only
 * where no money ever moved, and only once the operator has typed the
 * teacher's username.
 *
 * ★ Superadmin only — `assertSuperAdmin` first, 404 for anyone else (§1.7).
 */
@Injectable()
export class SoloDeleteService {
  private readonly logger = new Logger(SoloDeleteService.name);

  constructor(
    private readonly repo: SoloDeleteRepository,
    private readonly platform: PlatformAccessService,
    private readonly audit: AuditRepository,
    private readonly storage: StorageService,
  ) {}

  /** «Устгах» — nobody signs in to it again; the rows stay, restorable. */
  async softDelete(actor: Actor, id: string) {
    this.platform.assertSuperAdmin(actor);
    const workspace = await this.repo.workspace(id);
    if (!workspace || workspace.deletedAt) throw new NotFoundException();

    const money = await this.repo.moneyMoved(id);
    const result = await this.repo.softDelete(id, new Date());

    await this.audit.append({
      action: "DELETE",
      kindergartenId: id,
      actorUserId: actor.userId,
      objectType: "Kindergarten",
      objectId: id,
      metadata: {
        kind: "SOLO_TEACHER",
        mode: "soft",
        name: workspace.name,
        membershipsDeleted: result.memberships,
        usersDeleted: result.users,
        paidAccessFees: money.paidAccessFees,
      },
    });

    return { id, mode: "soft" as const, ...result };
  }

  /**
   * What «Бүр мөсөн устгах» would remove — the purge itself, rolled back — and
   * whether money moved, which refuses it. Shown before the operator types.
   */
  async purgePreview(actor: Actor, id: string) {
    this.platform.assertSuperAdmin(actor);
    const workspace = await this.repo.workspace(id);
    if (!workspace) throw new NotFoundException();
    const money = await this.repo.moneyMoved(id);
    const result = await this.repo.purge(id, { preview: true });
    return {
      id,
      purgeable: !Object.values(money).some((count) => count > 0),
      money,
      deleted: result.deleted,
      usersDeleted: result.usersDeleted,
      usersKept: result.usersKept,
      files: result.storageKeys.length,
    };
  }

  /**
   * «Бүр мөсөн устгах» — the user's one exception to §3.2 (2026-10-18). The
   * workspace's rows and its people go; the audit log stays, and one row more
   * says who removed what. Refused while any money moved through it (§14).
   */
  async purge(actor: Actor, id: string, dto: { username: string }) {
    this.platform.assertSuperAdmin(actor);
    const workspace = await this.repo.workspace(id);
    if (!workspace) throw new NotFoundException();

    const teacher = await this.repo.teacher(id);
    if (!teacher || teacher.user.username !== dto.username.trim()) {
      throw new BadRequestException("Нэвтрэх нэр таарахгүй байна.");
    }

    const money = await this.repo.moneyMoved(id);
    if (Object.values(money).some((count) => count > 0)) {
      throw new ConflictException(
        "Энэ бүртгэлээр төлбөр төлөгдсөн тул бүр мөсөн устгах боломжгүй. «Устгах»-ыг ашиглана уу.",
      );
    }

    const result = await this.repo.purge(id);

    // ★ The row is gone, so its `kindergartenId` is in the metadata, not the column.
    await this.audit.append({
      action: "DELETE",
      kindergartenId: null,
      actorUserId: actor.userId,
      objectType: "Kindergarten",
      objectId: id,
      metadata: {
        kind: "SOLO_TEACHER",
        mode: "purge",
        kindergartenId: id,
        name: workspace.name,
        teacherUsername: teacher.user.username,
        deleted: result.deleted,
        usersDeleted: result.usersDeleted,
        usersKept: result.usersKept,
        files: result.storageKeys.length,
      },
    });

    // After the commit: a rolled-back purge must not have taken a photo.
    let filesFailed = 0;
    for (const key of result.storageKeys) {
      try {
        await this.storage.delete(key);
      } catch (error) {
        filesFailed += 1;
        this.logger.warn(`purge ${id}: could not delete ${key}: ${String(error)}`);
      }
    }

    return {
      id,
      mode: "purge" as const,
      deleted: result.deleted,
      usersDeleted: result.usersDeleted,
      usersKept: result.usersKept,
      files: result.storageKeys.length,
      filesFailed,
    };
  }
}
