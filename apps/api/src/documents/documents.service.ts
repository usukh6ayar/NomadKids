import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { StorageService } from "../storage/storage.service";
import { MediaRepository } from "../media/media.repository";
import {
  sanitiseFilename,
  UploadRejected,
  validateImageUpload,
  validatePdfUpload,
} from "../media/upload-validation";
import { paginate, type PageParams } from "../common/pagination";
import { DocumentsRepository } from "./documents.repository";
import type { CreateDocumentDto, ListDocumentsQuery, UpdateDocumentDto } from "./documents.dto";

@Injectable()
export class DocumentsService {
  constructor(
    private readonly repo: DocumentsRepository,
    private readonly media: MediaRepository,
    private readonly storage: StorageService,
    private readonly tenants: TenantAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * The library — RFP §9.
   *
   * ★ Staff only, everywhere in this service.
   *
   * §9 opens with "Багшид зориулсан PDF баримт бичгийн сан". Curricula and
   * methodology are professional material, and `assertStaff` is the check on
   * reading as well as writing.
   */
  async list(actor: Actor, kindergartenId: string, query: ListDocumentsQuery, page: PageParams) {
    this.tenants.assertStaff(actor, kindergartenId);

    /*
      ★ A teacher sees their groups' documents; an administrator sees all —
      2026-09-06.

      The client asked that a document filed against a group reach "зөвхөн тэр
      багш руу н л". An administrator is exempt because they are the one
      filing: a director who could not see what they had just published to
      Дэлбээ could not check it, and every route in this module is already
      `assertStaff`-gated to the kindergarten.

      `null` here means "no narrowing"; `[]` means "narrowed to nothing but the
      kindergarten-wide documents", which is what an unassigned teacher should
      get. See `DocumentsRepository.list`.
    */
    const visibleGroupIds = this.tenants.isAdmin(actor, kindergartenId)
      ? null
      : await this.repo.teachingGroupIds(actor.userId, kindergartenId);

    const { items, total } = await this.repo.list(
      kindergartenId,
      actor.userId,
      {
        q: query.q,
        category: query.category,
        bookmarkedOnly: query.bookmarkedOnly,
        visibleGroupIds,
      },
      page,
    );

    // The per-reader bookmark rows are flattened to a boolean here: a client
    // that received the rows could count them and learn how many colleagues had
    // bookmarked it, which is not a fact this feature offers.
    return paginate(
      items.map(({ bookmarks, ...doc }) => ({ ...doc, isBookmarked: bookmarks.length > 0 })),
      total,
      page,
    );
  }

  async listCategories(actor: Actor, kindergartenId: string) {
    this.tenants.assertStaff(actor, kindergartenId);
    return this.repo.listCategories(kindergartenId);
  }

  /**
   * Publishes a document: the PDF, optionally a cover, and the metadata.
   *
   * The file is validated by **content** (CLAUDE.md §1.6) and stored under a
   * random key in the private bucket, exactly like every other upload. It is
   * only ever served through `/media/:id`, which checks staff membership first.
   */
  async create(
    actor: Actor,
    kindergartenId: string,
    dto: CreateDocumentDto,
    file: { buffer: Buffer; originalname: string },
    cover?: { buffer: Buffer; originalname: string },
  ) {
    this.tenants.assertStaff(actor, kindergartenId);

    /*
      The audience id comes from a client, so it is checked against this
      kindergarten before it is stored — otherwise a document could be filed
      against another kindergarten's group and would be invisible to everyone.
      §1.1's rule: the screen narrows, the server decides.
    */
    if (dto.groupId) {
      const group = await this.repo.findGroupInKindergarten(dto.groupId, kindergartenId);
      if (!group) throw new BadRequestException("Бүлэг олдсонгүй");
    }

    const validated = await this.validatePdf(file);
    const storageKey = this.storage.buildKindergartenKey(kindergartenId, "documents");
    await this.storage.put(storageKey, validated.buffer, validated.mimeType);

    const fileMedia = await this.media.create({
      kindergartenId,
      purpose: "DOCUMENT",
      storageKey,
      originalName: sanitiseFilename(file.originalname),
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      width: null,
      height: null,
      caption: null,
      order: 0,
      uploadedById: actor.userId,
    });

    const coverMediaId = cover ? await this.storeCover(actor, kindergartenId, cover) : null;

    const document = await this.repo.create({
      kindergartenId,
      title: dto.title,
      category: dto.category ?? null,
      description: dto.description ?? null,
      version: dto.version ?? null,
      // Null is every group — see `Document.groupId`.
      groupId: dto.groupId ?? null,
      fileMediaFileId: fileMedia.id,
      coverMediaFileId: coverMediaId,
      publishedById: actor.userId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Document",
      objectId: document.id,
      metadata: { title: dto.title, sizeBytes: validated.sizeBytes },
    });

    return document;
  }

  async update(actor: Actor, id: string, dto: UpdateDocumentDto) {
    const document = await this.requireStaffOwned(actor, id);

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.version !== undefined) data.version = dto.version;
    if (dto.groupId !== undefined) {
      // Re-checked on every write, not only on create: an edit can change the
      // audience, and the id is as much a client's claim here as it was there.
      if (dto.groupId) {
        const group = await this.repo.findGroupInKindergarten(dto.groupId, document.kindergartenId);
        if (!group) throw new BadRequestException("Бүлэг олдсонгүй");
      }
      data.groupId = dto.groupId;
    }

    const saved = await this.repo.update(id, data);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: document.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Document",
      objectId: id,
      metadata: { fields: Object.keys(data) },
    });

    return saved;
  }

  /**
   * Replaces the PDF — RFP §9's "Баримт шинэ хувилбараар солих".
   *
   * The previous file is retired in the same transaction that attaches the new
   * one: `fileMediaFileId` is `@unique`, so leaving the old row live would both
   * orphan its bytes and stop the new one claiming the column. Same shape as
   * replacing a kindergarten logo.
   */
  async replaceFile(
    actor: Actor,
    id: string,
    file: { buffer: Buffer; originalname: string },
    version: string | null,
  ) {
    const document = await this.requireStaffOwned(actor, id);

    const validated = await this.validatePdf(file);
    const storageKey = this.storage.buildKindergartenKey(document.kindergartenId, "documents");
    await this.storage.put(storageKey, validated.buffer, validated.mimeType);

    const media = await this.media.create({
      kindergartenId: document.kindergartenId,
      purpose: "DOCUMENT",
      storageKey,
      originalName: sanitiseFilename(file.originalname),
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      width: null,
      height: null,
      caption: null,
      order: 0,
      uploadedById: actor.userId,
    });

    const saved = await this.repo.replaceFile(id, media.id, version);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: document.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Document",
      objectId: id,
      metadata: { replacedFile: true, version },
    });

    return saved;
  }

  async remove(actor: Actor, id: string) {
    const document = await this.requireStaffOwned(actor, id);
    await this.repo.softDelete(id);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: document.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Document",
      objectId: id,
    });

    return { id };
  }

  /** RFP §9's "Bookmark хийх" — per reader, idempotent. */
  async setBookmark(actor: Actor, id: string, bookmarked: boolean) {
    const document = await this.requireStaffOwned(actor, id);

    if (bookmarked) {
      await this.repo.addBookmark(document.kindergartenId, id, actor.userId);
    } else {
      await this.repo.removeBookmark(id, actor.userId);
    }

    return { id, isBookmarked: bookmarked };
  }

  /**
   * Loads a document and proves the actor is staff of its kindergarten.
   *
   * The tenant is read from the row, never from the path — which is what makes
   * a pasted id from another kindergarten a 404 rather than a write.
   */
  private async requireStaffOwned(actor: Actor, id: string) {
    const document = await this.repo.findById(id);
    if (!document) throw new NotFoundException();
    this.tenants.assertStaff(actor, document.kindergartenId);
    return document;
  }

  private async validatePdf(file: { buffer: Buffer }) {
    try {
      return await validatePdfUpload(file.buffer);
    } catch (error) {
      if (error instanceof UploadRejected) throw new BadRequestException(error.reason);
      throw error;
    }
  }

  /** The cover is an ordinary image, so it goes through the image validator. */
  private async storeCover(
    actor: Actor,
    kindergartenId: string,
    cover: { buffer: Buffer; originalname: string },
  ): Promise<string> {
    let validated;
    try {
      validated = await validateImageUpload(cover.buffer);
    } catch (error) {
      if (error instanceof UploadRejected) throw new BadRequestException(error.reason);
      throw error;
    }

    const key = this.storage.buildKindergartenKey(kindergartenId, "documents");
    await this.storage.put(key, validated.buffer, validated.mimeType);

    const media = await this.media.create({
      kindergartenId,
      purpose: "DOCUMENT_COVER",
      storageKey: key,
      originalName: sanitiseFilename(cover.originalname),
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      width: validated.width,
      height: validated.height,
      caption: null,
      order: 0,
      uploadedById: actor.userId,
    });

    return media.id;
  }
}
