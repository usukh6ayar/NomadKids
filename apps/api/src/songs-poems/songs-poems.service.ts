import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  SONG_POEMS_PER_MONTH_MAX,
  type SongPoem,
  type SongPoemForm,
  type SongPoemLibrary,
  type SongPoemMonthInput,
} from "@kinder/contracts";
import type { Actor } from "../authz/actor";
import { ChildAccessService } from "../authz/child-access.service";
import { GroupAccessService } from "../authz/group-access.service";
import { AuditRepository } from "../audit/audit.repository";
import { UploadRejected, sanitiseFilename } from "../media/upload-validation";
import { StorageService } from "../storage/storage.service";
import { validateAttachment, validateCover } from "./song-poem-file";
import {
  SongsPoemsRepository,
  type AttachmentData,
  type CoverData,
  type SongPoemData,
} from "./songs-poems.repository";
import { TYPE_FROM_WIRE, libraryView, songPoemView } from "./songs-poems.view";

export interface UploadedPart {
  buffer: Buffer;
  originalname: string;
}

/**
 * Дуу, шүлэг — a group's library, a book per school month (#195, 2026-10-11).
 *
 * Who, decided in `authz/` and only called from here:
 *   - the group's own teacher and the director read and write —
 *     `assertCanReadGroup` (the director's writing added 2026-10-16, №21);
 *   - a family reads the library of their child's group now —
 *     `assertCanAccess` on the child (the fee gate included), and its files
 *     through `assertCanReadGroupContent`.
 * Everyone else: 404 (CLAUDE.md §1.7).
 */
@Injectable()
export class SongsPoemsService {
  constructor(
    private readonly repo: SongsPoemsRepository,
    private readonly groups: GroupAccessService,
    private readonly childAccess: ChildAccessService,
    private readonly storage: StorageService,
    private readonly audit: AuditRepository,
  ) {}

  async forGroup(actor: Actor, groupId: string): Promise<SongPoemLibrary> {
    const group = await this.groups.assertCanReadGroup(actor, groupId);
    return this.library(group);
  }

  /** The child's group now — never `Child.kindergartenId` (§1.2). In no group: 404. */
  async forChild(actor: Actor, childId: string): Promise<SongPoemLibrary> {
    await this.childAccess.assertCanAccess(actor, childId);
    const group = await this.repo.currentGroup(childId);
    if (!group) throw new NotFoundException();
    return this.library(group);
  }

  async saveMonth(actor: Actor, groupId: string, month: string, input: SongPoemMonthInput) {
    const group = await this.groups.assertCanReadGroup(actor, groupId);
    const row = await this.repo.saveMonth(
      group.kindergartenId,
      group.id,
      month,
      input.label,
      input.subtitle,
    );
    await this.record(actor, group.kindergartenId, "UPDATE", "SongPoemMonth", row.id, {
      month,
      label: input.label,
    });
    return { month, label: input.label, subtitle: input.subtitle };
  }

  async create(
    actor: Actor,
    groupId: string,
    form: SongPoemForm,
    cover: UploadedPart | undefined,
    file: UploadedPart | undefined,
  ): Promise<SongPoem> {
    const group = await this.groups.assertCanReadGroup(actor, groupId);
    if ((await this.repo.countInMonth(group.id, form.month)) >= SONG_POEMS_PER_MONTH_MAX) {
      throw new BadRequestException(
        `Нэг сард ${SONG_POEMS_PER_MONTH_MAX}-аас олон материал оруулах боломжгүй.`,
      );
    }

    const keys: string[] = [];
    try {
      const parts = await this.storeParts(group.kindergartenId, cover, file, keys);
      const row = await this.repo.create(group.kindergartenId, group.id, actor.userId, {
        ...formData(form),
        ...parts,
      });
      await this.record(actor, group.kindergartenId, "CREATE", "SongPoem", row.id, {
        month: form.month,
        title: form.title,
      });
      return songPoemView(row);
    } catch (error) {
      await this.removeObjects(keys);
      throw error;
    }
  }

