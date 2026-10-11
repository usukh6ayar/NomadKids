import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  MATERIAL_PREVIEWS_MAX,
  type Material,
  type MaterialForm,
  type MaterialListQuery,
  type PlatformMaterial,
  type QpayInvoiceAttempt,
} from "@kinder/contracts";
import type { Actor } from "../authz/actor";
import { PlatformAccessService } from "../authz/platform-access.service";
import { AuditRepository } from "../audit/audit.repository";
import { paginate, toSkipTake } from "../common/pagination";
import { QpayService } from "../integrations/qpay/qpay.service";
import { UploadRejected, sanitiseFilename } from "../media/upload-validation";
import { StorageService } from "../storage/storage.service";
import { materialExtension, validateMaterialFile } from "./material-file";
import { preparePreview } from "./material-preview";
import {
  MaterialsRepository,
  type MaterialData,
  type MaterialFileData,
  type PreviewData,
} from "./materials.repository";
import { materialView, platformMaterialView } from "./materials.view";

export interface UploadedPart {
  buffer: Buffer;
  originalname: string;
}

/**
 * Сургалтын хэрэглэгдэхүүн — the platform's lessons, sold to teachers one at a
 * time through QPay (client, 2026-10-09; CLAUDE.md §7).
 *
 * Who: the shop, buying and downloading are a **teacher's** (`@Roles` on the
 * controller — not a director, not a family); the catalog is the platform
 * operator's (`PlatformAccessService`). 404 for everyone else, and a material
 * the reader does not own downloads as the same 404 as one that does not exist.
 *
 * ★ The sale is the platform's revenue: no `Payment` row, no kindergarten.
 */
@Injectable()
export class MaterialsService {
  constructor(
    private readonly repo: MaterialsRepository,
    private readonly platform: PlatformAccessService,
    private readonly qpay: QpayService,
    private readonly storage: StorageService,
    private readonly audit: AuditRepository,
  ) {}

  // ── The shop ─────────────────────────────────────────────────────────────

  async shop(actor: Actor, query: MaterialListQuery) {
    const { skip, take } = toSkipTake(query);
    const { items, total } = await this.repo.listShop({
      q: query.q || undefined,
      area: query.area || undefined,
      level: query.level,
      skip,
      take,
    });
    const owned = await this.repo.ownedIds(
      actor.userId,
      items.map((i) => i.id),
    );
    return paginate(
      items.map((row) => materialView(row, owned.has(row.id))),
      total,
      query,
    );
  }

  async owned(actor: Actor): Promise<Material[]> {
    const rows = await this.repo.listOwned(actor.userId);
    return rows.map((row) => materialView(row, true));
  }

  /**
   * Starts paying for a material, or answers how far it got.
   *
   * ★ A free material never reaches QPay (it would refuse a 0₮ invoice): the
   * purchase is PAID at once, and the answer is the PAID attempt the buy
   * dialog already treats as success.
   */
  async startPurchase(actor: Actor, materialId: string): Promise<QpayInvoiceAttempt> {
    const material = await this.repo.findOnSale(materialId);
    if (!material) throw new NotFoundException();

    const purchase = await this.repo.ensurePurchase(material.id, actor.userId, material.price);
    if (purchase.status === "PAID") {
      throw new BadRequestException("Энэ хэрэглэгдэхүүн таны санд аль хэдийн байна.");
    }

    if (material.price === 0) {
      const now = new Date();
      if (await this.repo.markFree(purchase.id, now)) {
        await this.audit.append({
          action: "UPDATE",
          actorUserId: actor.userId,
          objectType: "MaterialPurchase",
          objectId: purchase.id,
          metadata: { before: { status: "UNPAID" }, after: { status: "PAID" }, free: true },
        });
      }
      return freeAttempt(purchase.id, now);
    }

    // While unpaid, the purchase follows the price a new QR is drawn for.
    if (purchase.amount !== material.price) {
      await this.repo.setUnpaidAmount(purchase.id, material.price);
    }
    const row = await this.qpay.createForMaterialPurchase(actor, {
      id: purchase.id,
      amount: material.price,
      title: material.title,
    });
    return attemptView(row);
  }

