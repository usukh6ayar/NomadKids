import { Injectable, NotFoundException } from "@nestjs/common";
import { localDate } from "@kinder/contracts";
import { AuditRepository } from "../audit/audit.repository";
import type { Actor } from "../authz/actor";
import { PlatformAccessService } from "../authz/platform-access.service";
import { paginate } from "../common/pagination";
import type {
  ListOfficialDocumentsQuery,
  OfficialDocumentInput,
  OfficialDocumentPatch,
} from "./official-documents.dto";
import { OfficialDocumentsRepository } from "./official-documents.repository";

type Row = NonNullable<Awaited<ReturnType<OfficialDocumentsRepository["findLive"]>>>;

/**
 * «Үндсэн баримт бичиг» — the ministry register, editable by the platform
 * operator (backend list №7, 2026-10-20 the user: "супер админ ... засаж
 * устгаж шинээр нэмж"). Replaces the list shipped in the web's code, which
 * the migration seeded with its 37 entries.
 *
 * ★ Read by the operator and any kindergarten's staff; written by the
 * operator alone — 404 for anyone else (§1.7). Soft delete, every write
 * audited with what it replaced (§3.2).
 */
@Injectable()
export class OfficialDocumentsService {
  constructor(
    private readonly repo: OfficialDocumentsRepository,
    private readonly platform: PlatformAccessService,
    private readonly audit: AuditRepository,
  ) {}

  async list(actor: Actor, query: ListOfficialDocumentsQuery) {
    this.platform.assertCanReadOfficialDocuments(actor);
    const { items, total } = await this.repo.list(query);
    return paginate(items.map(view), total, query);
  }

  async create(actor: Actor, input: OfficialDocumentInput) {
    this.platform.assertSuperAdmin(actor);
    const row = await this.repo.create({
      ...input,
      checkedOn: today(),
      createdById: actor.userId,
    });
    await this.audit.append({
      action: "CREATE",
      actorUserId: actor.userId,
      objectType: "OfficialDocument",
      objectId: row.id,
      metadata: { after: view(row) },
    });
    return view(row);
  }

  /** Saving it is the operator checking it: `checkedOn` becomes today. */
  async update(actor: Actor, id: string, patch: OfficialDocumentPatch) {
    this.platform.assertSuperAdmin(actor);
    const before = await this.repo.findLive(id);
    if (!before) throw new NotFoundException();

    const row = await this.repo.update(id, { ...patch, checkedOn: today() });
    await this.audit.append({
      action: "UPDATE",
      actorUserId: actor.userId,
      objectType: "OfficialDocument",
      objectId: id,
      metadata: { before: view(before), after: view(row) },
    });
    return view(row);
  }

  async remove(actor: Actor, id: string): Promise<void> {
    this.platform.assertSuperAdmin(actor);
    const before = await this.repo.findLive(id);
    if (!before) throw new NotFoundException();

    if (!(await this.repo.softDelete(id, new Date()))) throw new NotFoundException();
    await this.audit.append({
      action: "DELETE",
      actorUserId: actor.userId,
      objectType: "OfficialDocument",
      objectId: id,
      metadata: { before: view(before) },
    });
  }
}

function today(): Date {
  return new Date(`${localDate()}T00:00:00.000Z`);
}

/** One entry as the web reads it — `apps/web/lib/official-documents-api.ts`. */
function view(row: Row) {
  return {
    id: row.id,
    code: row.code,
    category: row.category,
    title: row.title,
    year: row.year,
    number: row.number,
    url: row.url,
    sourceLevel: row.sourceLevel,
    reviewRequired: row.reviewRequired,
    audience: row.audience,
    notes: row.notes,
    checkedOn: row.checkedOn ? row.checkedOn.toISOString().slice(0, 10) : null,
    featured: row.featured,
  };
}