  /** ★ A cover or file not sent is kept — an edit of the title must not wipe it. */
  async update(
    actor: Actor,
    groupId: string,
    id: string,
    form: SongPoemForm,
    cover: UploadedPart | undefined,
    file: UploadedPart | undefined,
  ): Promise<SongPoem> {
    const group = await this.groups.assertCanReadGroup(actor, groupId);
    const before = await this.repo.findInGroup(id, group.id);
    if (!before) throw new NotFoundException();

    const keys: string[] = [];
    let row;
    try {
      const parts = await this.storeParts(group.kindergartenId, cover, file, keys);
      row = await this.repo.update(id, { ...formData(form), ...parts });
    } catch (error) {
      await this.removeObjects(keys);
      throw error;
    }
    // Replaced objects are no longer referenced by anything.
    await this.removeObjects(
      [cover && before.coverKey, file && before.fileKey].filter((k): k is string => Boolean(k)),
    );

    await this.record(actor, group.kindergartenId, "UPDATE", "SongPoem", id, {
      before: { title: before.title, month: before.month },
      after: { title: form.title, month: form.month },
      coverReplaced: Boolean(cover),
      fileReplaced: Boolean(file),
    });
    return songPoemView(row);
  }

  async remove(actor: Actor, groupId: string, id: string): Promise<void> {
    const group = await this.groups.assertCanReadGroup(actor, groupId);
    const before = await this.repo.findInGroup(id, group.id);
    if (!before) throw new NotFoundException();
    await this.repo.softDelete(id);
    await this.record(actor, group.kindergartenId, "DELETE", "SongPoem", id, {
      title: before.title,
    });
  }

  /** The cover or the file: the group's staff, or a family with a child in it now. */
  async objectUrl(actor: Actor, id: string, which: "cover" | "file"): Promise<string> {
    const item = await this.repo.findObject(id);
    if (!item) throw new NotFoundException();
    await this.groups.assertCanReadGroupContent(actor, item.groupId);

    const key = which === "cover" ? item.coverKey : item.fileKey;
    if (!key) throw new NotFoundException();
    const name = which === "cover" ? item.coverName : item.fileName;
    return this.storage.presignedGetUrl(key, name ?? undefined, "inline");
  }

  private async library(group: { id: string; name: string }): Promise<SongPoemLibrary> {
    const [months, items] = await Promise.all([
      this.repo.listMonths(group.id),
      this.repo.listItems(group.id),
    ]);
    return libraryView(group, months, items);
  }

  /** Validates and stores whichever parts were sent; every key goes into `keys`. */
  private async storeParts(
    kindergartenId: string,
    cover: UploadedPart | undefined,
    file: UploadedPart | undefined,
    keys: string[],
  ): Promise<Partial<CoverData> & Partial<AttachmentData>> {
    try {
      const out: Partial<CoverData> & Partial<AttachmentData> = {};
      if (cover) {
        const image = await validateCover(cover.buffer);
        const key = this.storage.buildKindergartenKey(kindergartenId, "songs-poems");
        await this.storage.put(key, image.buffer, image.mimeType);
        keys.push(key);
        Object.assign(out, {
          coverKey: key,
          coverMimeType: image.mimeType,
          coverName: sanitiseFilename(cover.originalname),
        });
      }
      if (file) {
        const stored = await validateAttachment(file.buffer);
        const key = this.storage.buildKindergartenKey(kindergartenId, "songs-poems");
        await this.storage.put(key, stored.buffer, stored.mimeType);
        keys.push(key);
        Object.assign(out, {
          fileKey: key,
          fileMimeType: stored.mimeType,
          fileName: sanitiseFilename(file.originalname),
          fileSize: stored.buffer.length,
        });
      }
      return out;
    } catch (error) {
      if (error instanceof UploadRejected) throw new BadRequestException(error.reason);
      throw error;
    }
  }

  private async removeObjects(keys: string[]): Promise<void> {
    await Promise.allSettled(keys.map((key) => this.storage.delete(key)));
  }

  private record(
    actor: Actor,
    kindergartenId: string,
    action: "CREATE" | "UPDATE" | "DELETE",
    objectType: string,
    objectId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.append({
      action,
      kindergartenId,
      actorUserId: actor.userId,
      objectType,
      objectId,
      metadata,
    });
  }
}

function formData(form: SongPoemForm): SongPoemData {
  return {
    month: form.month,
    type: TYPE_FROM_WIRE[form.type],
    title: form.title,
    description: form.description,
    linkUrl: form.linkUrl,
  };
}