  async purchaseStatus(actor: Actor, materialId: string): Promise<QpayInvoiceAttempt> {
    const purchase = await this.repo.findPurchase(materialId, actor.userId);
    if (!purchase) throw new NotFoundException();

    const row = await this.qpay.statusForMaterialPurchase(purchase.id);
    if (row) return attemptView(row);
    if (purchase.status === "PAID") return freeAttempt(purchase.id, purchase.paidAt ?? new Date());
    throw new NotFoundException();
  }

  /** The file, to its owner only: our `Content-Type`, as an attachment, five minutes. */
  async downloadUrl(actor: Actor, materialId: string): Promise<string> {
    const material = await this.repo.findOwned(materialId, actor.userId);
    if (!material) throw new NotFoundException();

    await this.audit.append({
      action: "DOWNLOAD",
      actorUserId: actor.userId,
      objectType: "TeachingMaterial",
      objectId: material.id,
    });
    const name = `${material.title}${materialExtension(material.mimeType)}`;
    return this.storage.presignedGetUrl(material.storageKey, name, "attachment");
  }

  /**
   * A sample page: to any teacher while the material is on sale, to its owner
   * after it is not, and to the operator always.
   */
  async previewUrl(actor: Actor, materialId: string, order: number): Promise<string> {
    const preview = await this.repo.findPreview(materialId, order);
    if (!preview) throw new NotFoundException();

    const onSale = preview.material.published && preview.material.deletedAt === null;
    const allowed =
      actor.isSuperAdmin || onSale || (await this.repo.isOwnedBy(materialId, actor.userId));
    if (!allowed) throw new NotFoundException();

    return this.storage.presignedGetUrl(preview.storageKey);
  }

  // ── The operator's catalog ───────────────────────────────────────────────

  async catalog(actor: Actor): Promise<PlatformMaterial[]> {
    this.platform.assertSuperAdmin(actor);
    const { items, sales } = await this.repo.listAll();
    return items.map((row) => platformMaterialView(row, sales.get(row.id) ?? 0));
  }

  async create(
    actor: Actor,
    form: MaterialForm,
    file: UploadedPart | undefined,
    previews: UploadedPart[],
  ): Promise<PlatformMaterial> {
    this.platform.assertSuperAdmin(actor);
    if (!file) throw new BadRequestException("PDF эсвэл PowerPoint файлаа хавсаргана уу.");
    const data = await this.formData(form);
    const pages = await this.preparePreviews(previews);

    const stored = await this.storeFile(file);
    const keys = [stored.storageKey];
    try {
      const savedPreviews = await this.storePreviews(pages, keys);
      const { id } = await this.repo.create({ ...data, ...stored }, savedPreviews, actor.userId);
      await this.record(actor, "CREATE", id, { title: data.title, price: data.price });
      return this.platformView(id);
    } catch (error) {
      await this.removeObjects(keys);
      throw error;
    }
  }

  /**
   * ★ Replaces the file and the sample pages **only when new ones are sent**;
   * an edit of the title must not wipe what the operator did not touch.
   */
  async update(
    actor: Actor,
    id: string,
    form: MaterialForm,
    file: UploadedPart | undefined,
    previews: UploadedPart[],
  ): Promise<PlatformMaterial> {
    this.platform.assertSuperAdmin(actor);
    const before = await this.repo.findLive(id);
    if (!before) throw new NotFoundException();

    const data = await this.formData(form);
    const pages = previews.length > 0 ? await this.preparePreviews(previews) : null;

    const keys: string[] = [];
    let unused: string[];
    try {
      const stored = file ? await this.storeFile(file) : null;
      if (stored) keys.push(stored.storageKey);
      const savedPreviews = pages ? await this.storePreviews(pages, keys) : null;
      unused = await this.repo.update(id, data, stored, savedPreviews);
    } catch (error) {
      await this.removeObjects(keys);
      throw error;
    }
    // After the commit: nothing points at these any more.
    await this.removeObjects(unused);

    await this.record(actor, "UPDATE", id, {
      before: { title: before.title, price: before.price, published: before.published },
      after: { title: data.title, price: data.price, published: data.published },
      fileReplaced: Boolean(file),
      previewsReplaced: Boolean(pages),
    });
    return this.platformView(id);
  }

  /** Off the shop; every buyer keeps it, so the file stays in the bucket. */
  async remove(actor: Actor, id: string): Promise<void> {
    this.platform.assertSuperAdmin(actor);
    const before = await this.repo.findLive(id);
    if (!before) throw new NotFoundException();
    await this.repo.softDelete(id);
    await this.record(actor, "DELETE", id, { title: before.title });
  }

  /**
   * Phase 2 of the contract: the server drawing sample pages from the file
   * needs poppler and LibreOffice in the worker image, which it does not have.
   */
  async regeneratePreviews(actor: Actor, id: string): Promise<never> {
    this.platform.assertSuperAdmin(actor);
    if (!(await this.repo.findLive(id))) throw new NotFoundException();
    throw new BadRequestException(
      "Жишээ хуудсыг автоматаар үүсгэх боломж хараахан нээгдээгүй. Зургаа гараар оруулна уу.",
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async formData(form: MaterialForm): Promise<MaterialData> {
    const areas = await this.repo.systemAreaNames();
    if (!areas.has(form.area)) {
      throw new BadRequestException(`Ийм сургалтын чиглэл алга: ${form.area}`);
    }
    return {
      title: form.title,
      description: form.description || null,
      area: form.area,
      level: form.level ?? null,
      price: form.price,
      contents: form.contents,
      published: form.published,
    };
  }

  private async preparePreviews(parts: UploadedPart[]) {
    if (parts.length > MATERIAL_PREVIEWS_MAX) {
      throw new BadRequestException(`Жишээ зураг ${MATERIAL_PREVIEWS_MAX} хүртэл байна.`);
    }
    try {
      return await Promise.all(parts.map((p) => preparePreview(p.buffer)));
    } catch (error) {
      if (error instanceof UploadRejected) throw new BadRequestException(error.reason);
      throw error;
    }
  }

  private async storeFile(file: UploadedPart): Promise<MaterialFileData> {
    let validated;
    try {
      validated = validateMaterialFile(file.buffer);
    } catch (error) {
      if (error instanceof UploadRejected) throw new BadRequestException(error.reason);
      throw error;
    }
    const storageKey = this.storage.buildPlatformKey("materials");
    await this.storage.put(storageKey, validated.buffer, validated.mimeType);
    return {
      fileType: validated.fileType,
      storageKey,
      originalName: sanitiseFilename(file.originalname),
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
    };
  }

  /** Stores each page; every key is pushed to `keys` so a failure can clean up. */
  private async storePreviews(
    pages: { buffer: Buffer; mimeType: string }[],
    keys: string[],
  ): Promise<PreviewData[]> {
    const saved: PreviewData[] = [];
    for (const page of pages) {
      const storageKey = this.storage.buildPlatformKey("material-previews");
      await this.storage.put(storageKey, page.buffer, page.mimeType);
      keys.push(storageKey);
      saved.push({ storageKey, mimeType: page.mimeType });
    }
    return saved;
  }

  private async removeObjects(keys: string[]): Promise<void> {
    await Promise.allSettled(keys.map((key) => this.storage.delete(key)));
  }

  private async platformView(id: string): Promise<PlatformMaterial> {
    const row = await this.repo.findLive(id);
    if (!row) throw new NotFoundException();
    const sales = await this.repo.salesFor([id]);
    return platformMaterialView(row, sales.get(id) ?? 0);
  }

  private record(
    actor: Actor,
    action: "CREATE" | "UPDATE" | "DELETE",
    id: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.append({
      action,
      actorUserId: actor.userId,
      objectType: "TeachingMaterial",
      objectId: id,
      metadata,
    });
  }
}

function attemptView(row: {
  id: string;
  status: QpayInvoiceAttempt["status"];
  amount: { toFixed(digits: number): string };
  qrText: string | null;
  qrImage: string | null;
  expiresAt: Date | null;
  paidAt: Date | null;
}): QpayInvoiceAttempt {
  return {
    id: row.id,
    status: row.status,
    amount: row.amount.toFixed(2),
    qrText: row.qrText,
    qrImage: row.qrImage,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
  };
}

/** A free material's "attempt": paid, with nothing to scan. */
function freeAttempt(purchaseId: string, paidAt: Date): QpayInvoiceAttempt {
  return {
    id: purchaseId,
    status: "PAID",
    amount: "0.00",
    qrText: null,
    qrImage: null,
    expiresAt: null,
    paidAt: paidAt.toISOString(),
  };
}
